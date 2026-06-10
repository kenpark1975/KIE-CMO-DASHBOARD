/**
 * 네이버 검색광고 API 수집기
 * 수집 대상: 캠페인별 광고 성과 (본앤메이드·헬스키친 각 계정)
 * 출력 시트: RAW_ads_naver
 *
 * 인증: HMAC-SHA256 서명 (요청마다 생성)
 * 실행: node src/collectors/naver_sa.js [--date=YYYY-MM-DD] [--days=N]
 *
 * [업데이트] 광고그룹 레벨에서 ror(ROAS 상당) 수집 후 캠페인별 집계
 * - convCnt / revenueForConv 는 네이버 전환추적 미설정 계정에서 미지원
 * - ror = Return on Revenue (네이버 자체 ROAS, %) — 광고그룹 레벨에서만 제공
 */

require('dotenv').config({ path: 'config/.env' });
const axios  = require('axios');
const crypto = require('crypto');
const { writeToSheet } = require('../sheets/writer');

const BASE_URL   = 'https://api.searchad.naver.com';
const BATCH_SIZE = 10;

// 광고그룹 레벨 지원 필드 (convCnt / revenueForConv 제외 — 전환추적 미설정)
const ADGROUP_FIELDS = ['clkCnt', 'impCnt', 'salesAmt', 'crto', 'cpc', 'ror'];

const SA_ACCOUNTS = [
  {
    brand:      'BC',
    apiKey:     process.env.NAVER_SA_API_KEY_BNM,
    secretKey:  process.env.NAVER_SA_SECRET_KEY_BNM,
    customerId: process.env.NAVER_SA_CUSTOMER_ID_BNM,
    label:      '본앤메이드(BC)',
  },
  {
    brand:      'HK',
    apiKey:     process.env.NAVER_SA_API_KEY_HK,
    secretKey:  process.env.NAVER_SA_SECRET_KEY_HK,
    customerId: process.env.NAVER_SA_CUSTOMER_ID_HK,
    label:      '헬스키친(HK)',
  },
];

const args     = process.argv.slice(2);
const dateArg  = args.find(a => a.startsWith('--date='));
const daysArg  = args.find(a => a.startsWith('--days='));
const daysBack = daysArg
  ? parseInt(daysArg.split('=')[1])
  : parseInt(process.env.COLLECT_DAYS_BACK || '7');

function getDateRange() {
  if (dateArg) return [dateArg.split('=')[1]];
  const dates = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i - 1);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// HMAC-SHA256 서명
function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

function buildHeaders(method, uri, account) {
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, uri, account.secretKey);
  return {
    'X-Timestamp':  timestamp,
    'X-API-KEY':    account.apiKey,
    'X-Customer':   account.customerId,
    'X-Signature':  signature,
    'Content-Type': 'application/json; charset=UTF-8',
  };
}

function buildQS(params) {
  return Object.entries(params)
    .map(([k, v]) => k === 'ids' ? k + '=' + v : k + '=' + encodeURIComponent(v))
    .join('&');
}

async function rawGet(path, qs, account) {
  const headers = buildHeaders('GET', path, account);
  const url     = `${BASE_URL}${path}${qs ? '?' + qs : ''}`;
  const res     = await axios.get(url, { headers });
  return res.data;
}

// 캠페인 목록 조회
async function fetchCampaigns(account) {
  const data = await rawGet('/ncc/campaigns', '', account);
  return data || [];
}

// 캠페인별 광고그룹 목록 조회
async function fetchAdGroups(campaignId, account) {
  try {
    const qs   = `nccCampaignId=${encodeURIComponent(campaignId)}`;
    const data = await rawGet('/ncc/adgroups', qs, account);
    return data || [];
  } catch (e) {
    console.warn(`    광고그룹 조회 실패 (${campaignId}): ${e.response?.data?.message || e.message}`);
    return [];
  }
}

/**
 * 광고그룹 레벨 stats 배치 조회
 * → 결과를 campaignId 기준으로 집계 후 반환
 */
async function fetchAdGroupStatsBatch(adGroupIds, date, account) {
  // Map: adGroupId → stats
  const statsMap = {};
  const fields   = JSON.stringify(ADGROUP_FIELDS);

  for (let i = 0; i < adGroupIds.length; i += BATCH_SIZE) {
    const batch = adGroupIds.slice(i, i + BATCH_SIZE);
    const ids   = batch.join(',');

    const qs = buildQS({
      ids,
      timeRange: JSON.stringify({ since: date, until: date }),
      timeUnit:  'DAY',
      type:      'AD_GROUP',
      fields,
    });

    try {
      const data = await rawGet('/stats', qs, account);
      for (const stat of data.data || []) {
        statsMap[stat.id] = stat;
      }
    } catch (e) {
      console.warn(`    광고그룹 stats 오류 (${date}): ${e.response?.data?.message || e.message}`);
    }

    await new Promise(r => setTimeout(r, 150));
  }

  return statsMap;
}

async function fetchStatsBatch(dates, account) {
  const campaigns = await fetchCampaigns(account);
  if (!campaigns.length) return [];

  console.log(`    캠페인 ${campaigns.length}개 발견`);

  // 캠페인별 광고그룹 수집 (한 번만)
  const campAdGroups = {};   // nccCampaignId → adgroup[]
  for (const camp of campaigns) {
    const adgroups = await fetchAdGroups(camp.nccCampaignId, account);
    campAdGroups[camp.nccCampaignId] = adgroups;
    await new Promise(r => setTimeout(r, 100));
  }

  const allAdGroupIds = Object.values(campAdGroups).flat().map(g => g.nccAdgroupId);
  console.log(`    광고그룹 총 ${allAdGroupIds.length}개`);

  const rows = [];

  for (const date of dates) {
    // 전체 광고그룹 stats 한 번에 조회
    const statsMap = await fetchAdGroupStatsBatch(allAdGroupIds, date, account);

    // 캠페인 단위로 집계
    for (const camp of campaigns) {
      const adgroups = campAdGroups[camp.nccCampaignId] || [];
      if (!adgroups.length) continue;

      // 집계 변수
      let totalSpend = 0, totalImp = 0, totalClk = 0;
      let totalRorWeighted = 0, totalRorBase = 0;  // spend-weighted ror
      let totalCpc = 0, cpcCount = 0;
      let totalCtr = 0, ctrCount = 0;

      for (const grp of adgroups) {
        const stat = statsMap[grp.nccAdgroupId];
        if (!stat) continue;

        const spend = parseFloat(stat.salesAmt || 0);
        const clk   = parseInt(stat.clkCnt   || 0);
        const imp   = parseInt(stat.impCnt   || 0);
        const ror   = parseFloat(stat.ror    || 0);
        const cpc   = parseFloat(stat.cpc    || 0);
        const ctr   = parseFloat(stat.crto   || 0);

        totalSpend += spend;
        totalImp   += imp;
        totalClk   += clk;

        // spend 가중 평균으로 ror 집계
        if (spend > 0 && ror > 0) {
          totalRorWeighted += ror * spend;
          totalRorBase     += spend;
        }
        if (cpc > 0) { totalCpc += cpc; cpcCount++; }
        if (ctr > 0) { totalCtr += ctr; ctrCount++; }
      }

      if (totalSpend === 0 && totalClk === 0) continue;

      const avgRor = totalRorBase > 0
        ? Math.round(totalRorWeighted / totalRorBase * 10) / 10
        : 0;
      const avgCpc = cpcCount > 0 ? Math.round(totalCpc / cpcCount) : 0;
      const avgCtr = ctrCount > 0 ? Math.round(totalCtr / ctrCount * 10000) / 100 : 0;

      rows.push([
        date,
        account.brand,
        camp.campaignName || camp.nccCampaignId,
        Math.round(totalSpend),
        totalImp,
        totalClk,
        avgCtr,
        avgCpc,
        0,          // convCnt — 전환추적 미설정 (네이버 프리미엄 로그분석 필요)
        0,          // revenue — 동상
        avgRor,     // roas ← ror (네이버 Return on Revenue, 광고그룹 spend 가중평균)
        new Date().toISOString(),
      ]);
    }
  }

  return rows;
}

async function main() {
  const validAccounts = SA_ACCOUNTS.filter(a => a.apiKey && a.secretKey && a.customerId);
  if (!validAccounts.length) {
    console.error('네이버SA 계정 정보가 없습니다. config/.env를 확인하세요.');
    process.exit(1);
  }

  const dates = getDateRange();
  console.log(`[NaverSA] 수집 기간: ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length}일)`);
  console.log('[NaverSA] 광고그룹 레벨 수집 → 캠페인 집계 (ror = ROAS 상당)');

  const allRows = [];
  for (const account of validAccounts) {
    console.log(`  → ${account.label} 수집 중...`);
    try {
      const rows = await fetchStatsBatch(dates, account);
      allRows.push(...rows);
      console.log(`  ✓ ${account.label}: ${rows.length}행`);
    } catch (err) {
      console.error(`  ✗ ${account.label} 실패: ${err.message}`);
    }
  }

  if (!allRows.length) {
    console.log('[NaverSA] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_ads_naver', allRows);
  console.log(`[NaverSA] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[NaverSA] 치명적 오류:', err.message);
  process.exit(1);
});
