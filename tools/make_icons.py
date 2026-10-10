# -*- coding: utf-8 -*-
"""生成 PWA 应用图标：python tools/make_icons.py"""
import os
from PIL import Image, ImageDraw

TOP = (106, 131, 255)    # #6A83FF 渐变顶部
BOTTOM = (79, 110, 247)  # #4F6EF7 渐变底部（品牌主色）
WHITE = (255, 255, 255, 255)
OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def v_gradient(w, h):
    """垂直渐变图"""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return img


def rounded_mask(w, h, r):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return m


def make_icon(glyph_scale=1.0, rounded=True):
    """按 512 基准绘制：渐变底 + 白色日历图形（挂环 / 色带 / 事项点阵）"""
    W = 512
    grad = v_gradient(W, W).convert("RGBA")
    icon = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    if rounded:
        icon.paste(grad, (0, 0), rounded_mask(W, W, int(W * 0.225)))
    else:
        icon.paste(grad, (0, 0))

    d = ImageDraw.Draw(icon)
    gw, gh = int(W * 0.52 * glyph_scale), int(W * 0.46 * glyph_scale)
    cx, cy = W // 2, W // 2 + int(W * 0.015)
    x0, y0 = cx - gw // 2, cy - gh // 2
    x1, y1 = x0 + gw, y0 + gh
    r_body = int(gh * 0.16)

    # 挂环（先画，下端被主体覆盖）
    ring_w = max(6, int(gw * 0.075))
    for rx in (x0 + int(gw * 0.24), x1 - int(gw * 0.24)):
        top = y0 - int(gh * 0.13)
        d.rounded_rectangle(
            [rx - ring_w // 2, top, rx + ring_w // 2, y0 + int(gh * 0.10)],
            radius=ring_w // 2, fill=WHITE,
        )

    # 白色主体
    d.rounded_rectangle([x0, y0, x1, y1], radius=r_body, fill=WHITE)

    # 顶部色带：直接裁渐变贴上去，和背景浑然一体（仅上圆角）
    band_h = int(gh * 0.22)
    band = grad.crop((x0, y0, x1, y0 + band_h))
    bm = Image.new("L", (gw, band_h), 0)
    ImageDraw.Draw(bm).rounded_rectangle(
        [0, 0, gw - 1, band_h * 2], radius=r_body, fill=255)
    icon.paste(band, (x0, y0), bm)

    # 事项点阵：2 行 × 3 列，渐变色
    margin = int(gw * 0.15)
    dot = int(gw * 0.115)
    r_dot = int(dot * 0.34)
    area_y0 = y0 + band_h + int((y1 - y0 - band_h) * 0.20)
    area_y1 = y1 - int((y1 - y0 - band_h) * 0.20)
    for i in range(3):
        dx = x0 + margin + i * (gw - 2 * margin - dot) / 2
        for j, dy in enumerate((area_y0, area_y0 + (area_y1 - area_y0 - dot))):
            gdot = grad.crop((int(dx), int(dy), int(dx) + dot, int(dy) + dot))
            icon.paste(gdot, (int(dx), int(dy)), rounded_mask(dot, dot, r_dot))
    return icon


def save(img, size, name):
    path = os.path.join(OUT, name)
    img.resize((size, size), Image.LANCZOS).save(path, "PNG")
    print("OK", name, size)


os.makedirs(OUT, exist_ok=True)
base = make_icon(1.0, rounded=True)      # 常规（透明圆角）
mask = make_icon(0.78, rounded=False)    # maskable（满铺，图形留安全区）
apple = make_icon(1.0, rounded=False)    # iOS 自行裁圆角

save(base, 512, "icon-512.png")
save(base, 192, "icon-192.png")
save(mask, 512, "icon-maskable-512.png")
save(mask, 192, "icon-maskable-192.png")
save(apple, 180, "apple-touch-icon.png")
