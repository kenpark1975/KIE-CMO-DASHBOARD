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
  // 활성 캠페인 찾기
  const activeCamp = camps.find(c => !c.userLock) || camps[0];
  console.log("캠페인:", activeCamp.name, activeCamp.nccCampaignId, "userLock:", activeCamp.userLock);

  const groups = await rawGet("/ncc/adgroups", "nccCampaignId=" + activeCamp.nccCampaignId);
  console.log("광고그룹 수:", groups.length);

  const id  = groups[0].nccAdgroupId;
  const tr  = encodeURIComponent(JSON.stringify({ since: "2026-06-01", until: "2026-06-08" }));
  const fields = ["clkCnt","impCnt","salesAmt","crto","cpc"];
  const qs = "ids=" + id + "&timeRange=" + tr + "&timeUnit=DAY&type=AD_GROUP&fields=" + encodeURIComponent(JSON.stringify(fields));

  const data = await rawGet("/stats", qs);
  console.log("전체 응답:", JSON.stringify(data).slice(0, 500));

  // 키워드 레벨도 테스트
  const keywords = await rawGet("/ncc/keywords", "nccAdgroupId=" + id);
  console.log("\n키워드 수:", keywords.length);
  if (keywords.length > 0) {
    const kid = keywords[0].nccKeywordId;
    const fields2 = ["clkCnt","impCnt","salesAmt","convCnt","revenueForConv"];
    const qs2 = "ids=" + kid + "&timeRange=" + tr + "&timeUnit=DAY&type=AD&fields=" + encodeURIComponent(JSON.stringify(fields2));
    try {
      const data2 = await rawGet("/stats", qs2);
      console.log("✓ KEYWORD 레벨 전환 필드 성공:", JSON.stringify(data2).slice(0,300));
    } catch(e) {
      console.log("✗ KEYWORD 오류:", e.response?.data?.message || e.message);
    }
  }
}
run().catch(console.error);
