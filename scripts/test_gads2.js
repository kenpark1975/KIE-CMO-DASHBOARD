require("dotenv").config({ path: "config/.env" });
const axios = require("axios");
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const CUSTOMER_ID = "6840205525";

async function test() {
  const tokenRes = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN, grant_type: "refresh_token"
  });
  const accessToken = tokenRes.data.access_token;
  console.log("Token OK");

  const query = "SELECT segments.date, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE segments.date BETWEEN '2026-06-01' AND '2026-06-08' AND campaign.status != 'REMOVED' ORDER BY segments.date DESC";

  try {
    const res = await axios.post(
      "https://googleads.googleapis.com/v20/customers/" + CUSTOMER_ID + "/googleAds:searchStream",
      { query },
      { headers: { Authorization: "Bearer " + accessToken, "developer-token": DEVELOPER_TOKEN, "Content-Type": "application/json" } }
    );
    const rows = [];
    for (const batch of res.data || []) rows.push(...(batch.results || []));
    console.log("rows:", rows.length);
    if (rows.length > 0) console.log("first:", JSON.stringify(rows[0], null, 2));
    else console.log("no data");
  } catch(e) {
    console.error("status:", e.response?.status);
    console.error("body:", JSON.stringify(e.response?.data, null, 2));
  }
}
test().catch(console.error);
