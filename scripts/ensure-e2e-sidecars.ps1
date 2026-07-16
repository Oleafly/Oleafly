$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$hostLine = rustc -vV | Where-Object { $_ -like "host: *" }
$hostTriple = $hostLine.Substring(6).Trim()
if ($hostTriple -ne "x86_64-pc-windows-msvc") {
  throw "unsupported Windows E2E host: $hostTriple"
}

$binDir = Join-Path $root "src-tauri\binaries"
$cacheDir = if ($env:OPENLEAF_SIDECAR_CACHE_DIR) { $env:OPENLEAF_SIDECAR_CACHE_DIR } else { Join-Path $root "src-tauri\target\e2e-sidecars" }
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

function Test-Version($path, $version) {
  if (-not (Test-Path $path -PathType Leaf)) { return $false }
  $reported = & $path --version 2>$null
  return $LASTEXITCODE -eq 0 -and "$reported".ToLowerInvariant().Contains($version.ToLowerInvariant())
}

function Install-Sidecar($name, $version, $asset, $sha256, $member, $url) {
  $out = Join-Path $binDir "$name-$hostTriple.exe"
  $temp = Join-Path ([System.IO.Path]::GetTempPath()) "openleaf-sidecar-$([System.Guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $temp | Out-Null
  try {
    $archive = Join-Path $cacheDir $asset
    $actual = if ((Test-Path $archive -PathType Leaf) -and -not ((Get-Item -LiteralPath $archive).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant() } else { "" }
    if ($actual -ne $sha256) {
      Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
      $download = Join-Path $temp "download"
      Invoke-WebRequest -Uri $url -OutFile $download
      $actual = (Get-FileHash -Algorithm SHA256 -Path $download).Hash.ToLowerInvariant()
      if ($actual -eq $sha256) { Move-Item -LiteralPath $download -Destination $archive }
    }
    if ($actual -ne $sha256) { throw "$name checksum mismatch" }
    $staged = "$out.$([System.Guid]::NewGuid().ToString('N')).tmp"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
      $matches = @($zip.Entries | Where-Object { $_.FullName -eq $member.Replace('\', '/') -and $_.Name.Length -gt 0 })
      if ($matches.Count -ne 1) { throw "$name archive member is missing or duplicated: $member" }
      $source = $matches[0].Open()
      $destination = [System.IO.File]::Create($staged)
      try { $source.CopyTo($destination) } finally { $destination.Dispose(); $source.Dispose() }
    } finally {
      $zip.Dispose()
    }
    Move-Item -LiteralPath $staged -Destination $out -Force
  } finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Version $out "$name $version")) { throw "$name $version verification failed" }
}

Install-Sidecar "typst" "0.15.0" "typst-x86_64-pc-windows-msvc.zip" "66ae7f0907b4b9afed5c7d6cb9b21e07f0f3c3d4e293ba3e0026a54d88202fe9" "typst-x86_64-pc-windows-msvc\typst.exe" "https://github.com/typst/typst/releases/download/v0.15.0/typst-x86_64-pc-windows-msvc.zip"
Install-Sidecar "tectonic" "0.16.9" "tectonic-0.16.9-x86_64-pc-windows-msvc.zip" "131a24604785a9600989a3d91225f597df52ac06f00aeffe86fd529f99ee5cdd" "tectonic.exe" "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.16.9/tectonic-0.16.9-x86_64-pc-windows-msvc.zip"
