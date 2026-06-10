/**
 * 카카오 OAuth 액세스 토큰 발급 스크립트
 *
 * 사용법:
 * 1. node scripts/get_kakao_token.js 실행
 * 2. 출력된 URL을 브라우저에서 열기
 * 3. 카카오 광고 담당자 계정으로 로그인
 * 4. 인가 코드(code=...) 복사해서 붙여넣기
 * 5. 발급된 access_token을 config/.env의 KAKAO_ACCESS_TOKEN에 입력
 *
 * 필요 스코프: moment_adaccounts (카카오모먼트 광고계정 접근)
 */

require('dotenv').config({ path: 'config/.env' });
const axios    = require('axios');
const readline = require('readline');

const REST_API_KEY   = process.env.KAKAO_REST_API_KEY;
const REDIRECT_URI   = 'https://example.com/oauth';  // 카카오 앱에 등록된 Redirect URI로 변경 필요

if (!REST_API_KEY) {
  console.error('KAKAO_REST_API_KEY가 .env에 없습니다.');
  process.exit(1);
}

const authUrl =
  `https://kauth.kakao.com/oauth/authorize` +
  `?client_id=${REST_API_KEY}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=moment_adaccounts`;

console.log('\n========================================');
console.log(' 카카오 OAuth 토큰 발급');
console.log('========================================');
console.log('\n아래 URL을 브라우저에서 여세요:');
console.log('\n' + authUrl + '\n');
console.log('로그인 후 리다이렉트된 URL에서 "code=" 값을 복사하세요.');
console.log('예: https://example.com/oauth?code=ABCD1234  →  ABCD1234\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('인가 코드(code=... 값)를 입력하세요: ', async (code) => {
  rl.close();
  code = code.trim();
  if (!code) { console.error('코드가 없습니다.'); process.exit(1); }

  try {
    const res = await axios.post('https://kauth.kakao.com/oauth/token', null, {
      params: {
        grant_type:   'authorization_code',
        client_id:    REST_API_KEY,
        redirect_uri: REDIRECT_URI,
        code,
      },
    });

    const { access_token, refresh_token, expires_in } = res.data;
    console.log('\n========================================');
    console.log(' 토큰 발급 성공!');
    console.log('========================================');
    console.log(`\naccess_token  : ${access_token}`);
    console.log(`refresh_token : ${refresh_token}`);
    console.log(`만료 시간     : ${expires_in}초 (약 ${Math.round(expires_in/3600)}시간)`);
    console.log('\nconfig/.env에 아래 값을 입력하세요:');
    console.log(`KAKAO_ACCESS_TOKEN=${access_token}`);
    console.log(`KAKAO_REFRESH_TOKEN=${refresh_token}`);
    console.log('========================================\n');
  } catch (e) {
    console.error('토큰 발급 실패:', e.response?.data || e.message);
  }
});
