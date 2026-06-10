/**
 * Google Sheets 데이터 쓰기 유틸리티
 * 모든 collector가 이 모듈을 통해 시트에 데이터 저장
 */

require('dotenv').config({ path: 'config/.env' });
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || 'config/google_credentials.json';

// ----------------------------------------
// 인증
// ----------------------------------------
async function getAuth() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return auth;
}

// ----------------------------------------
// 시트에 Upsert (날짜 범위 중복 방지)
// 새 데이터의 날짜 범위에 해당하는 기존 행을 삭제하고 새 데이터 추가
// 날짜 컬럼이 없는 경우(brand_search 등) 단순 append
// ----------------------------------------
async function writeToSheet(tabName, rows) {
  if (!rows || rows.length === 0) return;

  const auth   = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // 새 데이터의 날짜 범위 추출 (0번 컬럼이 YYYY-MM-DD 형식인 경우)
  const newDates = rows
    .map(r => r[0])
    .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(String(d)));

  if (newDates.length > 0) {
    const minDate = newDates.reduce((a, b) => a < b ? a : b);
    const maxDate = newDates.reduce((a, b) => a > b ? a : b);

    // 기존 데이터 읽기 (헤더 포함)
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A:Z`,
    });
    const allRows = existing.data.values || [];

    if (allRows.length > 1) {
      // 헤더 + 날짜 범위 밖의 행만 유지
      const header   = allRows[0];
      const kept     = allRows.slice(1).filter(r => {
        const d = String(r[0] || '');
        return !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < minDate || d > maxDate;
      });

      // 전체 재작성
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:Z`,
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [header, ...kept, ...rows] },
      });
      return;
    }
  }

  // 날짜 없는 경우 또는 기존 데이터 없는 경우 — 단순 append
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

// ----------------------------------------
// 시트 전체 덮어쓰기 (clear + write)
// RAW 탭 갱신 시 사용
// ----------------------------------------
async function overwriteSheet(tabName, headers, rows) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // 기존 데이터 삭제
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A:Z`
  });

  // 헤더 + 데이터 쓰기
  const allRows = [headers, ...rows];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: allRows }
  });
}

// ----------------------------------------
// 초기화 — 탭 생성 + 헤더 작성
// node src/sheets/writer.js --init
// ----------------------------------------
async function initSheets() {
  console.log('Google Sheets 초기화 시작...');

  const tabHeaders = {
    'RAW_ads_meta':       ['date','brand','campaign_name','adset_name','ad_name','spend','impressions','clicks','ctr','cpc','purchases','revenue','roas','cac','updated_at'],
    'RAW_ads_google':     ['date','brand','campaign_name','spend','impressions','clicks','ctr','cpc','conversions','revenue','roas','updated_at'],
    'RAW_ads_naver':      ['date','brand','campaign_name','spend','impressions','clicks','ctr','avg_cpc','conversions','revenue','roas','updated_at'],
    'RAW_ads_kakao':      ['date','brand','campaign_name','spend','impressions','clicks','ctr','cpc','conversions','revenue','roas','updated_at'],
    'RAW_ads_coupang':    ['date','brand','campaign_name','spend','impressions','clicks','ctr','conversions','revenue','roas','updated_at'],
    'RAW_commerce':       ['order_date','brand','channel','sku','product_name','quantity','sales_amount','discount_amount','net_amount','order_status','is_new_customer','updated_at'],
    'RAW_inventory':      ['snapshot_date','brand','sku','product_name','stock_qty','avg_daily_sales','weeks_remaining','inbound_qty','status','updated_at'],
    'RAW_returns':        ['return_date','brand','channel','sku','return_reason','quantity','return_amount','updated_at'],
    'RAW_sns_instagram':  ['snapshot_date','brand','followers','followers_change','media_id','media_type','published_at','reach','impressions','likes','comments','saved','shares','engagement_rate','updated_at'],
    'RAW_brand_search':   ['week_start','brand','keyword','search_ratio','updated_at'],
    'DASHBOARD_input':    ['section','col1','col2','col3','col4','col5','col6','col7','col8'],
  };

  const auth   = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // 기존 탭 목록 조회
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existingTabs = meta.data.sheets.map(s => s.properties.title);

  // 없는 탭만 생성
  const tabsToCreate = Object.keys(tabHeaders).filter(t => !existingTabs.includes(t));
  if (tabsToCreate.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: tabsToCreate.map(title => ({
          addSheet: { properties: { title } }
        }))
      }
    });
    console.log(`  + 탭 생성: ${tabsToCreate.join(', ')}`);
  }

  // 헤더 행 작성
  for (const [tab, headers] of Object.entries(tabHeaders)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });
    console.log(`  ✓ ${tab}`);
  }

  console.log('\n✓ 초기화 완료. Google Sheets를 확인하세요.');
}

// CLI 실행
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--init')) {
    initSheets().catch(console.error);
  }
}

module.exports = { writeToSheet, overwriteSheet };
