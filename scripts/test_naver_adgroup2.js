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
  const r = await axios.get(url, {
    headers: { "X-Timestamp": ts, "X-API-KEY": apiKey, "X-Customer": customerId, "X-Signature": sig }
  });
  return r.data;
}

async function run() {
  const camps  = await rawGet("/ncc/campaigns", "");
  const camp   = camps[0];
  const groups = await rawGet("/ncc/adgroups", "nccCampaignId=" + camp.nccCampaignId);
  const id     = groups[0].nccAdgroupId;
  console.log("캠페인 full:", JSON.stringify(camp).slice(0,200));
  console.log("광고그룹 full:", JSON.stringify(groups[0]).slice(0,200));

  const tr = encodeURIComponent(JSON.stringify({ since: "2026-06-01", until: "2026-06-08" }));

  // 필드 하나씩 추가해서 어디서 오류나는지 확인
  const allFields = ["clkCnt","impCnt","salesAmt","crto","cpc","convCnt","revenueForConv"];
  for (let n = 1; n <= allFields.length; n++) {
    const fields = allFields.slice(0, n);
    const qs = "ids=" + id + "&timeRange=" + tr + "&timeUnit=DAY&type=AD_GROUP&fields=" + encodeURIComponent(JSON.stringify(fields));
    try {
      const data = await rawGet("/stats", qs);
      console.log("✓", n+"개 ["+fields.join(",")+"] 데이터:", JSON.stringify(data.data?.[0]));
    } catch(e) {
      console.log("✗", n+"개 ["+fields.join(",")+"] →", e.response?.data?.message || e.message);
      break;
    }
  }
}
run().catch(console.error);
