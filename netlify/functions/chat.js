/**
 * Netlify Function: /chat — 대시보드 AI 채팅
 * data.json(시트 데이터) + 질문을 Claude API에 전달, 답변 반환
 *
 * 필요 환경변수 (Netlify Site settings → Environment variables):
 *   ANTHROPIC_API_KEY  — console.anthropic.com에서 발급
 *   CHAT_PASSWORD      — 채팅 비밀번호 (남용 방지)
 *   CHAT_MODEL         — (선택) 기본 claude-haiku-4-5-20251001. 더 똑똑한 답변: claude-sonnet-4-6
 *
 * 의존성 없음 (Node 18+ 내장 fetch 사용)
 */

const SCHEMA = `
[데이터 스키마 — 모든 행은 배열, 컬럼 순서 고정]
ads_meta / ads_google / ads_naver / ads_kakao (일별 광고 성과):
  [date, brand, campaign_name, adset_name, ad_name, spend(원), impressions, clicks, ctr(%), cpc(원), purchases, revenue(원), roas(%), cac(원), updated_at]
ads_coupang (쿠팡 광고, 14일 기여 기준):
  [date, brand, campaign_name, spend(원), impressions, clicks, ctr(%), conversions, revenue(원), roas(배수: 3.19=319%), updated_at]
orders_coupang (쿠팡 일별 주문):
  [date, brand, order_count, item_count, revenue(원), cancel_count, updated_at]
orders_smartstore (스마트스토어 일별 주문):
  [date, brand, order_count, item_count, revenue(원), cancel_count, return_count, cancel_return_rate, updated_at]
commerce (주문 품목 단위, channel="자사몰"=아임웹 등):
  [order_date, brand, channel, sku, product_name, quantity, sales_amount(원), discount_amount(원), net_amount(원), order_status, is_new_customer, updated_at]
brand_search (네이버 데이터랩, 주별 상대 검색량):
  [week_start, brand, keyword, ...]
instagram:
  [snapshot_date, brand, followers, followers_change, media_id, media_type, published_at, reach, impressions, likes, comments, saved, shares, engagement_rate, updated_at]

[브랜드] BC=브리즈케어(본앤메이드), HK=헬스키친, BD=뷰티디바이스(인수 예정)
`;

const SYSTEM_PROMPT = `너는 경인전자(KIE) CMO 대시보드의 데이터 분석 어시스턴트다.
아래 제공되는 JSON 데이터(구글 시트에서 적재된 광고/매출/SNS 데이터)를 근거로 질문에 답한다.

규칙:
- 반드시 제공된 데이터만 근거로 답한다. 데이터에 없으면 "해당 기간 데이터가 없습니다"라고 말한다.
- 금액은 원 단위, 천 단위 콤마로 표기 (예: 1,234,567원).
- ROAS: ads_coupang만 배수(3.19=319%), 나머지는 % 그대로.
- 계산 과정은 간단히, 결론을 먼저. 한국어로 간결하게 답한다.
- 데이터 외 질문(일반 지식, 코드 작성 등)은 정중히 거절한다.
${SCHEMA}`;

// 최근 N일 데이터만 추출 (토큰 비용 절감)
function trimData(data, days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const out = { generated_at: data.generated_at };
  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    out[key] = rows.filter(r => r && r[0] && String(r[0]).slice(0, 10) >= cutoff);
  }
  return out;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 요청' }) }; }

  // ── 비밀번호 확인 ──
  const PASSWORD = process.env.CHAT_PASSWORD;
  if (!PASSWORD) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'CHAT_PASSWORD 환경변수 미설정' }) };
  }
  if (body.password !== PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: '비밀번호가 틀렸습니다' }) };
  }

  const question = (body.question || '').trim();
  if (!question) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '질문이 비어 있습니다' }) };
  }
  if (question.length > 2000) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '질문이 너무 깁니다 (2000자 이내)' }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY 환경변수 미설정' }) };
  }

  try {
    // ── data.json 로드 (배포된 정적 파일) ──
    const siteUrl = process.env.URL || 'https://kie-cmodash.netlify.app';
    const dataRes = await fetch(`${siteUrl}/data.json`);
    if (!dataRes.ok) throw new Error(`data.json 로드 실패 (${dataRes.status})`);
    const fullData = await dataRes.json();

    // 90일 → 너무 크면 30일로 축소
    let data = trimData(fullData, 90);
    let dataStr = JSON.stringify(data);
    if (dataStr.length > 300000) {
      data = trimData(fullData, 30);
      dataStr = JSON.stringify(data);
    }

    // ── 대화 이력 (최근 6턴) ──
    const history = Array.isArray(body.history)
      ? body.history.slice(-6).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      : [];

    const messages = [
      {
        role: 'user',
        content: `다음은 대시보드 데이터(최근 데이터, JSON)입니다:\n${dataStr}\n\n이 데이터를 참고해 이어지는 질문에 답하세요.`,
      },
      { role: 'assistant', content: '데이터를 확인했습니다. 질문해 주세요.' },
      ...history,
      { role: 'user', content: question },
    ];

    // ── Claude API 호출 ──
    const model = process.env.CHAT_MODEL || 'claude-haiku-4-5-20251001';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      const msg = result?.error?.message || `Claude API 오류 (${res.status})`;
      return { statusCode: 502, headers, body: JSON.stringify({ error: msg }) };
    }

    const answer = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    return { statusCode: 200, headers, body: JSON.stringify({ answer }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
