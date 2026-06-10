/**
 * 일별 광고 이슈 체크 & 이메일 리포트
 * run_all.js 마지막 단계에서 자동 실행
 *
 * 수동 실행: node src/reporters/daily_report.js [--date=YYYY-MM-DD]
 */

require('dotenv').config({ path: 'config/.env' });
const nodemailer  = require('nodemailer');
const { google }  = require('googleapis');
const path        = require('path');

const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
const CREDS_PATH  = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH || 'config/google_credentials.json');
const FROM        = process.env.REPORT_EMAIL_FROM;
const TO          = process.env.REPORT_EMAIL_TO;
const PASS        = process.env.REPORT_EMAIL_PASS;

// ─── 날짜 ────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='));

function getTargetDate() {
  if (dateArg) return dateArg.split('=')[1];
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function prevDate(d) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().split('T')[0];
}

// ─── 시트 읽기 ───────────────────────────────────────────────────────────────
async function readSheet(sheets, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A2:Z`,
    });
    return res.data.values || [];
  } catch { return []; }
}

// ─── 집계 ────────────────────────────────────────────────────────────────────
const n = v => parseFloat(v) || 0;

function sumByDate(rows, date, spendCol, revenueCol, clickCol) {
  return rows
    .filter(r => r[0] === date)
    .reduce((s, r) => ({
      spend:   s.spend   + n(r[spendCol]),
      revenue: s.revenue + n(r[revenueCol]),
      clicks:  s.clicks  + n(r[clickCol]),
    }), { spend: 0, revenue: 0, clicks: 0 });
}

// ─── 이슈 감지 ───────────────────────────────────────────────────────────────
const THRESHOLDS = {
  roas_min:         300,    // ROAS 기준치 (%)
  spend_surge:       30,    // 광고비 전일 대비 급증 기준 (%)
  spend_drop:       -40,    // 광고비 전일 대비 급감 기준 (%)
  search_drop:      -20,    // 검색량 전주 대비 급락 기준 (%)
};

function detectIssues(today, yesterday, searchRows, targetDate) {
  const issues  = [];
  const notices = [];

  // ROAS 체크 (Meta만 revenue 있음)
  const totalSpend = today.meta.spend + today.google.spend + today.naver.spend;
  const totalRevenue = today.meta.revenue + today.google.revenue;
  const roas = totalSpend > 0 ? Math.round(totalRevenue / totalSpend * 100) : null;

  if (roas !== null) {
    if (roas < THRESHOLDS.roas_min) {
      issues.push(`🔴 통합 ROAS ${roas}% — 기준치 ${THRESHOLDS.roas_min}% 미달`);
    } else {
      notices.push(`✅ 통합 ROAS ${roas}% — 정상`);
    }
  }

  // 채널별 광고비 전일 대비
  const channels = [
    { name: '메타',     cur: today.meta.spend,   prev: yesterday.meta.spend },
    { name: '구글',     cur: today.google.spend, prev: yesterday.google.spend },
    { name: '네이버SA', cur: today.naver.spend,  prev: yesterday.naver.spend },
  ];

  for (const ch of channels) {
    if (!ch.prev || ch.cur === 0) continue;
    const chg = Math.round((ch.cur - ch.prev) / ch.prev * 100);
    if (chg >= THRESHOLDS.spend_surge) {
      issues.push(`🟡 ${ch.name} 광고비 전일 대비 +${chg}% 급증 (${fmt원(ch.cur)})`);
    } else if (chg <= THRESHOLDS.spend_drop) {
      issues.push(`🟡 ${ch.name} 광고비 전일 대비 ${chg}% 급감 (${fmt원(ch.cur)})`);
    } else if (ch.cur > 0) {
      notices.push(`✅ ${ch.name} 광고비 정상 (${fmt원(ch.cur)}, 전일비 ${chg > 0 ? '+' : ''}${chg}%)`);
    }
  }

  // 브랜드 검색량 (최근 2주 비교)
  const brands = { BC: '브리즈케어', HK: '헬스키친' };
  for (const [code, name] of Object.entries(brands)) {
    const brandRows = searchRows
      .filter(r => r[1] === code)
      .sort((a, b) => b[0].localeCompare(a[0]));
    if (brandRows.length >= 2) {
      const latest = n(brandRows[0][3]);
      const prev   = n(brandRows[1][3]);
      if (prev > 0) {
        const chg = Math.round((latest - prev) / prev * 100);
        if (chg <= THRESHOLDS.search_drop) {
          issues.push(`🟡 ${name} 검색량 전주 대비 ${chg}% 급락 (${latest.toFixed(1)})`);
        } else {
          notices.push(`✅ ${name} 검색량 정상 (${latest.toFixed(1)}, 전주비 ${chg > 0 ? '+' : ''}${chg}%)`);
        }
      }
    }
  }

  return { issues, notices, roas, totalSpend, totalRevenue };
}

// ─── 포맷 ────────────────────────────────────────────────────────────────────
function fmt원(v) {
  const n = parseFloat(v) || 0;
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억원';
  if (n >= 10_000)      return Math.round(n / 10000) + '만원';
  return n.toLocaleString() + '원';
}

// ─── 이메일 HTML ─────────────────────────────────────────────────────────────
function buildEmailHtml(targetDate, result) {
  const { issues, notices, roas, totalSpend, totalRevenue, today } = result;
  const hasIssue = issues.length > 0;

  const issueSection = issues.length
    ? `<div style="background:#2d1a1a;border-left:4px solid #f87171;padding:12px 16px;border-radius:4px;margin-bottom:12px">
        <div style="font-weight:700;color:#f87171;margin-bottom:8px">🚨 이슈 ${issues.length}건</div>
        ${issues.map(i => `<div style="color:#fca5a5;font-size:14px;padding:3px 0">${i}</div>`).join('')}
      </div>`
    : `<div style="background:#1a2d1a;border-left:4px solid #34d399;padding:12px 16px;border-radius:4px;margin-bottom:12px">
        <div style="font-weight:700;color:#34d399">✅ 이슈 없음 — 전 채널 정상</div>
      </div>`;

  const noticeSection = notices.length
    ? `<div style="color:#8892a4;font-size:13px;margin-top:8px">${notices.map(n => `<div style="padding:2px 0">${n}</div>`).join('')}</div>`
    : '';

  const kpiTable = `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
      <tr style="border-bottom:1px solid #2a3044">
        <td style="padding:8px 0;color:#8892a4">총 광고비</td>
        <td style="padding:8px 0;font-weight:700;text-align:right">${fmt원(totalSpend)}</td>
      </tr>
      <tr style="border-bottom:1px solid #2a3044">
        <td style="padding:8px 0;color:#8892a4">광고 매출</td>
        <td style="padding:8px 0;font-weight:700;text-align:right">${fmt원(totalRevenue)}</td>
      </tr>
      <tr style="border-bottom:1px solid #2a3044">
        <td style="padding:8px 0;color:#8892a4">통합 ROAS</td>
        <td style="padding:8px 0;font-weight:700;text-align:right;color:${roas !== null ? (roas >= 300 ? '#34d399' : '#f87171') : '#8892a4'}">${roas !== null ? roas + '%' : '—'}</td>
      </tr>
      <tr style="border-bottom:1px solid #2a3044">
        <td style="padding:8px 0;color:#8892a4">메타 광고비</td>
        <td style="padding:8px 0;text-align:right">${fmt원(today.meta.spend)}</td>
      </tr>
      <tr style="border-bottom:1px solid #2a3044">
        <td style="padding:8px 0;color:#8892a4">구글 광고비</td>
        <td style="padding:8px 0;text-align:right">${fmt원(today.google.spend)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#8892a4">네이버SA 광고비</td>
        <td style="padding:8px 0;text-align:right">${fmt원(today.naver.spend)}</td>
      </tr>
    </table>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="background:#0d0f14;color:#e2e8f0;font-family:-apple-system,sans-serif;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto">

    <div style="margin-bottom:20px">
      <div style="font-size:12px;color:#4a5568;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">경인전자 CMO 대시보드</div>
      <div style="font-size:22px;font-weight:700">${targetDate} 광고 리포트</div>
    </div>

    ${issueSection}
    ${noticeSection}

    <div style="background:#161a23;border:1px solid #2a3044;border-radius:10px;padding:20px;margin-top:16px">
      <div style="font-size:12px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">어제 광고 요약</div>
      ${kpiTable}
    </div>

    <div style="margin-top:20px;font-size:11px;color:#4a5568;text-align:center">
      자동 생성 · 경인전자 CMO 대시보드 · ${new Date().toLocaleString('ko-KR')}
    </div>
  </div>
</body></html>`;
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
async function main() {
  if (!FROM || !TO || !PASS) {
    console.warn('[Report] 이메일 설정 없음 — 건너뜀 (REPORT_EMAIL_FROM/TO/PASS 확인)');
    return;
  }

  const targetDate = getTargetDate();
  const prevDay    = prevDate(targetDate);

  console.log(`[Report] ${targetDate} 리포트 생성 중...`);

  // 시트 읽기
  const auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const [rawMeta, rawGoogle, rawNaver, rawSearch] = await Promise.all([
    readSheet(sheets, 'RAW_ads_meta'),
    readSheet(sheets, 'RAW_ads_google'),
    readSheet(sheets, 'RAW_ads_naver'),
    readSheet(sheets, 'RAW_brand_search'),
  ]);

  // meta:   [date,brand,camp,adset,ad,spend,imp,clicks,ctr,cpc,purchases,revenue,roas,cac,updated]
  // google: [date,brand,camp,spend,imp,clicks,ctr,cpc,conv,revenue,roas,updated]
  // naver:  [date,brand,camp,spend,imp,clicks,ctr,cpc,conv,revenue,roas,updated]
  const today = {
    meta:   sumByDate(rawMeta,   targetDate, 5, 11, 7),
    google: sumByDate(rawGoogle, targetDate, 3,  9, 5),
    naver:  sumByDate(rawNaver,  targetDate, 3,  9, 5),
  };
  const yesterday = {
    meta:   sumByDate(rawMeta,   prevDay, 5, 11, 7),
    google: sumByDate(rawGoogle, prevDay, 3,  9, 5),
    naver:  sumByDate(rawNaver,  prevDay, 3,  9, 5),
  };

  const { issues, notices, roas, totalSpend, totalRevenue } = detectIssues(today, yesterday, rawSearch, targetDate);

  const result = { issues, notices, roas, totalSpend, totalRevenue, today };

  // 콘솔 출력
  console.log(`  광고비: ${fmt원(totalSpend)} | ROAS: ${roas ?? '—'}%`);
  if (issues.length)  { console.log('  이슈:'); issues.forEach(i  => console.log('   ', i)); }
  if (notices.length) { console.log('  정상:'); notices.forEach(n => console.log('   ', n)); }

  // 이메일 발송
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: FROM, pass: PASS },
  });

  const subject = issues.length
    ? `🚨 [KIE CMO] ${targetDate} 이슈 ${issues.length}건 발생`
    : `✅ [KIE CMO] ${targetDate} 광고 정상`;

  await transporter.sendMail({
    from:    `"경인전자 CMO" <${FROM}>`,
    to:      TO,
    subject,
    html:    buildEmailHtml(targetDate, result),
  });

  console.log(`[Report] 이메일 발송 완료 → ${TO}`);
}

main().catch(err => {
  console.error('[Report] 오류:', err.message);
  process.exit(1);
});
