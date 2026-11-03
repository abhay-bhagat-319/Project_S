"""Shiksha Portal — 36s text-free promo film.

Story (student problems -> the app):
  0-6   The struggle: a clunky web portal, endless spinner, dying wifi, lost time.
  6-11  Unlock: biometric login blooms into the live dashboard.
  11-20 Attendance: the 75% rule made obvious — 'need 26' vs 'can miss 4'.
  20-27 Courses & CPI trend: everything in one place, data comes alive.
  27-31 Offline + private: wifi off, app keeps working.
  31-36 Finale: three screens fan out under the aurora, logo settles.

Render:  python render.py                 (full 1080p60 film)
         python render.py --frames 2,7,14 (preview stills)
         python render.py --clip 12 18    (short mp4)
"""
from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import engine as E
from engine import (Track, seg, pulse, clamp, lerp, mix, rgba, PURPLE, INDIGO,
                    PINK, GREEN, RED, warp_paste, phone_quad, tex_point_to_screen,
                    paste_center, radial_glow, sparkle_sprite, Cam3)

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
REPO = os.path.dirname(HERE)

OUT_W, OUT_H = 1920, 1080
FPS = 60
DUR = 36.0
SS = 1.5                      # supersample factor
W, H = int(OUT_W * SS), int(OUT_H * SS)

SCR_W, SCR_H = 1080, 2400     # phone screen viewport
BEZ = 26                      # bezel px in texture space
TEX_W, TEX_H = SCR_W + BEZ * 2, SCR_H + BEZ * 2

# --------------------------------------------------------------------------- #
#  Asset preparation
# --------------------------------------------------------------------------- #

def _load(name):
    return Image.open(os.path.join(ASSETS, name)).convert("RGB")


def prep_assets():
    A = {}
    A["attendance"] = _load("Screenshot_2026-10-25-00-49-35-68.jpg.jpeg")
    A["courses"] = _load("Screenshot_2026-10-25-00-49-44-55.jpg.jpeg")
    A["settings"] = _load("Screenshot_2026-10-25-00-50-05-48.jpg.jpeg")
    A["lock"] = _load("Screenshot_2026-10-25-00-49-16-14_fe0f03542f51516b906f267f429cec92.jpg.jpeg")

    # ---- profile: remove Gemini watermark + android nav strip, pin app navbar
    pr = _load("Gemini_Generated_Image_subz6osubz6osubz.png")
    pa = np.asarray(pr).copy()
    # watermark star bbox ~ (1370,2585)-(1480,2650): patch with local dark tones
    pa[2585:2650, 1360:1490] = (26, 26, 28)
    pr = Image.fromarray(pa)
    pr = pr.crop((0, 0, pr.width, 2650))
    sc = SCR_W / pr.width
    pr = pr.resize((SCR_W, int(pr.height * sc)), Image.LANCZOS)
    nav_top = int(2400 * sc)          # navbar pill starts here in scaled space
    content = pr.crop((0, 0, SCR_W, nav_top))
    navbar = pr.crop((0, nav_top, SCR_W, pr.height))
    vp = Image.new("RGB", (SCR_W, SCR_H), (18, 18, 20))
    vp.paste(content, (0, 0))
    # fill gap with sampled page background gradient
    bgcol = np.asarray(pr)[nav_top - 6, 5].astype(int)
    vp.paste(Image.new("RGB", (SCR_W, SCR_H - nav_top - navbar.height), tuple(bgcol)),
             (0, nav_top))
    vp.paste(navbar, (0, SCR_H - navbar.height))
    A["profile"] = vp

    # ---- CPI polyline (purple solid line) for the animated sweep
    arr = np.asarray(pr).astype(int)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    purple = (b > 170) & (r > 90) & (r < 180) & (g < 150) & (b - r > 40)
    pts = []
    for x in range(168, 957, 4):
        ys = np.where(purple[:, x])[0]
        ys = ys[(ys > 1300) & (ys < 1500)]
        if len(ys):
            pts.append((x, float(np.median(ys))))
    # light smoothing with edge replication (no zero-pad spikes)
    if len(pts) > 6:
        ys = np.array([p[1] for p in pts])
        pad = np.pad(ys, (2, 2), mode="edge")
        sm = np.convolve(pad, np.ones(5) / 5, mode="valid")
        pts = [(p[0], float(y)) for p, y in zip(pts, sm)]
    A["cpi_pts"] = pts

    # ---- logo
    logo = Image.open(os.path.join(REPO, "mobile/assets/icon_purple.png")).convert("RGBA")
    A["logo"] = logo
    return A


# --------------------------------------------------------------------------- #
#  Phone device texture
# --------------------------------------------------------------------------- #

class Device:
    def __init__(self):
        self.base = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(self.base)
        d.rounded_rectangle([0, 0, TEX_W - 1, TEX_H - 1], radius=118, fill=(7, 7, 11, 255))
        # screen hole
        self.screen_mask = Image.new("L", (SCR_W, SCR_H), 0)
        sd = ImageDraw.Draw(self.screen_mask)
        sd.rounded_rectangle([0, 0, SCR_W - 1, SCR_H - 1], radius=86, fill=255)
        hole = Image.new("RGBA", (SCR_W, SCR_H), (0, 0, 0, 0))
        self.base.paste(hole, (BEZ, BEZ), self.screen_mask)
        # top overlay: rim light + punch hole + buttons
        self.top = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
        t = ImageDraw.Draw(self.top)
        t.rounded_rectangle([1, 1, TEX_W - 2, TEX_H - 2], radius=117,
                            outline=(120, 116, 160, 90), width=2)
        t.rounded_rectangle([4, 4, TEX_W - 5, TEX_H - 5], radius=114,
                            outline=(0, 0, 0, 160), width=3)
        cx = TEX_W // 2
        t.ellipse([cx - 17, BEZ + 34, cx + 17, BEZ + 68], fill=(4, 4, 7, 255))
        t.ellipse([cx - 9, BEZ + 42, cx + 3, BEZ + 54], fill=(22, 24, 38, 255))
        # side buttons
        t.rounded_rectangle([TEX_W - 3, 420, TEX_W + 3, 560], radius=3, fill=(40, 40, 52, 255))
        t.rounded_rectangle([TEX_W - 3, 620, TEX_W + 3, 820], radius=3, fill=(40, 40, 52, 255))
        t.rounded_rectangle([-3, 500, 3, 700], radius=3, fill=(40, 40, 52, 255))
        # subtle glass reflection across the screen
        refl = Image.new("RGBA", (TEX_W, TEX_H), (0, 0, 0, 0))
        rd = ImageDraw.Draw(refl)
        rd.polygon([(BEZ, BEZ), (TEX_W * 0.62, BEZ), (TEX_W * 0.20, TEX_H), (BEZ, TEX_H)],
                   fill=(255, 255, 255, 7))
        refl = refl.filter(ImageFilter.GaussianBlur(40))
        refl.putalpha(Image.composite(refl.getchannel("A"), Image.new("L", (TEX_W, TEX_H), 0),
                                      self.screen_mask.transform((TEX_W, TEX_H), Image.Transform.AFFINE,
                                                                 (1, 0, -BEZ, 0, 1, -BEZ))))
        self.top.alpha_composite(refl)

    def compose(self, screen: Image.Image) -> Image.Image:
        tex = self.base.copy()
        tex.paste(screen, (BEZ, BEZ), self.screen_mask)
        tex.alpha_composite(self.top)
        return tex


# --------------------------------------------------------------------------- #
#  Screen-space effects (drawn into the 1080x2400 viewport)
# --------------------------------------------------------------------------- #

def spotlight(screen, box, color, strength, ring_phase=0.0, glow=1.0):
    """Dim everything outside `box`, draw a pulsing ring + glow around it."""
    if strength <= 0.01:
        return screen
    x0, y0, x1, y1 = box
    ov = Image.new("RGBA", screen.size, (5, 5, 10, int(150 * strength)))
    od = ImageDraw.Draw(ov)
    od.rounded_rectangle([x0 - 14, y0 - 14, x1 + 14, y1 + 14], radius=44, fill=(0, 0, 0, 0))
    screen = screen.convert("RGBA")
    screen.alpha_composite(ov)
    # glow
    gw, gh = int(x1 - x0 + 220), int(y1 - y0 + 220)
    gl = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gl)
    gd.rounded_rectangle([110, 110, gw - 110, gh - 110], radius=50,
                         outline=rgba(color, int(120 * strength * glow)), width=26)
    gl = gl.filter(ImageFilter.GaussianBlur(34))
    screen.alpha_composite(gl, (int(x0 - 110), int(y0 - 110)))
    # crisp ring
    rd = ImageDraw.Draw(screen)
    ra = int((170 + 70 * math.sin(ring_phase)) * strength)
    rd.rounded_rectangle([x0 - 10, y0 - 10, x1 + 10, y1 + 10], radius=42,
                         outline=rgba(color, ra), width=6)
    return screen.convert("RGB")


def cell_ring(screen, box, color, strength, phase=0.0):
    if strength <= 0.01:
        return screen
    screen = screen.convert("RGBA")
    x0, y0, x1, y1 = box
    gl = Image.new("RGBA", (int(x1 - x0) + 120, int(y1 - y0) + 120), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gl)
    gd.rounded_rectangle([60, 60, gl.width - 60, gl.height - 60], radius=26,
                         outline=rgba(color, int(140 * strength)), width=18)
    gl = gl.filter(ImageFilter.GaussianBlur(20))
    screen.alpha_composite(gl, (int(x0 - 60), int(y0 - 60)))
    d = ImageDraw.Draw(screen)
    d.rounded_rectangle([x0, y0, x1, y1], radius=22,
                        outline=rgba(color, int((190 + 60 * math.sin(phase)) * strength)), width=5)
    return screen.convert("RGB")


def fingerprint_ripples(screen, t_local, center=(540, 2020)):
    screen = screen.convert("RGBA")
    d = ImageDraw.Draw(screen)
    for k in range(3):
        birth = 0.0 + k * 0.55
        age = t_local - birth
        if 0 <= age <= 1.4:
            u = age / 1.4
            r = 60 + u * 320
            a = int((1 - u) ** 1.5 * 170)
            d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r],
                      outline=rgba(PURPLE, a), width=5)
    # soft glow on the fingerprint
    g = radial_glow(420, PURPLE)
    paste_center(screen, g, center[0], center[1], scale=1.0,
                 alpha=0.25 + 0.15 * math.sin(t_local * 4))
    return screen.convert("RGB")


def cpi_sweep(screen, pts, progress, t):
    if progress <= 0.001 or len(pts) < 2:
        return screen
    screen = screen.convert("RGBA")
    n = max(2, int(len(pts) * progress))
    sub = pts[:n]
    glow = Image.new("RGBA", screen.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.line(sub, fill=rgba(PURPLE, 130), width=18, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    screen.alpha_composite(glow)
    d = ImageDraw.Draw(screen)
    d.line(sub, fill=rgba((200, 192, 255), 225), width=6, joint="curve")
    # leading dot
    hx, hy = sub[-1]
    paste_center(screen, radial_glow(140, (210, 204, 255)), hx, hy, 0.8, 0.7)
    d.ellipse([hx - 12, hy - 12, hx + 12, hy + 12], fill=(240, 238, 255, 255))
    # vertex pops
    xs = [p[0] for p in pts]
    for vx, vy in pts[:: max(1, len(pts) // 5)]:
        if vx <= hx:
            pr = pulse((hx - vx) / max(1, xs[-1] - xs[0]), 0.0, 0.12)
            if pr > 0:
                d.ellipse([vx - 14, vy - 14, vx + 14, vy + 14],
                          outline=rgba((220, 214, 255), int(200 * pr)), width=4)
    return screen.convert("RGB")


def unlock_flash(screen, strength):
    if strength <= 0.01:
        return screen
    ov = Image.new("RGBA", screen.size, rgba((210, 204, 255), int(120 * strength)))
    s = screen.convert("RGBA")
    s.alpha_composite(ov)
    return s.convert("RGB")


# --------------------------------------------------------------------------- #
#  The "struggle" browser skeleton
# --------------------------------------------------------------------------- #

def browser_screen(t, spin_speed, dim):
    s = Image.new("RGB", (SCR_W, SCR_H), (28, 30, 36))
    d = ImageDraw.Draw(s)
    # browser chrome
    d.rounded_rectangle([40, 60, SCR_W - 40, 200], radius=28, fill=(36, 39, 46))
    for i, c in enumerate(((90, 94, 104), (90, 94, 104), (90, 94, 104))):
        d.ellipse([80 + i * 44, 112, 104 + i * 44, 136], fill=c)
    d.rounded_rectangle([240, 100, SCR_W - 90, 160], radius=30, fill=(28, 30, 36))
    # skeleton header
    d.rounded_rectangle([60, 260, 620, 320], radius=16, fill=(60, 64, 73))
    d.rounded_rectangle([60, 350, 420, 392], radius=14, fill=(44, 47, 54))
    # table
    top = 460
    rows, cols = 9, 5
    cw = (SCR_W - 120) / cols
    for r in range(rows):
        y = top + r * 150
        d.rounded_rectangle([60, y, SCR_W - 60, y + 120], radius=18, fill=(32, 35, 41))
        for c in range(cols):
            x = 80 + c * cw
            ww = cw * (0.5 + 0.3 * ((r * 5 + c) % 3) / 2)
            d.rounded_rectangle([x, y + 44, x + ww, y + 76], radius=12, fill=(66, 70, 80))
    # shimmer sweep
    sh = Image.new("RGBA", (SCR_W, SCR_H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sx = ((t * 300) % (SCR_W + 600)) - 300
    sd.polygon([(sx, 0), (sx + 220, 0), (sx - 80, SCR_H), (sx - 300, SCR_H)],
               fill=(255, 255, 255, 10))
    s = s.convert("RGBA"); s.alpha_composite(sh); s = s.convert("RGB")
    # spinner
    sp = E.icon_spinner(220, t * spin_speed, color=(150, 156, 170))
    s = s.convert("RGBA")
    paste_center(s, sp, SCR_W / 2, 1250, 1.0, 0.9)
    # notification badges pile up on the browser chrome (attached, not floating)
    for k, bt in enumerate((1.2, 1.8, 2.4)):
        pp = seg(t, bt, bt + 0.35, "outback") * (1 - seg(t, 4.6, 5.2))
        if pp > 0.01:
            nx, ny = SCR_W - 120 - k * 52, 130
            r = 26 * pp
            paste_center(s, radial_glow(120, RED), nx, ny, 0.9, 0.35 * pp)
            d2 = ImageDraw.Draw(s)
            d2.ellipse([nx - r, ny - r, nx + r, ny + r], fill=rgba(RED, int(235 * pp)))
            d2.ellipse([nx - r * 0.45, ny - r * 0.62, nx - r * 0.05, ny - r * 0.22],
                       fill=(255, 200, 205, int(180 * pp)))
    s = s.convert("RGB")
    if dim > 0:
        s = Image.blend(s, Image.new("RGB", s.size, (16, 17, 20)), dim)
    return s


# --------------------------------------------------------------------------- #
#  Floating UI panels (crisp perspective close-ups, reference-ad style)
# --------------------------------------------------------------------------- #

RED_CROP = (60, 1898, 1019, 2601)
GREEN_CROP = (60, 1148, 1019, 1849)
GRAPH_CROP = (36, 1160, 1044, 1662)
CELL_REL = (648, 352, 958, 470)   # need / can-miss cell within red/green crops


def make_panel_tex(crop, ring_color, ring_strength, t, cell=None, cell_strength=0.0):
    pad = 30
    w, h = crop.size
    tw, th = w + 2 * pad, h + 2 * pad
    tex = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    d = ImageDraw.Draw(tex)
    d.rounded_rectangle([0, 0, tw - 1, th - 1], radius=46, fill=(19, 19, 25, 255))
    tex.paste(crop, (pad, pad), E.rounded_mask(w, h, 30))
    ra = int(70 + 110 * ring_strength * (0.7 + 0.3 * math.sin(t * 5)))
    d.rounded_rectangle([2, 2, tw - 3, th - 3], radius=44, outline=rgba(ring_color, ra), width=4)
    if cell and cell_strength > 0.01:
        x0, y0, x1, y1 = [c + pad for c in cell]
        gl = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        gd = ImageDraw.Draw(gl)
        gd.rounded_rectangle([x0 - 8, y0 - 8, x1 + 8, y1 + 8], radius=24,
                             outline=rgba(ring_color, int(150 * cell_strength)), width=16)
        gl = gl.filter(ImageFilter.GaussianBlur(14))
        tex.alpha_composite(gl)
        d = ImageDraw.Draw(tex)
        d.rounded_rectangle([x0, y0, x1, y1], radius=18,
                            outline=rgba(ring_color, int((200 + 55 * math.sin(t * 7)) * cell_strength)), width=5)
    return tex


def draw_panel(canvas, tex, cxw, cyw, yaw, width_out, alpha, glow_color, glow_a):
    if alpha <= 0.01:
        return
    tw, th = tex.size
    h_unit = 2.2222
    w_unit = h_unit * tw / th
    scale = width_out * CAM.z / (CAM.f * w_unit)
    quad = phone_quad(CAM, (cxw - W / 2) / CAM.f * CAM.z, (cyw - H / 2) / CAM.f * CAM.z,
                      yaw, 0.0, 0.0, w=w_unit, h=h_unit, scale=scale)
    xs = [p[0] for p in quad]; ys = [p[1] for p in quad]
    cx, cy = sum(xs) / 4, sum(ys) / 4
    bw, bh = max(xs) - min(xs), max(ys) - min(ys)
    if glow_a > 0.01:
        paste_center(canvas, radial_glow(512, glow_color), cx, cy,
                     scale=max(bw, bh) / 512 * 1.4, alpha=glow_a)
    sh = soft_shadow_rgba(max(2, int(bw * 0.9)), max(2, int(bh * 0.85)), 50, 40)
    paste_center(canvas, sh, cx + 14, cy + 26, alpha=0.4 * alpha)
    warp_paste(canvas, tex, quad, alpha)


# --------------------------------------------------------------------------- #
#  Storyboard tracks
# --------------------------------------------------------------------------- #

ATT_SCROLL = Track([(0, 0), (11.6, 0), (12.2, 0, "inout"), (13.4, 1050), (15.6, 1050, "inout"),
                    (16.8, 298), (18.4, 298, "out"), (19.6, 2400), (40, 2400)])
CO_SCROLL = Track([(0, 0), (20.2, 0), (23.4, 1500), (40, 1500)])
SE_SCROLL = Track([(0, 120), (27.6, 120), (30.6, 520), (40, 520)])

AURORA_I = Track([(0, 0.10), (4.8, 0.12), (5.4, 0.25, "out"), (7.0, 0.95), (11, 0.8),
                  (20, 0.85), (31.5, 0.9), (33, 1.0), (35, 1.0), (36, 0.0)])
AURORA_HUE = Track([(0, 0.0), (5.0, 0.0), (6.4, 1.0), (40, 1.0)])
GRID_A = Track([(0, 0.0), (6.0, 0.0), (7.5, 0.8), (31.5, 0.9), (33, 1.0), (36, 0.0)])

# app phone world transform
AP_Y = Track([(0, 1.7), (5.4, 1.7), (6.6, 0.0, "outback"), (30.6, 0.0), (31.6, 0.10), (40, 0.10)])
AP_YAW = Track([(0, -0.30), (5.4, -0.30), (7.4, -0.10), (9.0, 0.09), (11.2, 0.09),
                (12.2, 0.0), (18.6, 0.0), (19.8, -0.14), (21.0, 0.10), (23.6, 0.06),
                (24.2, 0.0), (27.2, 0.0), (28.0, -0.06), (30.6, -0.06), (31.8, 0.0), (40, 0.0)])
AP_PITCH = Track([(0, 0.10), (6.6, 0.03), (12, 0.0), (30.6, 0.0), (31.8, 0.02), (40, 0.02)])
AP_SCALE = Track([(0, 1.0), (30.6, 1.0), (31.8, 0.80), (40, 0.80)])
AP_CY = Track([(0, 830), (30.6, 830), (31.8, 930), (40, 930)])

ZOOM = Track([(0, 1.0), (4.6, 1.06), (5.6, 1.0), (12.8, 1.0), (13.6, 1.05), (18.2, 1.05),
              (19.2, 1.0), (24.0, 1.0), (24.8, 1.06), (26.6, 1.06), (27.2, 1.0),
              (31.4, 1.0), (35.0, 1.07), (36, 1.07)])

FADE = Track([(0, 0), (0.6, 1), (35.0, 1), (36, 0)])


def app_screen_name(t):
    if t < 8.2:
        return "lock", "lock", 0
    if t < 8.6:
        return "lock", "profile", seg(t, 8.2, 8.6, "smooth")
    if t < 11.2:
        return "profile", "profile", 0
    if t < 11.6:
        return "profile", "attendance", seg(t, 11.2, 11.6, "smooth")
    if t < 19.8:
        return "attendance", "attendance", 0
    if t < 20.2:
        return "attendance", "courses", seg(t, 19.8, 20.2, "smooth")
    if t < 23.6:
        return "courses", "courses", 0
    if t < 24.0:
        return "courses", "profile", seg(t, 23.6, 24.0, "smooth")
    if t < 27.2:
        return "profile", "profile", 0
    if t < 27.6:
        return "profile", "settings", seg(t, 27.2, 27.6, "smooth")
    if t < 30.9:
        return "settings", "settings", 0
    if t < 31.5:
        return "settings", "profile", seg(t, 30.9, 31.5, "smooth")
    return "profile", "profile", 0


_STATUS_MASK = None


def pin_status(s, src):
    """Keep the OS status bar fixed while the page content scrolls beneath it."""
    global _STATUS_MASK
    if _STATUS_MASK is None:
        m = Image.new("L", (SCR_W, 140), 0)
        md = ImageDraw.Draw(m)
        for y in range(140):
            v = 255 if y < 104 else int(255 * (1 - (y - 104) / 36))
            md.line([(0, y), (SCR_W, y)], fill=v)
        _STATUS_MASK = m
    s.paste(src.crop((0, 0, SCR_W, 140)), (0, 0), _STATUS_MASK)
    return s


def get_screen(A, name, t, scroll_override=None):
    if name == "lock":
        s = A["lock"].copy()
        if 6.4 < t < 8.4:
            s = fingerprint_ripples(s, t - 6.4)
        return s
    if name == "profile":
        s = A["profile"].copy()
        if 24.4 < t < 26.8:
            s = cpi_sweep(s, A["cpi_pts"], seg(t, 24.6, 26.3, "smooth"), t)
        return s
    if name == "attendance":
        off = int(scroll_override if scroll_override is not None else ATT_SCROLL(t))
        off = clamp(off, 0, A["attendance"].height - SCR_H)
        s = pin_status(A["attendance"].crop((0, off, SCR_W, off + SCR_H)), A["attendance"])
        # hero highlights
        red_box = (60, 1898 - off, 1019, 2601 - off)
        red_s = pulse(t, 14.4, 1.5) * seg(t, 13.1, 13.5) * (1 - seg(t, 15.5, 15.9))
        if red_s > 0.01 and -200 < red_box[1] < SCR_H:
            s = spotlight(s, red_box, RED, red_s, t * 5)
            need_box = (758, 2278 - off, 1006, 2388 - off)
            s = cell_ring(s, need_box, RED, red_s * pulse(t, 14.6, 0.9), t * 7)
        green_box = (60, 1148 - off, 1019, 1849 - off)
        gr_s = seg(t, 16.5, 16.9) * (1 - seg(t, 18.3, 18.7))
        if gr_s > 0.01 and -200 < green_box[1] < SCR_H:
            s = spotlight(s, green_box, GREEN, gr_s, t * 5)
            miss_box = (758, 1528 - off, 1006, 1638 - off)
            s = cell_ring(s, miss_box, GREEN, gr_s * pulse(t, 17.3, 0.9), t * 7)
        return s
    if name == "courses":
        off = int(scroll_override if scroll_override is not None else CO_SCROLL(t))
        off = clamp(off, 0, A["courses"].height - SCR_H)
        return pin_status(A["courses"].crop((0, off, SCR_W, off + SCR_H)), A["courses"])
    if name == "settings":
        off = int(scroll_override if scroll_override is not None else SE_SCROLL(t))
        off = clamp(off, 0, A["settings"].height - SCR_H)
        return pin_status(A["settings"].crop((0, off, SCR_W, off + SCR_H)), A["settings"])
    raise ValueError(name)


# --------------------------------------------------------------------------- #
#  Phone rendering helper
# --------------------------------------------------------------------------- #

CAM = Cam3(cx=W / 2, cy=H / 2, f=H * 0.70 * 4.6 / 2.2222)


def draw_phone(canvas, device, screen, cxw, cyw, yaw, pitch, roll, scale, alpha,
               glow_color=None, glow_a=0.0, shadow=True):
    quad = phone_quad(CAM, (cxw - W / 2) / CAM.f * CAM.z, (cyw - H / 2) / CAM.f * CAM.z,
                      yaw, pitch, roll, scale=scale)
    xs = [p[0] for p in quad]; ys = [p[1] for p in quad]
    bw, bh = max(xs) - min(xs), max(ys) - min(ys)
    cx, cy = sum(xs) / 4, sum(ys) / 4
    if glow_a > 0.01 and glow_color:
        g = radial_glow(512, glow_color)
        paste_center(canvas, g, cx, cy, scale=max(bw, bh) / 512 * 1.5, alpha=glow_a)
    if shadow:
        sh = soft_shadow_rgba(max(2, int(bw * 0.86)), max(2, int(bh * 0.86)), 60, 42)
        paste_center(canvas, sh, cx + 16, cy + 30, alpha=0.45 * alpha)
    tex = device.compose(screen)
    warp_paste(canvas, tex, quad, alpha)
    return quad


def soft_shadow_rgba(w, h, r, blur):
    s = E.soft_shadow(w, h, r, blur)
    out = Image.new("RGBA", s.size, (0, 0, 0, 0))
    out.putalpha(s)
    return out


# --------------------------------------------------------------------------- #
#  Frame renderer
# --------------------------------------------------------------------------- #

def render_frame(t, A, device, bg, grain_rng):
    canvas = bg.render(t, AURORA_I(t), AURORA_HUE(t), GRID_A(t))

    # ---------------- struggle scene ----------------
    if t < 6.0:
        vis = seg(t, 0.3, 0.9) * (1 - seg(t, 5.0, 5.8))
        if vis > 0.01:
            shake = math.sin(t * 13) * 3 * (1 - seg(t, 4.0, 5.0))
            spin = lerp(1.6, 0.15, seg(t, 3.8, 5.2))
            dim = seg(t, 3.4, 5.0) * 0.55
            scr = browser_screen(t, spin, dim)
            old_yaw = -0.16 - 0.05 * seg(t, 0, 5)
            old_pitch = 0.04 + 0.06 * seg(t, 2.5, 5)
            oy = 830 + 40 * seg(t, 4.6, 5.8)
            draw_phone(canvas, device, scr, W / 2 + shake, oy, old_yaw, old_pitch, 0.0,
                       0.92, vis, shadow=True)
            # clock icon (time lost)
            ca = seg(t, 1.0, 1.5) * (1 - seg(t, 4.6, 5.2))
            if ca > 0.01:
                ck = E.icon_clock(150, t)
                paste_center(canvas, ck, W / 2 - 480, 430 + math.sin(t * 1.3) * 10, 1.0, ca * 0.9)
            # wifi icon (connection lost)
            wa = seg(t, 1.6, 2.1) * (1 - seg(t, 4.6, 5.2))
            if wa > 0.01:
                flick = 1.0
                if 2.6 < t < 3.2:
                    flick = 0.4 + 0.6 * (math.sin(t * 40) > 0)
                off = t > 3.2
                wf = E.icon_wifi(150, off=off)
                paste_center(canvas, wf, W / 2 + 480, 430 + math.sin(t * 1.1 + 2) * 10, 1.0, wa * flick * 0.9)

    # ---------------- light sweep transition ----------------
    if 5.0 < t < 6.2:
        u = seg(t, 5.0, 6.2, "inout")
        sweep = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sweep)
        yy = lerp(H + 300, -500, u)
        for i in range(60):
            y = yy + i * 8
            a = int(90 * math.sin(math.pi * i / 60) * (1 - abs(u - 0.5) * 1.2))
            if a > 0:
                sd.line([(0, y), (W, y + 120)], fill=rgba(PURPLE, a), width=8)
        sweep = sweep.filter(ImageFilter.GaussianBlur(30))
        canvas.alpha_composite(sweep)

    # ---------------- hero close-up panels (phone dips out behind them) ----------------
    att_win = seg(t, 13.0, 13.5) * (1 - seg(t, 18.2, 18.8))
    graph_win = seg(t, 24.2, 24.7) * (1 - seg(t, 26.6, 27.1))

    # ---------------- main app phone ----------------
    if t > 5.3:
        enter = seg(t, 5.4, 6.6, "outback") * (1 - att_win) * (1 - graph_win)
        cyw = AP_CY(t) + AP_Y(t) * H
        if enter > 0.01:
            yaw, pitch, scale = AP_YAW(t), AP_PITCH(t), AP_SCALE(t)
            n1, n2, blend = app_screen_name(t)
            s1 = get_screen(A, n1, t)
            if blend > 0.001:
                s2 = get_screen(A, n2, t)
                shift = int((1 - blend) * 60)
                s1 = s1.transform((SCR_W, SCR_H), Image.Transform.AFFINE, (1, 0, shift, 0, 1, 0))
                s2 = s2.transform((SCR_W, SCR_H), Image.Transform.AFFINE, (1, 0, -60 + shift, 0, 1, 0))
                scr = Image.blend(s1, s2, blend)
            else:
                scr = s1
            if n1 == "lock" or n2 == "lock":
                scr = unlock_flash(scr, pulse(t, 8.3, 0.25))
            glow_a = 0.16 * enter + 0.10 * pulse(t, 8.4, 0.6) + 0.08 * pulse(t, 32.4, 1.2)
            draw_phone(canvas, device, scr, W / 2, cyw, yaw, pitch, 0.0, scale,
                       enter, PURPLE, glow_a)

        # offline icons above phone
        if 27.7 < t < 30.8:
            ia = seg(t, 27.8, 28.2, "outback") * (1 - seg(t, 30.2, 30.7))
            wf = E.icon_wifi(140, off=True)
            paste_center(canvas, wf, W / 2 + 330, 240, 1.0, ia)
            ck_a = seg(t, 28.8, 29.1, "outback") * (1 - seg(t, 30.2, 30.7))
            if ck_a > 0.01:
                ck = E.icon_check(120)
                paste_center(canvas, ck, W / 2 + 330, 240, 0.8 + 0.2 * ck_a, ck_a)
                rp = seg(t, 28.8, 29.8, "out")
                if rp < 1:
                    d = ImageDraw.Draw(canvas)
                    r = 60 + rp * 130
                    d.ellipse([W / 2 + 330 - r, 240 - r, W / 2 + 330 + r, 240 + r],
                              outline=rgba(GREEN, int(160 * (1 - rp))), width=5)

    # ---------------- attendance hero panels ----------------
    if 13.0 < t < 18.8:
        a_r = seg(t, 13.1, 13.7, "out") * (1 - seg(t, 15.3, 15.8))
        if a_r > 0.01:
            crop = A["attendance"].crop(RED_CROP)
            rs = 0.6 + 0.4 * math.sin(t * 4) ** 2
            tex = make_panel_tex(crop, RED, rs, t, CELL_REL, a_r * pulse(t, 14.5, 1.1))
            wout = lerp(760, 1060, seg(t, 13.1, 13.9, "out"))
            x = W / 2 - seg(t, 15.3, 15.8, "in") * 500
            draw_panel(canvas, tex, x, H * 0.50 + math.sin(t * 0.9) * 8, -0.10 + 0.02 * math.sin(t * 0.8),
                       wout, a_r, RED, 0.16 * a_r)
        a_g = seg(t, 15.6, 16.2, "out") * (1 - seg(t, 18.0, 18.6))
        if a_g > 0.01:
            crop = A["attendance"].crop(GREEN_CROP)
            gs = 0.6 + 0.4 * math.sin(t * 4) ** 2
            tex = make_panel_tex(crop, GREEN, gs, t, CELL_REL, a_g * pulse(t, 17.2, 1.1))
            wout = lerp(760, 1060, seg(t, 15.6, 16.4, "out"))
            x = W / 2 + (1 - seg(t, 15.6, 16.4, "out")) * 500
            draw_panel(canvas, tex, x, H * 0.50 + math.sin(t * 0.9 + 1) * 8, 0.10 - 0.02 * math.sin(t * 0.8),
                       wout, a_g, GREEN, 0.16 * a_g)

    # ---------------- CPI graph panel ----------------
    if 24.2 < t < 27.1:
        a_p = seg(t, 24.3, 24.9, "out") * (1 - seg(t, 26.6, 27.1))
        if a_p > 0.01:
            crop = A["profile"].crop(GRAPH_CROP).convert("RGB")
            rel = [(x - GRAPH_CROP[0], y - GRAPH_CROP[1]) for x, y in A["cpi_pts"]]
            crop = cpi_sweep(crop, rel, seg(t, 24.7, 26.3, "smooth"), t)
            tex = make_panel_tex(crop, PURPLE, 0.7, t)
            wout = lerp(820, 1200, seg(t, 24.3, 25.1, "out"))
            draw_panel(canvas, tex, W / 2, H * 0.50 + math.sin(t * 0.8) * 9, -0.06 + 0.02 * math.sin(t * 0.7),
                       wout, a_p, PURPLE, 0.18 * a_p)

    # ---------------- finale side phones ----------------
    if t > 30.6:
        u = seg(t, 30.6, 31.9, "out")
        for side, name, scroll in ((-1, "attendance", 1050), (1, "courses", 700)):
            sx = W / 2 + side * lerp(900, 560, u)
            sy = 950
            yaw = side * lerp(0.5, 0.30, u)
            scr = get_screen(A, name, t, scroll_override=scroll)
            draw_phone(canvas, device, scr, sx, sy, yaw, 0.03, 0, 0.74, u * 0.96,
                       PURPLE, 0.08 * u)
        # logo
        la = seg(t, 31.8, 32.7, "out")
        if la > 0.01:
            lg = A["logo"]
            gl = radial_glow(512, PURPLE)
            paste_center(canvas, gl, W / 2, 250, 1.1, 0.30 * la * (0.8 + 0.2 * math.sin(t * 2)))
            paste_center(canvas, lg, W / 2, 244, 0.50 * (0.9 + 0.1 * la), la)

    # ---------------- sparkles ----------------
    sparks = [
        (6.8, 40, W * 0.20, H * 0.30, 90, 12), (7.4, 40, W * 0.82, H * 0.24, 64, -9),
        (8.2, 40, W * 0.74, H * 0.62, 110, 16), (9.0, 40, W * 0.16, H * 0.70, 58, -14),
        (16.9, 3.0, W * 0.66, H * 0.30, 96, 20), (8.25, 2.2, W * 0.63, H * 0.20, 120, 24),
        (32.0, 40, W * 0.30, H * 0.18, 80, 10), (32.4, 40, W * 0.72, H * 0.20, 66, -12),
        (32.8, 40, W * 0.86, H * 0.55, 92, 14),
    ]
    for (birth, life, x, y, sz, rs) in sparks:
        age = t - birth
        if 0 <= age <= life:
            env = seg(age, 0, 0.5, "outback") * (1 - seg(age, life - 0.8, life))
            tw = 0.85 + 0.15 * math.sin(age * 2.2 + x)
            sp = sparkle_sprite(360, PURPLE)
            paste_center(canvas, sp, x + math.sin(age * 0.4 + y) * 14,
                         y + math.cos(age * 0.3 + x) * 10, sz / 360 * tw, env * 0.95,
                         rot=age * rs)

    # ---------------- camera ----------------
    zoom = ZOOM(t)
    focus = (W / 2, H / 2)
    if t > 31.4:
        wgt = seg(t, 31.4, 33)
        focus = (W / 2, lerp(H / 2, H * 0.50, wgt))

    inv = 1.0 / zoom
    canvas = canvas.transform((W, H), Image.Transform.AFFINE,
                              (inv, 0, focus[0] - W / 2 * inv, 0, inv, focus[1] - H / 2 * inv),
                              resample=Image.Resampling.BICUBIC)

    # ---------------- downscale + grain + fade ----------------
    frame = canvas.convert("RGB").resize((OUT_W, OUT_H), Image.LANCZOS)
    arr = np.asarray(frame).astype(np.float32)
    noise = grain_rng.standard_normal((OUT_H, OUT_W)).astype(np.float32)
    arr += noise[..., None] * 2.2
    arr *= FADE(t)
    return np.clip(arr, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------- #
#  CLI
# --------------------------------------------------------------------------- #

_W = {}


def _init_worker(A, device, bg, t0, fps):
    _W.update(A=A, device=device, bg=bg, t0=t0, fps=fps)


def _render_one(i):
    t = _W["t0"] + i / _W["fps"]
    rng = np.random.default_rng(1000 + i)   # deterministic grain per frame
    return render_frame(t, _W["A"], _W["device"], _W["bg"], rng).tobytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=str, default=None, help="comma list of preview times")
    ap.add_argument("--clip", type=float, nargs=2, default=None, help="start end seconds")
    ap.add_argument("--out", type=str, default=os.path.join(HERE, "out", "shiksha_portal_promo.mp4"))
    ap.add_argument("--draft", action="store_true")
    ap.add_argument("--jobs", type=int, default=2)
    args = ap.parse_args()

    global SS, W, H, CAM
    if args.draft:
        SS = 1.0
        W, H = OUT_W, OUT_H
        CAM = Cam3(cx=W / 2, cy=H / 2, f=H * 0.70 * 4.6 / 2.2222)

    A = prep_assets()
    device = Device()
    bg = E.Background(W, H)
    rng = np.random.default_rng(42)
    os.makedirs(os.path.join(HERE, "preview"), exist_ok=True)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    if args.frames:
        for ts in args.frames.split(","):
            t = float(ts)
            arr = render_frame(t, A, device, bg, rng)
            p = os.path.join(HERE, "preview", f"f{t:05.2f}.png")
            Image.fromarray(arr).save(p)
            print("wrote", p, flush=True)
        return

    import imageio_ffmpeg
    fps = 30 if args.draft else FPS
    t0, t1 = (args.clip if args.clip else (0.0, DUR))
    n = int((t1 - t0) * fps)
    gen = imageio_ffmpeg.write_frames(
        args.out, (OUT_W, OUT_H), fps=fps, codec="libx264", macro_block_size=1,
        output_params=["-crf", "17", "-preset", "slow", "-movflags", "+faststart"])
    gen.send(None)
    import time
    from concurrent.futures import ProcessPoolExecutor
    start = time.time()
    done = 0
    if args.jobs > 1:
        with ProcessPoolExecutor(max_workers=args.jobs, initializer=_init_worker,
                                 initargs=(A, device, bg, t0, fps)) as ex:
            for buf in ex.map(_render_one, range(n), chunksize=4):
                gen.send(buf)
                done += 1
                if done % 120 == 0:
                    el = time.time() - start
                    print(f"frame {done}/{n}  {el:.1f}s  ({done/max(el,0.01):.2f} fps)", flush=True)
    else:
        for i in range(n):
            t = t0 + i / fps
            arr = render_frame(t, A, device, bg, np.random.default_rng(1000 + i))
            gen.send(arr.tobytes())
            done += 1
            if done % 120 == 0:
                el = time.time() - start
                print(f"frame {done}/{n}  {el:.1f}s  ({done/max(el,0.01):.2f} fps)", flush=True)
    gen.close()
    print(f"DONE {args.out}  ({time.time()-start:.1f}s)", flush=True)


if __name__ == "__main__":
    main()
