/**
 * 아임웹(자사몰) 주문/매출 수집기
 * 수집 대상: 본앤메이드 자사몰 주문 (브리즈케어 BC)
 * 출력 시트: RAW_commerce (channel="자사몰")
 *
 * 인증: POST https://api.imweb.me/v2/auth (key + secret) → access_token
 * 주문: GET  https://api.imweb.me/v2/shop/orders (헤더 access-token)
 * 실행: node src/collectors/imweb.js [--date=YYYY-MM-DD] [--days=N]
 *
 * ⚠️ RAW_commerce는 여러 채널이 공유하는 탭이므로 writer.js의 writeToSheet
 *    (날짜 범위 전체 삭제 방식)를 쓰면 다른 채널 행이 지워짐.
 *    → 이 파일은 자체 "채널 범위 upsert" 사용: 날짜 범위 + channel="자사몰" 행만 교체.
 */

require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');
const { google } = require('googleapis');

const BASE_URL   = 'https://api.imweb.me/v2';
const API_KEY    = process.env.IMWEB_API_KEY;
const API_SECRET = process.env.IMWEB_API_SECRET;

const BRAND        = 'BC';
const CHANNEL_NAME = '자사몰';
const TAB_NAME     = 'RAW_commerce';
const PAGE_LIMIT   = 100;          // 아임웹 주문 목록 페이지당 최대 100
const DETAIL_DELAY = 300;          // 주문 상세 호출 간격(ms) — rate limit 보호
const DEBUG        = (process.env.LOG_LEVEL || '') === 'debug';

// ─── CLI 인수 ────────────────────────────────────────────────────────────────
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
  to.setDate(to.getDate() - 1);             // 어제까지
  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  return {
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
  };
}

// unix timestamp(초) → KST YYYY-MM-DD
function tsToKstDate(ts) {
  if (!ts) return '';
  const ms = String(ts).length > 10 ? Number(ts) : Number(ts) * 1000;
  return new Date(ms + 9 * 3600 * 1000).toISOString().split('T')[0];
}

// ─── 인증 ────────────────────────────────────────────────────────────────────
async function getAccessToken() {
  // 기본: POST /auth — 실패(405 등) 시 GET 쿼리 방식 재시도
  try {
    const res = await axios.post(`${BASE_URL}/auth`, { key: API_KEY, secret: API_SECRET });
    if (res.data && res.data.access_token) return res.data.access_token;
    throw new Error(`auth 응답에 access_token 없음: ${JSON.stringify(res.data).slice(0, 200)}`);
  } catch (e) {
    if (e.response && [404, 405].includes(e.response.status)) {
      const res = await axios.get(`${BASE_URL}/auth`, { params: { key: API_KEY, secret: API_SECRET } });
      if (res.data && res.data.access_token) return res.data.access_token;
    }
    throw e;
  }
}

function authHeaders(token) {
  return { 'access-token': token, 'Content-Type': 'application/json' };
}

// ─── 주문 목록 (페이지네이션) ────────────────────────────────────────────────
// 아임웹 API는 order_date_from/to를 unix timestamp(초)로 받음.
// 1차: timestamp 방식 → 0건이면 2차: YYYY-MM-DD 문자열 방식으로 재시도.
async function fetchOrdersWithParams(token, dateParams) {
  const orders = [];
  let offset = 0;

  while (true) {
    const res = await axios.get(`${BASE_URL}/shop/orders`, {
      headers: authHeaders(token),
      params: { ...dateParams, limit: PAGE_LIMIT, offset },
    });

    if (offset === 0) {
      const pg = res.data?.data?.pagenation || res.data?.data?.pagination;
      if (pg) console.log(`  (pagenation: ${JSON.stringify(pg).slice(0, 200)})`);
      if (DEBUG) console.log('[Imweb][debug] orders 응답 샘플:', JSON.stringify(res.data).slice(0, 800));
    }

    const list = res.data?.data?.list || res.data?.data || [];
    if (!Array.isArray(list) || list.length === 0) break;
    orders.push(...list);

    if (list.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    await new Promise(r => setTimeout(r, 200));
  }

  return orders;
}

async function fetchOrders(token, from, to) {
  // KST 기준 from 00:00:00 ~ to 23:59:59 → unix timestamp(초)
  const tsFrom = Math.floor(new Date(`${from}T00:00:00+09:00`).getTime() / 1000);
  const tsTo   = Math.floor(new Date(`${to}T23:59:59+09:00`).getTime() / 1000);

  let orders = await fetchOrdersWithParams(token, { order_date_from: tsFrom, order_date_to: tsTo });
  if (orders.length) return orders;

  console.log('  (timestamp 방식 0건 → 날짜 문자열 방식 재시도)');
  orders = await fetchOrdersWithParams(token, { order_date_from: from, order_date_to: to });
  return orders;
}

// ─── 주문 상세 (품목 단위) ───────────────────────────────────────────────────
async function fetchProdOrders(token, orderNo) {
  const res = await axios.get(`${BASE_URL}/shop/orders/${orderNo}/prod-orders`, {
    headers: authHeaders(token),
  });
  const data = res.data?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  return [];
}

// 다양한 필드명 후보에서 첫 번째 존재 값 선택 (API 응답 구조 방어)
function pick(obj, keys, fallback = '') {
  for (const k of keys) {
    const v = k.split('.').reduce((o, kk) => (o == null ? undefined : o[kk]), obj);
    if (v !== undefined && v !== null) return v;
  }
  return fallback;
}

// ─── 행 변환 ─────────────────────────────────────────────────────────────────
// RAW_commerce: order_date, brand, channel, sku, product_name, quantity,
//               sales_amount, discount_amount, net_amount, order_status,
//               is_new_customer, updated_at
function buildRows(order, prodOrders) {
  const orderDate = tsToKstDate(pick(order, ['order_time', 'wtime', 'payment.pay_time']));
  if (!orderDate) return [];

  // 주문 단위 할인(쿠폰+포인트) — 품목 매출 비중대로 배분
  const orderDiscount =
    Number(pick(order, ['payment.coupon'], 0)) +
    Number(pick(order, ['payment.point'], 0));

  const items = [];
  for (const po of prodOrders) {
    const status  = pick(po, ['status', 'order_status'], '');
    const poItems = Array.isArray(po.items) ? po.items : [po];
    for (const it of poItems) {
      const qty   = Number(pick(it, ['payment.count', 'count', 'quantity'], 1)) || 1;
      const price = Number(pick(it, ['payment.price', 'price', 'pay_price'], 0)) || 0;
      items.push({
        sku:   String(pick(it, ['prod_custom_code', 'prod_no', 'prod_code'], '')),
        name:  String(pick(it, ['prod_name', 'name', 'title'], '')),
        qty,
        sales: price * (pick(it, ['payment.count'], null) !== null ? 1 : qty) || price, // price가 합계인지 단가인지 모호 → 합계 우선
        status,
      });
    }
  }

  const totalSales = items.reduce((s, i) => s + i.sales, 0) || 1;
  const now = new Date().toISOString();

  return items.map(i => {
    const disc = Math.round(orderDiscount * (i.sales / totalSales));
    return [
      orderDate,
      BRAND,
      CHANNEL_NAME,
      i.sku,
      i.name,
      i.qty,
      Math.round(i.sales),
      disc,
      Math.round(i.sales) - disc,
      i.status,
      '',          // is_new_customer — 아임웹 API로 판별 불가
      now,
    ];
  });
}

// ─── 채널 범위 upsert (자사몰 행만 교체) ─────────────────────────────────────
async function upsertChannelRows(rows) {
  if (!rows.length) return;

  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS_PATH || 'config/google_credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets  = google.sheets({ version: 'v4', auth });
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;

  const dates   = rows.map(r => r[0]);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A:Z`,
  });
  const allRows = existing.data.values || [];
  const header  = allRows[0] || [];

  // 유지: (다른 채널) 또는 (날짜 범위 밖)
  const kept = allRows.slice(1).filter(r => {
    const d = String(r[0] || '');
    const ch = String(r[2] || '');
    const inRange = /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= minDate && d <= maxDate;
    return !(inRange && ch === CHANNEL_NAME);
  });

  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${TAB_NAME}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, ...kept, ...rows] },
  });
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY || !API_SECRET) {
    console.error('[Imweb] IMWEB_API_KEY / IMWEB_API_SECRET이 없습니다. config/.env 확인.');
    process.exit(1);
  }

  const { from, to } = getDateRange();
  console.log(`[Imweb] 수집 기간: ${from} ~ ${to}`);

  const token = await getAccessToken();
  console.log('[Imweb] 인증 성공');

  const orders = await fetchOrders(token, from, to);
  console.log(`[Imweb] 주문 ${orders.length}건 조회`);
  if (!orders.length) {
    console.log('[Imweb] 수집된 데이터 없음.');
    return;
  }

  const allRows = [];
  for (const order of orders) {
    const orderNo = pick(order, ['order_no', 'orderNo', 'no']);
    if (!orderNo) continue;
    try {
      const prodOrders = await fetchProdOrders(token, orderNo);
      if (DEBUG && allRows.length === 0) {
        console.log('[Imweb][debug] prod-orders 샘플:', JSON.stringify(prodOrders).slice(0, 800));
      }
      allRows.push(...buildRows(order, prodOrders));
    } catch (e) {
      console.warn(`  ✗ 주문 ${orderNo} 상세 조회 실패: ${e.response?.status || ''} ${e.message}`);
    }
    await new Promise(r => setTimeout(r, DETAIL_DELAY));
  }

  if (!allRows.length) {
    console.log('[Imweb] 변환된 행 없음.');
    return;
  }

  await upsertChannelRows(allRows);
  console.log(`[Imweb] 완료 — ${TAB_NAME}에 ${allRows.length}행 저장 (channel=${CHANNEL_NAME})`);
}

main().catch(err => {
  console.error('[Imweb] 치명적 오류:', err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message);
  process.exit(1);
});
