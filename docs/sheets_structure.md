# Google Sheets 구조 설계도
> 대시보드 데이터 허브 · 탭 구성 및 컬럼 정의

---

## 탭 구성 원칙

- `RAW_*` : API/CSV에서 받은 원본 데이터. 수식 없음. 덮어쓰기 방식.
- `CALC_*` : RAW 탭을 참조해서 집계하는 수식 탭. 자동 계산.
- `DASHBOARD_input` : 대시보드 HTML이 직접 읽는 최종 데이터 탭.

---

## RAW 탭 구조

### RAW_ads_meta
| 컬럼 | 타입 | 설명 |
|------|------|------|
| date | DATE | 날짜 |
| brand | TEXT | BC / HK / BD |
| campaign_name | TEXT | 캠페인명 |
| adset_name | TEXT | 광고세트명 |
| ad_name | TEXT | 소재명 |
| spend | NUMBER | 광고비 (원) |
| impressions | NUMBER | 노출수 |
| clicks | NUMBER | 클릭수 |
| ctr | NUMBER | 클릭률 (%) |
| cpc | NUMBER | 클릭당 비용 (원) |
| purchases | NUMBER | 구매 전환수 |
| revenue | NUMBER | 전환 매출 (원) |
| roas | NUMBER | ROAS (%) |
| cac | NUMBER | 고객 획득 비용 (원) |
| updated_at | DATETIME | 수집 시각 |

### RAW_ads_google
*(메타와 동일 구조)*

### RAW_ads_naver
*(메타와 동일 구조)*

### RAW_ads_coupang
*(메타와 동일 구조 — 수동 CSV 업로드)*

---

### RAW_commerce
| 컬럼 | 타입 | 설명 |
|------|------|------|
| order_date | DATE | 주문일 |
| brand | TEXT | BC / HK / BD |
| channel | TEXT | SELFMALL / SMARTSTORE / COUPANG |
| sku | TEXT | 상품코드 |
| product_name | TEXT | 상품명 |
| quantity | NUMBER | 주문수량 |
| sales_amount | NUMBER | 판매금액 (원) |
| discount_amount | NUMBER | 할인금액 (원) |
| net_amount | NUMBER | 실매출 (원) |
| order_status | TEXT | 완료/취소/반품 |
| is_new_customer | BOOLEAN | 신규고객 여부 |
| updated_at | DATETIME | 수집 시각 |

---

### RAW_inventory
| 컬럼 | 타입 | 설명 |
|------|------|------|
| snapshot_date | DATE | 재고 기준일 |
| brand | TEXT | BC / HK / BD |
| sku | TEXT | 상품코드 |
| product_name | TEXT | 상품명 |
| stock_qty | NUMBER | 현재 재고수량 |
| avg_daily_sales | NUMBER | 일평균 판매량 (30일) |
| weeks_remaining | NUMBER | 잔여 주수 (stock_qty / avg_daily_sales / 7) |
| inbound_qty | NUMBER | 입고 예정수량 |
| status | TEXT | 정상 / 부족(2주미만) / 과잉(8주초과) |
| updated_at | DATETIME | 수집 시각 |

---

### RAW_returns
| 컬럼 | 타입 | 설명 |
|------|------|------|
| return_date | DATE | 반품일 |
| brand | TEXT | BC / HK / BD |
| channel | TEXT | 채널 |
| sku | TEXT | 상품코드 |
| return_reason | TEXT | 반품 사유 |
| quantity | NUMBER | 반품수량 |
| return_amount | NUMBER | 반품금액 (원) |
| updated_at | DATETIME | 수집 시각 |

---

### RAW_sns_instagram
| 컬럼 | 타입 | 설명 |
|------|------|------|
| snapshot_date | DATE | 수집일 |
| brand | TEXT | BC / HK / BD |
| followers | NUMBER | 팔로워 수 |
| followers_change | NUMBER | 전일 대비 증감 |
| media_id | TEXT | 게시물 ID |
| media_type | TEXT | IMAGE / VIDEO / REEL |
| published_at | DATETIME | 게시일 |
| reach | NUMBER | 도달수 |
| impressions | NUMBER | 노출수 |
| likes | NUMBER | 좋아요 |
| comments | NUMBER | 댓글 |
| saved | NUMBER | 저장수 ⭐ |
| shares | NUMBER | 공유수 ⭐ |
| engagement_rate | NUMBER | 인게이지먼트율 (%) |
| updated_at | DATETIME | 수집 시각 |

---

### RAW_brand_search
| 컬럼 | 타입 | 설명 |
|------|------|------|
| week_start | DATE | 주 시작일 |
| brand | TEXT | BC / HK / BD |
| keyword | TEXT | 검색 키워드 |
| search_ratio | NUMBER | 검색량 지수 (0~100) |
| updated_at | DATETIME | 수집 시각 |

---

## CALC 탭 구조

### CALC_weekly (주간 집계)
매주 자동 계산. 대시보드 주간 KPI의 소스.

| 컬럼 | 수식 소스 | 설명 |
|------|----------|------|
| week_start | - | 주 시작일 |
| brand | - | BC / HK / BD / ALL |
| total_revenue | RAW_commerce | 총 매출 |
| total_ad_spend | RAW_ads_* 합산 | 총 광고비 |
| blended_roas | revenue/spend | 통합 ROAS |
| new_customers | RAW_commerce | 신규 고객수 |
| cac | spend/new_customers | 고객 획득 비용 |
| return_rate | RAW_returns | 반품율 (%) |
| selfmall_ratio | RAW_commerce | 자사몰 비중 (%) |
| contribution_margin | 별도 계산 | 공헌이익률 (%) |

### CALC_brand (브랜드별 집계)
브랜드별 채널 믹스, 광고 채널별 ROAS, SNS 성과 집계.

---

## DASHBOARD_input 탭 구조

대시보드 HTML이 `fetch`로 직접 읽는 탭.
**이 탭만 잘 만들면 대시보드는 자동으로 업데이트됨.**

### 섹션별 Named Range 설정

```
OVERVIEW_KPI          → 주간 핵심 KPI 8개
BRAND_SUMMARY         → 브랜드별 요약 (3행)
ADS_CHANNEL           → 채널별 ROAS (6행)
ADS_FUNNEL            → 퍼널 데이터
SNS_PLATFORM          → 플랫폼별 SNS 성과
COMMERCE_CHANNEL      → 채널별 매출 매트릭스
INVENTORY_STATUS      → 재고 현황 (SKU별)
BRAND_SEARCH          → 브랜드 검색량 트렌드
KILL_SWITCH           → Kill Switch 현황 (브랜드×KPI)
```

---

## Google Sheets 초기 설정 순서

1. 새 구글 시트 생성
2. 위 탭들을 순서대로 생성
3. `node src/sheets/writer.js --init` 실행 → 헤더 행 자동 생성
4. Named Range 설정 (수동 또는 스크립트)
5. CALC 탭 수식 입력
6. `DASHBOARD_input` 탭 수식 연결
7. 대시보드 HTML에서 Sheet ID 설정 후 테스트
