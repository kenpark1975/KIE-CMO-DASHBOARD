/**
 * 쿠팡 애즈 CSV 수동 업로드 스크립트
 * 매주 월요일 오전 — 전주 데이터 업로드
 *
 * 실행: node scripts/upload_csv.js --file=쿠팡광고_20260601.csv --brand=BC
 */

require('dotenv').config({ path: 'config/.env' });
const path = require('path');
const { parseCoupangCsv } = require('../src/collectors/coupang_csv');
const { writeToSheet }    = require('../src/sheets/writer');

const args     = process.argv.slice(2);
const fileArg  = args.find(a => a.startsWith('--file='));
const brandArg = args.find(a => a.startsWith('--brand='));

function printUsage() {
  console.log(`
사용법:
  node scripts/upload_csv.js --file=<CSV파일경로> --brand=<브랜드코드>

브랜드 코드: BC (브리즈케어) | HK (헬스키친) | BD (뷰티디바이스)

예시:
  node scripts/upload_csv.js --file=쿠팡광고_20260601.csv --brand=BC
  node scripts/upload_csv.js --file="C:/Downloads/쿠팡광고_20260601.csv" --brand=HK
`);
}

async function main() {
  if (!fileArg || !brandArg) {
    console.error('오류: --file 과 --brand 는 필수입니다.');
    printUsage();
    process.exit(1);
  }

  const filePath = path.resolve(fileArg.split('=')[1]);
  const brand    = brandArg.split('=')[1].toUpperCase();

  const validBrands = ['BC', 'HK', 'BD'];
  if (!validBrands.includes(brand)) {
    console.error(`오류: 브랜드 코드는 ${validBrands.join(' | ')} 중 하나여야 합니다.`);
    process.exit(1);
  }

  console.log(`[쿠팡 애즈] 파일: ${filePath}`);
  console.log(`[쿠팡 애즈] 브랜드: ${brand}`);

  let rows;
  try {
    rows = parseCoupangCsv(filePath, brand);
  } catch (err) {
    console.error(`CSV 파싱 실패: ${err.message}`);
    process.exit(1);
  }

  if (!rows.length) {
    console.warn('[쿠팡 애즈] 파싱된 데이터가 없습니다. CSV 파일 형식을 확인하세요.');
    process.exit(1);
  }

  // 날짜 범위 출력
  const dates = rows.map(r => r[0]).filter(Boolean).sort();
  console.log(`[쿠팡 애즈] 기간: ${dates[0]} ~ ${dates[dates.length - 1]}`);
  console.log(`[쿠팡 애즈] ${rows.length}행 업로드 중...`);

  await writeToSheet('RAW_ads_coupang', rows);
  console.log(`[쿠팡 애즈] 완료 — ${rows.length}행 저장`);
}

main().catch(err => {
  console.error('[쿠팡 애즈] 치명적 오류:', err.message);
  process.exit(1);
});
