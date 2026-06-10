require('dotenv').config({ path: 'config/.env' });
const axios  = require('axios');
const crypto = require('crypto');

const apiKey     = process.env.NAVER_SA_API_KEY_BNM;
const secretKey  = process.env.NAVER_SA_SECRET_KEY_BNM;
const customerId = process.env.NAVER_SA_CUSTOMER_ID_BNM;
const BASE_URL   = 'https://api.searchad.naver.com';

function sign(method, uri) {
  const ts  = Date.now().toString();
  const sig = crypto.createHmac('sha256', secretKey).update(ts + '.' + method + '.' + uri).digest('base64');
  return { ts, sig };
}

async function rawGet(path, qs) {
  const { ts, sig } = sign('GET', path);
  const url = BASE_URL + path + (qs ? '?' + qs : '');
  const r = await axios.get(url, {
    headers: { 'X-Timestamp': ts, 'X-API-KEY': apiKey, 'X-Customer': customerId, 'X-Signature': sig }
  });
  return r.data;
}

async function run() {
  const camps = await rawGet('/ncc/campaigns', '');
  const id = camps[0].nccCampaignId;
  const tr = encodeURIComponent(JSON.stringify({since:'2026-06-07',until:'2026-06-08'}));
  const base = 'ids=' + id + '&timeRange=' + tr + '&timeUnit=DAY&type=CAMPAIGN';

  // 필드 하나씩 추가
  const allFields = ['clkCnt','impCnt','salesAmt','crto','cpc','convCnt','revenueForConv','ror','avgRnk'];
  for (let n = 1; n <= allFields.length; n++) {
    const fields = allFields.slice(0, n);
    const qs = base + '&fields=' + encodeURIComponent(JSON.stringify(fields));
    try {
      await rawGet('/stats', qs);
      console.log(`✓ ${n}개 [${fields.join(',')}]`);
    } catch(e) {
      console.log(`✗ ${n}개 [${fields.join(',')}] → ${e.response?.data?.message}`);
      // 어떤 필드가 추가됐을 때 깨지는지 확인
      break;
    }
  }
}

run().catch(console.error);
