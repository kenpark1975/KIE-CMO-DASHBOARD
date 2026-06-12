/**
 * 전체 수집기 일괄 실행
 * 매일 새벽 2시 자동 실행 (Windows 작업 스케줄러로 등록)
 *
 * 수동 실행: node run_all.js [--date=YYYY-MM-DD] [--days=N] [--only=meta,naver_sa,...]
 * 예시:
 *   node run_all.js                        # 기본 (최근 7일)
 *   node run_all.js --date=2026-06-01      # 특정 날짜
 *   node run_all.js --days=30              # 최근 30일
 *   node run_all.js --only=meta,google_ads # 선택 수집기만
 */

require('dotenv').config({ path: 'config/.env' });
const { execFile } = require('child_process');
const path         = require('path');
const fs           = require('fs');

// ─── 수집기 목록 (실행 순서) ──────────────────────────────────────────────────
const COLLECTORS = [
  { id: 'meta',         file: 'src/collectors/meta.js',         name: '메타 광고' },
  { id: 'google_ads',   file: 'src/collectors/google_ads.js',   name: '구글 광고' },
  { id: 'naver_sa',     file: 'src/collectors/naver_sa.js',     name: '네이버 검색광고' },
  { id: 'kakao_moment', file: 'src/collectors/kakao_moment.js', name: '카카오 모먼트' },
  { id: 'naver_datalab',file: 'src/collectors/naver_datalab.js',name: '네이버 데이터랩' },
  { id: 'instagram',    file: 'src/collectors/instagram.js',    name: '인스타그램' },
  { id: 'imweb',        file: 'src/collectors/imweb.js',           name: '아임웹 자사몰 주문' },
  { id: 'smartstore',   file: 'src/collectors/smartstore.js',      name: '스마트스토어 주문' },
  { id: 'coupang',      file: 'src/collectors/coupang.js',         name: '쿠팡 주문' },
  { id: 'aggregate',    file: 'src/dashboard/aggregate.js',        name: '대시보드 집계' },
  { id: 'upload_drive', file: 'src/dashboard/upload_drive.js',   name: '구글 드라이브 업로드' },
  { id: 'report',       file: 'src/reporters/daily_report.js',   name: '일별 리포트 메일' },
];

// ─── CLI 인수 파싱 ────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const dateArg  = args.find(a => a.startsWith('--date='));
const daysArg  = args.find(a => a.startsWith('--days='));
const onlyArg  = args.find(a => a.startsWith('--only='));
const passArgs = [dateArg, daysArg].filter(Boolean);

const onlyIds  = onlyArg
  ? onlyArg.split('=')[1].split(',').map(s => s.trim())
  : null;

const targets = onlyIds
  ? COLLECTORS.filter(c => onlyIds.includes(c.id))
  : COLLECTORS;

// ─── 로그 유틸 ────────────────────────────────────────────────────────────────
const LOG_DIR  = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const logFile  = path.join(LOG_DIR, `run_${new Date().toISOString().slice(0,10)}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

// ─── 개별 수집기 실행 ─────────────────────────────────────────────────────────
function runCollector({ id, file, name }) {
  return new Promise((resolve) => {
    const start = Date.now();
    log(`▶ ${name} 시작...`);

    const child = execFile(
      process.execPath,           // node 실행파일
      [file, ...passArgs],
      { cwd: __dirname, timeout: 5 * 60 * 1000 }   // 5분 타임아웃
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });

    child.on('close', (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        log(`✅ ${name} 완료 (${elapsed}s)`);
        resolve({ id, name, ok: true, elapsed });
      } else {
        log(`❌ ${name} 실패 (exit ${code}, ${elapsed}s)`);
        if (stderr) logStream.write('  STDERR: ' + stderr.trim() + '\n');
        resolve({ id, name, ok: false, elapsed, code });
      }
    });

    child.on('error', (err) => {
      log(`❌ ${name} 실행 오류: ${err.message}`);
      resolve({ id, name, ok: false, elapsed: 0, error: err.message });
    });
  });
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  log('═══════════════════════════════════════════');
  log(' KIE CMO 대시보드 — 전체 수집 시작');
  if (dateArg) log(` 날짜: ${dateArg.split('=')[1]}`);
  if (daysArg) log(` 기간: 최근 ${daysArg.split('=')[1]}일`);
  if (onlyIds) log(` 대상: ${onlyIds.join(', ')}`);
  log('═══════════════════════════════════════════');

  const results = [];

  // 순차 실행 (API rate limit 방지)
  for (const collector of targets) {
    const result = await runCollector(collector);
    results.push(result);
    // 수집기 사이 간격 2초
    if (targets.indexOf(collector) < targets.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ─── 결과 요약 ────────────────────────────────────────────────────────────
  const total   = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = results.filter(r => r.ok).length;
  const failed  = results.filter(r => !r.ok);

  log('═══════════════════════════════════════════');
  log(` 완료: ${success}/${results.length}개 성공 | 소요: ${total}s`);
  results.forEach(r => {
    const mark = r.ok ? '✅' : '❌';
    log(`  ${mark} ${r.name} (${r.elapsed}s)`);
  });
  if (failed.length) {
    log(` 실패 목록: ${failed.map(r => r.id).join(', ')}`);
  }
  log('═══════════════════════════════════════════');
  log(` 로그 저장: ${logFile}`);

  logStream.end();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  log(`치명적 오류: ${err.message}`);
  logStream.end();
  process.exit(1);
});
