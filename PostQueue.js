const Rethink = require('rethinkdb');


class PostQueue{
    constructor(dbConfig){
        if(!dbConfig)
            throw new Error("dbConfig is required to create a postQueue.")
        this.dbConfig = dbConfig;
        this.dbName = dbConfig.db ?? 'test';
    }

    async init(){
        this.db = await Rethink.connect(this.dbConfig);
        const tables = await Rethink
                                .db(this.dbName)
                                .tableList()
                                .run(this.db);
        //Check if "post_queue" table exists in db
        if (!tables.includes('post_queue')) {
            await Rethink
                    .db(this.dbName)
                    .tableCreate('post_queue')
                    .run(this.db);

            await Rethink
                    .db(this.dbName)
                    .table('post_queue')
                    .indexCreate('created_at')
                    .run(this.db);
        }
        //check if story_queue table exists in db
        if (!tables.includes('story_queue')) {
            await Rethink
                    .db(this.dbName)
                    .tableCreate('story_queue')
                    .run(this.db);

            await Rethink
                    .db(this.dbName)
                    .table('story_queue')
                    .indexCreate('created_at')
                    .run(this.db);
        }
    }

    async pushPosts(posts, type = "post"){

        posts = posts.map(post => ({
            ...post,
            status : "PENDING"
        }));

        if(!this.db)
            await this.init();

        Rethink
            .db(this.dbName)
            .table(`${type}_queue`)
            .insert(posts)
            .run(this.db);
    }

    async nextPost(type = "post"){
        if(!this.db)
            await this.init();

        const cursor  = await Rethink
                                .db(this.dbName)
                                .table(`${type}_queue`)
                                .orderBy({index : 'created_at'})
                                .filter({status : "PENDING"})
                                .limit(1)
                                .run(this.db);

        const next = await cursor.toArray();
        if(next.length !== 0)
            return next[0];
    }

    async markPosted(id, type = "post"){
        await Rethink
                .db(this.dbName)
                .table(`${type}_queue`)
                .get(id)
                .update({status : "POSTED"})
                .run(this.db);
    }

    async markReviewRequired(id, type = "post"){
        await Rethink
                .db(this.dbName)
                .table(`${type}_queue`)
                .get(id)
                .update({status : "REVIEW_REQUIRED"})
                .run(this.db);
    }

    async markIncludedInStory(id){
        await Rethink
                .db(this.dbName)
                .table('post_queue')
                .get(id)
                .update({status : "INCLUDED_IN_STORY"})
                .run(this.db);
    }

    async getPosted(campaign_id){
        const cursor = await Rethink
                                .db(this.dbName)
                                .table('post_queue')
                                .orderBy({index : "created_at"})
                                .filter({
                                    campaign_id : campaign_id,
                                    status : "POSTED"
                                })
                                .run(this.db);

        return await cursor.toArray();

    }
}


module.exports = {PostQueue}