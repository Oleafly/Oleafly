# Self-contained e2e run for Windows: launches the app with the e2e bridge
# (TCP transport; Windows has no unix sockets) and a throwaway data dir, waits
# for the bridge, runs the Playwright suite, and always tears the app down.
# Usage: powershell -File scripts/e2e.ps1 [playwright args...]
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$stamp = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
$dataDir = Join-Path ([System.IO.Path]::GetTempPath()) "openleaf-e2e-$stamp"
New-Item -ItemType Directory -Path $dataDir | Out-Null
$log = Join-Path ([System.IO.Path]::GetTempPath()) "openleaf-e2e-log-$stamp.txt"

Write-Host "e2e: data dir $dataDir"
Write-Host "e2e: app log  $log"

Get-Process -Name openleaf -ErrorAction SilentlyContinue | Stop-Process -Force

$env:OPENLEAF_DATA_DIR = $dataDir
$app = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "pnpm tauri dev --features e2e-testing > `"$log`" 2>&1" `
  -PassThru -WindowStyle Hidden

Write-Host "e2e: waiting for the tcp bridge (first build can take minutes)..."
$deadline = (Get-Date).AddMinutes(30)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if ($app.HasExited) {
    Write-Host "e2e: app process exited early; log tail:"
    if (Test-Path $log) { Get-Content $log -Tail 30 }
    exit 1
  }
  if ((Test-Path $log) -and (Select-String -Path $log -Pattern "listening on tcp" -Quiet)) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 5
}
if (-not $ready) {
  Write-Host "e2e: bridge never came up; log tail:"
  if (Test-Path $log) { Get-Content $log -Tail 30 }
  exit 1
}
Start-Sleep -Seconds 2

$code = 1
try {
  pnpm exec playwright test -c e2e/playwright.config.ts @args
  $code = $LASTEXITCODE
} finally {
  taskkill /PID $app.Id /T /F 2>$null | Out-Null
  Get-Process -Name openleaf -ErrorAction SilentlyContinue | Stop-Process -Force
  New-Item -ItemType Directory -Force -Path test-results | Out-Null
  if (Test-Path $log) { Copy-Item $log (Join-Path "test-results" "app.log") -Force }
}
exit $code
