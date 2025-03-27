const axios = require('axios');

class InstaService {
    constructor(config) {
        this.accessToken = config.accessToken;
        this.instagramAccountId = config.instagramAccountId;
        this.appId = config.appId;
        this.appSecret = config.appSecret;
        this.baseGraphApiUrl = 'https://graph.facebook.com/v22.0';
    }

    async _createMediaContainer(postParams) {
        const { 
            image_url,
            caption, 
            tags = [], 
            location,
            user_names_to_tag,
            mediaContainers,
            is_carousel_item = false,
            is_carousel =false
        } = postParams;

        if(!image_url)
            throw new Error("Image URL is required to create a Media Container")

        //get location id
        /*
        let location_id = null;
        if(location)
            location_id = await this._getLocationId(location);
        */

        //Data to be passed to '/media' api to create media container
        let mediaData = {};
        if(!is_carousel){
            mediaData = {
                ...mediaData,
                image_url : image_url,
                ...(user_names_to_tag ? {user_tags : JSON.stringify(this._formatUserTags(user_names_to_tag))} : {}),
                is_carousel_item : is_carousel_item,
                access_token : this.accessToken
            };
        }
        else{
            mediaData = {
                ...mediaData,
                media_type : 'CAROUSEL',
                children : mediaContainers
            }
        }

        if(!is_carousel_item){
            mediaData = {
                ...mediaData,
                caption : this._formatCaption(caption, tags),
                //...(location_id ? {location_id} : {}),
            }
        }

        // Create media container
        try {
            const response = await axios.post(
                `${this.baseGraphApiUrl}/${this.instagramAccountId}/media`, 
                mediaData,
                {
                    headers : {
                    "Content-Type": "application/json"
                    }
                }
            );
            console.log("Media container created");
            return response.data.id;
        } catch (error) {
            throw new Error(`Media container creation failed: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async _publishMediaContainer(containerID) {
        const data = { 
            creation_id: containerID,
            access_token: this.accessToken 
        };

        try {
            const response = await axios.post(
                `${this.baseGraphApiUrl}/${this.instagramAccountId}/media_publish`, 
                data,
                {
                    headers : {
                        "Content-Type" : "application/json"
                    }
                }
            );
            console.log("Media container published");
            return response.data;
        } catch (error) {
            throw new Error(`Media publication failed: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    //Get location id from latitude, longitude
    async _getLocationId(location){
        let location_id = null;
        if (typeof location.latitude === 'number' && typeof location.longitude === 'number') {
            try{
                if(location.latitude > 90 || location.latitude < -90) throw new Error("Latitude must be between -90 to 90");
                if(location.longitude > 180 || location.longitude < -180) throw new Error("Longitude must be between -180 to 180");
            

                const locationResponse = await axios.get(`${this.baseGraphApiUrl}/search`, {
                    params: {
                        type: 'place',
                        center: `${location.latitude},${location.longitude}`,
                        distance: 1000,
                        access_token: this.accessToken,
                    },
                });
    
                if (locationResponse.data.data?.length > 0) {
                    //Add location id to the media data
                    location_id = locationResponse.data.data[0].id;
                    console.log(`Location found: ${locationResponse.data.data[0].name}, ID: ${location_id}`);
                }
            } 
            catch (err) {
                console.error("Error fetching location:", err.response ? err.response.data : err.message);
            }
        }

        return location_id;
    }

    //Adds hashtags to caption
    _formatCaption(caption = "", tags = []) {
        const formattedTags = tags.map(tag => `#${tag}`).join(' ');
        return `${caption}\n\n${formattedTags}`.trim();
    }

    _formatUserTags(user_names_to_tag) {
        return user_names_to_tag.map(user_name => ({
            username: user_name,
            ...this._getRandomPosition()
        }));
    }

    _getRandomPosition() {
        const randomX = (Math.random() * 0.8 + 0.1).toFixed(2);
        const randomY = (Math.random() * 0.8 + 0.1).toFixed(2);
        return {
            x : parseFloat(randomX), 
            y : parseFloat(randomY)
        };
    }

    async postPhotoToInsta(image_url, caption, tags, location, user_names_to_tag) {
        try {
            // Validate input parameters
            if (!image_url) {
                throw new Error('Image URL is required');
            }

            // Create media container
            const containerID = await this._createMediaContainer({image_url, caption, tags, location, user_names_to_tag, is_carousel_item : false});

            await this._waitForContainerPublishReady(containerID);

            // Publish media container
            const publishResult = await this._publishMediaContainer(containerID);

            console.log('Photo successfully posted to Instagram');
            return {
                success: true,
                postId: publishResult.id,
            };
        } catch (error) {
            console.error('Instagram photo posting error:', error);
            return {
                success: false,
            };
        }
    }

    async postPhotoCarouselToInsta(posts){
        //The maximum number of images/vidoes in Carousels allowed by graph API is 10
        if(posts.length > 10) throw new Error("The maximum number of photos/videos per carousel is 10");

        try{
            let mediaContainers = [];
            //Create media containers for each individual photo
            for(let post of posts){
                let containerId = await this._createMediaContainer({
                    image_url : post.image_url,
                    user_names_to_tag : post.user_names_to_tag,
                    is_carousel_item : true
                })

                mediaContainers.push(containerId);
            }
            //Create container for the Carousel post
            const carouselContainerID = await this._createMediaContainer({mediaContainers, caption, location, is_carousel : true});

            //Wait until the Carousel is ready to publish
            await this._waitForContainerPublishReady(carouselContainerID);

            // Publish Carousel container
            const publishResult = await this._publishMediaContainer(carouselContainerID);

            console.log('Carousel successfully posted to Instagram');
            return {
                success: true,
                postId: publishResult.id,
            };
        }
        catch(error){
            console.error('Instagram photo posting error:', error);
            return {
                success: false,
            };
        }
    }

    async _waitForContainerPublishReady(containerId) {
        const initialDelay = 1000; //1s
        const maxDelay = 30000; //30s
        const maxElapsedTime = 300000;  //5min

        const startTime = Date.now();
        let currentDelay = initialDelay;
    
        while (Date.now() - startTime < maxElapsedTime) {
            const response = await axios.get(`${this.baseGraphApiUrl}/${containerId}`,{
                params: {
                    fields: "status_code",
                    access_token: this.accessToken
                }
            });

            // Ready to publish
            if (response.data.status_code === 'FINISHED') {
                return; 
            }

            if (response.data.status_code === 'ERROR') {
                throw new Error(`Container creation failed with error: ${response.data.status}`);
            }

            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, currentDelay));

            // Increase delay
            currentDelay = Math.min(currentDelay * 2, maxDelay);
        }
    
        throw new Error('Max elapsed time reached while waiting for container');
    }

    async refreshAccessToken() {
        // Validate refresh prerequisites
        if (!this.appId || !this.appSecret) {
            throw new Error('Missing required parameters for token refresh. Ensure appId and appSecret are provided.');
        }

        try {
            const response = await axios.get(`${this.baseGraphApiUrl}/oauth/access_token`, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: this.appId,
                    client_secret: this.appSecret,
                    fb_exchange_token: this.accessToken
                }
            });

            // Update the access token
            this.accessToken = response.data.access_token;
            
            // Optional: Return additional token details
            return {
                accessToken: response.data.access_token,
                expiresIn: response.data.expires_in
            };
        } catch (error) {
            console.error('Token refresh failed:', error.response?.data || error.message);
            throw new Error(`Token refresh failed: ${error.response?.data?.error?.message || error.message}`);
        }
    }
}

module.exports = {InstaService};