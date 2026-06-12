/**
 * 쿠팡 수동 엑셀 파서 (셀러 인사이트 + 광고 커스텀 리포트)
 * 수집 대상: data/coupang/ 폴더의 .xlsx
 *   - SELLER_INSIGHTS_DAILY_SUMMARY_*  → RAW_orders_coupang (일별 주문/매출)
 *   - *custom_report*                  → RAW_ads_coupang (일별x캠페인 광고 성과, 14일 기여 기준)
 *
 * 운영 방법 (주 1회):
 *   1. 쿠팡 Wing → 셀러 인사이트 → 일별 요약 엑셀 다운로드
 *   2. GitHub 웹에서 data/coupang/ 폴더에 업로드 (파일은 지우지 말고 누적)
 *   3. 매일 자동 수집 시 폴더 전체를 재파싱해 날짜 기준 upsert (중복 안전)
 *
 * 브랜드 구분: 파일명이 HK_ 로 시작하면 HK, BD_ 면 BD, 그 외 기본 BC
 * 상품별 파일(VENDOR_ITEM_METRICS)은 날짜 컬럼이 없어 건너뜀
 *
 * 실행: node src/collectors/coupang_insights.js
 * 의존: xlsx (워크플로에서 npm install xlsx --no-save 로 설치)
 */

require('dotenv').config({ path: 'config/.env' });
const fs   = require('fs');
const path = require('path');
const { writeToSheet } = require('../sheets/writer');

const DATA_DIR = path.join(__dirname, '../../data/coupang');

function detectBrand(filename) {
  const up = filename.toUpperCase();
  if (up.startsWith('HK_')) return 'HK';
  if (up.startsWith('BD_')) return 'BD';
  return 'BC';
}

function parseDailySummary(XLSX, filePath, brand) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  if (!json.length) return [];

  const header = json[0].map(h => String(h || '').trim());
  const idx = {
    date:    header.findIndex(h => h === '날짜'),
    orders:  header.findIndex(h => h === '주문'),
    qty:     header.findIndex(h => h === '판매량'),
    revenue: header.findIndex(h => h.startsWith('매출')),
  };
  if (idx.date < 0 || idx.revenue < 0) {
    console.warn(`  ⚠️  일별 요약 형식 아님 (건너뜀): ${path.basename(filePath)}`);
    return [];
  }

  const now = new Date().toISOString();
  const rows = [];
  for (const r of json.slice(1)) {
    const date = String(r[idx.date] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const num = v => parseInt(String(v ?? '0').replace(/[^\d-]/g, '')) || 0;
    // RAW_orders_coupang: date, brand, order_count, item_count, revenue, cancel_count, updated_at
    rows.push([date, brand, num(r[idx.orders]), num(r[idx.qty]), num(r[idx.revenue]), 0, now]);
  }
  return rows;
}

// 광고 커스텀 리포트 파싱 → (date, campaign) 단위 집계
// 행이 (노출영역 x 전환옵션)으로 분할돼 있고 spend/노출은 한 행에만 있음 → 단순 합산 안전
function parseAdsReport(XLSX, filePath, brand) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!json.length) return [];

  const header = json[0].map(h => String(h || '').trim());
  const col = name => header.indexOf(name);
  const ix = {
    date:  col('날짜'),
    camp:  col('캠페인 이름'),
    imp:   col('노출수'),
    clk:   col('클릭수'),
    spend: col('광고비(원)'),
    conv:  col('총 주문수 (14일)'),
    rev:   col('총 전환 매출액 (14일)(원)'),
  };
  if (ix.date < 0 || ix.spend < 0) {
    console.warn(`  ⚠️  광고 리포트 형식 아님 (건너뜀): ${path.basename(filePath)}`);
    return [];
  }

  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const agg = {};
  for (const r of json.slice(1)) {
    const d = String(Math.round(num(r[ix.date])));
    if (d.length !== 8) continue;
    const date = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
    const camp = String(r[ix.camp] || '');
    const key  = `${date}|${camp}`;
    if (!agg[key]) agg[key] = { date, camp, imp:0, clk:0, spend:0, conv:0, rev:0 };
    const a = agg[key];
    a.imp += num(r[ix.imp]); a.clk += num(r[ix.clk]); a.spend += num(r[ix.spend]);
    a.conv += num(r[ix.conv]); a.rev += num(r[ix.rev]);
  }

  const now = new Date().toISOString();
  // RAW_ads_coupang: date, brand, campaign_name, spend, impressions, clicks, ctr, conversions, revenue, roas, updated_at
  return Object.values(agg)
    .filter(a => a.spend > 0 || a.clk > 0 || a.conv > 0)
    .map(a => [
      a.date, brand, a.camp,
      Math.round(a.spend), Math.round(a.imp), Math.round(a.clk),
      a.imp > 0 ? Math.round(a.clk / a.imp * 10000) / 100 : 0,
      Math.round(a.conv), Math.round(a.rev),
      a.spend > 0 ? Math.round(a.rev / a.spend * 100) / 100 : 0,   // ROAS 배수 (3.19 = 319%)
      now,
    ]);
}

async function main() {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    console.error('[CoupangInsights] xlsx 패키지 없음 — 워크플로에 "npm install xlsx --no-save" 단계 필요');
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    console.log('[CoupangInsights] data/coupang 폴더 없음 — 업로드된 파일 없음, 종료');
    return;
  }

  const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.xlsx'));
  if (!files.length) {
    console.log('[CoupangInsights] xlsx 파일 없음, 종료');
    return;
  }

  // 중복 키(주문: 날짜|브랜드 / 광고: 날짜|브랜드|캠페인)는 나중 파일 우선 (파일명 정렬 순)
  const orderRows = {};
  const adsRows   = {};
  for (const f of files.sort()) {
    const up = f.toUpperCase();
    const brand = detectBrand(f);
    if (up.includes('DAILY_SUMMARY')) {
      const rows = parseDailySummary(XLSX, path.join(DATA_DIR, f), brand);
      for (const row of rows) orderRows[`${row[0]}|${row[1]}`] = row;
      console.log(`  ✓ [주문] ${f} (${brand}): ${rows.length}행`);
    } else if (up.includes('CUSTOM_REPORT')) {
      const rows = parseAdsReport(XLSX, path.join(DATA_DIR, f), brand);
      for (const row of rows) adsRows[`${row[0]}|${row[1]}|${row[2]}`] = row;
      console.log(`  ✓ [광고] ${f} (${brand}): ${rows.length}행`);
    } else {
      console.log(`  - 건너뜀 (지원 형식 아님): ${f}`);
    }
  }

  const orders = Object.values(orderRows).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const ads    = Object.values(adsRows).sort((a, b) => (a[0] + a[1] + a[2]).localeCompare(b[0] + b[1] + b[2]));

  if (orders.length) {
    await writeToSheet('RAW_orders_coupang', orders);
    console.log(`[CoupangInsights] RAW_orders_coupang에 ${orders.length}행 저장`);
  }
  if (ads.length) {
    await writeToSheet('RAW_ads_coupang', ads);
    console.log(`[CoupangInsights] RAW_ads_coupang에 ${ads.length}행 저장`);
  }
  if (!orders.length && !ads.length) console.log('[CoupangInsights] 파싱된 데이터 없음.');
}

main().catch(err => {
  console.error('[CoupangInsights] 치명적 오류:', err.message);
  process.exit(1);
});
