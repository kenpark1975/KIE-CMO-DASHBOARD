# KIE CMO 대시보드 — Windows 작업 스케줄러 등록 스크립트
# 실행: PowerShell을 관리자 권한으로 열고 아래 명령 실행
#   cd C:\Users\Ken\COWORK\kie-dashboard\kie-dashboard
#   powershell -ExecutionPolicy Bypass -File scripts\register_scheduler.ps1

$TaskName    = "KIE-CMO-Dashboard-Collector"
$NodePath    = (Get-Command node -ErrorAction SilentlyContinue).Source
$ProjectDir  = "C:\Users\Ken\COWORK\kie-dashboard\kie-dashboard"
$ScriptPath  = "$ProjectDir\run_all.js"
$LogPath     = "$ProjectDir\logs\scheduler.log"

if (-not $NodePath) {
    # 일반적인 설치 경로 시도
    $NodePath = "C:\Program Files\nodejs\node.exe"
}

if (-not (Test-Path $NodePath)) {
    Write-Error "node.exe를 찾을 수 없습니다: $NodePath"
    exit 1
}

Write-Host "node 경로: $NodePath"
Write-Host "스크립트: $ScriptPath"

# 기존 작업 삭제 (재등록 시)
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 작업 액션: node run_all.js --days=2 (어제+오늘 보정)
$Action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "$ScriptPath --days=2" `
    -WorkingDirectory $ProjectDir

# 트리거: 매일 새벽 02:00
$Trigger = New-ScheduledTaskTrigger -Daily -At "02:00"

# 실행 환경 설정
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# 현재 사용자로 실행 (로그인된 상태에서 실행)
$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# 작업 등록
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "KIE CMO 대시보드 광고 데이터 자동 수집 (매일 02:00)" `
    -Force

Write-Host ""
Write-Host "=========================================="
Write-Host " 작업 스케줄러 등록 완료!"
Write-Host " 작업 이름: $TaskName"
Write-Host " 실행 시간: 매일 02:00"
Write-Host " 작업 디렉토리: $ProjectDir"
Write-Host "=========================================="
Write-Host ""
Write-Host "수동 실행 테스트:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "작업 상태 확인:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Select-Object TaskName, State"
Write-Host ""
Write-Host "작업 삭제:"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
