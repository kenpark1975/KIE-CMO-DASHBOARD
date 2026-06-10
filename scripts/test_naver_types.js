require("dotenv").config({ path: "config/.env" });
const axios  = require("axios");
const crypto = require("crypto");

const apiKey     = process.env.NAVER_SA_API_KEY_BNM;
const secretKey  = process.env.NAVER_SA_SECRET_KEY_BNM;
const customerId = process.env.NAVER_SA_CUSTOMER_ID_BNM;
const BASE_URL   = "https://api.searchad.naver.com";

function sign(method, uri) {
  const ts  = Date.now().toString();
  const sig = crypto.createHmac("sha256", secretKey).update(ts + "." + method + "." + uri).digest("base64");
  return { ts, sig };
}
async function rawGet(path, qs) {
  const { ts, sig } = sign("GET", path);
  const url = BASE_URL + path + (qs ? "?" + qs : "");
  const r = await axios.get(url, { headers: { "X-Timestamp": ts, "X-API-KEY": apiKey, "X-Customer": customerId, "X-Signature": sig } });
  return r.data;
}

async function run() {
  const camps  = await rawGet("/ncc/campaigns", "");
  const camp   = camps.find(c => !c.userLock) || camps[0];
  const groups = await rawGet("/ncc/adgroups", "nccCampaignId=" + camp.nccCampaignId);
  const group  = groups[0];
  const keywords = await rawGet("/ncc/keywords", "nccAdgroupId=" + group.nccAdgroupId);
  const kid    = keywords[0].nccKeywordId;
  const tr     = encodeURIComponent(JSON.stringify({ since: "2026-06-01", until: "2026-06-08" }));

  console.log("키워드:", keywords[0].keyword, kid);

  // type 종류별 테스트
  for (const type of ["KEYWORD", "AD", "CAMPAIGN", "AD_GROUP"]) {
    const fields = ["clkCnt","impCnt","salesAmt","convCnt","revenueForConv"];
    const qs = "ids=" + kid + "&timeRange=" + tr + "&timeUnit=DAY&type=" + type + "&fields=" + encodeURIComponent(JSON.stringify(fields));
    try {
      const data = await rawGet("/stats", qs);
      console.log("✓ type=" + type, "→", JSON.stringify(data.data?.[0]));
    } catch(e) {
      console.log("✗ type=" + type, "→", e.response?.data?.message || e.message);
    }
  }
}
run().catch(console.error);
