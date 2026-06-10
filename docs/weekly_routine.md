# 주간 운영 루틴 가이드
> 매주 월요일 오전 · 퍼포마케터 담당 · 목표 10분 이내

---

## 월요일 오전 루틴 (10분)

### Step 1 — 쿠팡 애즈 CSV 다운로드 (3분)
1. 쿠팡 Wing 접속 → [광고 관리] → [성과 리포트]
2. 기간: 전주 월요일 ~ 일요일
3. 브랜드별로 각각 다운로드 (BC / HK / BD)
4. 파일명 형식: `쿠팡광고_BC_20260601.csv`

### Step 2 — CSV 업로드 (2분)
```bash
# 브리즈케어
node scripts/upload_csv.js --file="쿠팡광고_BC_20260601.csv" --brand=BC

# 헬스키친
node scripts/upload_csv.js --file="쿠팡광고_HK_20260601.csv" --brand=HK

# 뷰티디바이스
node scripts/upload_csv.js --file="쿠팡광고_BD_20260601.csv" --brand=BD
```

### Step 3 — 대시보드 확인 (5분)
1. `dashboard/index.html` 브라우저에서 열기
2. 전체 현황 탭 → 알럿(빨간색) 항목 확인
3. Kill Switch 탭 → ALERT/WATCH 항목 확인
4. 이슈 있으면 슬랙 #마케팅-이슈 채널에 공유

---

## 자동 수집 스케줄 (매일 오전 6시)

아래 항목은 자동으로 수집되므로 별도 작업 불필요:
- 메타·구글·네이버SA 광고 전일 성과
- ONEWMS 전일 주문·반품·재고
- 인스타그램 전일 인사이트
- 네이버 데이터랩 검색량 (주 1회 자동)

---

## 이슈 발생 시 대응

### 데이터가 안 들어왔을 때
```bash
# 특정 소스만 재실행
node src/collectors/meta.js --date=2026-06-01
node src/collectors/onewms.js --date=2026-06-01
```

### API 오류 발생 시
```bash
# 로그 확인
cat logs/error.log | tail -50
```

### Kill Switch ALERT 발생 시
1. 해당 브랜드·지표 즉시 CMO(Ken) 슬랙 보고
2. 원인 파악 후 개선 방안 제안
3. CMO 승인 후 조치 실행

---

## 월간 루틴 (매월 1일)

- [ ] 재무팀으로부터 전월 정산 데이터 수령
- [ ] 공헌이익률 수동 업데이트 (CALC_weekly 탭)
- [ ] CMO 월간 리포트 Google Slides 초안 생성
- [ ] 전월 KPI 달성율 정리 → 브랜드별 1페이지

---

## 문의

이슈 발생 시 Claude Code 프로젝트에서 문제 상황 설명하면
파이프라인 수정·디버깅 지원.
