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
  const gid    = groups[0].nccAdgroupId;
  const tr     = encodeURIComponent(JSON.stringify({ since: "2026-06-01", until: "2026-06-08" }));

  // AD_GROUP 레벨에서 가능한 모든 필드 테스트
  const candidates = [
    "clkCnt","impCnt","salesAmt","crto","cpc",
    "convCnt","revenueForConv","ror",
    "viewThrConvCnt","viewThrSalesAmt",
    "notifyConvCnt","notifySalesAmt",
    "avgRnk","pcCnt","mobileCnt"
  ];

  const working = [];
  for (const f of candidates) {
    const qs = "ids=" + gid + "&timeRange=" + tr + "&timeUnit=DAY&type=AD_GROUP&fields=" + encodeURIComponent(JSON.stringify([f]));
    try {
      await rawGet("/stats", qs);
      working.push(f);
      process.stdout.write("✓ ");
    } catch(e) {
      process.stdout.write("✗ ");
    }
    process.stdout.write(f + "\n");
  }

  console.log("\n사용 가능한 필드:", working.join(", "));

  // 사용 가능한 필드로 실제 데이터 확인
  const qs = "ids=" + gid + "&timeRange=" + tr + "&timeUnit=DAY&type=AD_GROUP&fields=" + encodeURIComponent(JSON.stringify(working));
  const data = await rawGet("/stats", qs);
  console.log("\n실제 데이터:", JSON.stringify(data.data?.[0], null, 2));
}
run().catch(console.error);
