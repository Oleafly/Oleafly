# Self-contained e2e run for Windows. A full suite launches a fresh real app
# for every spec while retaining one throwaway data directory across the run.
# Usage: powershell -File scripts/e2e.ps1 [--suite-max-failures=N] [--shard=K/N] [playwright args...]
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$suiteMaxFailures = 0
$shardIndex = 0
$shardTotal = 0
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
  } elseif ($argument -match "^--shard=(\d+)/(\d+)$") {
    $shardIndex = [int]$Matches[1]
    $shardTotal = [int]$Matches[2]
    if ($shardIndex -lt 1 -or $shardIndex -gt $shardTotal) {
      throw "--shard must look like K/N with 1 <= K <= N (e.g. 2/4)"
    }
  } elseif ($argument -like "--shard*") {
    throw "--shard must look like K/N (e.g. 2/4)"
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
$checkpointHints = ""
$stamp = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
$dataDir = Join-Path ([System.IO.Path]::GetTempPath()) "oleafly-e2e-$stamp"

# Hermetic remote endpoints: specs 42/44/75 run a local fixture server on this
# fixed port; other specs never call the pack/deadline commands, so this is
# harmless. Mirrors scripts/e2e.sh.
if (-not $env:OLEAFLY_PACKS_BASE_URL) { $env:OLEAFLY_PACKS_BASE_URL = "http://127.0.0.1:38999" }
if (-not $env:OLEAFLY_DEADLINES_URL) { $env:OLEAFLY_DEADLINES_URL = "http://127.0.0.1:38999/allconf.yml" }
if (-not $env:OLEAFLY_SKILLS_BASE_URL) { $env:OLEAFLY_SKILLS_BASE_URL = "http://127.0.0.1:38999" }

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

# Checkpoint publication walks and hashes the whole project tree behind every
# successful compile. Only the specs that assert it need that cost; leaving it
# on for the rest writes the whole tree into the store on every compile, on the
# slowest lane in CI. Mirrors configure_checkpoints_for_spec in scripts/e2e.sh.
#
# The JS lives in a file rather than in `node -e`: CI invokes this script with
# powershell.exe (Windows PowerShell 5.1), which strips embedded double quotes
# when it forwards a string to a native command, so an inline script would
# reach node as require(node:fs) and die. The target path and the flag travel
# as argv for the same reason, and so they stay out of the environment the app
# and Playwright inherit.
function Set-CheckpointsForSpec {
  $enabled = "false"
  if ($script:checkpointHints -match "66-checkpoints" -or
      $script:checkpointHints -match "24-synctex-inverse") {
    $enabled = "true"
  }
  $writer = Join-Path ([System.IO.Path]::GetTempPath()) "oleafly-e2e-$stamp-checkpoints.js"
  if (-not (Test-Path -LiteralPath $writer)) {
    $nodeScript = @'
const fs = require("node:fs");
const path = require("node:path");
const [target, enabled] = process.argv.slice(2);
let config = {};
try {
  config = JSON.parse(fs.readFileSync(target, "utf8"));
} catch {
  config = {};
}
config.checkpoints_enabled = enabled === "true";
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(config, null, 2));
'@
    Set-Content -LiteralPath $writer -Value $nodeScript -Encoding ASCII
  }
  $configPath = Join-Path $script:dataDir "config.json"
  & node $writer $configPath $enabled
  if ($LASTEXITCODE -ne 0) {
    throw "e2e: could not write checkpoints_enabled into $configPath"
  }
}

function Start-App([string]$label) {
  Stop-App
  Set-CheckpointsForSpec
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
  Preserve-RunArtifacts $label
  if ($status -eq 0) {
    Write-Host "e2e: completed $label"
  } else {
    Write-Host "e2e: failed $label with exit code $status"
  }
  return $status
}

function Preserve-RunArtifacts([string]$label) {
  $safeLabel = $label -replace "[^A-Za-z0-9._-]", "-"
  $resultDir = Join-Path "e2e-artifacts" $safeLabel
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $resultDir
  New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
  if (Test-Path "test-results") {
    $sourceRoot = (Resolve-Path "test-results").Path.TrimEnd([char[]]"\/")
    Get-ChildItem -Path "test-results" -Recurse -File | Where-Object {
      $_.Name -eq "error-context.md" -or $_.Name -eq "trace.zip" -or $_.Extension -eq ".log"
    } | ForEach-Object {
      $relativePath = $_.FullName.Substring($sourceRoot.Length).TrimStart([char[]]"\/")
      $destination = Join-Path (Join-Path $resultDir "playwright") $relativePath
      New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
      Copy-Item $_.FullName $destination -Force
    }
  }
  if ($null -ne $script:log -and (Test-Path $script:log)) {
    Copy-Item $script:log (Join-Path $resultDir "app.log") -Force
  }
  $userLog = Join-Path $script:dataDir "app.log"
  if (Test-Path $userLog) {
    Copy-Item $userLog (Join-Path $resultDir "user-app.log") -Force
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
    $script:checkpointHints = ($playwrightArgs -join " ")
    Start-App $label
    $code = Run-Playwright $label @()
    Stop-App
  } else {
    $code = 0
    $failures = 0
    $specs = Get-ChildItem -Path "e2e/tests" -Filter "*.spec.ts" | Sort-Object Name
    if ($shardTotal -gt 0) {
      # Round-robin split for parallel CI runners, matching scripts/e2e.sh.
      # Every shard gets 02-create-compile first: it creates the shared
      # "E2E Doc" project and warms the compile path later specs assume.
      $anchor = "02-create-compile.spec.ts"
      $selected = [System.Collections.Generic.List[object]]::new()
      foreach ($spec in $specs) {
        if ($spec.Name -eq $anchor) { $selected.Add($spec) }
      }
      $position = 0
      foreach ($spec in $specs) {
        if ($spec.Name -ne $anchor -and ($position % $shardTotal) -eq ($shardIndex - 1)) {
          $selected.Add($spec)
        }
        $position++
      }
      $specs = $selected
      Write-Host "e2e: shard $shardIndex/$shardTotal runs $($specs.Count) spec file(s)"
    }
    foreach ($spec in $specs) {
      $label = $spec.Name
      $specPath = "e2e/tests/$($spec.Name)"
      $script:checkpointHints = $specPath
      Start-App $label
      $status = Run-Playwright $label @($specPath)
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
