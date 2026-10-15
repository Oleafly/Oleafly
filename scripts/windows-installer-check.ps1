param(
  [string]$BundleDir = "src-tauri\target\debug\bundle",
  [string]$Nsis = "",
  [string]$Msi = "",
  [string]$WorkDir = "",
  [string]$LogDir = "installer-check-logs"
)

$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"

$VerbKeys = @(
  "Software\Classes\Directory\shell\Oleafly",
  "Software\Classes\Directory\Background\shell\Oleafly"
)
$InstallKey = "Software\Oleafly"
$SchemeKey = "Software\Classes\oleafly"
$AppExe = "oleafly.exe"
$ForeignExe = "C:\Elsewhere\oleafly.exe"
$InstallerTimeoutMs = 300000
$BusyRetryDelaySeconds = 15
$Failures = [System.Collections.Generic.List[string]]::new()

function Test-RegistryKey([string]$key) {
  $handle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key)
  if ($null -eq $handle) { return $false }
  $handle.Close()
  return $true
}

function Get-RegistryString([string]$key, [string]$name) {
  $handle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key)
  if ($null -eq $handle) { return $null }
  try { return $handle.GetValue($name) } finally { $handle.Close() }
}

function Set-RegistryString([string]$key, [string]$name, [string]$data) {
  $handle = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($key)
  try { $handle.SetValue($name, $data, [Microsoft.Win32.RegistryValueKind]::String) } finally { $handle.Close() }
}

function Remove-RegistryTree([string]$key) {
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($key, $false)
}

function Test-Elevated {
  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Installer([string]$file, [string]$arguments) {
  Write-Information "> $file $arguments"
  $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
  $null = $process.Handle
  if (-not $process.WaitForExit($InstallerTimeoutMs)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    return -1
  }
  return $process.ExitCode
}

function Invoke-Msiexec([string]$arguments) {
  $code = 0
  for ($attempt = 1; $attempt -le 4; $attempt++) {
    $code = Invoke-Installer "msiexec.exe" $arguments
    if ($code -ne 1618) { return $code }
    Write-Information "another installation is running (1618), retrying in $BusyRetryDelaySeconds s"
    Start-Sleep -Seconds $BusyRetryDelaySeconds
  }
  return $code
}

function Get-FullPath([string]$path) {
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path)
}

function Get-VerbCommand([string]$exe) {
  return "`"$exe`" --open-folder `"%V`""
}

function Write-Verbs([string]$exe) {
  foreach ($key in $VerbKeys) {
    Set-RegistryString $key "Icon" "`"$exe`",0"
    Set-RegistryString "$key\command" "" (Get-VerbCommand $exe)
  }
}

function Clear-Leftovers {
  foreach ($key in @($VerbKeys) + @($InstallKey) + @($SchemeKey)) {
    Remove-RegistryTree $key
  }
  [Microsoft.Win32.Registry]::LocalMachine.DeleteSubKeyTree($SchemeKey, $false)
}

function Get-SchemeHive([string]$kind) {
  if ($kind -eq "NSIS") { return [Microsoft.Win32.Registry]::CurrentUser }
  return [Microsoft.Win32.Registry]::LocalMachine
}

function Get-SchemeHiveName([string]$kind) {
  if ($kind -eq "NSIS") { return "HKCU" }
  return "HKLM"
}

function Get-SchemeValue([string]$kind, [string]$key, [string]$name) {
  $handle = (Get-SchemeHive $kind).OpenSubKey($key)
  if ($null -eq $handle) { return $null }
  try { return $handle.GetValue($name) } finally { $handle.Close() }
}

function Test-SchemeRegistered([string]$label, [string]$kind, [string]$exe) {
  $hive = Get-SchemeHiveName $kind
  $expected = "`"$exe`" `"%1`""
  $actual = Get-SchemeValue $kind "$SchemeKey\shell\open\command" ""
  if ($actual -ne $expected) {
    Add-Failure "$label did not register oleafly:// links in $hive\$SchemeKey to open $exe (command is '$actual')"
  }
  if ($null -eq (Get-SchemeValue $kind $SchemeKey "URL Protocol")) {
    Add-Failure "$label did not mark $hive\$SchemeKey as a URL protocol"
  }
}

function Test-SchemeRemoved([string]$label, [string]$kind) {
  $hive = Get-SchemeHiveName $kind
  $command = Get-SchemeValue $kind "$SchemeKey\shell\open\command" ""
  if ($null -ne $command) {
    Add-Failure "$label left oleafly:// links registered in $hive\$SchemeKey after the uninstall ('$command')"
  }
}

function Show-Scheme([string]$label) {
  foreach ($kind in @("NSIS", "MSI")) {
    $hive = Get-SchemeHiveName $kind
    try {
      $command = Get-SchemeValue $kind "$SchemeKey\shell\open\command" ""
      if ($null -eq $command) {
        Write-Host "  $hive\$SchemeKey is absent ($label)"
      } else {
        Write-Host "  $hive\$SchemeKey\shell\open\command = $command ($label)"
      }
    } catch {
      Write-Host "  $hive\$SchemeKey could not be read ($($_.Exception.Message))"
    }
  }
}

function Add-Failure([string]$message) {
  $Failures.Add($message)
  Write-Information "FAIL $message"
}

function Show-Verbs([string]$label) {
  Write-Host "registry $label"
  foreach ($key in $VerbKeys) {
    try {
      if (Test-RegistryKey $key) {
        Write-Host "  HKCU\$key\command = $(Get-RegistryString "$key\command" '')"
      } else {
        Write-Host "  HKCU\$key is absent"
      }
    } catch {
      Write-Host "  HKCU\$key could not be read ($($_.Exception.Message))"
    }
  }
}

function Show-LogLines([string]$log) {
  try {
    Select-String -LiteralPath $log -Pattern "RemoveOleafly|OLEAFLY_" |
      Select-Object -First 40 |
      ForEach-Object { Write-Host "  $($_.Line.Trim())" }
  } catch {
    Write-Host "  could not read $log ($($_.Exception.Message))"
  }
}

function Show-BundleDir {
  try {
    Get-ChildItem -LiteralPath $BundleDir -Recurse -File -ErrorAction Stop |
      ForEach-Object { Write-Host "  $($_.FullName)" }
  } catch {
    Write-Host "  could not list $BundleDir ($($_.Exception.Message))"
  }
}

function Find-Installer([string]$explicit, [string]$folder, [string]$filter) {
  if ($explicit) {
    if (-not (Test-Path -LiteralPath $explicit -PathType Leaf)) {
      throw "$explicit does not exist"
    }
    return (Resolve-Path -LiteralPath $explicit).Path
  }
  $directory = Join-Path $BundleDir $folder
  $found = @(Get-ChildItem -LiteralPath $directory -Filter $filter -File -ErrorAction SilentlyContinue)
  if ($found.Count -ne 1) {
    Write-Information "bundle directory $BundleDir holds"
    Show-BundleDir
    throw "expected one $filter in $directory, found $($found.Count)"
  }
  return $found[0].FullName
}

function Test-Removed([string]$label) {
  foreach ($key in $VerbKeys) {
    if (Test-RegistryKey $key) {
      Add-Failure "$label left HKCU\$key behind although it pointed at this install"
    }
  }
}

function Test-Kept([string]$label) {
  $expected = Get-VerbCommand $ForeignExe
  foreach ($key in $VerbKeys) {
    $actual = Get-RegistryString "$key\command" ""
    if ($actual -cne $expected) {
      Add-Failure "$label removed or changed HKCU\$key, which pointed at another copy (now '$actual')"
    }
  }
}

function Invoke-Pass([string]$kind, [string]$installer, [int]$pass, [bool]$own) {
  $label = "$kind pass $pass"
  $dir = Join-Path $WorkDir "$($kind.ToLowerInvariant())-$pass"
  Write-Information ""
  if ($own) {
    Write-Information "== $label installs into $dir and the verbs point at this install"
  } else {
    Write-Information "== $label installs into $dir and the verbs point at $ForeignExe"
  }
  Clear-Leftovers
  if ($kind -eq "NSIS") {
    $code = Invoke-Installer $installer "/S /D=$dir"
  } else {
    $log = Join-Path $LogDir "msi-$pass-install.log"
    $code = Invoke-Msiexec "/i `"$installer`" /qn /norestart /l*v `"$log`" INSTALLDIR=`"$dir`""
  }
  if ($code -ne 0 -and $code -ne 3010) {
    Add-Failure "$label install exited with $code"
    return
  }
  $exe = Join-Path $dir $AppExe
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    Add-Failure "$label did not install $exe"
    return
  }
  Show-Scheme "after the $label install"
  Test-SchemeRegistered $label $kind $exe
  if ($own) { Write-Verbs $exe } else { Write-Verbs $ForeignExe }
  Show-Verbs "before the $label uninstall"
  if ($kind -eq "NSIS") {
    $code = Invoke-Installer (Join-Path $dir "uninstall.exe") "/S _?=$dir"
  } else {
    $log = Join-Path $LogDir "msi-$pass-uninstall.log"
    $code = Invoke-Msiexec "/x `"$installer`" /qn /norestart /l*v `"$log`""
    Show-LogLines $log
  }
  Show-Verbs "after the $label uninstall"
  if ($code -ne 0 -and $code -ne 3010) {
    Add-Failure "$label uninstall exited with $code"
  }
  Show-Scheme "after the $label uninstall"
  if ($own) { Test-Removed $label } else { Test-Kept $label }
  Test-SchemeRemoved $label $kind
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-InstallerCheck {
  $nsisInstaller = Find-Installer $Nsis "nsis" "*-setup.exe"
  $msiInstaller = Find-Installer $Msi "msi" "*.msi"
  Write-Information "NSIS installer $nsisInstaller"
  Write-Information "MSI installer $msiInstaller"
  if (-not $WorkDir) {
    if ($env:RUNNER_TEMP) { $base = $env:RUNNER_TEMP } else { $base = [System.IO.Path]::GetTempPath() }
    $script:WorkDir = Join-Path $base "oleafly-installer-check"
  }
  $script:WorkDir = Get-FullPath $WorkDir
  $script:LogDir = Get-FullPath $LogDir
  if (-not (Test-Elevated)) {
    throw "the MSI installs per machine, so run this from an elevated PowerShell"
  }
  foreach ($key in @($VerbKeys) + @($InstallKey) + @($SchemeKey)) {
    if (Test-RegistryKey $key) {
      throw "HKCU\$key already exists, so Oleafly is installed for this user. Run the check on a clean machine."
    }
  }
  if ($null -ne (Get-SchemeValue "MSI" "$SchemeKey\shell\open\command" "")) {
    throw "HKLM\$SchemeKey already opens oleafly:// links, so Oleafly is installed on this machine. Run the check on a clean machine."
  }
  $null = New-Item -ItemType Directory -Force -Path $WorkDir
  $null = New-Item -ItemType Directory -Force -Path $LogDir
  $passes = @(
    @{ Kind = "NSIS"; Installer = $nsisInstaller; Pass = 1; Own = $true },
    @{ Kind = "NSIS"; Installer = $nsisInstaller; Pass = 2; Own = $false },
    @{ Kind = "MSI"; Installer = $msiInstaller; Pass = 1; Own = $true },
    @{ Kind = "MSI"; Installer = $msiInstaller; Pass = 2; Own = $false }
  )
  try {
    foreach ($pass in $passes) {
      try {
        Invoke-Pass $pass.Kind $pass.Installer $pass.Pass $pass.Own
      } catch {
        Add-Failure "$($pass.Kind) pass $($pass.Pass) stopped ($($_.Exception.Message))"
      }
    }
  } finally {
    try { Clear-Leftovers } catch { Write-Information "could not clear the test keys ($($_.Exception.Message))" }
    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($MyInvocation.InvocationName -eq ".") { return }

try {
  Invoke-InstallerCheck
} catch {
  Write-Host "installer check could not run ($($_.Exception.Message))"
  exit 1
}
Write-Host ""
if ($Failures.Count -gt 0) {
  Write-Host "$($Failures.Count) installer assertion(s) failed"
  foreach ($failure in $Failures) { Write-Host "  $failure" }
  exit 1
}
Write-Host "Both installers register oleafly:// links, remove this install's Explorer verbs and links on uninstall, and keep another copy's verbs."
exit 0
