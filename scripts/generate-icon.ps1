$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 37, 99, 235))
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 37, 99, 235)), 14
$graphics.FillRectangle($blue, 8, 8, 240, 240)
$graphics.FillRectangle($white, 48, 68, 160, 124)
$graphics.DrawLine($pen, 52, 74, 128, 137)
$graphics.DrawLine($pen, 204, 74, 128, 137)
$pngPath = Join-Path $build 'icon.png'
$icoPath = Join-Path $build 'icon.ico'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create($icoPath)
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$pen.Dispose()
$white.Dispose()
$blue.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "Generated $pngPath and $icoPath"
