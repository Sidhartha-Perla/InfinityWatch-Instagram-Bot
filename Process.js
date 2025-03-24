const Rethink = require('rethinkdb');
const { WitnessChainAdapter } = require('./WitnessChainApiAdapter');
const { InstaService } = require('./Insta');

class CampaignPostingService {
    constructor(dbConfig, feedRequestSize = 50, batchSize, ethPvtKey) {

        const constructorStack = new Error().stack;

        if (!constructorStack.includes("CampaignPostingService.create")) {
            throw new Error(
                "CampaignPostingService must be initialized using CampaignPostingService.create(dbConfig, feedRequestSize, ethPvtKey, instaUsername, instaPassword)."
            );
        }

        this.dbConfig = dbConfig;
        this.feedRequestSize = feedRequestSize;
        this.batchSize = batchSize;
        this.db = null;
        this.wc = new WitnessChainAdapter(ethPvtKey);
    }

    static async create(dbConfig, feedRequestSize, batchSize, ethPvtKey, instaUsername, instaPassword){
        const instance = new CampaignPostingService(dbConfig, feedRequestSize, batchSize, ethPvtKey);
        instance.ig = await InstaService.create(instaUsername, instaPassword);
        return instance;
    }

    async init() {
        this.db = await Rethink.connect(this.dbConfig);
        //Check if required tables exist
        const tables = await Rethink
                                .db('InstaPub')
                                .tableList()
                                .run(this.db);
        //Create if they don't exist already
        if (!tables.includes('backlog')) {
            await Rethink
                    .db('InstaPub')
                    .tableCreate('backlog')
                    .run(this.db);

            await Rethink
                    .db('InstaPub')
                    .table('backlog')
                    .indexCreate('added_at')
                    .run(this.db);
        }
        if (!tables.includes('processed_until')) {
            await Rethink
                    .db('InstaPub')
                    .tableCreate('processed_until')
                    .run(this.db);
        }
    }

    async disconnect() {
        if (this.db) 
            await this.db.close();
    }

    async processBacklog() {
        let backlogItems;
        do {
            let backlogCursor = await Rethink
                                    .db('InstaPub')
                                    .table('backlog')
                                    .filter({ status: 'pending' })
                                    .orderBy({index : 'added_at'})
                                    .limit(this.batchSize)
                                    .run(this.db);

            backlogItems = await backlogCursor.toArray() ?? [];
            console.log(`Processing ${backlogItems.length} items from backlog`);
            
            for (const item of backlogItems) {
                try {
                    await this.ig.postPhotoToInsta(item.photo.photo_url, item.caption, item.tags);
                    
                    // Mark as processed
                    await Rethink
                            .db('InstaPub')
                            .get(item.id)
                            .update({ status: 'processed', processed_at: new Date() })
                            .run(this.db);
                } catch (error) {
                    console.error(`Error processing photo ${item.photo.id}:`, error);
                    
                    // Mark as failed
                    await Rethink.db('InstaPub')
                    .get(item.id)
                    .update({ 
                        status: 'failed', 
                        error: erroRethink.message,
                        retry_count: (item.retry_count || 0) + 1 
                    })
                    .run(this.db);
                }
            }
        } while (backlogItems.length > 0); 

        console.log('Backlog empty, checking for new photos from campaigns');
    }

    async fetchNewPhotosForCampaigns() {
    
        const campaigns = await wc.getCampaigns();
        console.log(`Found ${campaigns.length} campaigns to check`);

        for (const campaign of campaigns) {
            await this.fetchPhotosForCampaign(campaign);
        }
    }

    async fetchPhotosForCampaign(campaign) {
        // Get the last processed date for this campaign
        let processedUntilRecord = await Rethink
            .db('InstaPub')
            .table('processed_until')
            .get(campaign.id)
            .run(this.db)

        const lastProcessedDate = processedUntilRecord
            ? new Date(processedUntilRecord.date.toISOString())
            : new Date(0);

        console.log(`Fetching photos for campaign ${campaign.id} since ${lastProcessedDate}`);

        let skip = 0;
        let hasMorePhotos = true;
        let latestPhotoDate = lastProcessedDate;
        let photoCount = 0;

        // Loop until no more photos
        while (hasMorePhotos) {
            const photos = await wc.getCampaignPhotos(
                campaign.id, 
                lastProcessedDate.toISOString(),
                skip,
                this.feedRequestSize
            );
            
            if (photos.length === 0) {
                hasMorePhotos = false;
                break;
            }

            photoCount += photos.length;
            console.log(`Retrieved ${photos.length} photos, total: ${photoCount}`);
            
            // Add all photos to backlog
            const backlogItems = photos.map(photo => ({
                photo,
                caption: campaign.description,
                tags: campaign.tags,
                status: 'pending',
                added_at: Rethink.now()
            }));
            
            await Rethink
                    .db('InstaPub')
                    .insert(backlogItems)
                    .run(this.db);
            
            // Update the latest photo date
            const newestPhotoDate = new Date(Math.max(
                ...photos.map(photo => new Date(photo.created_at).getTime())
            ));
            
            if (newestPhotoDate > latestPhotoDate) {
                latestPhotoDate = newestPhotoDate;
            }
            
            
            skip += photos.length;
            
            // If photos returned less than limit, there are no more photos
            if (photos.length < this.feedRequestSize) {
                hasMorePhotos = false;
            }
        }

        // Update the processed_until
        if (photoCount > 0) {
            
            Rethink
                .db('InstaPub')
                .table('processed_until')
                .insert({
                    id : campaign.id,
                    date : latestPhotoDate
                }, {conflict: "replace"})
                .run(this.db);
            
            console.log(`Updated processed_until for campaign ${campaign.id} to ${latestPhotoDate}`);
        }
    }

    async run() {
    try {
        await this.init();
        
        while (true) {
        // First process any photos in the backlog
        await this.processBacklog();
        
        // Then fetch new photos from all campaigns
        await this.fetchNewPhotosForAllCampaigns();
        
        // Wait a bit before checking again
        console.log('Finished processing cycle, waiting before next check');
        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
        }
    } catch (error) {
        console.error('Fatal error in photo processor:', error);
    } finally {
        await this.disconnect();
    }
    }
}

module.exports = {CampaignPostingService};

