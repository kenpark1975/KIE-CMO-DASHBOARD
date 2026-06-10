/**
 * 경인전자 CMO 대시보드 — 전체 수집 실행
 * 매일 오전 6시 cron으로 실행
 * Usage: node scripts/run_all.js
 *        node scripts/run_all.js --date=2026-06-01  (특정 날짜 재수집)
 */

require('dotenv').config({ path: 'config/.env' });
const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='));
const targetDate = dateArg ? dateArg.split('=')[1] : getYesterday();

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function run(script, label) {
  console.log(`\n▶ [${label}] 수집 시작...`);
  try {
    execSync(`node ${path.join('src/collectors', script)} --date=${targetDate}`, {
      stdio: 'inherit'
    });
    console.log(`✓ [${label}] 완료`);
  } catch (err) {
    console.error(`✗ [${label}] 실패 — ${err.message}`);
    // 실패해도 다음 소스는 계속 수집
  }
}

async function main() {
  console.log(`\n========================================`);
  console.log(`경인전자 CMO 대시보드 — 데이터 수집`);
  console.log(`대상 날짜: ${targetDate}`);
  console.log(`실행 시각: ${new Date().toLocaleString('ko-KR')}`);
  console.log(`========================================`);

  // 광고 데이터
  run('meta.js',        '메타 광고');
  run('google_ads.js',  '구글 광고');
  run('naver_sa.js',    '네이버SA 광고');

  // 커머스·물류 (ONEWMS 단일 소스)
  run('onewms.js',      'ONEWMS (커머스·재고·반품)');

  // SNS
  run('instagram.js',   '인스타그램');

  // 브랜드 검색량 (주 1회 — 월요일만)
  const today = new Date();
  if (today.getDay() === 1) { // 1 = 월요일
    run('naver_datalab.js', '네이버 데이터랩 (주간)');
  }

  console.log(`\n========================================`);
  console.log(`✓ 전체 수집 완료 — ${new Date().toLocaleString('ko-KR')}`);
  console.log(`========================================\n`);
}

main();
