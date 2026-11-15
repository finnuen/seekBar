# =============================================================================
#  seekBar - builds the extension icons from geometry
#
#  Same tile as wifiForce, so the two look like a family:
#
#    tile    rounded square, corner radius 0.252, vertical gradient
#            #518CF2 -> #3F64D9
#    mark    white: a play triangle above a seek track with a knob.
#            The part of the track behind the knob is solid white (played),
#            the rest is faint white so the gradient shows through.
#
#  Every size is drawn from fractions rather than scaled down from one bitmap,
#  so the 16 px frame is a deliberate drawing: the track and knob get thicker,
#  and the triangle a little larger, before they dissolve into grey mush.
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools\make-icon.ps1
#    powershell -ExecutionPolicy Bypass -File tools\make-icon.ps1 -PreviewDir C:\temp\seekbar-icon
# =============================================================================

[CmdletBinding()]
param(
    [string] $OutputDir,
    [string] $PreviewDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot     = Split-Path -Parent $scriptDirectory
if (-not $OutputDir) { $OutputDir = Join-Path $projectRoot 'extension\icons' }

$sizes = @(16, 32, 48, 128)

# --- the tile and the mark, as fractions of the tile's side -------------------
$tileRadius      = 0.252
$tileTopColor    = [System.Drawing.Color]::FromArgb(255, 0x51, 0x8C, 0xF2)
$tileBottomColor = [System.Drawing.Color]::FromArgb(255, 0x3F, 0x64, 0xD9)

function New-RoundedTilePath {
    param([int] $Size)

    $diameter = $tileRadius * 2.0 * $Size
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $path.AddArc($Size - $diameter, 0, $diameter, $diameter, 270, 90)
    $path.AddArc($Size - $diameter, $Size - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc(0, $Size - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-CapsulePath {
    param([int] $Size, [double] $Left, [double] $Right, [double] $CentreY, [double] $Thickness)

    $height = $Thickness * $Size
    $x      = $Left * $Size
    $width  = ($Right - $Left) * $Size
    $y      = $CentreY * $Size - $height / 2.0

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc([single] $x, [single] $y, [single] $height, [single] $height, 90, 180)
    $path.AddArc([single] ($x + $width - $height), [single] $y, [single] $height, [single] $height, 270, 180)
    $path.CloseFigure()
    return $path
}

function New-IconBitmap {
    param([int] $Size)

    # Below about 24 px the true weights fall under one pixel, so the mark is
    # drawn heavier: a hairline track and knob read as a smudge.
    $small  = $Size -le 24
    $grow   = if ($small) { 1.18 } else { 1.0 }
    $track  = if ($small) { [Math]::Max(1.4, 0.085 * $Size) } else { 0.095 * $Size }
    $knob   = if ($small) { [Math]::Max(2.0, 0.12 * $Size) } else { 0.115 * $Size }
    $restA  = if ($small) { 175 } else { 120 }
    $triL   = if ($small) { 0.340 } else { 0.385 }
    $triR   = if ($small) { 0.700 } else { 0.665 }
    $triT   = if ($small) { 0.140 } else { 0.185 }
    $triB   = if ($small) { 0.585 } else { 0.575 }

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $tile = $null; $trackPath = $null; $gradient = $null; $white = $null; $rest = $null
    try {
        $graphics.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.Clear([System.Drawing.Color]::Transparent)

        $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)

        # --- the tile ---------------------------------------------------------
        $tile = New-RoundedTilePath -Size $Size
        $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            $rect, $tileTopColor, $tileBottomColor,
            [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
        $graphics.FillPath($gradient, $tile)

        $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

        # --- play triangle ----------------------------------------------------
        # Lifted to sit clear of the track; the apex is right of centre, the way
        # a play glyph is drawn in every player.
        $triangle = @(
            (New-Object System.Drawing.PointF([single] ($triL * $Size), [single] ($triT * $Size))),
            (New-Object System.Drawing.PointF([single] ($triR * $Size), [single] ((($triT + $triB) / 2.0) * $Size))),
            (New-Object System.Drawing.PointF([single] ($triL * $Size), [single] ($triB * $Size)))
        )
        $graphics.FillPolygon($white, $triangle)

        # --- seek track -------------------------------------------------------
        $trackPath = New-CapsulePath -Size $Size -Left 0.150 -Right 0.850 -CentreY 0.745 -Thickness ($track / $Size)

        # The remaining (unplayed) part of the track is faint white: it keeps the
        # bar readable while the tile gradient still shows through, the same
        # "punched out of a white mark" look wifiForce uses.
        $rest = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($restA, 255, 255, 255))
        $graphics.FillPath($rest, $trackPath)

        # --- knob and played part --------------------------------------------
        $knobX = 0.605 * $Size
        $knobY = 0.745 * $Size
        $played = New-Object System.Drawing.RectangleF([single] (0), [single] (0), [single] $knobX, [single] $Size)
        $graphics.SetClip($trackPath)
        $graphics.FillRectangle($white, $played)
        $graphics.ResetClip()

        $graphics.FillEllipse(
            $white,
            [single] ($knobX - $knob),
            [single] ($knobY - $knob),
            [single] (2.0 * $knob),
            [single] (2.0 * $knob))
    } finally {
        if ($rest) { $rest.Dispose() }
        if ($white) { $white.Dispose() }
        if ($trackPath) { $trackPath.Dispose() }
        if ($gradient) { $gradient.Dispose() }
        if ($tile) { $tile.Dispose() }
        $graphics.Dispose()
    }
    return $bitmap
}

# --- write one PNG per size ---------------------------------------------------
if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
if ($PreviewDir -and -not (Test-Path -LiteralPath $PreviewDir)) {
    New-Item -ItemType Directory -Path $PreviewDir -Force | Out-Null
}

foreach ($size in $sizes) {
    $bitmap = New-IconBitmap -Size $size
    try {
        $target = Join-Path $OutputDir "icon-$size.png"
        $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
        if ($PreviewDir) {
            $bitmap.Save((Join-Path $PreviewDir "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        }
        Write-Host ("Wrote {0} ({1} px)" -f $target, $size)
    } finally {
        $bitmap.Dispose()
    }
}
