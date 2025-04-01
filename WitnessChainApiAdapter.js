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
        let attempts = 0;
        do {
            try{
                attempts += 1;
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
                    if(api === "photo-feed-from-campaign")
                        console.log("Data returned: ", response.data?.result);
                    return response.data.result;
                }
                if(response.status === 401 && api !== "pre-login" && api !== "login"){
                    await this.login();
                }
                
                throw new Error(`Error message returned:${response.data?.error?.message || JSON.stringify(response)}`);
            }
            catch(error){
                if(error instanceof AxiosError){
                    console.log("\x1b[31mFAILURE\x1b[0m", api, (error.response?.data || error));
                    if(error.response.status === 401 && api !== "pre-login" && api !== "login"){
                        await this.login();
                    }
                }
                else{
                    console.log(error);
                }
            }
        } while(attempts < 5)
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

