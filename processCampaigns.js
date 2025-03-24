const {WitnessChainAdapter} = require('./WitnessChainApiAdapter.js');
const Rethink = require("rethinkdb");

async function processCampaigns(instaClient){
    let count = 0;
    const wc = new WitnessChainAdapter(process.env.ETH_PRIVATE_KEY);
    
    await wc.login();

    let campaigns = await wc.getCampaigns();
    campaigns = campaigns.filter(camp => camp.id === "CoordinatedDays2025");
    for(let campaign of campaigns){
        const feed =  await wc.getCampaignPhotos(campaign.id);
        const caption = campaign.description ?? " ";
        const tags = campaign.tags;
        for (let witness of feed){
            console.log(witness.photo_url, caption, tags);
            await instaClient.postPhotoToInsta(witness.photo_url, caption, tags);
            count += 1;
            console.log("Posted: ", count);
        }
    }
}

module.exports = {processCampaigns};