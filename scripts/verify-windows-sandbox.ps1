<#
.SYNOPSIS
  Checks Oleafly's Windows sandbox (AppContainer) on this machine and writes
  a report.

.DESCRIPTION
  Runs the app's built-in sandbox self-test, then sandboxed runs of the
  interpreters and agents installed here, and writes a Markdown report with
  the raw JSON. Exit code 0 means every "must pass" check passed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\verify-windows-sandbox.ps1 -Network
#>
param(
  [string]$App = "$env:LOCALAPPDATA\Oleafly\oleafly.exe",
  [string]$Report = ".\oleafly-windows-sandbox-report.md",
  [switch]$Network,
  [switch]$SkipAgents
)

$ErrorActionPreference = "Stop"
$env:OLEAFLY_REQUIRE_APPCONTAINER = "1"

if (-not (Test-Path $App)) {
  Write-Error "Oleafly was not found at $App. Pass -App with the path to oleafly.exe."
}

$Rows = New-Object System.Collections.Generic.List[object]
$MustFail = $false

function Add-Row([string]$Check, [string]$Expected, [bool]$Ok, [string]$Detail, [bool]$Must = $true) {
  $script:Rows.Add([pscustomobject]@{ Check = $Check; Expected = $Expected; Ok = $Ok; Detail = $Detail; Must = $Must })
  if ($Must -and -not $Ok) { $script:MustFail = $true }
}

# The app is a GUI program, so its output comes back through files.
function Invoke-Oleafly([string[]]$Arguments, [int]$TimeoutSeconds = 120) {
  $out = [System.IO.Path]::GetTempFileName()
  $err = [System.IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath $App -ArgumentList $Arguments -NoNewWindow -PassThru `
      -RedirectStandardOutput $out -RedirectStandardError $err
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{ Code = -1; Out = (Get-Content $out -Raw); Err = "timed out after $TimeoutSeconds s"; TimedOut = $true }
    }
    return [pscustomobject]@{ Code = $process.ExitCode; Out = (Get-Content $out -Raw); Err = (Get-Content $err -Raw); TimedOut = $false }
  } finally {
    Remove-Item $out, $err -ErrorAction SilentlyContinue
  }
}

function Invoke-SandboxRun([string]$Workspace, [string[]]$Command, [string]$Profile = "analysis", [int]$TimeoutSeconds = 120) {
  $arguments = @("--oleafly-sandbox-run", "--profile", $Profile, "--workspace", "`"$Workspace`"")
  if ($Network) { $arguments += "--network" }
  $arguments += "--"
  $arguments += $Command
  return Invoke-Oleafly $arguments $TimeoutSeconds
}

$Os = Get-CimInstance Win32_OperatingSystem
$OsLine = "$($Os.Caption) $($Os.Version) build $($Os.BuildNumber)"

# 1. Self-test
$selfArgs = @("--oleafly-sandbox-selftest", "--json")
if ($Network) { $selfArgs += "--network" }
$python = (Get-Command python.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*WindowsApps*" } | Select-Object -First 1)
if ($python) { $selfArgs += @("--python", "`"$($python.Source)`"") }
$self = Invoke-Oleafly $selfArgs 300
$selfJson = $self.Out
try {
  $parsed = $self.Out | ConvertFrom-Json
  foreach ($check in $parsed.checks) {
    Add-Row "selftest: $($check.id)" $check.expected $check.ok $check.detail
  }
  if (-not $parsed.available) { Add-Row "selftest: available" "sandbox available" $false $parsed.reason }
} catch {
  Add-Row "selftest" "JSON report" $false ($self.Err + $self.Out)
}

# 2. Scenario runs in a workspace with spaces and non-ASCII letters
$Base = Join-Path $env:TEMP ("oleafly-sbx-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
$Workspace = Join-Path $Base "Prüfung Ordner"
New-Item -ItemType Directory -Path $Workspace -Force | Out-Null

$ver = Invoke-SandboxRun $Workspace @("cmd.exe", "/c", "ver")
Add-Row "cmd ver" "runs" ($ver.Code -eq 0) ($ver.Out + $ver.Err)

$pythons = @()
try { $pythons = (& py -0p 2>$null) | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ -like "*.exe" } } catch {}
if (-not $pythons -and $python) { $pythons = @($python.Source) }
foreach ($py in $pythons) {
  $temp = Invoke-SandboxRun $Workspace @("`"$py`"", "-c", "`"import tempfile,os;d=tempfile.mkdtemp();open(os.path.join(d,'x'),'w').write('1');print('ok')`"")
  Add-Row "python tempfile ($py)" "temporary folders work" ($temp.Out -match "ok") ($temp.Err)
  $mp = Invoke-SandboxRun $Workspace @("`"$py`"", "-c", "`"import multiprocessing as m;print(m.Pool(2).map(abs,[-1]))`"") "analysis" 30
  Add-Row "python multiprocessing ($py)" "expected to fail in an AppContainer" ($mp.Code -ne 0) ($mp.Err) $false
  if ($Network) {
    $pip = Invoke-SandboxRun $Workspace @("`"$py`"", "-m", "pip", "install", "--user", "six") "analysis" 300
    Add-Row "pip install ($py)" "installs into the task home" ($pip.Code -eq 0) ($pip.Err) $false
  }
}

if (Get-Command Rscript.exe -ErrorAction SilentlyContinue) {
  $r = Invoke-SandboxRun $Workspace @("Rscript.exe", "-e", "`"cat(R.version.string)`"")
  Add-Row "R" "runs" ($r.Code -eq 0) ($r.Out + $r.Err)
}
if (Get-Command julia.exe -ErrorAction SilentlyContinue) {
  $j = Invoke-SandboxRun $Workspace @("julia.exe", "-e", "`"println(VERSION)`"")
  Add-Row "Julia" "runs" ($j.Code -eq 0) ($j.Out + $j.Err)
}
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node) {
  $uv = (& $node.Source -p "process.versions.uv")
  $child = Invoke-SandboxRun $Workspace @("node.exe", "-e", "`"console.log(require('child_process').execFileSync('cmd.exe',['/c','echo hi']).toString())`"") "analysis" 20
  Add-Row "Node child process (libuv $uv)" "hangs before libuv 1.53" (-not $child.TimedOut) ($child.Err) $false
}
if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
  $gpu = Invoke-SandboxRun $Workspace @("nvidia-smi.exe") "training"
  Add-Row "GPU (nvidia-smi)" "visible in the Training profile" ($gpu.Code -eq 0) ($gpu.Err) $false
}
if (-not $SkipAgents) {
  foreach ($agent in @("claude", "codex", "gemini")) {
    $found = Get-Command "$agent.exe" -ErrorAction SilentlyContinue
    if ($found) {
      $version = Invoke-SandboxRun $Workspace @("$agent.exe", "--version") "analysis" 30
      Add-Row "$agent --version" "runs" ($version.Code -eq 0) ($version.Err) $false
    }
  }
}

# A workspace path of 250 characters must be refused clearly.
$Long = Join-Path $Base ("x" * [Math]::Max(1, 250 - $Base.Length - 1))
New-Item -ItemType Directory -Path $Long -Force | Out-Null
$longRun = Invoke-SandboxRun $Long @("cmd.exe", "/c", "ver")
Add-Row "long workspace path" "refused as too long" ($longRun.Err -match "too long") ($longRun.Err)

# No profiles left for the released self-test owners.
$left = Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -Filter "Oleafly.Task.*" -ErrorAction SilentlyContinue
Add-Row "cleanup" "no self-test profiles left" ($null -eq $left -or $left.Count -eq 0) (($left | Select-Object -ExpandProperty Name) -join ", ")

Remove-Item $Base -Recurse -Force -ErrorAction SilentlyContinue

$lines = @("# Oleafly Windows sandbox report", "", "- Machine: $OsLine", "- App: $App", "- Network checks: $Network", "", "| Check | Expected | Result | Detail |", "|---|---|---|---|")
foreach ($row in $Rows) {
  $result = if ($row.Ok) { "pass" } elseif ($row.Must) { "FAIL" } else { "note" }
  $detail = ($row.Detail -replace "\r?\n", " ") -replace "\|", "/"
  if ($detail.Length -gt 200) { $detail = $detail.Substring(0, 200) + "…" }
  $lines += "| $($row.Check) | $($row.Expected) | $result | $detail |"
}
$lines += @("", "## Self-test JSON", "", '```json', $selfJson, '```')
$lines | Set-Content -Path $Report -Encoding UTF8
Write-Host "Report written to $Report"
if ($MustFail) { exit 1 } else { exit 0 }
