#!/usr/bin/env python3
"""Generate the 9:16 (1080x1920) WWWY3 ticket story image for Instagram.

Recreates the OG share preview (`ticket-system/public/og-image.jpg`) in a
vertical, full-screen layout. The OG asset is prerendered with no generator
script, so this composes the design from scratch using the same source photo,
duotone treatment, theme palette and fonts.

Usage:
    pip install Pillow fonttools brotli numpy
    # convert the woff2 web fonts to ttf (Pillow can't read woff2):
    mkdir -p /tmp/fonts
    for f in anton-latin archivo-latin dmserifdisplay-italic-latin \
             dmserifdisplay-latin permanentmarker-latin; do
      python3 -c "from fontTools.ttLib import TTFont; \
        t=TTFont('ticket-system/public/fonts/$f.woff2'); t.flavor=None; \
        t.save('/tmp/fonts/$f.ttf')"
    done
    python3 scripts/make-wwwy3-story.py

Writes: public/assets/images/wwwy3-story-9x16.jpg
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# --- paths ---------------------------------------------------------------
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTO = os.path.join(REPO, "public/assets/images/photoshoot/skirlaz/IMG_2433.jpg")
FONT_DIR = "/tmp/fonts"
OUT = os.path.join(REPO, "public/assets/images/wwwy3-story-9x16.jpg")

W, H = 1080, 1920

# --- theme palette (ticket-system/src/entradas/theme.css) ----------------
PURPLE_DEEP = (62, 39, 104)     # #3e2768
PINK = (255, 46, 147)           # #ff2e93
LILAC = (201, 174, 240)         # #c9aef0
PAPER = (246, 245, 248)         # #f6f5f8
DUO_SHADOW = (38, 22, 60)       # #26163c
DUO_HIGHLIGHT = (205, 178, 235) # #cdb2eb


def cover(img, w, h, anchor_top=True):
    """Scale-to-cover and crop to w x h, anchored to the top."""
    iw, ih = img.size
    scale = max(w / iw, h / ih)
    nw, nh = round(iw * scale), round(ih * scale)
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = 0 if anchor_top else (nh - h) // 2
    return img.crop((left, top, left + w, top + h))


def duotone(img, shadow, highlight):
    """Map luminance onto a shadow->highlight gradient."""
    arr = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
    s = np.array(shadow, dtype=np.float32)
    hi = np.array(highlight, dtype=np.float32)
    out = s[None, None, :] + arr[:, :, None] * (hi - s)[None, None, :]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def load_font(name, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)


def text_w(draw, s, font, tracking=0):
    if tracking == 0:
        return draw.textlength(s, font=font)
    return sum(draw.textlength(ch, font=font) for ch in s) + tracking * (len(s) - 1)


def draw_tracked(draw, x, y, s, font, fill, tracking=0, anchor_mid=True):
    """Draw text with letter spacing. x is the center if anchor_mid."""
    total = text_w(draw, s, font, tracking)
    cx = x - total / 2 if anchor_mid else x
    for ch in s:
        draw.text((cx, y), ch, font=font, fill=fill)
        cx += draw.textlength(ch, font=font) + tracking
    return total


# --- compose -------------------------------------------------------------
photo = Image.open(PHOTO).convert("RGB")
base = cover(photo, W, H, anchor_top=True)
base = duotone(base, DUO_SHADOW, DUO_HIGHLIGHT)

# bottom scrim toward purple-deep for text legibility
scrim = Image.new("L", (1, H), 0)
sp = scrim.load()
for y in range(H):
    t = (y - 620) / (H - 620)
    t = max(0.0, min(1.0, t))
    sp[0, y] = int(255 * (t ** 1.35) * 0.97)
scrim = scrim.resize((W, H))
purple_layer = Image.new("RGB", (W, H), PURPLE_DEEP)
base = Image.composite(purple_layer, base, scrim)

draw = ImageDraw.Draw(base)
cx = W // 2

# fonts
f_marker = load_font("permanentmarker-latin.ttf", 112)
f_anton_xl = load_font("anton-latin.ttf", 138)
f_anton_md = load_font("anton-latin.ttf", 62)
f_anton_btn = load_font("anton-latin.ttf", 60)
f_serif = load_font("dmserifdisplay-italic-latin.ttf", 50)
f_url = load_font("archivo-latin.ttf", 46)

# --- text block ----------------------------------------------------------
y = 980

# Still Louder (Permanent Marker, paper white)
draw_tracked(draw, cx, y, "Still Louder", f_marker, PAPER, tracking=2)
y += 150

# WHEN WE WERE (Anton, white)
draw_tracked(draw, cx, y, "WHEN WE WERE", f_anton_xl, PAPER, tracking=4)
y += 150

# YOUNG 3  (3 in pink)
young = "YOUNG "
three = "3"
total = text_w(draw, young, f_anton_xl, 4) + draw.textlength(three, font=f_anton_xl)
startx = cx - total / 2
xx = startx
for ch in young:
    draw.text((xx, y), ch, font=f_anton_xl, fill=PAPER)
    xx += draw.textlength(ch, font=f_anton_xl) + 4
draw.text((xx, y), three, font=f_anton_xl, fill=PINK)
y += 165

# date line (Anton)
draw_tracked(draw, cx, y, "1 AGOSTO  ·  HOPS  ·  8:00 PM", f_anton_md, PAPER, tracking=3)
y += 92

# opener line (DM Serif italic, lilac) — replaces the old emo/pop-punk kicker
draw_tracked(draw, cx, y, "Abriendo el show: Katana y DJ Spawn", f_serif, LILAC, tracking=1)
y += 110

# button pill (ENTRADAS DESDE $6)
btn_text = "ENTRADAS DESDE $6"
btn_tw = text_w(draw, btn_text, f_anton_btn, 3)
pad_x, pad_y = 64, 34
bb = draw.textbbox((0, 0), "ENTRADAS DESDE $6", font=f_anton_btn)
bh = bb[3] - bb[1]
pill_w = btn_tw + pad_x * 2
pill_h = bh + pad_y * 2
px0 = cx - pill_w / 2
py0 = y
draw.rounded_rectangle(
    [px0, py0, px0 + pill_w, py0 + pill_h],
    radius=pill_h / 2,
    fill=PINK,
)
draw_tracked(draw, cx, py0 + pad_y - bb[1], btn_text, f_anton_btn, PAPER, tracking=3)
y = py0 + pill_h + 70

# url (Archivo)
draw_tracked(draw, cx, y, "entradas.stilllouder.space", f_url, LILAC, tracking=2)

# --- export --------------------------------------------------------------
base.save(OUT, "JPEG", quality=88, optimize=True, progressive=True)
print("wrote", OUT, os.path.getsize(OUT), "bytes")
