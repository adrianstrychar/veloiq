#!/usr/bin/env python3
"""Czcionka dużych cyfr mocy dla VeloIQ Edge (ekran TRENING).

Liczniki bez czcionek wektorowych (Edge 1030 i starsze) mają największą czcionkę liczbową ok. 58 px,
a pole mocy mieści cyfry o połowę wyższe. Skrypt renderuje cyfry 0–9 z DejaVu Sans Condensed Bold
(ten sam krój co czcionki liczbowe Garmina na Edge 1030, licencja pozwala na osadzanie) do formatu
BMFont (.fnt + .png w skali szarości) – w trzech rozmiarach, po jednym na rodzinę ekranów.

    python3 garmin/ci/make-font.py        (wymaga Pillow i czcionki DejaVu)
"""
import os
from PIL import Image, ImageDraw, ImageFont

TTF = "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CHARS = "0123456789"
# katalog zasobów → wysokość cyfry w pikselach
SIZES = {
    "resources": 62,                      # 282×470: Edge 1030 / 1030 Plus / 1040
    "resources-rectangle-246x322": 42,    # Edge 530 / 830 / 540 / 840
    "resources-rectangle-480x800": 106,   # Edge 1050
}
FONTS_XML = """<resources>
    <fonts>
        <!-- Duże cyfry mocy na ekranie TRENING. Plik generuje garmin/ci/make-font.py. -->
        <font id="PowerDigits" filename="power.fnt" antialias="true" filter="0123456789" />
    </fonts>
</resources>
"""


def build(out_dir: str, digit_h: int) -> None:
    # dobierz rozmiar kroju tak, żeby cyfry miały dokładnie digit_h pikseli wysokości
    size = digit_h
    while True:
        font = ImageFont.truetype(TTF, size)
        boxes = [font.getbbox(c) for c in CHARS]
        top = min(b[1] for b in boxes)
        bottom = max(b[3] for b in boxes)
        if bottom - top >= digit_h:
            break
        size += 1
    pad_y = max(2, digit_h // 16)
    line_h = (bottom - top) + 2 * pad_y
    gap = 2
    widths = [b[2] - b[0] for b in boxes]
    atlas_w = sum(widths) + gap * (len(CHARS) + 1)
    atlas_h = (bottom - top) + 2
    img = Image.new("L", (atlas_w, atlas_h), 0)
    draw = ImageDraw.Draw(img)
    lines = [
        f'info face="VeloIQ Power" size={size} bold=1 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing={gap},{gap}',
        f"common lineHeight={line_h} base={line_h - pad_y} scaleW={atlas_w} scaleH={atlas_h} pages=1 packed=0",
        'page id=0 file="power.png"',
        f"chars count={len(CHARS)}",
    ]
    x = gap
    for c, b, w in zip(CHARS, boxes, widths):
        draw.text((x - b[0], 1 - top), c, font=font, fill=255)
        adv = round(font.getlength(c))
        lines.append(f"char id={ord(c)} x={x} y=1 width={w} height={bottom - top} xoffset={b[0]} yoffset={pad_y} xadvance={adv} page=0 chnl=15")
        x += w + gap
    os.makedirs(out_dir, exist_ok=True)
    img.save(os.path.join(out_dir, "power.png"), optimize=True)
    with open(os.path.join(out_dir, "power.fnt"), "w", encoding="ascii") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(out_dir, "fonts.xml"), "w", encoding="utf-8") as f:
        f.write(FONTS_XML)
    adv = round(font.getlength("0"))
    print(f"{out_dir}: cyfra {bottom - top} px, linia {line_h} px, krok {adv} px (4 cyfry = {4 * adv} px), atlas {atlas_w}x{atlas_h}")


if __name__ == "__main__":
    for res, h in SIZES.items():
        build(os.path.join(ROOT, res, "fonts"), h)
