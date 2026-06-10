/**
 * 인스타그램 Graph API 수집기 (v19.0)
 * 수집 대상: 브리즈케어(BC) · 헬스키친(HK) · 뷰티디바이스(BD)
 * 출력 시트: RAW_sns_instagram
 *
 * 실행: node src/collectors/instagram.js [--days=N]
 */

require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');
const { writeToSheet } = require('../sheets/writer');

const API_VERSION = 'v19.0';
const BASE_URL    = `https://graph.facebook.com/${API_VERSION}`;

const IG_ACCOUNTS = [
  {
    brand:      'BC',
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN_BC,
    businessId:  process.env.INSTAGRAM_BUSINESS_ID_BC,
  },
  {
    brand:      'HK',
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN_HK,
    businessId:  process.env.INSTAGRAM_BUSINESS_ID_HK,
  },
  {
    brand:      'BD',
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN_BD,
    businessId:  process.env.INSTAGRAM_BUSINESS_ID_BD,
  },
];

const args    = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const daysBack = daysArg
  ? parseInt(daysArg.split('=')[1])
  : parseInt(process.env.COLLECT_DAYS_BACK || '7');

function getCutoffDate() {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d;
}

// 계정 기본 정보 (팔로워 수)
async function fetchAccountInfo(businessId, accessToken) {
  const res = await axios.get(`${BASE_URL}/${businessId}`, {
    params: {
      fields: 'followers_count,media_count',
      access_token: accessToken,
    },
  });
  return res.data;
}

// 최근 게시물 목록
async function fetchMediaList(businessId, accessToken, cutoff) {
  const media = [];
  let url = `${BASE_URL}/${businessId}/media`;
  let params = {
    fields: 'id,media_type,timestamp,like_count,comments_count',
    limit: 50,
    access_token: accessToken,
  };

  while (url) {
    const res = await axios.get(url, { params });
    const data = res.data;

    if (data.error) throw new Error(`Instagram API 오류: ${data.error.message}`);

    const batch = (data.data || []).filter(m => new Date(m.timestamp) >= cutoff);
    media.push(...batch);

    // 페이지 내 모든 항목이 cutoff 이전이면 중단
    const oldest = data.data?.[data.data.length - 1];
    if (!oldest || new Date(oldest.timestamp) < cutoff) break;

    url    = data.paging?.next || null;
    params = {};
  }

  return media;
}

// 게시물 인사이트 (REEL과 IMAGE/VIDEO 지표가 다름)
async function fetchMediaInsights(mediaId, mediaType, accessToken) {
  // REEL은 plays 포함, IMAGE/VIDEO는 reach/impressions
  const metricMap = {
    IMAGE:    'reach,impressions,saved,shares',
    VIDEO:    'reach,impressions,saved,shares',
    CAROUSEL_ALBUM: 'reach,impressions,saved,shares',
    REELS:    'reach,plays,saved,shares',
  };
  const metric = metricMap[mediaType] || 'reach,impressions,saved,shares';

  try {
    const res = await axios.get(`${BASE_URL}/${mediaId}/insights`, {
      params: { metric, access_token: accessToken },
    });
    const result = {};
    (res.data.data || []).forEach(m => { result[m.name] = m.values?.[0]?.value ?? m.value ?? 0; });
    return result;
  } catch {
    // 일부 구형 게시물은 인사이트 없음
    return {};
  }
}

function calcEngagementRate(likes, comments, saved, shares, reach) {
  if (!reach) return 0;
  const eng = (likes + comments + saved + shares) / reach * 100;
  return Math.round(eng * 100) / 100;
}

async function collectBrand({ brand, accessToken, businessId }, cutoff) {
  if (!accessToken || !businessId) {
    console.warn(`  ⚠️  ${brand}: INSTAGRAM_ACCESS_TOKEN_${brand} 또는 INSTAGRAM_BUSINESS_ID_${brand} 미설정 — 건너뜀`);
    return [];
  }

  console.log(`  → ${brand} (${businessId}) 수집 중...`);

  const account   = await fetchAccountInfo(businessId, accessToken);
  const mediaList = await fetchMediaList(businessId, accessToken, cutoff);

  console.log(`     계정: 팔로워 ${account.followers_count?.toLocaleString()}명 / 게시물 ${mediaList.length}개 수집 대상`);

  const rows = [];
  const snapshotDate = new Date().toISOString().split('T')[0];

  for (const media of mediaList) {
    const insights = await fetchMediaInsights(media.id, media.media_type, accessToken);

    const reach       = insights.reach       || 0;
    const impressions = insights.impressions  || insights.plays || 0;
    const saved       = insights.saved        || 0;
    const shares      = insights.shares       || 0;
    const likes       = media.like_count      || 0;
    const comments    = media.comments_count  || 0;
    const engRate     = calcEngagementRate(likes, comments, saved, shares, reach);

    rows.push([
      snapshotDate,
      brand,
      account.followers_count || 0,
      '',                         // followers_change — 전일 대비 (집계 시트에서 계산)
      media.id,
      media.media_type,
      media.timestamp,
      reach,
      impressions,
      likes,
      comments,
      saved,
      shares,
      engRate,
      new Date().toISOString(),
    ]);
  }

  console.log(`  ✓ ${brand}: ${rows.length}행`);
  return rows;
}

async function main() {
  const cutoff = getCutoffDate();
  console.log(`[Instagram] 수집 기간: 최근 ${daysBack}일 (${cutoff.toISOString().split('T')[0]} ~)`);

  const allRows = [];
  for (const account of IG_ACCOUNTS) {
    try {
      const rows = await collectBrand(account, cutoff);
      allRows.push(...rows);
    } catch (err) {
      console.error(`  ✗ ${account.brand} 수집 실패: ${err.message}`);
    }
  }

  if (allRows.length === 0) {
    console.log('[Instagram] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_sns_instagram', allRows);
  console.log(`[Instagram] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[Instagram] 치명적 오류:', err.message);
  process.exit(1);
});
