Add-Type -AssemblyName System.Drawing

$BlueR = 23
$BlueG = 71
$BlueB = 184

$outDir = Join-Path $PSScriptRoot "..\build"
$rendererDir = Join-Path $PSScriptRoot "..\src\renderer"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-JsIconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [math]::Round($size * 0.08)
  $diameter = $size - ($pad * 2)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $BlueR, $BlueG, $BlueB))
  $g.FillEllipse($brush, $pad, $pad, $diameter, $diameter)

  $fontSize = [single]([math]::Round($size * 0.34))
  $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString("JS", $font, [System.Drawing.Brushes]::White, $rect, $format)

  $g.Dispose()
  return $bmp
}

function Save-IconSet {
  param([string]$BasePath)
  $bmp256 = New-JsIconBitmap 256
  $bmp256.Save("$BasePath.png", [System.Drawing.Imaging.ImageFormat]::Png)

  $icon = [System.Drawing.Icon]::FromHandle((New-JsIconBitmap 256).GetHicon())
  $stream = [System.IO.File]::Create("$BasePath.ico")
  $icon.Save($stream)
  $stream.Close()
}

Save-IconSet (Join-Path $outDir "icon")
Save-IconSet (Join-Path $rendererDir "favicon")

Write-Host "Created build/icon.png, build/icon.ico"
Write-Host "Created src/renderer/favicon.png, src/renderer/favicon.ico"
