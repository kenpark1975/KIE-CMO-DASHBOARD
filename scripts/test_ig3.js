require("dotenv").config({ path: "config/.env" });
const axios = require("axios");
const token = process.env.INSTAGRAM_ACCESS_TOKEN_BC;

async function test() {
  // 현재 토큰의 권한 목록 확인
  const r = await axios.get("https://graph.facebook.com/v19.0/me/permissions", {
    params: { access_token: token }
  });
  console.log("현재 부여된 권한:");
  r.data.data.forEach(p => console.log(" -", p.permission, ":", p.status));
}
test().catch(e => console.error(e.response?.data || e.message));
