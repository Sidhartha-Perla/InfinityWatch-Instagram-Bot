const { IgApiClient } = require('instagram-private-api');
const axios = require('axios');
const fs =require('fs');


class InstaService{

    constructor(username, password) {

        const constructorStack = new Error().stack;

        if (!constructorStack.includes("InstaService.create")) {
            throw new Error(
                "InstaService must be initialized using InstaService.create(username, password)."
            );
        }

        this.username = username;
        this.password = password
        this.igClient = new IgApiClient();
        this.igClient.state.generateDevice(username);
    }

    static async create(username, password) {
        if(!username?.trim()) throw new Error("'username' is a required parameter for InstaService.create");
        if(!password) throw new Error("'password' is a required parameter for InstaService.create");

        const instance = new InstaService(username.trim(), password);
        await instance.init();
        return instance;
    }

    async init() {
        const sessionRestored = await this.restoreSession();
    
        if (!sessionRestored) {
          console.log("Logging in and saving session...");
          await this.login();
        }
      }

    async login(){
        //simulate network requests send to insta before user logs in
        await this.igClient.simulate.preLoginFlow();

        await this.igClient.account.login(this.username, this.password);

        //simulate network requests send to insta after user logs in
        //this.igClient.simulate.postLoginFlow();
        
        this.saveSessionData();
    }

    async restoreSession(){
        if(!this.sessionDataExists()) return false;

        try{
            const session = this.loadSessionData();
            await this.igClient.state.deserialize(session);

            if(await this.isSessionValid()){
                console.log('Session restored successfully!');
                return true;
            }

            console.log("Session no longer valid. Please Login");
            return false;
        }
        catch(e){
            console.log(`Failed to restore session. Session might be invalid. ${e}`);
            return false;
        }
    }

    async isSessionValid() {
        try {
          const currentUser = await this.igClient.account.currentUser();
          return !!currentUser && !!currentUser.pk;
        } catch (error) {
          return false;
        }
      }

    async saveSessionData(){
        const serializedSessionData = await this.igClient.state.serialize();

        //delete constants to avoid future version mismatch
        delete serializedSessionData.constants;
        
        fs.writeFileSync('./session.json', JSON.stringify(serializedSessionData));
    }

    sessionDataExists() {
        return fs.existsSync('./session.json');
    }

    loadSessionData(){
        return JSON.parse(fs.readFileSync('./session.json', 'utf-8'));
    }

    async postPhotoToInsta(image_url, caption, tags, location, user_names_to_tag){

        if(! await this.isSessionValid())
            await this.login();
    
        if(!image_url) throw new Error("Image URL is required");
    
        const img_response = await axios.get(
            image_url,
            { responseType: 'arraybuffer' }
        );

        const imageBuffer = Buffer.from(img_response.data);

        let loc = null;
        if(location && location.latitude && location.longitude){
            if(location.latitude > 90 || location.latitude < -90) throw new Error("Latitude must be between -90 to 90");
            if(location.longitude > 180 || location.longitude < -180) throw new Error("Longitude must be between -180 to 180");
            const locations = await this.igClient.search.location(location.latitude, location.longitude, 'place');
            loc = locations[0];
            console.log("photo latitude: ", location.latitude);
            console.log("photo longitude: ", location.longitude);
            console.log("photo location retrieved: ", loc);
        }
        
        const hashtags = tags ? tags.map(tag => '#' + tag).join(' ') : "";

        caption = tags ? caption + ' ' + hashtags : caption;

        const user_tags = user_names_to_tag ?  await this.generateUserTagsFromNames(user_names_to_tag) : null;

        await this.igClient.publish.photo({
            file: imageBuffer,
            caption: caption,
            usertags: user_tags,
            ...(loc ? {location: loc} : {})
        });
        console.log("Image posted successfully");
        
    }

    async generateUserTagsFromNames(userNames) {
        const user_tags = {
          in: [],
        };
      
        for (const userName of userNames) {
          try {
            const user = await this.igClient.user.searchExact(userName);

            const position = this.getRandomPosition();

            user_tags.in.push({
              user_id: user.pk,
              position: position,
            });
          } catch (error) {
            console.error(`Failed to fetch user ID for ${userName}:`, error.message);
          }
        }

        return user_tags;
    }

    getRandomPosition() {
        const randomX = (Math.random() * 0.8 + 0.1).toFixed(2);
        const randomY = (Math.random() * 0.8 + 0.1).toFixed(2);
        return [parseFloat(randomX), parseFloat(randomY)];
    }

}

module.exports = { InstaService };

