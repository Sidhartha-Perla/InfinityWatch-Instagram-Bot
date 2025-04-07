require("dotenv").config();
const { CronJob } = require("cron");
const Rethink = require('rethinkdb');
const { PostQueue } = require("./PostQueue.js");
const { WitnessChainAdapter } = require("./WitnessChainApiAdapter.js");
const { InstaService } = require("./InstaOfficial.js");
const { createAndUploadCollage } = require("./collage.js");

const dbConfig = {
    host: 'localhost',
    port: 28015,
    db: 'InstaPub'
};

const SUCCESS = 1;
const FAILURE = 0;
const NO_POSTS_PENDING = 2;

const ACCEPTED_COLLAGE_SIZES = [6, 9];

// bot configuration parameters
const START_TIME = process.env.START_TIME || '08:00';
const END_TIME = process.env.END_TIME || '22:00';
const NUM_POSTS = parseInt(process.env.NUM_POSTS || 20);
const MAX_STORIES = parseInt(process.env.MAX_STORIES || 5)
const NUM_FETCHES = parseInt(process.env.NUM_FETCHES || 8);
const DEFAULT_FETCH_DAYS = 1;

// Instagram client
let ic = null;
// Post queue
let pq = null;
// db connection
let db = null;
// Witnesschain API adapter
let wc = null;
const feedRequestSize = 50;

// Counter for posts that should be published
let num_posts_allowed = 0;
let num_stories_allowed = 0;

// Job handles
let postingJob = null;
let fetchingJob = null;
let startJob = null;
let endJob = null;

async function main() {
    try {
        // Setup database connection
        await setupDatabase();
        
        // Initialize services
        ic = new InstaService({
            accessToken : process.env.GRAPH_API_ACCESS_TOKEN, 
            instagramAccountId : process.env.INSTAGTAM_ACCOUNT_ID,
            appId : process.env.FACEBOOK_APP_ID,
            appSecret : process.env.FACEBOOK_APP_SECRET
        });
        
        wc = new WitnessChainAdapter(process.env.ETH_PRIVATE_KEY);
        await wc.login();
        
        pq = new PostQueue(dbConfig);
        await pq.init();
        
        // Setup cron jobs for daily operation
        setupCronJobs();
    } catch (error) {
        console.error(`Error in main: ${error}`);
    }
}

async function test() {

    await setupDatabase();

    ic = new InstaService({
        accessToken : process.env.GRAPH_API_ACCESS_TOKEN, 
        instagramAccountId : process.env.INSTAGTAM_ACCOUNT_ID,
        appId : process.env.FACEBOOK_APP_ID,
        appSecret : process.env.FACEBOOK_APP_SECRET
    });
    
    wc = new WitnessChainAdapter(process.env.ETH_PRIVATE_KEY);
    await wc.login();
    
    pq = new PostQueue(dbConfig);
    await pq.init();

    await createCampaignStories({id : "WitnessNature"});
    
}

//execute initialization script
main();
//test();

async function setupDatabase() {
    // Initialize db connection
    db = await Rethink.connect(dbConfig);
    
    // Check if 'processed_period' table exists
    const tables = await Rethink
                        .db(dbConfig.db)
                        .tableList()
                        .run(db);
                        
    // Create if doesn't exist
    if (!tables.includes('processed_period')) {
        await Rethink
            .db(dbConfig.db)
            .tableCreate('processed_period')
            .run(db);
    }
}

function setupCronJobs() {
    // Parse start and end times
    const [startHour, startMinute] = START_TIME.split(':').map(Number);
    const [endHour, endMinute] = END_TIME.split(':').map(Number);
    
    // Calculate the posting interval (in minutes)
    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;
    const operationalMinutes = endTimeMinutes - startTimeMinutes;
    
    // Calculate minutes between posts
    const postingIntervalMinutes = Math.floor(operationalMinutes / NUM_POSTS);
    
    // Calculate fetch interval (in minutes)
    const fetchIntervalMinutes = Math.floor(operationalMinutes / NUM_FETCHES);
    
    console.log(`Bot operational from ${START_TIME} to ${END_TIME}`);
    console.log(`Posting ${NUM_POSTS} times per day with interval of ${postingIntervalMinutes} minutes`);
    console.log(`Fetching ${NUM_FETCHES} times per day with interval of ${fetchIntervalMinutes} minutes`);
    
    // Daily start job
    startJob = new CronJob(`0 ${startMinute} ${startHour} * * *`, () => {
        start();
    }, null, true);
    
    // Daily end job
    endJob = new CronJob(`0 ${endMinute} ${endHour} * * *`, () => {
        end();
    }, null, true);
    
    // Start immediately if within operational hours
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    
    if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
        console.log("Current time is within operational hours. Starting immediately...");
        start();
    } else {
        console.log(`Current time is outside operational hours. Will start at ${START_TIME}`);
    }
}

// Start daily operations
async function start() {
    try {
        console.log(`Starting daily operations at ${new Date().toISOString()}`);
        
        // Reset counter
        num_posts_available = 0;
        
        // Calculate intervals for posting and fetching
        const [startHour, startMinute] = START_TIME.split(':').map(Number);
        const [endHour, endMinute] = END_TIME.split(':').map(Number);
        
        const startTimeMinutes = startHour * 60 + startMinute;
        const endTimeMinutes = endHour * 60 + endMinute;
        const operationalMinutes = endTimeMinutes - startTimeMinutes;
        
        const postingIntervalMinutes = Math.floor(operationalMinutes / NUM_POSTS);
        const fetchIntervalMinutes = Math.floor(operationalMinutes / NUM_FETCHES);
        
        // Setup posting job
        if (postingJob) {
            postingJob.stop();
        }
        
        postingJob = new CronJob(`0 */${postingIntervalMinutes} * * * *`, async () => {
            console.log(`Posting interval triggered at ${new Date().toISOString()}`);
            num_posts_available++;
            await processAvailablePosts();
        }, null, true);
        
        // Setup fetching job
        if (fetchingJob) {
            fetchingJob.stop();
        }
        
        fetchingJob = new CronJob(`0 */${fetchIntervalMinutes} * * * *`, async () => {
            console.log(`Fetch interval triggered at ${new Date().toISOString()}`);
            await fetchNewPhotosForCampaigns();
        }, null, true);

        //Create stories based on available posted images
        await createStoriesForCampaigns();
        
        // Initial fetch
        await fetchNewPhotosForCampaigns();
        
        // Initial post
        num_posts_available++;
        await processAvailablePosts();
    } catch (error) {
        console.error(`Error in start: ${error}`);
    }
}

// End daily operations
function end() {
    console.log(`Ending daily operations at ${new Date().toISOString()}`);
    
    // Stop the interval jobs
    if (postingJob) {
        postingJob.stop();
        postingJob = null;
    }
    
    if (fetchingJob) {
        fetchingJob.stop();
        fetchingJob = null;
    }
    
    // Reset
    num_posts_available = 0;
}

// Process available posts based on num_posts_available(number of allowed posts at the moment)
async function processAvailablePosts() {
    try {
        while (num_posts_available > 0) {
            const result = await postNext();
            
            if (result === NO_POSTS_PENDING) {
                console.log("No pending posts available. Will try again in next interval.");
            } else if (result === FAILURE) {
                console.log("Post might or might not have failed. Review manually.");
                //break;
            }
            
            num_posts_available--;
        }
    } catch (error) {
        console.error(`Error in processAvailablePosts: ${error}`);
    }
}

async function postNext(type = "post") {
    let nextPost = null;
    try {
        nextPost = await pq.nextPost(type);
        if (!nextPost) return NO_POSTS_PENDING;
        
        let result;
        if(type === "post"){
            result = await ic.postPhotoToInsta(
                nextPost.photo_url, 
                nextPost.caption, 
                nextPost.tags, 
                nextPost.location, 
                nextPost.user_names_to_tag
            );
        }
        else if(type === "story"){
            result = await ic.postStoryToInsta(nextPost.image_url)
        }
        else{
            throw new Error("Invalid upload Type passed to 'postNext'");
        }

        if(result?.success){
            await pq.markPosted(nextPost.id, type);
            console.log(`Successfully posted photo ID: ${nextPost.id} as a ${type}`);
            return SUCCESS;
        }
        else{
            console.log(`An error occurred while trying to process ${type}: ${(nextPost.id)}`);
            await pq.markReviewRequired(nextPost.id, type);
            return FAILURE;
        }
    } catch (e) {
        console.log(`Error ${e} occurred while trying to process ${type}: ${nextPost ? JSON.stringify(nextPost.id) : 'unknown'}`);
        return FAILURE;
    }
}

async function fetchNewPhotosForCampaigns() {
    try {
        const campaigns = await wc.getCampaigns();
        console.log(`Found ${campaigns.length} campaigns to check`);

        for (const campaign of campaigns) {
            await fetchPhotosForCampaign(campaign);
        }
    } catch (e) {
        console.log(`Error ${e} occurred while trying to fetch new photos of campaigns`);
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
    if (processedRecord) {
        lastProcessedDate = new Date(processedRecord.date ? processedRecord.date.toISOString() : processedRecord.to);
    }
    else {
        lastProcessedDate = new Date();
        lastProcessedDate.setHours(0, 0, 0, 0);
        lastProcessedDate.setDate(lastProcessedDate.getDate() - DEFAULT_FETCH_DAYS);
        processedRecord = {id: campaign.id, from: lastProcessedDate, to: lastProcessedDate};
    }

    console.log(`Fetching photos for campaign ${campaign.id} since ${lastProcessedDate}`);

    let skip = 0;
    let hasMorePhotos = true;
    let latestPhotoDate = lastProcessedDate;
    let photoCount = 0;

    try {
        while (hasMorePhotos) {
            let photos = await wc.getCampaignPhotos(
                campaign.id, 
                lastProcessedDate.toISOString(),
                skip,
                feedRequestSize
            );
            
            if (!photos || photos.length === 0) {
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
                    id: photo.id,
                    created_at: Rethink.ISO8601(photo.created_at),
                    photo_url: photo.photo_url,
                    caption: campaign.description,
                    tags: photo.tags,
                    location: {
                        latitude: photo.latitude,
                        longitude: photo.longitude
                    },
                    place: photo.place,
                    user_names_to_tag: user_names_to_tag,
                    campaign_id : campaign.id
                };
            });
            
            // Add all photos to queue
            await pq.pushPosts(photos);
            
            skip += photos.length;
            
            // If photos returned less than limit, there are no more photos
            if (photos.length < feedRequestSize) {
                hasMorePhotos = false;
            }
        }
    } catch (e) {
        console.log(`Error ${e} occurred while fetching photos of campaign ${campaign.id}`);
    }

    processedRecord.to = latestPhotoDate;

    // Update the processed_period
    if (photoCount > 0) {
        await Rethink
            .db(dbConfig.db)
            .table('processed_period')
            .insert(processedRecord, {conflict: "replace"})
            .run(db);
        
        console.log(`Updated processed_until for campaign ${campaign.id} to ${latestPhotoDate}`);
    }
}

async function createStoriesForCampaigns(){
    try {
        const campaigns = await wc.getCampaigns();

        for (const campaign of campaigns) {
            await createCampaignStories(campaign);
        }
    } catch (e) {
        console.log(`Error ${e} occurred while trying to create stories for campaigns`);
    }
}

async function createCampaignStories(campaign){
    try {
        const postedPhotos = await pq.getPosted(campaign.id);
    
        const photos = postedPhotos.map(post => ({image_url : post.photo_url, id : post.id}));
        console.log("posted photos obtained: ", photos);
        const stories = [];

        let num_processed = 0;
        while(photos.length - num_processed >= 9){
            //Get the next batch of campaign photos and create a collage
            const nextBatch = photos.slice(num_processed, num_processed + 9);
            console.log("Next batch:", nextBatch);
            const collage_url = await createAndUploadCollage(nextBatch.map(item => item.image_url));
            //Add the story data into stories array
            const story = {image_url : collage_url, created_at : Rethink.now()};
            stories.push(story);
            //Mark photo as included in a story
            nextBatch.forEach(item => pq.markIncludedInStory(item.id));
            num_processed += 9;
        }

        //push story posts to db
        pq.pushPosts(stories, "story");

        console.log(`Created stories for ${campaign.id}`);
    }
    catch(e){
        console.log(`Error ${e} occured while trying to create stories for campaign: ${campaign}`);
    }
}

