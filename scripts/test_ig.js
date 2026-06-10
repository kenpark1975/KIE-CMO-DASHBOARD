require("dotenv").config({ path: "config/.env" });
const axios = require("axios");

const token = process.env.INSTAGRAM_ACCESS_TOKEN_BC;
const bizId = process.env.INSTAGRAM_BUSINESS_ID_BC;

async function test() {
  // 1. 토큰 유효성 확인
  try {
    const r = await axios.get("https://graph.facebook.com/v19.0/me", {
      params: { access_token: token, fields: "id,name" }
    });
    console.log("Token OK:", r.data);
  } catch(e) {
    console.error("Token error:", JSON.stringify(e.response?.data));
    return;
  }

  // 2. 비즈니스 계정 정보
  try {
    const r = await axios.get("https://graph.facebook.com/v19.0/" + bizId, {
      params: { access_token: token, fields: "id,name,followers_count,media_count,username" }
    });
    console.log("IG account:", r.data);
  } catch(e) {
    console.error("IG account error:", JSON.stringify(e.response?.data));
  }
}
test().catch(console.error);
