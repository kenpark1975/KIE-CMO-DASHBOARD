/**
 * 구글 광고 API 수집기 (Google Ads API v16, GAQL)
 * 수집 대상: 브리즈케어(BC) · 헬스키친(HK) · 뷰티디바이스(BD)
 * 출력 시트: RAW_ads_google
 *
 * 실행: node src/collectors/google_ads.js [--date=YYYY-MM-DD] [--days=N]
 */

require('dotenv').config({ path: 'config/.env' });
const axios  = require('axios');
const { writeToSheet } = require('../sheets/writer');

const CLIENT_ID      = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET  = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN  = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const API_VERSION    = 'v20';

const CUSTOMERS = [
  { brand: 'BC', customerId: process.env.GOOGLE_ADS_CUSTOMER_ID_BC },
  { brand: 'HK', customerId: process.env.GOOGLE_ADS_CUSTOMER_ID_HK },
  { brand: 'BD', customerId: process.env.GOOGLE_ADS_CUSTOMER_ID_BD },
];

const args    = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='));
const daysArg = args.find(a => a.startsWith('--days='));
const daysBack = daysArg
  ? parseInt(daysArg.split('=')[1])
  : parseInt(process.env.COLLECT_DAYS_BACK || '7');

function getDateRange() {
  if (dateArg) {
    const d = dateArg.split('=')[1];
    return { since: d, until: d };
  }
  const until = new Date();
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (daysBack - 1));
  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  };
}

// OAuth2 액세스 토큰 갱신
let cachedToken = null;
async function getAccessToken() {
  if (cachedToken && cachedToken.expiry > Date.now()) return cachedToken.token;

  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type:    'refresh_token',
  });

  cachedToken = {
    token:  res.data.access_token,
    expiry: Date.now() + (res.data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// GAQL 쿼리 실행
async function runQuery(customerId, query) {
  const accessToken = await getAccessToken();
  const cleanId = customerId.replace(/-/g, '');
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${cleanId}/googleAds:searchStream`;

  const res = await axios.post(
    url,
    { query },
    {
      headers: {
        Authorization:         `Bearer ${accessToken}`,
        'developer-token':     DEVELOPER_TOKEN,
        'Content-Type':        'application/json',
      },
    }
  );

  // searchStream 응답: 배열의 각 요소에 results 포함
  const rows = [];
  for (const batch of res.data || []) {
    rows.push(...(batch.results || []));
  }
  return rows;
}

async function collectBrand({ brand, customerId }, dateRange) {
  if (!customerId) {
    console.warn(`  ⚠️  ${brand}: GOOGLE_ADS_CUSTOMER_ID_${brand} 미설정 — 건너뜀`);
    return [];
  }

  console.log(`  → ${brand} (${customerId}) 수집 중...`);

  const query = `
    SELECT
      segments.date,
      campaign.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE
      segments.date BETWEEN '${dateRange.since}' AND '${dateRange.until}'
      AND campaign.status != 'REMOVED'
    ORDER BY segments.date DESC
  `;

  const results = await runQuery(customerId, query);

  const rows = results.map(r => {
    const spend   = (r.metrics.costMicros || 0) / 1_000_000;
    const revenue = parseFloat(r.metrics.conversionsValue || 0);
    const roas    = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

    return [
      r.segments.date,
      brand,
      r.campaign.name,
      Math.round(spend),
      parseInt(r.metrics.impressions || 0),
      parseInt(r.metrics.clicks      || 0),
      Math.round(parseFloat(r.metrics.ctr || 0) * 10000) / 100,  // 소수 → %
      Math.round((r.metrics.averageCpc || 0) / 1_000_000),        // micros → 원
      Math.round(parseFloat(r.metrics.conversions || 0)),
      Math.round(revenue),
      roas,
      new Date().toISOString(),
    ];
  });

  console.log(`  ✓ ${brand}: ${rows.length}행`);
  return rows;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !DEVELOPER_TOKEN) {
    console.error('Google Ads API 인증 정보가 설정되지 않았습니다. config/.env를 확인하세요.');
    process.exit(1);
  }

  const dateRange = getDateRange();
  console.log(`[GoogleAds] 수집 기간: ${dateRange.since} ~ ${dateRange.until}`);

  const allRows = [];
  for (const customer of CUSTOMERS) {
    try {
      const rows = await collectBrand(customer, dateRange);
      allRows.push(...rows);
    } catch (err) {
      console.error(`  ✗ ${customer.brand} 수집 실패: ${err.message}`);
    }
  }

  if (!allRows.length) {
    console.log('[GoogleAds] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_ads_google', allRows);
  console.log(`[GoogleAds] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[GoogleAds] 치명적 오류:', err.message);
  process.exit(1);
});
