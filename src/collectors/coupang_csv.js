/**
 * 쿠팡 애즈 CSV 파서
 * 쿠팡 Wing에서 수동 다운로드한 광고 성과 CSV를 파싱해 반환
 * upload_csv.js 에서 호출됨 (직접 실행 X)
 *
 * CSV 다운로드 경로: 쿠팡 Wing → 광고 관리 → 성과 리포트 → 다운로드
 */

const fs       = require('fs');
const Papa     = require('papaparse');

// 쿠팡 애즈 CSV 컬럼명 → 내부 필드명
const COLUMN_MAP = {
  '날짜':              'date',
  '캠페인명':          'campaign_name',
  '노출수':            'impressions',
  '클릭수':            'clicks',
  '클릭률(%)':         'ctr',
  '광고비(원)':        'spend',
  '직접 매출액(원)':   'revenue',
  'ROAS(%)':           'roas_raw',   // 쿠팡은 % 단위로 제공 (300% = ROAS 3.0)
  '전환수':            'conversions',
};

function parseCoupangCsv(filePath, brand) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');

  // 쿠팡 CSV는 BOM(UTF-8) 포함 가능
  const cleaned = raw.replace(/^﻿/, '');

  const result = Papa.parse(cleaned, {
    header:       true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (result.errors.length) {
    const critical = result.errors.filter(e => e.type === 'Delimiter' || e.type === 'Quotes');
    if (critical.length) throw new Error(`CSV 파싱 오류: ${critical[0].message}`);
  }

  const rows = [];

  for (const record of result.data) {
    // 컬럼명 정규화
    const mapped = {};
    for (const [csvCol, internalCol] of Object.entries(COLUMN_MAP)) {
      // 공백·특수문자 차이 대응
      const key = Object.keys(record).find(k => k.trim() === csvCol.trim());
      mapped[internalCol] = key ? record[key] : '';
    }

    // 필수 컬럼 없으면 스킵
    if (!mapped.date || !mapped.campaign_name) continue;

    const spend      = parseFloat((mapped.spend      || '0').replace(/,/g, '')) || 0;
    const revenue    = parseFloat((mapped.revenue    || '0').replace(/,/g, '')) || 0;
    const impressions = parseInt((mapped.impressions || '0').replace(/,/g, '')) || 0;
    const clicks     = parseInt((mapped.clicks       || '0').replace(/,/g, '')) || 0;
    const conversions = parseInt((mapped.conversions || '0').replace(/,/g, '')) || 0;
    const ctr        = parseFloat((mapped.ctr        || '0').replace(/,/g, '')) || 0;

    // 쿠팡 ROAS는 % 단위 (예: 350) → 소수로 변환 (3.5)
    const roasRaw = parseFloat((mapped.roas_raw || '0').replace(/,/g, '')) || 0;
    const roas    = Math.round((roasRaw / 100) * 100) / 100;

    rows.push([
      normalizeDate(mapped.date),
      brand,
      mapped.campaign_name.trim(),
      spend,
      impressions,
      clicks,
      ctr,
      conversions,
      revenue,
      roas,
      new Date().toISOString(),
    ]);
  }

  return rows;
}

// 날짜 형식 정규화: YYYY.MM.DD → YYYY-MM-DD
function normalizeDate(raw) {
  if (!raw) return '';
  return raw.trim().replace(/\./g, '-');
}

module.exports = { parseCoupangCsv };
