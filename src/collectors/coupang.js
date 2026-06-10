/**
 * 쿠팡 파트너스 API 수집기
 * 수집 대상: 주문/매출 데이터 (브리즈케어·헬스키친)
 * 출력 시트: RAW_orders_coupang
 *
 * 인증: HMAC-SHA256 서명 (쿠팡 Wing API)
 * 실행: node src/collectors/coupang.js [--date=YYYY-MM-DD] [--days=N]
 */

require('dotenv').config({ path: 'config/.env' });
const axios  = require('axios');
const crypto = require('crypto');
const { writeToSheet } = require('../sheets/writer');

const BASE_URL = 'https://api-gateway.coupang.com';

const ACCOUNTS = [
  {
    brand:     'BC',
    accessKey: process.env.COUPANG_ACCESS_KEY_BC,
    secretKey: process.env.COUPANG_SECRET_KEY_BC,
    vendorId:  process.env.COUPANG_VENDOR_ID_BC,
    label:     '브리즈케어(BC)',
  },
  {
    brand:     'HK',
    accessKey: process.env.COUPANG_ACCESS_KEY_HK,
    secretKey: process.env.COUPANG_SECRET_KEY_HK,
    vendorId:  process.env.COUPANG_VENDOR_ID_HK,
    label:     '헬스키친(HK)',
  },
];

const args     = process.argv.slice(2);
const dateArg  = args.find(a => a.startsWith('--date='));
const daysArg  = args.find(a => a.startsWith('--days='));
const daysBack = daysArg
  ? parseInt(daysArg.split('=')[1])
  : parseInt(process.env.COLLECT_DAYS_BACK || '7');

function getDateRange() {
  if (dateArg) {
    const d = dateArg.split('=')[1];
    return { from: d, to: d };
  }
  const to   = new Date();
  to.setDate(to.getDate() - 1);
  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  return {
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
  };
}

// HMAC-SHA256 서명 생성
function generateAuth(account, method, path, query = '') {
  const datetime   = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:T]/g, '').slice(0, 14);
  const message    = datetime + method + path + query;
  const signature  = crypto.createHmac('sha256', account.secretKey).update(message).digest('hex');
  return {
    Authorization: `CEA algorithm=HmacSHA256, access-key=${account.accessKey}, signed-date=${datetime}, signature=${signature}`,
  };
}

// 주문 목록 조회
async function fetchOrders(account, from, to) {
  const orders  = [];
  let nextToken = null;

  do {
    const path  = `/v2/providers/wing/apis/api/v4/vendors/${account.vendorId}/ordersheets`;
    const query = new URLSearchParams({
      createdAtFrom: `${from}T00:00:00`,
      createdAtTo:   `${to}T23:59:59`,
      status:        'ACCEPT',
      size:          '100',
      ...(nextToken ? { nextToken } : {}),
    }).toString();

    const headers = generateAuth(account, 'GET', path, query);
    const res     = await axios.get(`${BASE_URL}${path}?${query}`, { headers });

    const data = res.data?.data || {};
    orders.push(...(data.orderSheets || []));
    nextToken = data.nextToken || null;

    await new Promise(r => setTimeout(r, 200));
  } while (nextToken);

  return orders;
}

// 날짜별 집계
function aggregateOrders(orders, brand) {
  const byDate = {};

  for (const sheet of orders) {
    const date = sheet.orderedAt?.slice(0, 10);
    if (!date) continue;

    if (!byDate[date]) {
      byDate[date] = { orderCount: 0, itemCount: 0, revenue: 0, cancelCount: 0 };
    }

    const d = byDate[date];
    d.orderCount++;

    for (const item of sheet.orderItems || []) {
      d.itemCount++;
      d.revenue += parseFloat(item.salesPrice || 0) * parseInt(item.shippingCount || 1);
    }
  }

  return Object.entries(byDate).map(([date, d]) => [
    date,
    brand,
    d.orderCount,
    d.itemCount,
    Math.round(d.revenue),
    d.cancelCount,
    new Date().toISOString(),
  ]);
}

async function main() {
  const validAccounts = ACCOUNTS.filter(a => a.accessKey && a.secretKey && a.vendorId);
  if (!validAccounts.length) {
    console.warn('[Coupang] API Key 미설정 — 건너뜀 (COUPANG_ACCESS_KEY_BC/HK 확인)');
    return;
  }

  const { from, to } = getDateRange();
  console.log(`[Coupang] 수집 기간: ${from} ~ ${to}`);

  const allRows = [];

  for (const account of validAccounts) {
    console.log(`  → ${account.label} 수집 중...`);
    try {
      const orders = await fetchOrders(account, from, to);
      const rows   = aggregateOrders(orders, account.brand);
      allRows.push(...rows);
      console.log(`  ✓ ${account.label}: ${rows.length}일치 데이터 (주문 ${orders.length}건)`);
    } catch (err) {
      console.error(`  ✗ ${account.label} 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  if (!allRows.length) {
    console.log('[Coupang] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_orders_coupang', allRows);
  console.log(`[Coupang] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[Coupang] 치명적 오류:', err.message);
  process.exit(1);
});
