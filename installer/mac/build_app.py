"""Builds "Now Playing Visualizer Installer.app" into a zip, from any OS.

    python installer/mac/build_app.py

A .app is just a folder; the zip stores Unix permissions so the launcher stays executable
after macOS unzips it. Needs Pillow for the icon.
"""
import io
import math
import struct
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE / "dist"
APP = "Now Playing Visualizer Installer.app"
ZIP = OUT / "NowPlayingVisualizer-Installer-mac.zip"


def icon_png(size: int) -> bytes:
    """Ring of green bars around a dark disc, like the visualizer (same as the Windows icon)."""
    s = 4  # supersample for smooth edges
    big = size * s
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = big / 2
    # macOS icons sit on a rounded square.
    pad = big * 0.09
    d.rounded_rectangle([pad, pad, big - pad, big - pad], radius=big * 0.2, fill=(18, 18, 18, 255))
    green = (30, 215, 96, 255)
    inner = big * 0.2
    lengths = [22, 34, 48, 30, 54, 40, 26, 44, 58, 36, 24, 46, 32, 52, 28, 42]
    width = max(2, int(big * 0.028))
    for i in range(32):
        a = -math.pi / 2 + i / 32 * 2 * math.pi
        ln = lengths[i % 16] / 256 * big * 0.82
        r0 = inner + big * 0.03
        x0, y0 = c + math.cos(a) * r0, c + math.sin(a) * r0
        x1, y1 = c + math.cos(a) * (r0 + ln), c + math.sin(a) * (r0 + ln)
        d.line([x0, y0, x1, y1], fill=green, width=width)
        for x, y in ((x0, y0), (x1, y1)):
            d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=green)
    d.ellipse([c - inner, c - inner, c + inner, c + inner], fill=(30, 30, 30, 255))
    dot = big * 0.045
    d.ellipse([c - dot, c - dot, c + dot, c + dot], fill=green)
    im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def icns() -> bytes:
    # Modern .icns entries can hold PNG data directly.
    chunks = b""
    for kind, size in ((b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)):
        png = icon_png(size)
        chunks += kind + struct.pack(">I", len(png) + 8) + png
    return b"icns" + struct.pack(">I", len(chunks) + 8) + chunks


def add(z: zipfile.ZipFile, name: str, data: bytes, mode: int) -> None:
    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.create_system = 3  # Unix, so macOS honours the permission bits below
    info.external_attr = (mode & 0xFFFF) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, data)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    launcher = (HERE / "app" / "launcher.sh").read_bytes().replace(b"\r\n", b"\n")
    plist = (HERE / "app" / "Info.plist").read_bytes().replace(b"\r\n", b"\n")
    with zipfile.ZipFile(ZIP, "w") as z:
        for d in (f"{APP}/", f"{APP}/Contents/", f"{APP}/Contents/MacOS/", f"{APP}/Contents/Resources/"):
            add(z, d, b"", 0o40755)
        add(z, f"{APP}/Contents/Info.plist", plist, 0o100644)
        add(z, f"{APP}/Contents/PkgInfo", b"APPL????", 0o100644)
        add(z, f"{APP}/Contents/MacOS/launcher", launcher, 0o100755)
        add(z, f"{APP}/Contents/Resources/AppIcon.icns", icns(), 0o100644)
    print(ZIP, ZIP.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
