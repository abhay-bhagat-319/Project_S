"""Tiny software motion-graphics engine for the Shiksha Portal promo.

Pure Pillow + numpy. Renders 2.5D floating phone mockups, an aurora background,
perspective grid, metallic sparkles and vector icons, then pipes frames to ffmpeg.
No text and no audio are produced anywhere in this pipeline.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# --------------------------------------------------------------------------- #
#  Math / easing
# --------------------------------------------------------------------------- #

def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def smoother(t):
    t = clamp(t)
    return t * t * t * (t * (t * 6 - 15) + 10)


EASE = {
    "linear": lambda t: t,
    "smooth": smooth,
    "smoother": smoother,
    "in": lambda t: t * t * t,
    "out": lambda t: 1 - (1 - t) ** 3,
    "inout": lambda t: 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2,
    "out5": lambda t: 1 - (1 - t) ** 5,
    "in5": lambda t: t ** 5,
    "back": lambda t: 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
    "outback": lambda t: 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
    "expo": lambda t: 1 - 2 ** (-10 * t) if t < 1 else 1.0,
}


def seg(t, t0, t1, ease="smoother"):
    """Normalized eased progress of t within [t0, t1]."""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return EASE[ease](clamp((t - t0) / (t1 - t0)))


def pulse(t, center, width):
    """0..1..0 bump centered at `center`."""
    x = abs(t - center) / width
    return smooth(1 - x) if x < 1 else 0.0


class Track:
    """Keyframed scalar track: list of (time, value, ease_for_next_segment)."""

    def __init__(self, keys):
        self.keys = sorted(keys, key=lambda k: k[0])

    def __call__(self, t):
        ks = self.keys
        if t <= ks[0][0]:
            return ks[0][1]
        if t >= ks[-1][0]:
            return ks[-1][1]
        for i in range(len(ks) - 1):
            t0, v0, *e = ks[i]
            t1, v1, *_ = ks[i + 1]
            if t0 <= t <= t1:
                ease = e[0] if e else "smoother"
                return lerp(v0, v1, seg(t, t0, t1, ease))
        return ks[-1][1]


# --------------------------------------------------------------------------- #
#  Color helpers
# --------------------------------------------------------------------------- #

PURPLE = (139, 124, 248)
INDIGO = (99, 102, 241)
PINK = (236, 132, 196)
GREEN = (34, 197, 148)
RED = (244, 63, 94)
BG_TOP = (10, 10, 16)
BG_BOT = (16, 15, 26)


def rgba(c, a=255):
    return (int(c[0]), int(c[1]), int(c[2]), int(a))


def mix(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))


# --------------------------------------------------------------------------- #
#  Cached sprites / primitives
# --------------------------------------------------------------------------- #

@lru_cache(maxsize=64)
def rounded_mask(w, h, r):
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return m


@lru_cache(maxsize=32)
def radial_glow(size, color, hardness=0.0):
    """Soft radial glow sprite (RGBA)."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    cx = cy = (size - 1) / 2
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (size / 2)
    a = np.clip(1 - d, 0, 1) ** (1.6 + hardness * 2)
    arr = np.zeros((size, size, 4), np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = color
    arr[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(arr)


@lru_cache(maxsize=16)
def soft_shadow(w, h, r, blur):
    s = Image.new("L", (w + blur * 4, h + blur * 4), 0)
    d = ImageDraw.Draw(s)
    d.rounded_rectangle([blur * 2, blur * 2, blur * 2 + w, blur * 2 + h], radius=r, fill=200)
    return s.filter(ImageFilter.GaussianBlur(blur))


def paste_center(dst, spr, cx, cy, scale=1.0, alpha=1.0, rot=0.0):
    if alpha <= 0.003 or scale <= 0.003:
        return
    w = max(1, int(spr.width * scale))
    h = max(1, int(spr.height * scale))
    s = spr.resize((w, h), Image.LANCZOS)
    if abs(rot) > 0.01:
        s = s.rotate(rot, resample=Image.BICUBIC, expand=True)
    if alpha < 0.999:
        a = s.getchannel("A").point(lambda v: int(v * alpha))
        s.putalpha(a)
    dst.alpha_composite(s, (int(cx - s.width / 2), int(cy - s.height / 2)))


# --------------------------------------------------------------------------- #
#  Metallic 4-point sparkle (the reference ad's chrome stars)
# --------------------------------------------------------------------------- #

def _star_path(d, cx, cy, R, r, fill):
    """Concave 4-point star using quadratic-like polygon sampling."""
    pts = []
    tips = [(0, -R), (R, 0), (0, R), (-R, 0)]
    waists = [(r, -r), (r, r), (-r, r), (-r, -r)]
    # sample curved edges tip -> waist -> tip
    for i in range(4):
        t0 = tips[i]
        w0 = waists[i]
        t1 = tips[(i + 1) % 4]
        for a, b, ctrl in ((t0, w0, None), (w0, t1, None)):
            n = 10
            for k in range(n):
                u = k / n
                # pull toward center for concavity
                mx = lerp(a[0], b[0], u)
                my = lerp(a[1], b[1], u)
                pull = math.sin(u * math.pi) * 0.0
                pts.append((cx + mx, cy + my))
    d.polygon(pts, fill=fill)


@lru_cache(maxsize=8)
def sparkle_sprite(size=360, tint=PURPLE):
    """Chrome-like 4-point star with gradient body + specular streak."""
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cx = cy = S / 2
    R = S * 0.47
    r = S * 0.06
    # body mask
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    pts = []
    tips = [(0, -R), (R, 0), (0, R), (-R, 0)]
    waists = [(r, -r), (r, r), (-r, r), (-r, -r)]
    for i in range(4):
        a = tips[i]
        b = waists[i]
        c = tips[(i + 1) % 4]
        for k in range(14):
            u = k / 14
            # quadratic bezier a -> b(control) -> c gives concave curve
            x = (1 - u) ** 2 * a[0] + 2 * (1 - u) * u * b[0] + u ** 2 * c[0]
            y = (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * b[1] + u ** 2 * c[1]
            pts.append((cx + x, cy + y))
    d.polygon(pts, fill=255)
    # chrome shading: bright top-left -> tint -> near-black bottom-right,
    # with a 4-fold facet modulation so each arm reads as polished metal.
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    g = np.clip((x + y) / (2 * S), 0, 1)
    g = g ** 1.25
    light = np.array([252, 250, 255])
    mid = np.array(tint)
    dark = np.array([16, 14, 34])
    col = np.where(g[..., None] < 0.42,
                   light + (mid - light) * (g[..., None] / 0.42),
                   mid + (dark - mid) * ((g[..., None] - 0.42) / 0.58))
    theta = np.arctan2(y - cy, x - cx)
    facet = 0.78 + 0.30 * np.cos(2 * theta + 0.6)
    col = col * facet[..., None]
    # specular streaks (two crossing highlights)
    band = np.exp(-((x - y - S * 0.04) / (S * 0.07)) ** 2) * 0.6
    band2 = np.exp(-((x + y - S * 0.82) / (S * 0.05)) ** 2) * 0.35
    col = np.clip(col + (band + band2)[..., None] * 235, 0, 255)
    # hot white core
    core = np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (S * 0.055) ** 2))
    col = np.clip(col + core[..., None] * 255, 0, 255)
    body = Image.fromarray(col.astype(np.uint8)).convert("RGBA")
    body.putalpha(mask)
    img.alpha_composite(body)
    # rim light
    rim = mask.filter(ImageFilter.FIND_EDGES).point(lambda v: min(255, v * 2))
    rim_img = Image.new("RGBA", (S, S), rgba((240, 238, 255), 0))
    rim_img.putalpha(rim.point(lambda v: int(v * 0.5)))
    img.alpha_composite(rim_img)
    return img


# --------------------------------------------------------------------------- #
#  Perspective warp (3D plane -> screen quad)
# --------------------------------------------------------------------------- #

def _homography(src_pts, dst_pts):
    A, B = [], []
    for (x, y), (u, v) in zip(src_pts, dst_pts):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        B.append(v)
    return np.linalg.solve(np.array(A, np.float64), np.array(B, np.float64))


def warp_paste(dst, tex, quad, alpha=1.0):
    """Paste `tex` mapped onto screen-space `quad` [(x,y)*4] with perspective."""
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    x0, x1 = int(math.floor(min(xs))), int(math.ceil(max(xs)))
    y0, y1 = int(math.floor(min(ys))), int(math.ceil(max(ys)))
    W, H = dst.size
    x0c, x1c = max(0, x0), min(W, x1)
    y0c, y1c = max(0, y0), min(H, y1)
    if x1c - x0c < 2 or y1c - y0c < 2:
        return
    local = [(x - x0c, y - y0c) for (x, y) in quad]
    w, h = tex.size
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = _homography(local, src)  # dst -> src for PIL
    out = tex.transform((x1c - x0c, y1c - y0c), Image.Transform.PERSPECTIVE,
                        tuple(coeffs), resample=Image.Resampling.BICUBIC)
    if alpha < 0.999:
        a = out.getchannel("A").point(lambda v: int(v * alpha))
        out.putalpha(a)
    dst.alpha_composite(out, (x0c, y0c))


def rot3(x, y, z, yaw, pitch, roll):
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    # Rz * Ry * Rx
    x1 = cy * x + sy * z
    z1 = -sy * x + cy * z
    y2 = cp * y - sp * z1
    z2 = sp * y + cp * z1
    x3 = cr * x1 - sr * y2
    y3 = sr * x1 + cr * y2
    return x3, y3, z2


@dataclass
class Cam3:
    cx: float
    cy: float
    f: float
    z: float = 4.6

    def project(self, p):
        X, Y, Z = p
        zz = self.z + Z
        return (self.cx + self.f * X / zz, self.cy + self.f * Y / zz)


def phone_quad(cam: Cam3, cxw, cyw, yaw, pitch, roll, w=1.0, h=2.2222, scale=1.0):
    corners = [(-w / 2 * scale, -h / 2 * scale, 0), (w / 2 * scale, -h / 2 * scale, 0),
               (w / 2 * scale, h / 2 * scale, 0), (-w / 2 * scale, h / 2 * scale, 0)]
    out = []
    for c in corners:
        p = rot3(*c, yaw, pitch, roll)
        out.append(cam.project((p[0] + cxw, p[1] + cyw, p[2])))
    return out


def tex_point_to_screen(cam, quad, tex_size, u, v):
    """Bilinear-ish projective map of a texture point into the screen quad."""
    w, h = tex_size
    # solve using homography src->dst
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    H = _homography(src, quad)
    x, y = u, v
    den = H[6] * x + H[7] * y + 1
    return ((H[0] * x + H[1] * y + H[2]) / den, (H[3] * x + H[4] * y + H[5]) / den)


# --------------------------------------------------------------------------- #
#  Vector icons (no text)
# --------------------------------------------------------------------------- #

def icon_wifi(size, color=(235, 235, 245), off=False, alpha=1.0):
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = S / 2, S * 0.68
    lw = max(2, int(S * 0.075))
    for i, rr in enumerate((0.42, 0.30, 0.18)):
        a = 255 if not off else 90
        box = [cx - S * rr, cy - S * rr, cx + S * rr, cy + S * rr]
        d.arc(box, 225, 315, fill=rgba(color, a), width=lw)
    d.ellipse([cx - lw * 0.7, cy - lw * 0.7, cx + lw * 0.7, cy + lw * 0.7], fill=rgba(color, 255 if not off else 110))
    if off:
        d.line([S * 0.2, S * 0.2, S * 0.8, S * 0.82], fill=rgba(RED, 255), width=lw)
    return im


def icon_clock(size, t, color=(235, 235, 245)):
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lw = max(2, int(S * 0.06))
    d.ellipse([S * 0.12, S * 0.12, S * 0.88, S * 0.88], outline=rgba(color, 230), width=lw)
    cx = cy = S / 2
    # fast hands
    ah = t * 2.4
    am = t * 14.0
    d.line([cx, cy, cx + math.sin(ah) * S * 0.20, cy - math.cos(ah) * S * 0.20], fill=rgba(color, 255), width=lw)
    d.line([cx, cy, cx + math.sin(am) * S * 0.30, cy - math.cos(am) * S * 0.30], fill=rgba(PURPLE, 255), width=max(2, lw - 1))
    d.ellipse([cx - lw * 0.6, cy - lw * 0.6, cx + lw * 0.6, cy + lw * 0.6], fill=rgba(color, 255))
    return im


def icon_spinner(size, t, color=PURPLE):
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lw = max(2, int(S * 0.09))
    ang = (t * 360) % 360
    box = [S * 0.16, S * 0.16, S * 0.84, S * 0.84]
    d.arc(box, ang, ang + 300, fill=rgba(color, 230), width=lw)
    return im


def icon_check(size, color=GREEN):
    S = size
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lw = max(2, int(S * 0.09))
    d.ellipse([S * 0.08, S * 0.08, S * 0.92, S * 0.92], outline=rgba(color, 255), width=lw)
    d.line([S * 0.30, S * 0.52, S * 0.45, S * 0.66, S * 0.72, S * 0.36], fill=rgba(color, 255), width=lw, joint="curve")
    return im


# --------------------------------------------------------------------------- #
#  Background: gradient + aurora arc + perspective grid + dust + vignette
# --------------------------------------------------------------------------- #

class Background:
    def __init__(self, W, H):
        self.W, self.H = W, H
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        gy = yy / H
        base = np.zeros((H, W, 3), np.float32)
        for i in range(3):
            base[..., i] = lerp(BG_TOP[i], BG_BOT[i], gy)
        # faint center tint
        d = np.sqrt(((xx - W / 2) / (W * 0.7)) ** 2 + ((yy - H * 0.45) / (H * 0.8)) ** 2)
        tint = np.clip(1 - d, 0, 1) ** 2 * 0.10
        base[..., 0] += tint * 40
        base[..., 1] += tint * 34
        base[..., 2] += tint * 70
        self.base = np.clip(base, 0, 255).astype(np.uint8)
        self.grid = self._make_grid()
        self.vignette = self._make_vignette()
        rng = np.random.default_rng(7)
        self.dust = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.4, 1.6),
                      rng.uniform(0, 6.28), rng.uniform(0.04, 0.14)) for _ in range(46)]

    def _make_grid(self):
        W, H = self.W, self.H
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        horizon = H * 0.60
        vpx = W / 2
        col = rgba(PURPLE, 26)
        # verticals converging
        for i in range(-14, 15):
            xb = vpx + i * W * 0.085
            d.line([(vpx + (xb - vpx) * 0.06, horizon), (xb, H)], fill=col, width=2)
        # horizontals with perspective spacing
        n = 14
        for i in range(1, n + 1):
            u = i / n
            y = horizon + (H - horizon) * (u ** 2.1)
            a = int(10 + 22 * u)
            d.line([(0, y), (W, y)], fill=rgba(PURPLE, a), width=2)
        # fade near horizon
        fade = Image.new("L", (W, H), 0)
        fd = ImageDraw.Draw(fade)
        for y in range(H):
            v = 0 if y < horizon else int(255 * smooth((y - horizon) / (H * 0.10)))
            fd.line([(0, y), (W, y)], fill=v)
        im.putalpha(Image.eval(im.getchannel("A").point(lambda v: v), lambda v: v))
        a = np.asarray(im.getchannel("A")).astype(np.float32) * (np.asarray(fade) / 255)
        im.putalpha(Image.fromarray(a.astype(np.uint8)))
        return im.filter(ImageFilter.GaussianBlur(0.8))

    def _make_vignette(self):
        W, H = self.W, self.H
        y, x = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt(((x - W / 2) / (W * 0.62)) ** 2 + ((y - H / 2) / (H * 0.62)) ** 2)
        a = np.clip((d - 0.62) / 0.55, 0, 1) ** 1.6 * 0.5
        arr = np.zeros((H, W, 4), np.uint8)
        arr[..., 3] = (a * 255).astype(np.uint8)
        return Image.fromarray(arr)

    def aurora(self, t, intensity, hue):
        """Low-res glowing arc, upscaled. hue 0=grey-blue, 1=brand purple."""
        w, h = self.W // 3, self.H // 3
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        cx, cy = w * 0.5, h * 0.62
        R = w * 0.46
        breath = 0.92 + 0.08 * math.sin(t * 0.7)
        rot = math.sin(t * 0.23) * 10
        c1 = mix((70, 90, 120), PURPLE, hue)
        c2 = mix((40, 55, 85), INDIGO, hue)
        c3 = mix((60, 70, 100), PINK, hue)
        for (rr, cc, aa, lw) in ((R, c1, 150, 0.16), (R * 0.86, c2, 110, 0.12), (R * 1.12, c3, 70, 0.07)):
            box = [cx - rr * breath, cy - rr * breath * 0.78, cx + rr * breath, cy + rr * breath * 0.78]
            d.arc(box, 195 + rot, 345 + rot, fill=rgba(cc, int(aa * intensity)), width=int(w * lw))
        im = im.filter(ImageFilter.GaussianBlur(w * 0.045))
        # second sharper core
        core = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        cd = ImageDraw.Draw(core)
        box = [cx - R * breath, cy - R * breath * 0.78, cx + R * breath, cy + R * breath * 0.78]
        cd.arc(box, 205 + rot, 335 + rot, fill=rgba(mix(c1, (255, 255, 255), 0.35), int(120 * intensity)), width=int(w * 0.035))
        core = core.filter(ImageFilter.GaussianBlur(w * 0.012))
        im.alpha_composite(core)
        return im.resize((self.W, self.H), Image.BILINEAR)

    def render(self, t, intensity, hue, grid_alpha, cam_zoom=1.0, cam_dx=0.0, cam_dy=0.0):
        canvas = Image.fromarray(self.base).convert("RGBA")
        # aurora with slight parallax
        au = self.aurora(t, intensity, hue)
        if abs(cam_zoom - 1) > 0.001 or cam_dx or cam_dy:
            s = 1 + (cam_zoom - 1) * 0.35
            nw, nh = int(self.W * s), int(self.H * s)
            au = au.resize((nw, nh), Image.BILINEAR)
            canvas.alpha_composite(au, (int((self.W - nw) / 2 - cam_dx * 0.3), int((self.H - nh) / 2 - cam_dy * 0.3)))
        else:
            canvas.alpha_composite(au)
        if grid_alpha > 0.003:
            g = self.grid
            if grid_alpha < 0.999:
                g = g.copy()
                g.putalpha(g.getchannel("A").point(lambda v: int(v * grid_alpha)))
            canvas.alpha_composite(g, (int(-cam_dx * 0.15), int(-cam_dy * 0.15)))
        # dust
        d = ImageDraw.Draw(canvas)
        for (x, y, sp, ph, al) in self.dust:
            xx = (x + math.sin(t * 0.11 * sp + ph) * 40 - cam_dx * 0.1) % self.W
            yy = (y - t * 6 * sp - cam_dy * 0.1) % self.H
            a = al * (0.6 + 0.4 * math.sin(t * 0.9 * sp + ph)) * intensity
            r = 2 + sp * 2
            d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=rgba(mix((180, 180, 210), PURPLE, hue), int(a * 255)))
        canvas.alpha_composite(self.vignette)
        return canvas
