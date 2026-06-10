require("dotenv").config({ path: "config/.env" });
const axios = require("axios");
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

async function test() {
  const tokenRes = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN, grant_type: "refresh_token"
  });
  const accessToken = tokenRes.data.access_token;

  for (const cid of ["6840205525", "2834665872"]) {
    try {
      const res = await axios.post(
        "https://googleads.googleapis.com/v20/customers/" + cid + "/googleAds:searchStream",
        { query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign LIMIT 10" },
        { headers: { Authorization: "Bearer " + accessToken, "developer-token": DEVELOPER_TOKEN, "Content-Type": "application/json" } }
      );
      const rows = [];
      for (const batch of res.data || []) rows.push(...(batch.results || []));
      console.log("Customer", cid, "- campaigns:", rows.length);
      rows.forEach(r => console.log(" -", r.campaign.name, r.campaign.status));
    } catch(e) {
      console.log("Customer", cid, "error:", e.response?.data?.error?.details?.[0]?.errors?.[0]?.message || e.response?.status);
    }
  }
}
test().catch(console.error);
