require("dotenv").config({ path: "config/.env" });
const axios = require("axios");

const token = process.env.INSTAGRAM_ACCESS_TOKEN_BC;
const bizId = process.env.INSTAGRAM_BUSINESS_ID_BC;

async function test() {
  // 미디어 목록
  try {
    const r = await axios.get("https://graph.facebook.com/v19.0/" + bizId + "/media", {
      params: {
        fields: "id,media_type,timestamp,like_count,comments_count",
        limit: 5,
        access_token: token
      }
    });
    console.log("Media list OK, count:", r.data.data?.length);
    if (r.data.data?.length > 0) {
      const first = r.data.data[0];
      console.log("First media:", JSON.stringify(first));

      // 인사이트 테스트
      try {
        const ins = await axios.get("https://graph.facebook.com/v19.0/" + first.id + "/insights", {
          params: { metric: "reach,impressions,saved,shares", access_token: token }
        });
        console.log("Insights OK:", JSON.stringify(ins.data.data));
      } catch(e) {
        console.error("Insights error:", JSON.stringify(e.response?.data));
      }
    }
  } catch(e) {
    console.error("Media error:", JSON.stringify(e.response?.data));
  }
}
test().catch(console.error);
