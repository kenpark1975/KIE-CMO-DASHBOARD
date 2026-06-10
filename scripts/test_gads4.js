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

  // 최근 90일간 spend가 있는 캠페인 확인
  const query = "SELECT segments.date, campaign.name, metrics.cost_micros, metrics.impressions FROM campaign WHERE segments.date BETWEEN '2026-03-01' AND '2026-06-08' AND metrics.cost_micros > 0 ORDER BY segments.date DESC LIMIT 5";

  const res = await axios.post(
    "https://googleads.googleapis.com/v20/customers/6840205525/googleAds:searchStream",
    { query },
    { headers: { Authorization: "Bearer " + accessToken, "developer-token": DEVELOPER_TOKEN, "Content-Type": "application/json" } }
  );
  const rows = [];
  for (const batch of res.data || []) rows.push(...(batch.results || []));
  console.log("spend > 0 rows:", rows.length);
  rows.forEach(r => console.log(r.segments.date, r.campaign.name, "cost:", r.metrics.costMicros));
}
test().catch(e => console.error(e.response?.data || e.message));
