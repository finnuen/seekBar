# =============================================================================
#  seekBar - build
#
#  Produces, in build/:
#    seekBar_v<version>.zip   the extension folder, zipped for Load unpacked
#    seekBar_v<version>.crx   the same files, signed with key.pem
#
#  The zip's root is a folder named seekBar, so unzipping it leaves something
#  to point Load unpacked at instead of loose files. Entry names use forward
#  slashes; CreateFromDirectory would write backslashes on Windows.
#
#  The signing key is created on first build and then reused. It fixes the
#  extension ID: keep key.pem out of the repository and back it up elsewhere.
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools\build.ps1
#    powershell -ExecutionPolicy Bypass -File tools\build.ps1 -SkipIcons -SkipCrx
# =============================================================================

[CmdletBinding()]
param(
    [switch] $SkipIcons,
    [switch] $SkipCrx
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot     = Split-Path -Parent $scriptDirectory
$extensionDir    = Join-Path $projectRoot 'extension'
$buildDir        = Join-Path $projectRoot 'build'
$keyPath         = Join-Path $projectRoot 'key.pem'

function Remove-ToRecycleBin {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
}

$manifest = Get-Content (Join-Path $extensionDir 'manifest.json') -Raw | ConvertFrom-Json
$version  = $manifest.version
if (-not $version) { throw 'extension\manifest.json has no version' }

if (-not $SkipIcons) {
    & (Join-Path $scriptDirectory 'make-icon.ps1')
}

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
$zipPath = Join-Path $buildDir "seekBar_v$version.zip"
$crxPath = Join-Path $buildDir "seekBar_v$version.crx"

# --- the zip -----------------------------------------------------------------
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

Remove-ToRecycleBin $zipPath
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $files = Get-ChildItem -LiteralPath $extensionDir -Recurse -File | Sort-Object FullName
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($extensionDir.Length + 1).Replace('\', '/')
        $entry = $zip.CreateEntry("seekBar/$relative", [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $file.LastWriteTime
        $stream = $entry.Open()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Dispose()
        }
    }
} finally {
    $zip.Dispose()
}

$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $names = $zipCheck.Entries | ForEach-Object { $_.FullName }
} finally {
    $zipCheck.Dispose()
}
if ($names | Where-Object { $_ -match '\\' }) {
    throw 'zip contains backslash entry names'
}
$sourceCount = (Get-ChildItem -LiteralPath $extensionDir -Recurse -File).Count
if ($names.Count -ne $sourceCount) {
    throw "zip holds $($names.Count) files, extension has $sourceCount"
}

# --- the crx -----------------------------------------------------------------
if (-not $SkipCrx) {
    if (-not (Test-Path -LiteralPath $keyPath)) {
        & node (Join-Path $scriptDirectory 'make-key.js') $keyPath
    }
    $crx3 = Get-Command 'crx3.cmd' -ErrorAction SilentlyContinue
    if (-not $crx3) {
        Write-Warning 'crx3 is not installed (npm install -g crx3); skipping the .crx'
    } else {
        Remove-ToRecycleBin $crxPath
        & $crx3.Source -p $keyPath -o $crxPath $extensionDir
        if (-not (Test-Path -LiteralPath $crxPath)) { throw 'crx3 did not write the .crx' }
    }
}

# --- report ------------------------------------------------------------------
$zipSize = (Get-Item -LiteralPath $zipPath).Length
Write-Host ("Zip  {0}  ({1:N0} bytes, {2} files)" -f $zipPath, $zipSize, $names.Count)
if (Test-Path -LiteralPath $crxPath) {
    $crxSize = (Get-Item -LiteralPath $crxPath).Length
    Write-Host ("Crx  {0}  ({1:N0} bytes)" -f $crxPath, $crxSize)
}
