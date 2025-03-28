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
    }

    async pushPosts(posts){
        if(!this.db)
            await this.init();

        Rethink
            .db(this.dbName)
            .table('post_queue')
            .insert(posts)
            .run(this.db);
    }

    async nextPost(){
        if(!this.db)
            await this.init();

        const cursor  = await Rethink
                                .db(this.dbName)
                                .table('post_queue')
                                .orderBy({index : 'created_at'})
                                .limit(1)
                                .run(this.db);

        const next = await cursor.toArray();
        if(next.length !== 0)
            return next[0];
    }

    async delete(id){
        await Rethink
                .db(this.dbName)
                .table('post_queue')
                .get(id)
                .delete()
                .run(this.db);
    }
}

module.exports = {PostQueue}