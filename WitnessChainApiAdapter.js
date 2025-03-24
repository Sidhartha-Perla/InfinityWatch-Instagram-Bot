const axios = require("axios");
const ethers = require('ethers');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { AxiosError } = require("axios");


class WitnessChainAdapter {
    static base_api_url = "https://mainnet.witnesschain.com/proof/v1/pol";
    #private_key;
    #Wallet;
    #cookies;

    constructor(private_key){

        if(!private_key) throw new Error("Private key is required");

        this.#Wallet = new ethers.Wallet(private_key);
        this.#private_key = private_key;
        this.#cookies = "";
    }

    async doPost(api, data){
        try{
            const response = await axios.post(`${WitnessChainAdapter.base_api_url}/${api}`, data, {
                headers: { "Content-Type": "application/json", "Cookie": this.#cookies },
                timeout: 10000,
            });

            const all_cookies = response.headers['set-cookie'] ?? [];

            let got_cookies	= "";
            let update_cookie	= false;

            for (const c of all_cookies)
            {
                if (c.startsWith("__"))
                update_cookie = true;

                got_cookies += c.split(";")[0] + "; ";
            }

            if (update_cookie)
                this.#cookies = got_cookies;
            
            if(response.status === 200){
                console.log("\x1b[32mSUCCESS\x1b[0m", api);
                return response.data.result;
            }
            throw new Error(`${response.data.error.message}`);
        }
        catch(error){
            if(error instanceof AxiosError){
                console.error("\x1b[31mFAILURE\x1b[0m", api, error.response.data);
            }
            else{
                console.error(error);
            }
        }
    }

    async login(){
        const preLoginResult = await this.doPost("pre-login", JSON.stringify({
            keyType: "ethereum",
            publicKey: this.#Wallet.address,
            clientVersion: "9999999999",
            walletPublicKey: { ethereum: this.#Wallet.address },
            role: "prover",
            claims: {}
        }));

        if(!preLoginResult) return false;
        console.log(preLoginResult.message);

        //sign pre-login message
        const signed_message = await this.#Wallet.signMessage(preLoginResult.message);

        const loginResult = await this.doPost("login", JSON.stringify({ signature: signed_message }));

        return loginResult !== null;        
    }

    async getCampaigns(){
        const campaigns = await this.doPost("all-campaigns", {});

        return campaigns ?? [];
    }

    async getCampaignPhotos(campaign, since){
        if (!campaign) {
            throw new Error("Campaign ID is required.");
        }
        return await this.doPost("photo-feed-from-campaign", { campaign, since });
    }

}

module.exports = {WitnessChainAdapter};

/*
const BASE_URL = "https://mainnet.witnesschain.com/proof/v1/pol";

const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
async function doPost(api, data) {
    try {
        const response = await axios.post(`${BASE_URL}/${api}`, data, {
            headers: { 'Content-Type': 'application/json' },
            withCredentials: true
        });
        console.log("\x1b[32mSUCCESS\x1b[0m", api, response);
        
        return response;
    } catch (error) {
        console.error("\x1b[31mFAILURE\x1b[0m", api, error);
    }
}

async function sign(message) {
   
}


export async function login() {
    try{
        const address = WALLET_ADDRESS;
        //pre-login
        let r = await doPost("pre-login", JSON.stringify({
            keyType: "ethereum",
            publicKey: address,
            clientVersion: "9999999999",
            walletPublicKey: { ethereum: address },
            role: "prover",
            claims: { latitude: 17.563, longitude: 78.454 }
        }));

        if (!r || !r.data || !r.data.result) return false;

        console.log(r.data.result["message"]);
        const signature = await sign(r.data.result["message"]);
        const loginResponse = await doPost("login", JSON.stringify({ signature: signature }));
        
        return loginResponse && loginResponse.status === 200;
    }
    catch(e){
        return false;
    }
}

export async function getCampaigns() {
    const response = await doPost("all-campaigns", {message : "fetch campaigns"});

    const campaigns = response.status === 200 ? response.data.result : [];

    console.log(campaigns);

    return campaigns ?? [];
}

export async function getCampaignFeed(campaign, since){
    return await doPost("photo-feed-from-campaign", {campaign, since});
}
*/