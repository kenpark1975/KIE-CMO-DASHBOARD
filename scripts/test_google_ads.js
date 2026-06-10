require('dotenv').config({ path: 'config/.env' });
const axios = require('axios');

const CLIENT_ID      = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET  = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REFRESH_TOKEN  = process.env.GOOGLE_ADS_REFRESH_TOKEN;
const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

async function test() {
  // 1. 토큰 발급
  const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const accessToken = tokenRes.data.access_token;
  console.log('토큰 발급 성공');

  // 2. GAQL 쿼리
  const query = `
    SELECT
      segments.date,
      campaign.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks
    FROM campaign
    WHERE
      segments.date BETWEEN '2026-06-01' AND '2026-06-08'
      AND campaign.status != 'REMOVED'
    ORDER BY segments.date DESC
  `;

  try {
    const res = await axios.post(
      'https://googleads.googleapis.com/v20/customers/2834665872/googleAds:searchStream',
      { query },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': DEVELOPER_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('성공! 응답 크기:', JSON.stringify(res.data).length, '바이트');
    const rows = [];
    for (const batch of res.data || []) rows.push(...(batch.results || []));
    console.log('rows:', rows.length);
    if (rows.length > 0) console.log('첫 번째 행:', JSON.stringify(rows[0], null, 2));
  } catch (e) {
    console.error('오류 상태:', e.response?.status);
    console.error('오류 내용:', JSON.stringify(e.response?.data, null, 2));
  }
}

test().catch(console.error);
