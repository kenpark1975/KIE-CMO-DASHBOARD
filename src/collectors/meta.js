/**
 * 메타 광고 API 수집기 (Meta Marketing API v19.0)
 * 수집 대상: 브리즈케어(BC) · 헬스키친(HK) · 뷰티디바이스(BD)
 * 출력 시트: RAW_ads_meta
 *
 * 실행: node src/collectors/meta.js [--date=YYYY-MM-DD] [--days=N]
 */

require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');
const { overwriteSheet, writeToSheet } = require('../sheets/writer');

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const API_VERSION  = 'v19.0';
const BASE_URL     = `https://graph.facebook.com/${API_VERSION}`;

// 브랜드별 광고계정 ID
const AD_ACCOUNTS = [
  { brand: 'BC', accountId: process.env.META_AD_ACCOUNT_ID_BC },
  { brand: 'HK', accountId: process.env.META_AD_ACCOUNT_ID_HK },
  { brand: 'BD', accountId: process.env.META_AD_ACCOUNT_ID_BD },
];

// CLI 인수 처리
const args = process.argv.slice(2);
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

// 전환 액션 타입 (메타 픽셀 구매 이벤트)
const PURCHASE_ACTION_TYPES = [
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
];

function extractPurchase(actions = [], actionValues = []) {
  const count = actions
    .filter(a => PURCHASE_ACTION_TYPES.includes(a.action_type))
    .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

  const revenue = actionValues
    .filter(a => PURCHASE_ACTION_TYPES.includes(a.action_type))
    .reduce((sum, a) => sum + parseFloat(a.value || 0), 0);

  return { purchases: count, revenue };
}

// 페이지네이션 처리 — 전체 인사이트 행 반환
async function fetchAllInsights(accountId, timeRange) {
  const fields = [
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'ctr',
    'cpc',
    'actions',
    'action_values',
    'date_start',
  ].join(',');

  const rows = [];
  let url = `${BASE_URL}/${accountId}/insights`;
  let params = {
    access_token: ACCESS_TOKEN,
    fields,
    time_range: JSON.stringify(timeRange),
    time_increment: 1,   // 일별 분리
    level: 'campaign',
    limit: 500,
  };

  while (url) {
    const res = await axios.get(url, { params });
    const data = res.data;

    if (data.error) {
      throw new Error(`Meta API 오류: ${data.error.message} (code ${data.error.code})`);
    }

    rows.push(...(data.data || []));

    // 다음 페이지
    url = data.paging?.next || null;
    params = {};  // next URL에 파라미터 포함되어 있음
  }

  return rows;
}

// 수집된 행 → 시트 형식 변환
function toSheetRow(brand, row) {
  const { purchases, revenue } = extractPurchase(
    row.actions || [],
    row.action_values || []
  );

  const spend = parseFloat(row.spend || 0);
  const roas  = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;
  const cac   = purchases > 0 ? Math.round(spend / purchases) : 0;

  return [
    row.date_start,
    brand,
    row.campaign_name || '',
    '',  // adset_name — campaign 레벨 미사용
    '',  // ad_name — campaign 레벨 미사용
    spend,
    parseInt(row.impressions || 0),
    parseInt(row.clicks      || 0),
    Math.round(parseFloat(row.ctr || 0) * 100) / 100,
    Math.round(parseFloat(row.cpc || 0)),
    purchases,
    Math.round(revenue),
    roas,
    cac,
    new Date().toISOString(),
  ];
}

async function collectBrand({ brand, accountId }, timeRange) {
  if (!accountId) {
    console.warn(`  ⚠️  ${brand}: META_AD_ACCOUNT_ID_${brand} 미설정 — 건너뜀`);
    return [];
  }

  console.log(`  → ${brand} (${accountId}) 수집 중...`);
  const insights = await fetchAllInsights(accountId, timeRange);
  const rows = insights.map(row => toSheetRow(brand, row));
  console.log(`  ✓ ${brand}: ${rows.length}행`);
  return rows;
}

async function main() {
  if (!ACCESS_TOKEN) {
    console.error('META_ACCESS_TOKEN이 설정되지 않았습니다. config/.env를 확인하세요.');
    process.exit(1);
  }

  const timeRange = getDateRange();
  console.log(`[Meta] 수집 기간: ${timeRange.since} ~ ${timeRange.until}`);

  const allRows = [];
  for (const account of AD_ACCOUNTS) {
    try {
      const rows = await collectBrand(account, timeRange);
      allRows.push(...rows);
    } catch (err) {
      console.error(`  ✗ ${account.brand} 수집 실패: ${err.message}`);
    }
  }

  if (allRows.length === 0) {
    console.log('[Meta] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_ads_meta', allRows);
  console.log(`[Meta] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[Meta] 치명적 오류:', err.message);
  process.exit(1);
});
