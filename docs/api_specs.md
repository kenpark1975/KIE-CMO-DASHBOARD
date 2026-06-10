# API 연동 스펙 상세
> 각 데이터 소스별 연동 방법, 수집 항목, 주의사항

---

## 1. 메타 광고 API (Meta Marketing API)

**버전**: v19.0  
**공식 문서**: https://developers.facebook.com/docs/marketing-apis

### 준비사항
1. Meta Business Manager → 앱 생성
2. 마케팅 API 권한 신청 (`ads_read`)
3. 장기 액세스 토큰 발급 (60일 → 장기토큰으로 교환)
4. 브랜드별 광고계정 ID 확인 (`act_XXXXXXXXX`)

### 수집 항목
```
campaign_name       캠페인명
adset_name          광고세트명
ad_name             광고명 (소재명)
spend               광고비 (원)
impressions         노출수
clicks              클릭수
ctr                 클릭률
cpc                 클릭당 비용
purchase            구매 전환수
purchase_roas       구매 ROAS
cost_per_purchase   구매당 비용 (CAC)
date_start          날짜
account_id          광고계정 ID (브랜드 구분용)
```

### 핵심 코드 패턴
```javascript
// src/collectors/meta.js 참고
const url = `https://graph.facebook.com/v19.0/${AD_ACCOUNT_ID}/insights`;
const params = {
  access_token: META_ACCESS_TOKEN,
  fields: 'campaign_name,adset_name,spend,impressions,clicks,ctr,cpc,actions,action_values',
  time_range: JSON.stringify({ since: startDate, until: endDate }),
  level: 'ad',
  limit: 500
};
```

### 주의사항
- 전환 데이터(purchase)는 픽셀 연동 필수
- 브랜드별 광고계정이 분리되어 있어야 브랜드별 집계 가능
- API 호출 제한: 200calls/hour per token

---

## 2. 구글 광고 API (Google Ads API)

**버전**: v16  
**공식 문서**: https://developers.google.com/google-ads/api/docs/start

### 준비사항
1. Google Ads 개발자 토큰 신청 (승인까지 1~2주 소요)
2. OAuth2 인증 설정 (Client ID/Secret)
3. Refresh Token 발급
4. 브랜드별 Customer ID 확인

### 수집 항목
```
campaign.name
metrics.cost_micros           광고비 (1,000,000으로 나누면 원)
metrics.impressions
metrics.clicks
metrics.ctr
metrics.average_cpc
metrics.conversions           전환수
metrics.conversions_value     전환 가치 (매출)
metrics.roas                  ROAS
segments.date
```

### 핵심 코드 패턴
```javascript
// GAQL (Google Ads Query Language) 사용
const query = `
  SELECT
    campaign.name,
    metrics.cost_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.ctr,
    metrics.average_cpc,
    metrics.conversions,
    metrics.conversions_value,
    segments.date
  FROM campaign
  WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  ORDER BY segments.date DESC
`;
```

### 주의사항
- 개발자 토큰 승인 전에는 테스트 계정만 접근 가능
- cost_micros를 1,000,000으로 나눠야 실제 금액

---

## 3. 네이버 검색광고 API

**공식 문서**: https://naver.github.io/searchad-apidoc/

### 준비사항
1. 네이버 광고 시스템 → API 관리 → 액세스 라이선스 발급
2. API Key / Secret Key / Customer ID 확인

### 수집 항목
```
campaignName      캠페인명
adGroupName       광고그룹명
cost              광고비
impressionCnt     노출수
clickCnt          클릭수
ctr               클릭률
avgCpc            평균 CPC
revenueForConv    전환 매출
roas              ROAS
convCnt           전환수
statDate          날짜
```

### 핵심 코드 패턴
```javascript
// HMAC-SHA256 서명 필요
const timestamp = Date.now();
const signature = generateSignature(timestamp, 'GET', uri, secretKey);
const headers = {
  'X-Timestamp': timestamp,
  'X-API-KEY': apiKey,
  'X-Customer': customerId,
  'X-Signature': signature
};
```

### 주의사항
- 요청마다 HMAC-SHA256 서명 생성 필요 (복잡도 높음)
- 쇼핑검색 광고는 별도 API 엔드포인트

---

## 4. ONEWMS API ⭐ 가장 중요

**공식 문서**: ONEWMS 담당자에게 API 문서 요청 필요  
**커버 범위**: 자사몰(카페24)·스마트스토어·쿠팡 주문·재고·반품 **통합**

### 준비사항
1. ONEWMS 담당자에게 API 키 발급 요청
2. API 엔드포인트 URL 확인
3. 브랜드별 채널코드 확인 (ONEWMS 내부 설정)

### 수집 항목 — 주문/매출
```
order_date          주문일
channel             채널 (자사몰/스마트스토어/쿠팡)
brand               브랜드 코드
sku                 상품코드
product_name        상품명
quantity            주문수량
sales_amount        판매금액
discount_amount     할인금액
net_amount          실매출 (판매-할인)
order_status        주문상태
```

### 수집 항목 — 재고
```
sku                 상품코드
brand               브랜드
product_name        상품명
stock_quantity      현재 재고수량
weeks_remaining     잔여 주수 (자동 계산)
inbound_quantity    입고 예정수량
location            보관 위치
```

### 수집 항목 — 반품
```
return_date         반품 접수일
channel             채널
brand               브랜드
sku                 상품코드
return_reason       반품 사유
quantity            반품수량
return_amount       반품 금액
status              처리 상태
```

### 핵심 코드 패턴 (예상 — 실제 문서 확인 후 수정)
```javascript
const response = await axios.get(`${ONEWMS_BASE_URL}/api/orders`, {
  headers: {
    'Authorization': `Bearer ${ONEWMS_API_KEY}`,
    'Content-Type': 'application/json'
  },
  params: {
    start_date: startDate,
    end_date: endDate,
    brand: brandCode   // BC | HK | BD
  }
});
```

### ⚠️ 최우선 확인 사항
ONEWMS API 연동 시작 전 반드시 확인:
- [ ] API 문서 수령 (담당자 요청)
- [ ] 실제 API 엔드포인트 URL
- [ ] 인증 방식 (Bearer Token / API Key / HMAC)
- [ ] 브랜드별 채널 구분 방식 (ONEWMS 내부 코드 체계)
- [ ] Rate Limit 기준
- [ ] 재고 잔여 주수 계산 방식 (ONEWMS 제공 vs 직접 계산)

---

## 5. 인스타그램 Graph API

**버전**: v19.0  
**공식 문서**: https://developers.facebook.com/docs/instagram-api

### 준비사항
1. 비즈니스 인스타그램 계정 필수
2. 메타 개발자 앱에서 Instagram Graph API 권한 추가
3. 브랜드별 Instagram Business Account ID 확인
4. 장기 액세스 토큰 (메타 광고 API와 동일 토큰 재사용 가능)

### 수집 항목
```
followers_count           팔로워 수
media_count               게시물 수
// 게시물별 (media insights)
like_count                좋아요
comments_count            댓글
saved                     저장 ⭐ 핵심 지표
shares                    공유 ⭐ 핵심 지표
reach                     도달
impressions               노출
engagement_rate           인게이지먼트율
media_type                게시물 유형 (IMAGE/VIDEO/REEL)
timestamp                 게시일
```

### 핵심 코드 패턴
```javascript
// 계정 기본 정보
const accountUrl = `https://graph.facebook.com/v19.0/${INSTAGRAM_BUSINESS_ID}`;

// 게시물 목록 + 인사이트
const mediaUrl = `${accountUrl}/media?fields=id,media_type,timestamp,like_count,comments_count`;
const insightUrl = `https://graph.facebook.com/v19.0/${mediaId}/insights?metric=saved,shares,reach,impressions`;
```

### 주의사항
- 인사이트 데이터는 최대 2년치만 제공
- REEL과 IMAGE 인사이트 메트릭이 다름
- 저장(saved)·공유(shares)를 좋아요보다 우선 지표로 설정

---

## 6. 네이버 데이터랩 API

**공식 문서**: https://developers.naver.com/docs/serviceapi/datalab/search/search.md

### 준비사항
1. 네이버 개발자 센터 → 애플리케이션 등록
2. 데이터랩(검색어 트렌드) 사용 신청
3. Client ID / Client Secret 발급

### 수집 항목
```
// 브랜드 키워드별 상대 검색량 (0~100)
keyword         검색 키워드
period          기간 (startDate ~ endDate)
timeUnit        집계 단위 (date/week/month)
ratio           검색량 지수 (상대값)
```

### 수집 키워드 목록
```javascript
const keywords = [
  { brand: 'BC', keywords: ['브리즈케어', 'breezecare'] },
  { brand: 'HK', keywords: ['헬스키친', "hell's kitchen cookware"] },
  { brand: 'BD', keywords: [] } // 브랜드명 확정 후 추가
];
```

### 핵심 코드 패턴
```javascript
const response = await axios.post(
  'https://openapi.naver.com/v1/datalab/search',
  {
    startDate: startDate,
    endDate: endDate,
    timeUnit: 'week',
    keywordGroups: keywords
  },
  {
    headers: {
      'X-Naver-Client-Id': NAVER_DATALAB_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_DATALAB_CLIENT_SECRET
    }
  }
);
```

---

## 7. 쿠팡 애즈 CSV (수동)

**수동 다운로드 경로**: 쿠팡 Wing → 광고 관리 → 성과 리포트 → 다운로드

### 다운로드 주기
매주 월요일 오전 — 전주(월~일) 데이터

### CSV 컬럼 매핑
```javascript
// 쿠팡 애즈 CSV 실제 컬럼명 → 내부 필드명
const columnMap = {
  '캠페인명': 'campaign_name',
  '노출수': 'impressions',
  '클릭수': 'clicks',
  '클릭률(%)': 'ctr',
  '광고비(원)': 'spend',
  '직접 매출액(원)': 'revenue',
  'ROAS(%)': 'roas',
  '전환수': 'conversions',
  '날짜': 'date'
};
```

### 업로드 방법
```bash
node scripts/upload_csv.js --file="쿠팡광고_20260601.csv" --brand=BC
```

---

## API 연동 우선순위 및 난이도

| 순서 | 소스 | 난이도 | 이유 |
|------|------|--------|------|
| 1 | ONEWMS | ★★☆ | 커버 범위 최대 · API 문서 선수령 필요 |
| 2 | 메타 광고 | ★★☆ | 데이터 풍부 · 토큰 관리 필요 |
| 3 | 네이버 데이터랩 | ★☆☆ | 단순 · 즉시 시작 가능 |
| 4 | 인스타그램 | ★★☆ | 메타와 동일 인프라 |
| 5 | 구글 광고 | ★★★ | 개발자 토큰 승인 시간 소요 |
| 6 | 네이버SA | ★★☆ | HMAC 서명 구현 필요 |
| 7 | 쿠팡 애즈 CSV | ★☆☆ | 수동이라 언제든 가능 |
