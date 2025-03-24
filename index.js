require("dotenv").config();
const {processCampaigns} = require('./processCampaigns.js');
const CronJob = require("cron").CronJob;
const express = require('express');
const Rethink = require('rethinkdb');
const { InstaService } = require("./Insta.js");
const { CampaignPostingService } = require("./Process.js");
const { PostQueue } = require("./PostQueue.js");
const { WitnessChainAdapter } = require("./WitnessChainApiAdapter.js");


const app = express()

const port = process.env.PORT || 4000;

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    main();
})

const dbConfig = {
    host: 'localhost',
    port: 28015,
    db: 'InstaPub'
}

const SUCCESS = true;
const FAILURE = false;
const NO_POSTS_PENDING = false;

//Instagram client
let ic = null;
//Post queue
let pq = null;
//db connection
let db = null;
//Witnesschain API adapter
let wc = null;
const feedRequestSize = 50;

async function main(){
    ic = await InstaService.create(process.env.IG_USERNAME, process.env.IG_PASSWORD);

    //Inittialize db connection
    db = await Rethink.connect(dbConfig);
    //Check if 'processed_period' table exists
    const tables = await Rethink
                            .db(dbConfig.db)
                            .tableList()
                            .run(db);
    //Create if doesn't exist
    if (!tables.includes('processed_period'))
        await Rethink
                .db(dbName)
                .tableCreate('processed_period')
                .run(db);

    wc = new WitnessChainAdapter(process.env.ETH_PRIVATE_KEY);
    await wc.login();
    
    pq = new PostQueue(dbConfig);
    await pq.init();
    await fetchNewPhotosForCampaigns();
    await postnextPhoto();
}

async function postnextPhoto(){
    try{
        const nextPost = await pq.nextPost();
        if(!nextPost) return NO_POSTS_PENDING;
        await ic.postPhotoToInsta(nextPost.photo_url, nextPost.caption, nextPost.tags, nextPost.location, nextPost.user_names_to_tag);
        await pq.delete(nextPost.id);
        return SUCCESS;
    }
    catch(e){
        console.log(`error ${e} occured while trying to process post: ${nextPost}`);
        return FAILURE;
    }
}

async function fetchNewPhotosForCampaigns() {
    
    try{
        const campaigns = await wc.getCampaigns();
        console.log(`Found ${campaigns.length} campaigns to check`);

        for (const campaign of campaigns) {
            await fetchPhotosForCampaign(campaign);
        }
    }
    catch(e){
        console.log(`error ${e} occured while trying to fetch new photos of campaigns`);
    }
}

async function fetchPhotosForCampaign(campaign) {
    // Get the last processed date for this campaign
    let processedRecord = await Rethink
                                    .db(dbConfig.db)
                                    .table('processed_period')
                                    .get(campaign.id)
                                    .run(db);
    let lastProcessedDate;
    if(processedRecord){
        lastProcessedDate = new Date(processedRecord.date.toISOString());
    }
    else{
        lastProcessedDate = new Date();
        console.log
        lastProcessedDate.setHours(0, 0, 0, 0);
        lastProcessedDate.setDate(lastProcessedDate.getDate() - 2);
        processedRecord = {id : campaign.id, from : lastProcessedDate, to: lastProcessedDate};
    }

    console.log(`Fetching photos for campaign ${campaign.id} since ${lastProcessedDate}`);

    let skip = 0;
    let hasMorePhotos = true;
    let latestPhotoDate = lastProcessedDate;
    let photoCount = 0;

    // Loop until no more photos
    try{
        while (hasMorePhotos) {
            let photos = await wc.getCampaignPhotos(
                campaign.id, 
                lastProcessedDate.toISOString(),
                skip,
                50
            );
            
            if (photos.length === 0) {
                hasMorePhotos = false;
                break;
            }
    
            photoCount += photos.length;
            console.log(`Retrieved ${photos.length} photos, total: ${photoCount}`);
    
            // Update the latest photo date
            const newestPhotoDate = new Date(Math.max(
                ...photos.map(photo => new Date(photo.created_at).getTime())
            ));
    
            if (newestPhotoDate > latestPhotoDate) {
                latestPhotoDate = newestPhotoDate;
            }
    
            photos = photos.map(photo => {
                const user_names_to_tag = ["witnesschain"];
                return {
                    id : photo.id,
                    created_at : photo.created_at,
                    photo_url : photo.photo_url,
                    caption : campaign.description,
                    tags : photo.tags,
                    location : {
                        latitude : photo.latitude,
                        longitude : photo.longitude
                    },
                    place : photo.place,
                    user_names_to_tag : user_names_to_tag,
                };
            })
            
            // Add all photos to queue
            await pq.pushPosts(photos);
            
            skip += photos.length;
            
            // If photos returned less than limit, there are no more photos
            if (photos.length < feedRequestSize) {
                hasMorePhotos = false;
            }
        }
    }
    catch(e){
        console.log(`error ${e} occured while fetching photos of campaign ${campaign.id}`);
    }

    processedRecord.to = latestPhotoDate;

    // Update the processed_period
    if (photoCount > 0) {
        
        Rethink
            .db(dbConfig.db)
            .table('processed_period')
            .insert(processedRecord, {conflict: "replace"})
            .run(db);
        
        console.log(`Updated processed_until for campaign ${campaign.id} to ${latestPhotoDate}`);
    }
}
