/**
 * dist/dashboard.html → Google Drive 업로드
 * 매번 같은 파일 ID로 덮어씌우기 (링크 유지)
 *
 * 실행: node src/dashboard/upload_drive.js
 */

require('dotenv').config({ path: 'config/.env' });
const { google } = require('googleapis');
const fs         = require('fs');
const path       = require('path');

const CREDS_PATH  = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || 'config/google_credentials.json');
const FOLDER_ID   = process.env.GOOGLE_DRIVE_FOLDER_ID;
const FILE_ID     = process.env.GOOGLE_DRIVE_FILE_ID;
const DIST_PATH   = path.join(__dirname, '../../dist/dashboard.html');
const FILE_NAME   = 'KIE_CMO_Dashboard.html';

async function main() {
  if (!FILE_ID) {
    console.warn('[Drive] GOOGLE_DRIVE_FILE_ID 미설정 — 건너뜀');
    return;
  }
  if (!fs.existsSync(DIST_PATH)) {
    console.error('[Drive] dist/dashboard.html 없음 — aggregate.js 먼저 실행 필요');
    process.exit(1);
  }

  const auth  = new google.auth.GoogleAuth({
    keyFile: CREDS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/drive',
    ],
  });
  const drive = google.drive({ version: 'v3', auth });

  // 기존 파일 덮어쓰기 (파일 ID 고정 → 공유 링크 변경 없음)
  const fileStream = fs.createReadStream(DIST_PATH);
  await drive.files.update({
    fileId: FILE_ID,
    media: {
      mimeType: 'text/html',
      body: fileStream,
    },
  });
  console.log(`[Drive] 업데이트 완료`);
  console.log(`[Drive] 공유 링크: https://drive.google.com/file/d/${FILE_ID}/view`);
}

main().catch(err => {
  console.error('[Drive] 오류:', err.message);
  process.exit(1);
});
