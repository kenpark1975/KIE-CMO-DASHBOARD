/**
 * RAW 시트 → dist/dashboard.html + dist/data.json 빌더
 * RAW 데이터를 전부 읽어 HTML에 내장 → 브라우저에서 날짜 필터링/집계
 * data.json은 AI 채팅(Netlify Functions /chat)이 참조
 *
 * 실행: node src/dashboard/aggregate.js
 */

require('dotenv').config({ path: 'config/.env' });
const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');

const SHEET_ID   = process.env.GOOGLE_SHEET_ID;
const CREDS_PATH = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || 'config/google_credentials.json');

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function readSheet(sheets, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A2:Z`,
    });
    return res.data.values || [];
  } catch {
    return [];
  }
}

async function main() {
  if (!SHEET_ID) { console.error('GOOGLE_SHEET_ID 미설정'); process.exit(1); }

  console.log('[Build] RAW 시트 읽는 중...');
  const sheets = await getSheets();

  const [
    rawMeta, rawGoogle, rawNaver, rawKakao, rawSearch, rawIG,
    rawCommerce, rawOrdersCoupang, rawAdsCoupang, rawOrdersSmartstore,
  ] = await Promise.all([
    readSheet(sheets, 'RAW_ads_meta'),
    readSheet(sheets, 'RAW_ads_google'),
    readSheet(sheets, 'RAW_ads_naver'),
    readSheet(sheets, 'RAW_ads_kakao'),
    readSheet(sheets, 'RAW_brand_search'),
    readSheet(sheets, 'RAW_sns_instagram'),
    readSheet(sheets, 'RAW_commerce'),
    readSheet(sheets, 'RAW_orders_coupang'),
    readSheet(sheets, 'RAW_ads_coupang'),
    readSheet(sheets, 'RAW_orders_smartstore'),
  ]);

  console.log(`  Meta:${rawMeta.length} Google:${rawGoogle.length} Naver:${rawNaver.length} Kakao:${rawKakao.length} Search:${rawSearch.length} IG:${rawIG.length}`);
  console.log(`  Commerce:${rawCommerce.length} 쿠팡주문:${rawOrdersCoupang.length} 쿠팡광고:${rawAdsCoupang.length} 스마트스토어:${rawOrdersSmartstore.length}`);

  const rawData = {
    ads_meta:           rawMeta,
    ads_google:         rawGoogle,
    ads_naver:          rawNaver,
    ads_kakao:          rawKakao,
    brand_search:       rawSearch,
    instagram:          rawIG,
    commerce:           rawCommerce,
    orders_coupang:     rawOrdersCoupang,
    ads_coupang:        rawAdsCoupang,
    orders_smartstore:  rawOrdersSmartstore,
    generated_at:       new Date().toISOString(),
  };

  // dist/dashboard.html 생성
  const templatePath = path.join(__dirname, 'index.html');
  const distDir      = path.join(__dirname, '../../dist');
  const distPath     = path.join(distDir, 'dashboard.html');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  const template = fs.readFileSync(templatePath, 'utf8');

  const injectScript = `<script>
const __RAW_DATA__ = ${JSON.stringify(rawData)};
</script>`;

  const patched = template
    .replace('</head>', injectScript + '\n</head>');

  fs.writeFileSync(distPath, patched, 'utf8');

  // AI 채팅용 데이터 파일
  fs.writeFileSync(path.join(distDir, 'data.json'), JSON.stringify(rawData), 'utf8');

  // Netlify 루트 → dashboard.html 리다이렉트
  fs.writeFileSync(path.join(distDir, '_redirects'), '/  /dashboard.html  200\n', 'utf8');

  const totalRows = rawMeta.length + rawGoogle.length + rawNaver.length + rawKakao.length;
  console.log(`[Build] 완료 → ${distPath} + data.json`);
  console.log(`  총 광고 데이터: ${totalRows}행`);
}

main().catch(err => {
  console.error('[Build] 오류:', err.message);
  process.exit(1);
});
