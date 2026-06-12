/**
 * 카카오 모먼트 광고 API 수집기
 * 수집 대상: 브리즈케어(BC) — 광고계정 615466
 * 출력 시트: RAW_ads_kakao
 *
 * 인증: KakaoAK {REST_API_KEY}
 * API: https://apis.moment.kakao.com/openapi/v4
 * 실행: node src/collectors/kakao_moment.js [--date=YYYY-MM-DD] [--days=N]
 */

require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');
const { writeToSheet } = require('../sheets/writer');

const REST_API_KEY   = process.env.KAKAO_REST_API_KEY;
const REFRESH_TOKEN  = process.env.KAKAO_REFRESH_TOKEN;  // 있으면 매 실행마다 새 토큰 발급
const CLIENT_SECRET  = process.env.KAKAO_CLIENT_SECRET;
let   ACCESS_TOKEN   = process.env.KAKAO_ACCESS_TOKEN;   // 비즈니스 토큰 (만료 없음, 우선 사용)
const BASE_URL       = 'https://apis.moment.kakao.com/openapi/v4';

// refresh_token으로 access_token 갱신 (access_token은 약 6시간 만료라 매 실행 시 갱신)
async function refreshAccessToken() {
  if (!REFRESH_TOKEN || !CLIENT_SECRET) return false;
  try {
    const res = await axios.post(
      'https://kauth.kakao.com/oauth/token',
      new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     REST_API_KEY,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    ACCESS_TOKEN = res.data.access_token;
    console.log('[KakaoMoment] access_token 갱신 완료');
    if (res.data.refresh_token) {
      console.warn('[KakaoMoment] ⚠️  새 refresh_token 발급됨 — GitHub Secrets의 KAKAO_REFRESH_TOKEN을 아래 값으로 교체 필요:');
      console.warn(`             ${res.data.refresh_token}`);
    }
    return true;
  } catch (e) {
    console.error('[KakaoMoment] 토큰 갱신 실패:', e.response?.data?.error_description || e.message);
    return false;
  }
}

const AD_ACCOUNTS = [
  { brand: 'BC', adAccountId: process.env.KAKAO_AD_ACCOUNT_ID },
  // 추후 HK, BD 추가 시:
  // { brand: 'HK', adAccountId: process.env.KAKAO_AD_ACCOUNT_ID_HK },
  // { brand: 'BD', adAccountId: process.env.KAKAO_AD_ACCOUNT_ID_BD },
];

// CLI 인수
const args    = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='));
const daysArg = args.find(a => a.startsWith('--days='));
const daysBack = daysArg
  ? parseInt(daysArg.split('=')[1])
  : parseInt(process.env.COLLECT_DAYS_BACK || '7');

function getDateRange() {
  if (dateArg) {
    const d = dateArg.split('=')[1];
    return { start: d.replace(/-/g, ''), end: d.replace(/-/g, ''), display: d };
  }
  const until = new Date();
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (daysBack - 1));

  const fmt = d => d.toISOString().split('T')[0].replace(/-/g, '');
  const disp = d => d.toISOString().split('T')[0];
  return {
    start:   fmt(since),
    end:     fmt(until),
    display: `${disp(since)} ~ ${disp(until)}`,
  };
}

// OAuth Bearer 토큰이 있으면 우선 사용, 없으면 KakaoAK fallback
const headers = () => ({
  Authorization:  ACCESS_TOKEN
    ? `Bearer ${ACCESS_TOKEN}`
    : `KakaoAK ${REST_API_KEY}`,
  'Content-Type': 'application/json',
});

// 캠페인 목록 조회 (id → name 매핑용) — 실패해도 보고서 수집은 계속
async function fetchCampaignNames(adAccountId) {
  try {
    const res = await axios.get(`${BASE_URL}/campaigns`, {
      headers: { ...headers(), adAccountId },
    });
    const list = res.data?.content || res.data?.data || res.data || [];
    const map = {};
    for (const c of (Array.isArray(list) ? list : [])) {
      map[String(c.id ?? c.campaignId)] = c.name ?? c.campaignName ?? '';
    }
    return map;
  } catch (e) {
    console.warn('  (캠페인 이름 조회 실패 — campaign_id로 표기):', JSON.stringify(e.response?.data || e.message).slice(0, 200));
    return {};
  }
}

// 광고계정 보고서 조회 (캠페인 레벨, 일별)
// 문서: GET /adAccounts/report — adAccountId는 "헤더", metricsGroup(단수), timeUnit=DAY
// start/end: yyyyMMdd, 최대 31일. 호출 제한: 5초당 1회.
async function fetchReport(adAccountId, start, end) {
  const res = await axios.get(`${BASE_URL}/adAccounts/report`, {
    headers: { ...headers(), adAccountId },
    params: {
      level:        'CAMPAIGN',
      metricsGroup: 'BASIC,PIXEL_SDK_CONVERSION',
      timeUnit:     'DAY',
      start,
      end,
    },
  });
  return res.data?.data || [];
}

function toSheetRow(brand, row, campaignNames) {
  const dim = row.dimensions || {};
  const met = row.metrics    || {};

  // start: "2020-01-01" 또는 "20200101" 형태 모두 대응
  let date = String(row.start || '');
  if (/^\d{8}$/.test(date)) date = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;

  const campId = String(dim.campaign_id ?? dim.campaignId ?? '');
  const camp   = campaignNames[campId] || campId || '(광고계정 전체)';

  const spend   = parseFloat(met.cost || 0);
  const imps    = parseInt(met.imp || 0);
  const clicks  = parseInt(met.click || 0);
  const ctr     = Math.round(parseFloat(met.ctr || 0) * 100) / 100;
  const cpc     = clicks > 0 ? Math.round(spend / clicks) : 0;

  // 픽셀 전환 지표 — 키 이름이 계정 설정에 따라 다를 수 있어 방어적으로 탐색
  let conv = 0, revenue = 0;
  for (const [k, v] of Object.entries(met)) {
    const key = k.toLowerCase();
    if (key.includes('purchase') && key.includes('value')) revenue += parseFloat(v || 0);
    else if (key.includes('purchase')) conv += parseFloat(v || 0);
  }
  const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;

  return [
    date, brand, camp,
    Math.round(spend), imps, clicks,
    ctr, cpc, Math.round(conv), Math.round(revenue), roas,
    new Date().toISOString(),
  ];
}

async function collectBrand({ brand, adAccountId }) {
  if (!adAccountId || !adAccountId.trim()) {
    console.warn(`  ⚠️  ${brand}: KAKAO_AD_ACCOUNT_ID 미설정 — 건너뜀`);
    return [];
  }

  const { start, end } = getDateRange();
  console.log(`  → ${brand} (${adAccountId}) 수집 중...`);

  const campaignNames = await fetchCampaignNames(adAccountId);
  await new Promise(r => setTimeout(r, 5500));   // 보고서 API: 5초당 1회 제한

  const rows = await fetchReport(adAccountId, start, end);
  const result = rows
    .filter(r => r.metrics && Object.keys(r.metrics).length > 0)
    .map(r => toSheetRow(brand, r, campaignNames));
  console.log(`  ✓ ${brand}: ${result.length}행`);
  return result;
}

async function main() {
  // KAKAO_ACCESS_TOKEN(비즈니스 토큰)이 있으면 그대로 사용 — 모먼트 API는 비즈니스 토큰 필수.
  // 없을 때만 refresh_token으로 일반 로그인 토큰 발급 시도 (fallback).
  if (!ACCESS_TOKEN) await refreshAccessToken();

  if (!ACCESS_TOKEN && !REST_API_KEY) {
    console.error('KAKAO_ACCESS_TOKEN 또는 KAKAO_REST_API_KEY가 설정되지 않았습니다.');
    process.exit(1);
  }
  if (!ACCESS_TOKEN) {
    console.warn('[KakaoMoment] ⚠️  KAKAO_ACCESS_TOKEN 미설정 — KakaoAK로 시도합니다.');
    console.warn('             보고서 API는 OAuth Bearer 토큰이 필요할 수 있습니다.');
  }

  const { display } = getDateRange();
  console.log(`[KakaoMoment] 수집 기간: ${display}`);

  const allRows = [];
  for (const account of AD_ACCOUNTS) {
    try {
      const rows = await collectBrand(account);
      allRows.push(...rows);
    } catch (err) {
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
      console.error(`  ✗ ${account.brand} 수집 실패: ${detail}`);
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.error('     → 인증 오류: KAKAO_REST_API_KEY 또는 OAuth 토큰 확인 필요');
      }
    }
  }

  if (!allRows.length) {
    console.log('[KakaoMoment] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_ads_kakao', allRows);
  console.log(`[KakaoMoment] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[KakaoMoment] 치명적 오류:', err.message);
  process.exit(1);
});
