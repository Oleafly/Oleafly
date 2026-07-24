# Self-contained e2e run for Windows. A full suite launches a fresh real app
# for every spec while retaining one throwaway data directory across the run.
# Usage: powershell -File scripts/e2e.ps1 [--suite-max-failures=N] [playwright args...]
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$suiteMaxFailures = 0
$playwrightArgs = [System.Collections.Generic.List[string]]::new()
for ($index = 0; $index -lt $args.Count; $index++) {
  $argument = [string]$args[$index]
  if ($argument -match "^--suite-max-failures=(\d+)$") {
    $suiteMaxFailures = [int]$Matches[1]
  } elseif ($argument -eq "--suite-max-failures") {
    $index++
    if ($index -ge $args.Count -or [string]$args[$index] -notmatch "^\d+$") {
      throw "--suite-max-failures requires a non-negative integer"
    }
    $suiteMaxFailures = [int]$args[$index]
  } else {
    $playwrightArgs.Add($argument)
  }
}

$runnerMutex = [System.Threading.Mutex]::new($false, "Local\OleaflyE2ERunner")
$runnerOwned = $false
$app = $null
$log = $null
$logStream = $null
$heartbeat = $null
$code = 1
$stamp = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
$dataDir = Join-Path ([System.IO.Path]::GetTempPath()) "oleafly-e2e-$stamp"

# Hermetic remote endpoints: specs 42/44 run a local fixture server on this
# fixed port; other specs never call the pack/deadline commands, so this is
# harmless. Mirrors scripts/e2e.sh.
if (-not $env:OLEAFLY_PACKS_BASE_URL) { $env:OLEAFLY_PACKS_BASE_URL = "http://127.0.0.1:38999" }
if (-not $env:OLEAFLY_DEADLINES_URL) { $env:OLEAFLY_DEADLINES_URL = "http://127.0.0.1:38999/allconf.yml" }

function Start-OutputProcess([string]$command) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-EncodedCommand", $encoded `
    -NoNewWindow -PassThru
}

function Stop-AuxiliaryProcesses {
  foreach ($process in @($script:heartbeat, $script:logStream)) {
    if ($null -ne $process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
  $script:heartbeat = $null
  $script:logStream = $null
}

function Stop-App {
  Stop-AuxiliaryProcesses
  if ($null -ne $script:app -and -not $script:app.HasExited) {
    # Route taskkill output through cmd so its stderr never becomes a
    # terminating NativeCommandError under $ErrorActionPreference = "Stop".
    cmd /c "taskkill /PID $($script:app.Id) /T /F >nul 2>&1"
    try { $script:app.WaitForExit(15000) | Out-Null } catch {}
  }
  $script:app = $null
}

function Start-App([string]$label) {
  Stop-App
  $safeLabel = $label -replace "[^A-Za-z0-9._-]", "-"
  $script:log = Join-Path ([System.IO.Path]::GetTempPath()) "oleafly-e2e-$stamp-$safeLabel.log"
  New-Item -ItemType File -Force -Path $script:log | Out-Null

  Write-Host "e2e: launching app for $label"
  Write-Host "e2e: app log $($script:log)"
  $env:OLEAFLY_DATA_DIR = $script:dataDir
  $script:app = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "pnpm tauri dev --features e2e-testing > `"$($script:log)`" 2>&1" `
    -PassThru -WindowStyle Hidden

  $escapedLog = $script:log.Replace("'", "''")
  $script:logStream = Start-OutputProcess @"
Get-Content -LiteralPath '$escapedLog' -Wait -Tail 0 |
  ForEach-Object { Write-Output ('[app] ' + `$_) }
"@

  Write-Host "e2e: waiting for the tcp bridge (the first build can take minutes)..."
  $deadline = (Get-Date).AddMinutes(30)
  while ((Get-Date) -lt $deadline) {
    if ($script:app.HasExited) {
      Write-Host "e2e: app process exited before the bridge was ready"
      Get-Content $script:log -Tail 30
      throw "The app process exited before the bridge was ready"
    }
    if (Select-String -Path $script:log -Pattern "listening on tcp" -Quiet) {
      return
    }
    Start-Sleep -Seconds 2
  }

  Write-Host "e2e: bridge never came up; log tail:"
  Get-Content $script:log -Tail 30
  throw "The e2e bridge did not become ready within 30 minutes"
}

function Run-Playwright([string]$label, [string[]]$selection) {
  $script:heartbeat = Start-OutputProcess @"
`$started = Get-Date
while (`$true) {
  Start-Sleep -Seconds 30
  `$elapsed = [int]((Get-Date) - `$started).TotalSeconds
  Write-Output "e2e: heartbeat - $label running for `$(`$elapsed)s"
}
"@
  Write-Host "e2e: starting $label at $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))"
  & pnpm exec playwright test -c e2e/playwright.config.ts @playwrightArgs @selection | Out-Host
  $status = $LASTEXITCODE

  if ($null -ne $script:heartbeat -and -not $script:heartbeat.HasExited) {
    Stop-Process -Id $script:heartbeat.Id -Force -ErrorAction SilentlyContinue
  }
  $script:heartbeat = $null
  if ($status -eq 0) {
    Write-Host "e2e: completed $label"
  } else {
    Write-Host "e2e: failed $label with exit code $status"
  }
  return $status
}

function Preserve-AppLog([string]$label) {
  New-Item -ItemType Directory -Force -Path test-results | Out-Null
  if ($null -ne $script:log -and (Test-Path $script:log)) {
    $safeLabel = $label -replace "[^A-Za-z0-9._-]", "-"
    Copy-Item $script:log (Join-Path "test-results" "app-$safeLabel.log") -Force
  }
}

try {
  try {
    $runnerOwned = $runnerMutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $runnerOwned = $true
  }
  if (-not $runnerOwned) {
    throw "e2e: another runner owns the app and bridge"
  }

  & (Join-Path $PSScriptRoot "ensure-e2e-sidecars.ps1")
  New-Item -ItemType Directory -Path $dataDir | Out-Null
  Write-Host "e2e: shared data dir $dataDir"

  $hasSpec = $false
  foreach ($argument in $playwrightArgs) {
    if ($argument -match "\.spec\.ts(?::\d+)?$") {
      $hasSpec = $true
      break
    }
  }

  if ($hasSpec) {
    $label = "requested-spec-selection"
    Start-App $label
    $code = Run-Playwright $label @()
    Preserve-AppLog $label
    Stop-App
  } else {
    $code = 0
    $failures = 0
    $specs = Get-ChildItem -Path "e2e/tests" -Filter "*.spec.ts" | Sort-Object Name
    foreach ($spec in $specs) {
      $label = $spec.Name
      $specPath = "e2e/tests/$($spec.Name)"
      Start-App $label
      $status = Run-Playwright $label @($specPath)
      Preserve-AppLog $label
      Stop-App
      if ($status -ne 0) {
        $code = 1
        $failures++
        if ($suiteMaxFailures -gt 0 -and $failures -ge $suiteMaxFailures) {
          Write-Host "e2e: stopping after $failures failed spec(s)"
          break
        }
      }
    }
  }
} finally {
  Stop-App
  if ($runnerOwned) {
    $runnerMutex.ReleaseMutex()
  }
  $runnerMutex.Dispose()
}
exit $code
