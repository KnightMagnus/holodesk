"""Render the HOLODESK icon: build/icon.ico (all Windows sizes) and src/assets/icon.png.

Usage: python3 scripts/make-icon.py   (needs Pillow)
"""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = 1024
CYAN = (90, 210, 255)
HOT = (210, 245, 255)


def ring(draw, r, width, color, segments=None, gap=0.0):
    c = S / 2
    box = [c - r, c - r, c + r, c + r]
    if not segments:
        draw.ellipse(box, outline=color, width=width)
        return
    span = 360 / segments
    for i in range(segments):
        start = i * span - 90
        draw.arc(box, start, start + span * (1 - gap), fill=color, width=width)


def render():
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S / 2
    d.ellipse([24, 24, S - 24, S - 24], fill=(2, 12, 24, 255), outline=(30, 90, 130, 255), width=10)

    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    ring(g, 400, 26, CYAN + (255,), segments=3, gap=0.22)
    ring(g, 318, 10, CYAN + (200,))
    for i in range(48):
        a = i / 48 * math.tau
        r0, r1 = (270, 300) if i % 4 else (250, 300)
        g.line([c + math.cos(a) * r0, c + math.sin(a) * r0, c + math.cos(a) * r1, c + math.sin(a) * r1], fill=CYAN + (230,), width=8)
    g.ellipse([c - 170, c - 170, c + 170, c + 170], fill=CYAN + (90,))
    g.ellipse([c - 105, c - 105, c + 105, c + 105], fill=HOT + (255,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(22)))
    img.alpha_composite(glow)
    return img


def main():
    icon = render()
    (ROOT / 'build').mkdir(exist_ok=True)
    (ROOT / 'src' / 'assets').mkdir(parents=True, exist_ok=True)
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / 'src' / 'assets' / 'icon.png')
    sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / 'build' / 'icon.ico', sizes=sizes)
    print('wrote build/icon.ico and src/assets/icon.png')


if __name__ == '__main__':
    main()
