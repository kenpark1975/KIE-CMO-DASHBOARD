/**
 * 네이버 스마트스토어 커머스 API 수집기
 * 수집 대상: 주문/매출 데이터 (브리즈케어·헬스키친)
 * 출력 시트: RAW_orders_smartstore
 *
 * 인증: Client Credentials (Client ID + Secret → Bearer Token)
 * 실행: node src/collectors/smartstore.js [--date=YYYY-MM-DD] [--days=N]
 */

require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');
const { writeToSheet } = require('../sheets/writer');

const BASE_URL = 'https://api.commerce.naver.com/external';

const ACCOUNTS = [
  {
    brand:        'BC',
    clientId:     process.env.SMARTSTORE_CLIENT_ID_BC,
    clientSecret: process.env.SMARTSTORE_CLIENT_SECRET_BC,
    label:        '브리즈케어(BC)',
  },
  {
    brand:        'HK',
    clientId:     process.env.SMARTSTORE_CLIENT_ID_HK,
    clientSecret: process.env.SMARTSTORE_CLIENT_SECRET_HK,
    label:        '헬스키친(HK)',
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

// Bearer 토큰 발급
async function getToken(account) {
  const credentials = Buffer.from(`${account.clientId}:${account.clientSecret}`).toString('base64');
  const res = await axios.post(
    `${BASE_URL}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
    }
  );
  return res.data.access_token;
}

// 주문 목록 조회 (결제완료~배송완료 전체)
async function fetchOrders(token, from, to) {
  const orders = [];
  let page = 1;

  while (true) {
    const res = await axios.post(
      `${BASE_URL}/v1/pay-order/seller/search`,
      {
        searchDateType:  'PAYMENT_DATE',
        searchStartDate: `${from}T00:00:00.000Z`,
        searchEndDate:   `${to}T23:59:59.000Z`,
        page,
        size: 300,
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
      }
    );

    const data = res.data;
    orders.push(...(data.data?.contents || []));

    if (!data.data?.hasNext) break;
    page++;
    await new Promise(r => setTimeout(r, 200));
  }

  return orders;
}

// 날짜별·브랜드별 집계
function aggregateOrders(orders, brand) {
  const byDate = {};

  for (const order of orders) {
    const date = order.paymentDate?.slice(0, 10);
    if (!date) continue;

    if (!byDate[date]) {
      byDate[date] = {
        orderCount:   0,
        itemCount:    0,
        revenue:      0,
        cancelCount:  0,
        returnCount:  0,
      };
    }

    const d = byDate[date];
    d.orderCount++;

    for (const item of order.productOrderList || []) {
      const status = item.productOrderStatus;
      const price  = parseFloat(item.totalPaymentAmount || 0);

      if (['PAYMENT_WAITING', 'PAYED', 'DELIVERING', 'DELIVERED', 'PURCHASE_DECIDED'].includes(status)) {
        d.itemCount++;
        d.revenue += price;
      } else if (status === 'CANCELED') {
        d.cancelCount++;
      } else if (['RETURN_REQUEST', 'RETURN_DONE'].includes(status)) {
        d.returnCount++;
      }
    }
  }

  return Object.entries(byDate).map(([date, d]) => [
    date,
    brand,
    d.orderCount,
    d.itemCount,
    Math.round(d.revenue),
    d.cancelCount,
    d.returnCount,
    d.orderCount > 0 ? Math.round((d.cancelCount + d.returnCount) / d.orderCount * 100) : 0,
    new Date().toISOString(),
  ]);
}

async function main() {
  const validAccounts = ACCOUNTS.filter(a => a.clientId && a.clientSecret);
  if (!validAccounts.length) {
    console.warn('[SmartStore] API Key 미설정 — 건너뜀 (SMARTSTORE_CLIENT_ID_BC/HK 확인)');
    return;
  }

  const { from, to } = getDateRange();
  console.log(`[SmartStore] 수집 기간: ${from} ~ ${to}`);

  const allRows = [];

  for (const account of validAccounts) {
    console.log(`  → ${account.label} 수집 중...`);
    try {
      const token  = await getToken(account);
      const orders = await fetchOrders(token, from, to);
      const rows   = aggregateOrders(orders, account.brand);
      allRows.push(...rows);
      console.log(`  ✓ ${account.label}: ${rows.length}일치 데이터 (주문 ${orders.length}건)`);
    } catch (err) {
      console.error(`  ✗ ${account.label} 실패: ${err.response?.data?.message || err.message}`);
    }
  }

  if (!allRows.length) {
    console.log('[SmartStore] 수집된 데이터 없음.');
    return;
  }

  await writeToSheet('RAW_orders_smartstore', allRows);
  console.log(`[SmartStore] 완료 — 총 ${allRows.length}행 저장`);
}

main().catch(err => {
  console.error('[SmartStore] 치명적 오류:', err.message);
  process.exit(1);
});
