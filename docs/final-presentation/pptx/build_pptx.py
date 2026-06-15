#!/usr/bin/env python3
"""
Rebuild BeThere final-presentation slides as NATIVE, editable PowerPoint
shapes/text (no rasterised images) so the deck imports into Google Slides
fully editable. The same layout model renders to two backends:

  - PptxCanvas  -> bethere-deck-pilot.pptx   (the deliverable)
  - PngCanvas   -> preview/NN.png            (local fidelity QA, since there
                                              is no LibreOffice to render pptx)

Design is authored at 1920x1080 px. The pptx slide is 13.333in x 7.5in
(widescreen 16:9), so 1 px = 6350 EMU and font pt = px * 0.5.

Fonts (Archivo / Inter / Space Mono) are Google Fonts -> they exist in the
Google Slides font picker, so setting them by name renders identically.
The neobrutalist hard shadow (solid ink, zero blur, offset down-right) is
reproduced as a duplicate ink rectangle behind each card -> stays editable.
"""
import os
from PIL import Image, ImageDraw, ImageFont

from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn

HERE = os.path.dirname(os.path.abspath(__file__))
FONTDIR = "/tmp/fonts"
EMU_PX = 6350           # EMU per design px
PNG_SCALE = 0.5         # preview render scale

# ---- palette (exact brand hex) ----
INK = "111111"; WHITE = "FFFFFF"; PINK = "FF5CA8"; GREEN = "34A853"
PURPLE = "7E6BB0"; MUTED = "7D7A86"; BLUSH = "FCEFE8"; LAV = "ECEAFF"
OFFWHITE = "FDF6EE"; GREY = "9A97A2"; FILL55 = "555555"
PHONE = "15171C"; LP = "F1EEF6"; FP = "FCEFE8"; GP = "E7F6EC"

def rgb(h): return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# ---- font loading + measurement (Pillow) ----
_fc = {}
def _font(name, px, weight):
    px = max(1, int(round(px)))
    key = (name, px, weight)
    if key in _fc: return _fc[key]
    if name == "Archivo":
        f = ImageFont.truetype(f"{FONTDIR}/Archivo.ttf", px)
        try: f.set_variation_by_axes([weight, 100])
        except Exception: pass
    elif name == "Inter":
        f = ImageFont.truetype(f"{FONTDIR}/Inter.ttf", px)
        try: f.set_variation_by_axes([14, weight])
        except Exception: pass
    else:  # Space Mono
        p = "SpaceMono-Bold.ttf" if weight >= 700 else "SpaceMono-Regular.ttf"
        f = ImageFont.truetype(f"{FONTDIR}/{p}", px)
    _fc[key] = f
    return f

def measure(text, name, px, weight, ls=0.0):
    w = _font(name, px, weight).getlength(text)
    if ls and len(text) > 1: w += ls * (len(text) - 1)
    return w

# ---- rich-text token wrapping (shared by both backends) ----
def _tokens(runs):
    """runs: list of dicts {t, font, size, weight, color, ls}. Split into
    word tokens, keeping trailing spaces attached for width accounting."""
    out = []
    for r in runs:
        parts = r["t"].split(" ")
        for i, p in enumerate(parts):
            txt = p + (" " if i < len(parts) - 1 else "")
            if txt == "": continue
            out.append({**r, "t": txt})
    return out

def wrap(runs, width):
    """Greedy wrap rich runs to width -> list of lines, each a list of runs."""
    lines, cur, cw = [], [], 0.0
    for tok in _tokens(runs):
        w = measure(tok["t"], tok["font"], tok["size"], tok["weight"], tok.get("ls", 0))
        if cur and cw + w > width:
            lines.append(cur); cur, cw = [], 0.0
        cur.append(tok); cw += w
    if cur: lines.append(cur)
    return lines if lines else [[]]

# ============================================================ PPTX backend
class PptxCanvas:
    def __init__(self):
        self.prs = Presentation()
        self.prs.slide_width = Emu(1920 * EMU_PX)
        self.prs.slide_height = Emu(1080 * EMU_PX)
        self.slide = None
    def new_slide(self, notes=None):
        self.slide = self.prs.slides.add_slide(self.prs.slide_layouts[6])
        if notes:
            self.slide.notes_slide.notes_text_frame.text = notes
        return self.slide
    # -- primitives --
    def _shape(self, kind, x, y, w, h, rot=0):
        sp = self.slide.shapes.add_shape(kind, Emu(int(x*EMU_PX)), Emu(int(y*EMU_PX)),
                                         Emu(int(w*EMU_PX)), Emu(int(h*EMU_PX)))
        sp.shadow.inherit = False
        if rot: sp.rotation = rot
        return sp
    def rect(self, x, y, w, h, fill=None, line=None, lw=0, radius=0,
             shadow=None, rot=0, dash=False):
        if shadow:
            dx, dy, sc = shadow
            sh = self._shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                             x+dx, y+dy, w, h, rot)
            if radius: sh.adjustments[0] = min(0.5, radius/min(w, h))
            sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor(*rgb(sc))
            sh.line.fill.background()
        sp = self._shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                         x, y, w, h, rot)
        if radius: sp.adjustments[0] = min(0.5, radius/min(w, h))
        if fill: sp.fill.solid(); sp.fill.fore_color.rgb = RGBColor(*rgb(fill))
        else: sp.fill.background()
        if line:
            sp.line.color.rgb = RGBColor(*rgb(line)); sp.line.width = Emu(int(lw*EMU_PX))
            if dash:
                ln = sp.line._get_or_add_ln()
                pd = ln.makeelement(qn('a:prstDash'), {'val': 'dash'}); ln.append(pd)
        else:
            sp.line.fill.background()
        return sp
    def gradient_bg(self, c1, c2, angle=45):
        sp = self._shape(MSO_SHAPE.RECTANGLE, 0, 0, 1920, 1080)
        sp.line.fill.background()
        f = sp.fill; f.gradient()
        f.gradient_stops[0].position = 0.0; f.gradient_stops[0].color.rgb = RGBColor(*rgb(c1))
        f.gradient_stops[1].position = 1.0; f.gradient_stops[1].color.rgb = RGBColor(*rgb(c2))
        try: f.gradient_angle = angle
        except Exception: pass
        return sp
    def tri_right(self, x, y, w, h, fill):
        sp = self._shape(MSO_SHAPE.ISOSCELES_TRIANGLE, x, y, w, h, rot=90)
        sp.fill.solid(); sp.fill.fore_color.rgb = RGBColor(*rgb(fill)); sp.line.fill.background()
        return sp
    def text(self, x, y, w, h, runs, align="left", valign="top", lh=1.2, nowrap=False):
        tb = self.slide.shapes.add_textbox(Emu(int(x*EMU_PX)), Emu(int(y*EMU_PX)),
                                           Emu(int(w*EMU_PX)), Emu(int(h*EMU_PX)))
        tf = tb.text_frame; tf.word_wrap = not nowrap; tf.auto_size = None
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE,
                              "bottom": MSO_ANCHOR.BOTTOM}[valign]
        lines = [_tokens(runs)] if nowrap else wrap(runs, w)
        for li, line in enumerate(lines):
            p = tf.paragraphs[0] if li == 0 else tf.add_paragraph()
            p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                           "right": PP_ALIGN.RIGHT}[align]
            p.line_spacing = lh; p.space_before = Pt(0); p.space_after = Pt(0)
            for tok in line:
                r = p.add_run(); r.text = tok["t"]
                # use the exact Google Fonts name so Slides resolves it
                r.font.name = "Space Mono" if tok["font"] == "SpaceMono" else tok["font"]
                r.font.size = Pt(tok["size"]*0.5)
                r.font.bold = tok["weight"] >= 700
                r.font.color.rgb = RGBColor(*rgb(tok["color"]))
                ls = tok.get("ls", 0)
                if ls:
                    rPr = r._r.get_or_add_rPr(); rPr.set('spc', str(int(ls*0.5*100)))
        return tb
    def save(self, path): self.prs.save(path)

# ============================================================ PNG backend
class PngCanvas:
    def __init__(self):
        self.img = None; self.d = None
    def new_slide(self, notes=None):
        s = PNG_SCALE
        self.img = Image.new("RGB", (int(1920*s), int(1080*s)), rgb(WHITE))
        self.d = ImageDraw.Draw(self.img)
    def _s(self, v): return v * PNG_SCALE
    def rect(self, x, y, w, h, fill=None, line=None, lw=0, radius=0,
             shadow=None, rot=0, dash=False):
        s = PNG_SCALE
        def box(bx, by): return [bx*s, by*s, (bx+w)*s, (by+h)*s]
        rad = radius*s
        if shadow:
            dx, dy, sc = shadow
            self.d.rounded_rectangle(box(x+dx, y+dy), radius=rad, fill=rgb(sc))
        self.d.rounded_rectangle(box(x, y), radius=rad,
                                 fill=rgb(fill) if fill else None,
                                 outline=rgb(line) if line else None,
                                 width=max(1, int(lw*s)))
    def gradient_bg(self, c1, c2, angle=45):
        s = PNG_SCALE; W, H = int(1920*s), int(1080*s)
        a, b = rgb(c1), rgb(c2)
        grad = Image.new("RGB", (W, H))
        px = grad.load()
        for yy in range(H):
            for xx in range(0, W, 2):
                t = (xx/W + yy/H) / 2
                px[xx, yy] = (int(a[0]+(b[0]-a[0])*t), int(a[1]+(b[1]-a[1])*t), int(a[2]+(b[2]-a[2])*t))
                if xx+1 < W: px[xx+1, yy] = px[xx, yy]
        self.img.paste(grad, (0, 0)); self.d = ImageDraw.Draw(self.img)
    def tri_right(self, x, y, w, h, fill):
        s = PNG_SCALE
        self.d.polygon([(x*s, y*s), (x*s, (y+h)*s), ((x+w)*s, (y+h/2)*s)], fill=rgb(fill))
    def text(self, x, y, w, h, runs, align="left", valign="top", lh=1.2, nowrap=False):
        s = PNG_SCALE
        lines = [_tokens(runs)] if nowrap else wrap(runs, w)
        sizes = [max([t["size"] for t in ln], default=14) for ln in lines]
        total = sum(sz*lh for sz in sizes)
        if valign == "top": cy = y
        elif valign == "middle": cy = y + (h-total)/2
        else: cy = y + (h-total)
        for ln, sz in zip(lines, sizes):
            lw_ = sum(measure(t["t"], t["font"], t["size"], t["weight"], t.get("ls", 0)) for t in ln)
            if align == "left": cx = x
            elif align == "center": cx = x + (w-lw_)/2
            else: cx = x + (w-lw_)
            base = cy + sz  # baseline approx
            for t in ln:
                f = _font(t["font"], t["size"]*s, t["weight"]); lsv = t.get("ls", 0)
                if lsv:  # Pillow has no native tracking -> advance per glyph
                    for ch in t["t"]:
                        self.d.text((cx*s, base*s), ch, font=f, fill=rgb(t["color"]), anchor="ls")
                        cx += f.getlength(ch)/s + lsv
                else:
                    self.d.text((cx*s, base*s), t["t"], font=f, fill=rgb(t["color"]), anchor="ls")
                    cx += measure(t["t"], t["font"], t["size"], t["weight"])
            cy += sz*lh
    def save(self, path): self.img.save(path)

# ---- run helper ----
def R(t, font="Inter", size=30, weight=500, color=INK, ls=0.0):
    return {"t": t, "font": font, "size": size, "weight": weight, "color": color, "ls": ls}

# ---- title with inline pink highlight block(s) ----
def title(c, x, y, size, pieces, ls=-3.0):
    """pieces: list of ('text', str) or ('block', str). Archivo-heavy title on
    one line; the block is a pink rounded rect + white text, like the brand."""
    cx = x
    cap = size                      # cap-ish baseline band
    pad = 18                        # block horizontal padding
    for kind, txt in pieces:
        if kind == "text":
            w = measure(txt, "Archivo", size, 900, ls)
            c.text(cx, y, w+20, size*1.25, [R(txt, "Archivo", size, 900, INK, ls)],
                   valign="top", lh=1.0, nowrap=True)
            cx += w
        else:
            tw = measure(txt, "Archivo", size, 800, ls)
            bw = tw + pad*2
            by = y - size*0.04
            bh = size*1.06
            c.rect(cx, by, bw, bh, fill=PINK, line=INK, lw=3, radius=8,
                   shadow=(6, 6, INK))
            c.text(cx, by, bw, bh, [R(txt, "Archivo", size, 800, WHITE, ls)],
                   align="center", valign="middle", lh=1.0, nowrap=True)
            cx += bw
    return cx

def chip(c, right, y, text, size=22, pad_x=14, pad_y=8):
    """Space Mono data chip, right edge anchored at `right`."""
    tw = measure(text, "SpaceMono", size, 700)
    w = tw + pad_x*2; h = size + pad_y*2
    x = right - w
    c.rect(x, y, w, h, fill=WHITE, line=INK, lw=2, radius=8)
    c.text(x, y, w, h, [R(text, "SpaceMono", size, 700, INK)], align="center", valign="middle", lh=1.0, nowrap=True)
    return x, y, w, h

def bignum(c, x, y, num, num_size, num_color, unit=None, unit_size=0, unit_color=INK):
    """Big tabular number with optional smaller trailing unit, baseline aligned."""
    nb = y + num_size*0.9
    c.text(x, y, measure(num, "Archivo", num_size, 900)+10, num_size*1.05,
           [R(num, "Archivo", num_size, 900, num_color)], valign="top", lh=0.9)
    w = measure(num, "Archivo", num_size, 900)
    if unit:
        # place unit so its baseline matches the big number baseline
        uy = y + (num_size*0.9 - unit_size*0.9)
        c.text(x+w, uy, measure(unit, "Archivo", unit_size, 900)+10, unit_size*1.1,
               [R(unit, "Archivo", unit_size, 900, unit_color)], valign="top", lh=0.9)
    return num_size*0.9

# ============================================================ SLIDES
def slide05(c):
    notes = ("And this is not just us and our friends. We ran a survey - 43 people, "
             "collected over two days in May. The pattern is everywhere. Nearly nine in "
             "ten people, when they are only slightly unsure, send a maybe or just go "
             "silent. More than half said at least a third of their hangouts get talked "
             "about and never happen. And bigger groups are harder, not easier.")
    c.new_slide(notes)
    c.gradient_bg(BLUSH, LAV, 45)
    title(c, 110, 96, 88, [("text", "Plans dying is the "), ("block", "norm"), ("text", ".")])
    chip(c, 1810, 150, "Friend Meetup Survey · n=43 · May 2026")
    cards = [
        (("86", 150, PINK, "%", 70, PINK),
         [R("send a ", "Inter", 30, 600, INK), R("“maybe”", "Inter", 30, 700, INK),
          R(" or nothing at all when they are only slightly unsure.", "Inter", 30, 600, INK)]),
        (("23", 150, INK, "/43", 70, MUTED),
         [R("say a third or more of their hangouts get talked about but never happen.", "Inter", 30, 600, INK)]),
        (("0", 150, PURPLE, None, 0, INK),
         [R("people said a ", "Inter", 30, 600, INK), R("bigger", "Inter", 30, 800, INK),
          R(" group made planning easier. 84% said smaller is easier.", "Inter", 30, 600, INK)]),
    ]
    cw, gap, x0, y0, ch = 540, 40, 110, 430, 360
    for i, (num, cap) in enumerate(cards):
        x = x0 + i*(cw+gap)
        c.rect(x, y0, cw, ch, fill=WHITE, line=INK, lw=3, radius=18, shadow=(8, 8, INK))
        n, ns, ncol, u, us, ucol = num
        bignum(c, x+36, y0+40, n, ns, ncol, u, us, ucol)
        c.text(x+36, y0+40+ns*0.9+24, cw-72, ch-(40+ns*0.9+24)-30, cap, lh=1.32)

def phone_screen16(c, px, py, pw, ph):
    """Slide-16 blind-moment phone screen content. (px,py) inner screen top-left."""
    pad = 16; iw = pw - pad*2; ix = px + pad
    # status bar
    c.text(ix, py+12, iw, 22, [R("9:41", "Inter", 15, 600, INK)], lh=1.0)
    c.text(ix, py+12, iw, 22, [R("●●●", "Inter", 13, 600, MUTED)], align="right", lh=1.0)
    # back row
    c.rect(ix, py+44, 30, 30, fill=WHITE, line=INK, lw=2, radius=9, shadow=(2, 2, INK))
    c.text(ix, py+44, 30, 30, [R("‹", "Archivo", 18, 800, INK)], align="center", valign="middle", lh=1.0)
    c.text(ix+40, py+44, iw-40, 30, [R("The Boys", "Archivo", 18, 800, INK)], valign="middle", lh=1.0)
    # event card
    ey = py+88; ec_h = 96
    c.rect(ix, ey, iw, ec_h, fill=WHITE, line=INK, lw=2, radius=16, shadow=(4, 4, INK))
    # FRI chip + RSVP sticker
    fr = "FRI 16:00"; fw = measure(fr, "SpaceMono", 13, 700)+18
    c.rect(ix+14, ey+14, fw, 26, fill=WHITE, line=INK, lw=1.5, radius=7)
    c.text(ix+14, ey+14, fw, 26, [R(fr, "SpaceMono", 13, 700, INK)], align="center", valign="middle", lh=1.0)
    rw = measure("RSVP 8H", "Archivo", 13, 800)+18
    c.rect(ix+iw-14-rw, ey+12, rw, 28, fill=PINK, line=INK, lw=2, radius=8, shadow=(2, 2, INK), rot=356)
    c.text(ix+iw-14-rw, ey+12, rw, 28, [R("RSVP 8H", "Archivo", 13, 800, WHITE)], align="center", valign="middle", lh=1.0)
    c.text(ix+14, ey+46, iw-28, 36, [R("Bowling", "Archivo", 30, 900, INK)], lh=1.0)
    c.text(ix+14, ey+80, iw-28, 18, [R("TenPin Bexleyheath", "Inter", 14, 500, MUTED)], lh=1.0)
    # are you in
    ay = ey+ec_h+18
    c.text(ix+2, ay, iw, 24, [R("Are you in?", "Archivo", 20, 800, INK)], lh=1.0)
    # three buttons
    by = ay+34; bh = 50
    btns = [(GREEN, WHITE, "✓  I’m in"), (WHITE, INK, "I’ll go if…"),
            (WHITE, MUTED, "Can’t make it")]
    for i, (bg, fg, label) in enumerate(btns):
        yy = by + i*(bh+11)
        c.rect(ix, yy, iw, bh, fill=bg, line=INK, lw=2, radius=13, shadow=(4, 4, INK))
        c.text(ix, yy, iw, bh, [R(label, "Archivo", 18, 800, fg)], align="center", valign="middle", lh=1.0)
    # footnote
    c.text(ix, py+ph-pad-26, iw, 22,
           [R("No tally. No who’s in. Not until it locks.", "Inter", 14, 600, MUTED)],
           align="center", lh=1.1)

def slide16(c):
    notes = ("Step three, and this is the heart of it. At the deadline the top time wins "
             "automatically and a blind moment opens. Each person privately answers one of "
             "three things: I'm in, I can't make it, or I'll go if certain people go. And it "
             "is blind: there is no running tally and you cannot see who else is in. A push "
             "notification, BeReal-style, makes sure they do.")
    c.new_slide(notes)
    c.gradient_bg(BLUSH, LAV, 45)
    title(c, 110, 84, 72, [("text", "Then a blind "), ("block", "moment")], ls=-2.5)
    chip(c, 1810, 128, "Walkthrough · 3 / 4")
    # phone (left)
    px, py, pw, ph = 110, 205, 400, 784
    c.rect(px, py, pw, ph, fill=PHONE, line=INK, lw=3, radius=44, shadow=(12, 12, INK))
    sx, sy, sw, sh = px+11, py+11, pw-22, ph-22
    c.rect(sx, sy, sw, sh, fill=LAV, radius=33)         # inner screen (approx solid)
    phone_screen16(c, sx, sy, sw, sh)
    # right column
    rx, rw = 580, 1230
    c.text(rx, 250, 820, 120, [R("The deadline auto-picks the winner. Then you reply ", "Archivo", 46, 800, INK),
                               R("privately", "Archivo", 46, 800, GREEN), R(".", "Archivo", 46, 800, INK)], lh=1.2)
    c.text(rx, 380, 820, 100, [R("No live tally, no who-is-in. There is nothing to hedge against, so people just answer.", "Inter", 32, 500, MUTED)], lh=1.4)
    # card A
    ay = 500; ah = 92
    c.rect(rx, ay, 820, ah, fill=WHITE, line=INK, lw=3, radius=14, shadow=(6, 6, INK))
    c.text(rx+26, ay, 200, ah, [R("“I’ll go if…”", "Archivo", 24, 800, INK)], valign="middle", lh=1.1)
    c.text(rx+230, ay, 820-230-26, ah, [R("the conditional RSVP - defaults to “at least one” friend, never forces a name.", "Inter", 24, 600, MUTED)], valign="middle", lh=1.25)
    # card B (insight, ink)
    by = ay+ah+18; bh = 96
    c.rect(rx, by, 820, bh, fill=INK, line=INK, lw=3, radius=14, shadow=(6, 6, PINK))
    c.text(rx+26, by, 140, bh, [R("INSIGHT", "Inter", 18, 700, PINK, ls=1.0)], valign="middle", lh=1.0)
    c.text(rx+170, by, 820-170-26, bh, [R("“A deadline with a push - like BeReal, it goes ding ding ding.” - Tom", "Inter", 24, 600, WHITE)], valign="middle", lh=1.3)

def diagram_box(c, x, y, w, h, header_bg, header_fg, header_runs, body_rows):
    c.rect(x, y, w, h, fill=WHITE, line=INK, lw=3, radius=16, shadow=(7, 7, INK))
    hh = 46
    c.rect(x, y, w, hh, fill=header_bg, radius=16)      # header strip (approx)
    c.rect(x, y+hh-16, w, 16, fill=header_bg)           # square off bottom of header
    c.text(x+18, y, w-36, hh, header_runs, valign="middle", lh=1.0)
    ry = y+hh+14
    for (bg, runs, h_row, align) in body_rows:
        c.rect(x+16, ry, w-32, h_row, fill=bg, line=INK, lw=2, radius=10)
        c.text(x+29, ry, w-58, h_row, runs, valign="middle", align=align, lh=1.2)
        ry += h_row + 11

def arrow(c, x, y, w, label_top):
    c.text(x, y-20, w, 36, [R(label_top, "SpaceMono", 15, 700, MUTED)], align="center", lh=1.1)
    bar_w = 74
    bx = x + (w - (bar_w+20))/2
    c.rect(bx, y+30, bar_w, 8, fill=INK)
    c.tri_right(bx+bar_w, y+18, 20, 26, INK)

def slide24(c):
    notes = ("Quickly, under the hood. BeThere is a typed monorepo. An Expo React Native "
             "client - eight screens - runs on iOS, Android and web from one codebase. It "
             "talks to a Fastify and tRPC server over plain HTTP; that server holds the "
             "logic that matters: auth, the routers, and settlePhase, which resolves a "
             "plan's phase lazily. That writes through Drizzle into Postgres. Holding it "
             "together is a shared package of Zod schemas and pure logic. Dashed boxes are "
             "services outside our code: Clerk, AWS and Vercel.")
    c.new_slide(notes)
    c.rect(0, 0, 1920, 1080, fill=OFFWHITE)
    title(c, 90, 74, 72, [("text", "Under the "), ("block", "hood")])
    # legend (right)
    lx = 1240
    c.rect(lx, 96, 46, 7, fill=INK)
    c.text(lx+58, 84, 220, 30, [R("data & requests", "Inter", 21, 600, INK)], valign="middle", lh=1.0)
    c.rect(lx+330, 99, 46, 0, line=PURPLE, lw=4, dash=True)
    c.text(lx+388, 84, 240, 30, [R("shared types & logic", "Inter", 21, 600, PURPLE)], valign="middle", lh=1.0)
    # diagram row
    dy, dh = 200, 470
    mob_x, mob_w = 90, 472
    g1_x, g_w = mob_x+mob_w, 150
    api_x, api_w = g1_x+g_w, 590
    g2_x = api_x+api_w
    dat_x, dat_w = g2_x+g_w, 378
    diagram_box(c, mob_x, dy, mob_w, dh, PURPLE, WHITE,
                [R("Mobile  ", "Archivo", 23, 800, WHITE), R("@bethere/mobile", "SpaceMono", 15, 400, "E9E3F2")],
                [(LP, [R("Expo RN · 8 screens", "Inter", 18, 700, INK)], 50, "left"),
                 (LP, [R("Dashboard · CreateWizard · EventDetail · Groups · SignIn", "Inter", 16, 500, FILL55)], 64, "left"),
                 (LP, [R("tRPC client", "Inter", 18, 700, INK)], 50, "left")])
    arrow(c, g1_x, dy+dh/2-30, g_w, "HTTP /trpc")
    diagram_box(c, api_x, dy, api_w, dh, INK, WHITE,
                [R("API  ", "Archivo", 23, 800, WHITE), R("@bethere/api · Fastify + tRPC", "SpaceMono", 15, 400, "CFCFCF")],
                [(FP, [R("createContext  · Clerk auth / dev bypass", "Inter", 18, 700, INK)], 48, "left"),
                 (FP, [R("routers  · health · groups · events", "Inter", 18, 700, INK)], 48, "left"),
                 (PINK, [R("settlePhase  · lazy resolve, no scheduler", "Inter", 18, 700, WHITE)], 48, "left"),
                 (FP, [R("Drizzle ORM", "Inter", 18, 700, INK)], 48, "left")])
    arrow(c, g2_x, dy+dh/2-30, g_w, "Drizzle SQL")
    diagram_box(c, dat_x, dy, dat_w, dh, GREEN, WHITE,
                [R("Data", "Archivo", 23, 800, WHITE)],
                [(GP, [R("Postgres", "Inter", 19, 700, INK)], 54, "center"),
                 (GP, [R("8 tables · users, groups, events, candidates, reactions, responses", "Inter", 16, 500, FILL55)], 96, "center")])
    # bottom strips
    bsy = dy+dh+26; bh = 96
    c.rect(90, bsy, 1010, bh, fill=LAV, line=PURPLE, lw=3, radius=14, dash=True)
    c.text(120, bsy, 250, bh, [R("@bethere/shared", "SpaceMono", 21, 700, PURPLE)], valign="middle", lh=1.0)
    c.text(370, bsy, 1010-370-30, bh,
           [R("Zod schemas + pure logic - ", "Inter", 20, 500, INK), R("resolveIn · revealGoing · tally", "Inter", 20, 800, INK),
            R(". One source of truth; feeds both client and server.", "Inter", 20, 500, INK)], valign="middle", lh=1.25)
    ox = 1130
    c.rect(ox, bsy, 1830-ox, bh, fill=WHITE, line=GREY, lw=3, radius=14, dash=True)
    c.text(ox+24, bsy, 200, bh, [R("OUTSIDE OUR CODE", "Inter", 16, 700, GREY, ls=1.0)], valign="middle", lh=1.1)
    pills = ["Clerk", "AWS App Runner", "Vercel"]; pxp = ox+220
    for label in pills:
        pw = measure(label, "Inter", 17, 700)+28
        c.rect(pxp, bsy+bh/2-18, pw, 36, fill=WHITE, line=INK, lw=2, radius=18)
        c.text(pxp, bsy+bh/2-18, pw, 36, [R(label, "Inter", 17, 700, INK)], align="center", valign="middle", lh=1.0)
        pxp += pw + 10

# ============================================================ run
def main():
    builders = [("05", slide05), ("16", slide16), ("24", slide24)]
    os.makedirs(f"{HERE}/preview", exist_ok=True)
    # pptx (all slides in one deck)
    p = PptxCanvas()
    for _, fn in builders: fn(p)
    p.save(f"{HERE}/bethere-deck-pilot.pptx")
    print("wrote bethere-deck-pilot.pptx")
    # png previews (one per slide)
    for name, fn in builders:
        g = PngCanvas(); fn(g); g.save(f"{HERE}/preview/{name}.png")
        print(f"wrote preview/{name}.png")

if __name__ == "__main__":
    main()
