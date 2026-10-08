# Builds Setup.exe with the C# compiler that ships with Windows (.NET Framework 4.x).
# Usage: powershell -ExecutionPolicy Bypass -File installer\windows\build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'dist'
New-Item -ItemType Directory -Force $out | Out-Null

# App icon: a ring of green bars around a dark disc, like the visualizer.
Add-Type -AssemblyName System.Drawing
$icon = Join-Path $out 'icon.ico'
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$green = [System.Drawing.Color]::FromArgb(255, 30, 215, 96)
$pen = New-Object System.Drawing.Pen $green, 9
$pen.StartCap = 'Round'; $pen.EndCap = 'Round'
$c = $size / 2; $inner = 62
$lengths = 22, 34, 48, 30, 54, 40, 26, 44, 58, 36, 24, 46, 32, 52, 28, 42
for ($i = 0; $i -lt 32; $i++) {
    $a = -[Math]::PI / 2 + $i / 32 * 2 * [Math]::PI
    $len = $lengths[$i % 16]
    $g.DrawLine($pen, [float]($c + [Math]::Cos($a) * ($inner + 8)), [float]($c + [Math]::Sin($a) * ($inner + 8)),
        [float]($c + [Math]::Cos($a) * ($inner + 8 + $len)), [float]($c + [Math]::Sin($a) * ($inner + 8 + $len)))
}
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 24, 24))), $c - $inner, $c - $inner, $inner * 2, $inner * 2)
$g.FillEllipse((New-Object System.Drawing.SolidBrush $green), $c - 14, $c - 14, 28, 28)
$g.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
# ICO container holding one 256x256 PNG image (supported since Windows Vista).
$fs = [System.IO.File]::Create($icon)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
$w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0)
$w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
$w.Write($png)
$w.Close()

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:winexe /optimize+ /codepage:65001 `
    /out:"$out\NowPlayingVisualizer-Setup.exe" `
    /win32icon:"$icon" /win32manifest:"$here\app.manifest" `
    /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
    /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    "$here\Setup.cs"
if ($LASTEXITCODE -ne 0) { throw "Compile failed" }
Get-Item "$out\NowPlayingVisualizer-Setup.exe" | Select-Object Name, Length
