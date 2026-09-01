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

# PNG 기반 다중 해상도 ICO (Windows 작업 표시줄·제목 표시줄용)
function Save-PngIco {
  param([string]$Path, [int[]]$Sizes)
  $pngStreams = @()
  foreach ($s in $Sizes) {
    $bmp = New-JsIconBitmap $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngStreams += ,@($s, $ms.ToArray())
    $bmp.Dispose()
    $ms.Dispose()
  }

  $count = $pngStreams.Count
  $headerSize = 6 + ($count * 16)
  $offset = $headerSize
  $entries = New-Object System.Collections.Generic.List[byte[]]

  foreach ($item in $pngStreams) {
    $size = $item[0]
    $data = $item[1]
    $w = if ($size -ge 256) { 0 } else { $size }
    $h = if ($size -ge 256) { 0 } else { $size }
    $entry = New-Object byte[] 16
    $entry[0] = [byte]$w
    $entry[1] = [byte]$h
    $entry[2] = 0
    $entry[3] = 0
    [BitConverter]::GetBytes([uint16]1).CopyTo($entry, 4)
    [BitConverter]::GetBytes([uint16]32).CopyTo($entry, 6)
    [BitConverter]::GetBytes([uint32]$data.Length).CopyTo($entry, 8)
    [BitConverter]::GetBytes([uint32]$offset).CopyTo($entry, 12)
    $entries.Add($entry)
    $offset += $data.Length
  }

  $fs = [System.IO.File]::Create($Path)
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]$count)
  foreach ($e in $entries) { $bw.Write($e) }
  foreach ($item in $pngStreams) { $bw.Write($item[1]) }
  $bw.Close()
  $fs.Close()
}

function Save-IconSet {
  param([string]$BasePath)
  $bmp256 = New-JsIconBitmap 256
  $bmp256.Save("$BasePath.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp256.Dispose()
  Save-PngIco "$BasePath.ico" @(16, 24, 32, 48, 64, 128, 256)
}

Save-IconSet (Join-Path $outDir "icon")
Save-IconSet (Join-Path $rendererDir "favicon")

Write-Host "Created build/icon.png, build/icon.ico (multi-size)"
Write-Host "Created src/renderer/favicon.png, src/renderer/favicon.ico"
