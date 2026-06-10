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
  // 1. 캠페인 1개 가져오기
  const camps = await rawGet("/ncc/campaigns", "");
  const camp  = camps[0];
  console.log("캠페인:", camp.campaignName, camp.nccCampaignId);

  // 2. 해당 캠페인의 광고그룹 목록
  const groups = await rawGet("/ncc/adgroups", "nccCampaignId=" + camp.nccCampaignId);
  console.log("광고그룹 수:", groups.length);
  if (!groups.length) { console.log("광고그룹 없음"); return; }

  const id = groups[0].nccAdgroupId;
  console.log("첫 번째 광고그룹:", groups[0].adgroupName, id);

  // 3. AD_GROUP 레벨로 전환 필드 테스트
  const tr = encodeURIComponent(JSON.stringify({ since: "2026-06-01", until: "2026-06-08" }));
  const fields = ["clkCnt","impCnt","salesAmt","crto","cpc","convCnt","revenueForConv"];

  try {
    const qs   = "ids=" + id + "&timeRange=" + tr + "&timeUnit=DAY&type=AD_GROUP&fields=" + encodeURIComponent(JSON.stringify(fields));
    const data = await rawGet("/stats", qs);
    console.log("\n✓ AD_GROUP 레벨 전환 필드 성공!");
    console.log("샘플:", JSON.stringify(data.data?.[0]));
  } catch(e) {
    console.log("✗ AD_GROUP 오류:", e.response?.data?.message || e.message);

    // 전환 필드 빼고 재시도
    const fields2 = ["clkCnt","impCnt","salesAmt","crto","cpc"];
    const qs2   = "ids=" + id + "&timeRange=" + tr + "&timeUnit=DAY&type=AD_GROUP&fields=" + encodeURIComponent(JSON.stringify(fields2));
    const data2 = await rawGet("/stats", qs2);
    console.log("전환 필드 없이:", JSON.stringify(data2.data?.[0]));
  }
}
run().catch(console.error);
