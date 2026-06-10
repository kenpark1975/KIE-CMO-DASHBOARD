/**
 * ONEWMS API 수집기
 * 커버 범위: 자사몰·스마트스토어·쿠팡 주문 + 재고 + 반품
 *
 * ⚠️  ONEWMS API 문서 수령 후 실제 엔드포인트·인증방식 확인 필요
 *     현재는 예상 구조로 작성됨
 */

require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');
const { writeToSheet } = require('../sheets/writer');

const BASE_URL = process.env.ONEWMS_BASE_URL;
const API_KEY  = process.env.ONEWMS_API_KEY;

const args = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='));
const targetDate = dateArg ? dateArg.split('=')[1] : getYesterday();

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ----------------------------------------
// API 클라이언트
// ----------------------------------------
const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,  // ⚠️ 실제 인증방식 확인 필요
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

// ----------------------------------------
// 주문·매출 수집
// ----------------------------------------
async function collectOrders(date) {
  console.log(`  → 주문 데이터 수집: ${date}`);

  // ⚠️ 실제 엔드포인트·파라미터 확인 필요
  const res = await client.get('/api/orders', {
    params: { start_date: date, end_date: date }
  });

  const orders = res.data.orders || res.data.data || [];

  // 브랜드별 분류 후 시트에 저장
  const rows = orders.map(o => [
    o.order_date,
    o.brand_code,          // BC / HK / BD — ONEWMS 내부 코드 확인 필요
    o.channel,             // SELFMALL / SMARTSTORE / COUPANG
    o.sku,
    o.product_name,
    o.quantity,
    o.sales_amount,
    o.discount_amount,
    o.net_amount,
    o.order_status,
    o.is_new_customer ? 'Y' : 'N',
    new Date().toISOString()
  ]);

  await writeToSheet('RAW_commerce', rows);
  console.log(`  ✓ 주문 ${rows.length}건 저장`);
}

// ----------------------------------------
// 재고 현황 수집
// ----------------------------------------
async function collectInventory() {
  console.log(`  → 재고 현황 수집`);

  const res = await client.get('/api/inventory');
  const items = res.data.items || res.data.data || [];

  const rows = items.map(i => {
    const avgDailySales = i.avg_daily_sales || 0;
    const weeksRemaining = avgDailySales > 0
      ? Math.floor(i.stock_qty / avgDailySales / 7)
      : 99;

    let status = '정상';
    if (weeksRemaining < 2) status = '부족';
    else if (weeksRemaining > 8) status = '과잉';

    return [
      new Date().toISOString().split('T')[0],  // snapshot_date
      i.brand_code,
      i.sku,
      i.product_name,
      i.stock_qty,
      avgDailySales,
      weeksRemaining,
      i.inbound_qty || 0,
      status,
      new Date().toISOString()
    ];
  });

  await writeToSheet('RAW_inventory', rows);
  console.log(`  ✓ 재고 ${rows.length}개 SKU 저장`);

  // 부족 SKU 경고 출력
  const shortage = rows.filter(r => r[8] === '부족');
  if (shortage.length > 0) {
    console.warn(`  ⚠️  재고 부족 SKU: ${shortage.map(r => r[3]).join(', ')}`);
  }
}

// ----------------------------------------
// 반품 수집
// ----------------------------------------
async function collectReturns(date) {
  console.log(`  → 반품 데이터 수집: ${date}`);

  const res = await client.get('/api/returns', {
    params: { start_date: date, end_date: date }
  });

  const returns = res.data.returns || res.data.data || [];

  const rows = returns.map(r => [
    r.return_date,
    r.brand_code,
    r.channel,
    r.sku,
    r.return_reason,
    r.quantity,
    r.return_amount,
    new Date().toISOString()
  ]);

  await writeToSheet('RAW_returns', rows);
  console.log(`  ✓ 반품 ${rows.length}건 저장`);
}

// ----------------------------------------
// 메인 실행
// ----------------------------------------
async function main() {
  try {
    await collectOrders(targetDate);
    await collectInventory();
    await collectReturns(targetDate);
  } catch (err) {
    console.error('ONEWMS 수집 실패:', err.message);
    process.exit(1);
  }
}

main();
