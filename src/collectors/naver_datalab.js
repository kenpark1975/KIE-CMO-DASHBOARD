/**
 * 네이버 데이터랩 검색어 트렌드 API 수집기
 * 수집 대상: 브랜드 키워드 상대 검색량 (0~100)
 * 출력 시트: RAW_brand_search
 *
 * 실행: node src/collectors/naver_datalab.js [--weeks=N]
 */

require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');
const { writeToSheet } = require('../sheets/writer');

const CLIENT_ID     = process.env.NAVER_DATALAB_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_DATALAB_CLIENT_SECRET;
const API_URL       = 'https://openapi.naver.com/v1/datalab/search';

const args     = process.argv.slice(2);
const weeksArg = args.find(a => a.startsWith('--weeks='));
const weeksBack = weeksArg ? parseInt(weeksArg.split('=')[1]) : 4;

// 브랜드별 검색 키워드 그룹
// BD 키워드는 브랜드명 확정 후 추가
const KEYWORD_GROUPS = [
  {
    brand:    'BC',
    groupName: '브리즈케어',
    keywords:  ['브리즈케어', 'breezecare'],
  },
  {
    brand:    'HK',
    groupName: '헬스키친',
    keywords:  ['헬스키친', "hell's kitchen cookware", '헬스키친 냄비'],
  },
  // BD: 브랜드명 확정 후 아래 주석 해제
  // {
  //   brand:    'BD',
  //   groupName: '뷰티디바이스',
  //   keywords:  ['브랜드명'],
  // },
];

function getDateRange() {
  const until = new Date();
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - weeksBack * 7);
  return {
    startDate: since.toISOString().split('T')[0],
    endDate:   until.toISOString().split('T')[0],
  };
}

// 네이버 데이터랩은 한 번 요청에 keywordGroups 최대 5개
// 브랜드별로 각각 요청해 비교 가능한 상대값 확보
async function fetchTrend(keywordGroup, dateRange) {
  const body = {
    startDate:     dateRange.startDate,
    endDate:       dateRange.endDate,
    timeUnit:      'week',
    keywordGroups: [
      {
        groupName: keywordGroup.groupName,
        keywords:  keywordGroup.keywords,
      },
    ],
  };

  const res = await axios.post(API_URL, body, {
    headers: {
      'X-Naver-Client-Id':     CLIENT_ID,
      'X-Naver-Client-Secret': CLIENT_SECRET,
      'Content-Type':          'application/json',
    },
  });

  if (res.data.error) {
    throw new Error(`데이터랩 API 오류: ${res.data.error.message}`);
  }

  return res.data.results || [];
}

async function collectBrand(group, dateRange) {
  console.log(`  → ${group.brand} (${group.groupName}) 수집 중...`);

  const results = await fetchTrend(group, dateRange);
  const rows = [];

  for (const result of results) {
    for (const point of result.data || []) {
      rows.push([
        point.period,           // week_start (YYYY-MM-DD)
        group.brand,
        group.groupName,
        Math.round(point.ratio * 100) / 100,   // 소수점 2자리
        new Date().toISOString(),
      ]);
    }
  }

  console.log(`  ✓ ${group.brand}: ${rows.length}주치 데이터`);
  return rows;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('NAVER_DATALAB_CLIENT_ID / CLIENT_SECRET가 설정되지 않았습니다. config/.env를 확인하세요.');
    process.exit(1);
  }

  const dateRange = getDateRange();
  console.log(`[NaverDatalab] 수집 기간: ${dateRange.startDate} ~ ${dateRange.endDate} (${weeksBack}주)`);

  const allRows = [];
  for (const group of KEYWORD_GROUPS) {
    try {
      const rows = await collectBrand(group, dateRange);
      allRows.push(...rows);
      // API 호출 간격 (rate limit 방지)
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`  ✗ ${group.brand} 수집 실패: ${err.message}`);
    }
  }

  if (allRows.length === 0) {
    console.log('[NaverDatalab] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_brand_search', allRows);
  console.log(`[NaverDatalab] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[NaverDatalab] 치명적 오류:', err.message);
  process.exit(1);
});
