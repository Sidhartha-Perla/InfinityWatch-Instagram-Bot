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
            media_type = "SINGLE_POST",
            image_url,
            caption, 
            tags = [], 
            location,
            user_names_to_tag,
            mediaContainers,
        } = postParams;

        //Data to be passed to '/media' api to create media container
        let mediaData = {};
        mediaData.access_token = this.accessToken;

        if(media_type != "CAROUSEL")
            if(!image_url) throw new Error("Image URL is required for non-carousel posts");
        
        switch(media_type){
            case "SINGLE_POST":
                mediaData.image_url = image_url;
                mediaData.caption = this._formatCaption(caption, tags);
                if(user_names_to_tag) mediaData.user_tags = JSON.stringify(this._formatUserTags(user_names_to_tag))
                mediaData.is_carousel_item = false;
                break;
            case "CAROUSEL_ITEM":
                mediaData.image_url = image_url;
                if(user_names_to_tag) mediaData.user_tags = JSON.stringify(this._formatUserTags(user_names_to_tag))
                mediaData.is_carousel_item = true;
                break;
            case "CAROUSEL":
                mediaData.caption = this._formatCaption(caption, tags);
                mediaData.children = mediaContainers;
                break;
            case "STORIES":
                mediaData.image_url = image_url;
                mediaData.media_type = media_type;
                break;
            
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
            console.error('Error response data:', error.response?.data);
            console.error('Error response status:', error.response?.status);
            console.error('Error message:', error.message);
            throw new Error("Media publication failed");  
        }
    }

    async _waitForContainerPublishReady(containerId) {
        const initialDelay = 5000; //5s
        const maxDelay = 20000; //20s
        const maxElapsedTime = 300000;  //5min

        const startTime = Date.now();
        let currentDelay = initialDelay;
    
        while (Date.now() - startTime < maxElapsedTime) {
            const status_code = await this._checkContainerStatus(containerId);
            console.log("status code:", status_code)
            // Ready to publish
            if (status_code === 'FINISHED') {
                return; 
            }

            if (status_code === 'ERROR') {
                throw new Error(`Container creation failed with error: ${response.data.status}`);
            }

            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, currentDelay));

            // Increase delay
            currentDelay = Math.min(currentDelay * 2, maxDelay);
        }
    
        throw new Error('Max elapsed time reached while waiting for container');
    }

    async _checkContainerStatus(containerId) {
        const response = await axios.get(`${this.baseGraphApiUrl}/${containerId}`,{
            params: {
                fields: "status_code",
                access_token: this.accessToken
            }
        });

        console.log(`Status of container ${containerId}: ${response.data.status_code}`)
        return response.data.status_code;
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
            const containerID = await this._createMediaContainer({image_url, caption, tags, location, user_names_to_tag, media_type : "SINGLE_POST"});

            await this._waitForContainerPublishReady(containerID);

            // Publish media container
            const publishResult = await this._publishMediaContainer(containerID);

            console.log('Photo successfully posted to Instagram');
            return {
                success: true,
                postId: publishResult?.id ?? '',
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
                    media_type : "CAROUSEL_ITEM"
                })

                mediaContainers.push(containerId);
            }
            //Create container for the Carousel post
            const carouselContainerID = await this._createMediaContainer({mediaContainers, caption, location, media_type : "CAROUSEL"});

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

    async postStoryToInsta(image_url) {
        try {
            // Create the story container
            const containerID = await this._createMediaContainer({image_url, media_type : "STORIES"});
            
            // Wait for container to be ready
            await this._waitForContainerPublishReady(containerID);
            
            // Publish the story
            const publishResult = await this._publishMediaContainer(containerID);
            
            console.log('Story successfully posted to Instagram');
            return {
                success: true,
                storyId: publishResult?.id ?? ''
            };
        } catch (error) {
            console.error('Instagram story posting error:', error);
            return {
                success: false,
                error: error.message
            };
        }
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