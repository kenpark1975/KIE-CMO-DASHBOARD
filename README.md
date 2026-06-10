# 경인전자 CMO 마케팅 대시보드
> Ken Park · CMO · 2026

---

## 프로젝트 개요

경인전자 B2C 포트폴리오(브리즈케어·헬스키친·뷰티디바이스)의 마케팅 성과를
**자동 수집 → Google Sheets 집계 → HTML 대시보드** 파이프라인으로 운영하는 시스템.

개발 환경 없이 Claude Code가 전체 파이프라인을 구성하고 유지보수.

---

## 브랜드 코드

| 코드 | 브랜드 | 비고 |
|------|--------|------|
| `BC` | 브리즈케어 | Born & Made |
| `HK` | 헬스키친 | Hell's Kitchen |
| `BD` | 뷰티디바이스 | TBD (인수 예정) |

---

## 데이터 파이프라인 구조

```
[자동 수집 — API]
├── 메타 광고 API          → 광고 성과 (ROAS·CTR·CPC·CVR·CAC)
├── 구글 광고 API          → 광고 성과 (구글·유튜브)
├── 네이버SA 광고 API      → 검색광고 성과
├── ONEWMS API             → 커머스 전체 (자사몰·스마트스토어·쿠팡 주문·재고·반품)
├── 인스타그램 Graph API   → SNS 성과
└── 네이버 데이터랩 API    → 브랜드 검색량 트렌드

[수동 업로드 — 주 1회 월요일]
└── 쿠팡 애즈 CSV          → 쿠팡 광고 성과

[추후 추가]
├── 유튜브 Analytics API
├── 틱톡 API
└── 채널톡 API (CS)

        ↓
[Google Sheets — 중간 허브]
src/sheets/ 구조 참고

        ↓
[CMO 대시보드 — HTML]
dashboard/index.html → 브라우저에서 열어서 사용
```

---

## 디렉토리 구조

```
kie-dashboard/
├── README.md                   ← 이 파일
├── config/
│   ├── .env.example            ← API 키 템플릿 (실제 키는 .env에)
│   └── brands.json             ← 브랜드·채널 설정
├── src/
│   ├── collectors/             ← API 수집 스크립트
│   │   ├── meta.js
│   │   ├── google_ads.js
│   │   ├── naver_sa.js
│   │   ├── onewms.js
│   │   ├── instagram.js
│   │   ├── naver_datalab.js
│   │   └── coupang_csv.js      ← 수동 CSV 파싱
│   ├── sheets/                 ← Google Sheets 연동
│   │   ├── writer.js           ← 시트 업데이트 함수
│   │   └── structure.md        ← 시트 구조 설계도
│   └── dashboard/
│       └── index.html          ← CMO 대시보드 (Sheets 데이터 읽어서 렌더링)
├── scripts/
│   ├── run_all.js              ← 전체 수집 실행 (cron 등록용)
│   └── upload_csv.js           ← 수동 CSV 업로드 스크립트
└── docs/
    ├── api_specs.md            ← 각 API 연동 스펙 상세
    ├── sheets_structure.md     ← Google Sheets 탭 구조
    └── weekly_routine.md       ← 주간 운영 루틴 가이드
```

---

## 빠른 시작

### 1. 환경 설정
```bash
cp config/.env.example config/.env
# .env 파일에 API 키 입력 (docs/api_specs.md 참고)
npm install
```

### 2. Google Sheets 연결
```bash
# Google Service Account 키 파일을 config/google_credentials.json 에 저장
node src/sheets/writer.js --init
```

### 3. 첫 번째 수집 실행
```bash
node scripts/run_all.js
```

### 4. 대시보드 열기
```
dashboard/index.html 을 브라우저에서 열기
```

### 5. 자동 수집 스케줄 등록 (매일 오전 6시)
```bash
# crontab -e 에 추가:
0 6 * * * node /path/to/kie-dashboard/scripts/run_all.js
```

---

## 주간 수동 루틴 (월요일 오전)

1. 쿠팡 Wing 접속 → 광고 성과 CSV 다운로드
2. `node scripts/upload_csv.js --file=쿠팡광고_날짜.csv`
3. 대시보드 열어서 데이터 확인
4. 이상값 있으면 해당 collector 재실행

전체 소요시간 목표: **10분 이내**

---

## Google Sheets 탭 구조 (요약)

| 탭 이름 | 내용 | 업데이트 주기 |
|---------|------|--------------|
| `RAW_ads_meta` | 메타 광고 원본 | 매일 자동 |
| `RAW_ads_google` | 구글 광고 원본 | 매일 자동 |
| `RAW_ads_naver` | 네이버SA 원본 | 매일 자동 |
| `RAW_ads_coupang` | 쿠팡 광고 원본 | 주 1회 수동 |
| `RAW_commerce` | ONEWMS 커머스 통합 | 매일 자동 |
| `RAW_inventory` | ONEWMS 재고 현황 | 매일 자동 |
| `RAW_sns_instagram` | 인스타 성과 | 매일 자동 |
| `RAW_brand_search` | 네이버 검색량 | 주 1회 자동 |
| `CALC_weekly` | 주간 집계 (수식) | 자동 계산 |
| `CALC_brand` | 브랜드별 집계 (수식) | 자동 계산 |
| `DASHBOARD_input` | 대시보드가 읽는 최종 데이터 | 자동 계산 |

→ 상세 구조: `docs/sheets_structure.md`

---

## 기술 스택

- **Runtime**: Node.js
- **데이터 허브**: Google Sheets (googleapis)
- **스케줄링**: cron (로컬) 또는 GitHub Actions
- **대시보드**: Vanilla HTML/CSS/JS (Google Sheets API로 데이터 읽기)
- **개발·유지보수**: Claude Code

---

## 담당자

| 역할 | 담당 |
|------|------|
| 전체 총괄 | Ken Park (CMO) |
| 주간 CSV 업로드 | 퍼포마케터 (본앤메이드 라인) |
| 이슈 에스컬레이션 | Claude Code |
