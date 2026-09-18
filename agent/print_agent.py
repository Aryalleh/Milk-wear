#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
پرینت‌ایجنت سامانهٔ لبنیات محمدپور
----------------------------------
دو حالت چاپ:
  • حالت دقیق (پیش‌نمایش روشن): سرور صفحهٔ HTML را با کروم رندر می‌کند و ایجنت
    تصویر آماده را می‌گیرد و چاپ می‌کند.
  • حالت سبک (پیش‌نمایش خاموش): ایجنت خودش سند را با Pillow رسم می‌کند (بدون کروم،
    رمِ سرور تقریباً صفر) — نزدیک‌ترین حالت به طرحِ HTML.
سرور در پاسخِ poll فیلد light را می‌فرستد و حالت را تعیین می‌کند.

اجرا:
    pip install -r requirements.txt
    cp .env.example .env      # مقادیر را تنظیم کنید
    python print_agent.py
تست بدون پرینتر: PRINTER_TYPE=file → خروجی در out/*.png ذخیره می‌شود.
"""
import os, sys, io, time, base64
import requests

from PIL import Image, ImageDraw, ImageFont
from PIL import features as _pil_features

import config
import webpanel

# اگر Pillow با raqm ساخته شده باشد، خودش شکل‌دهیِ حروف و ترتیبِ راست‌به‌چپ را انجام
# می‌دهد؛ در این حالت نباید متن را دستی reshape/bidi کنیم (وگرنه دوباره برعکس می‌شود).
# فقط در نبودِ raqm از arabic_reshaper + python-bidi به‌عنوان فال‌بک استفاده می‌کنیم.
_HAS_RAQM = False
try:
    _HAS_RAQM = _pil_features.check("raqm")
except Exception:
    _HAS_RAQM = False
if not _HAS_RAQM:
    import arabic_reshaper
    from bidi.algorithm import get_display

config.load()

# وضعیتِ زندهٔ ایجنت که پنل وب نمایش می‌دهد.
STATUS = {"connected": False, "printer_type": config.get("printer_type"),
          "last_job": None, "last_error": None}

# دسترسیِ زنده به تنظیمات (پنل ممکن است آن‌ها را حین اجرا عوض کند).
def server_url():   return (config.get("server_url") or "http://localhost:3000").rstrip("/")
def agent_token():  return config.get("agent_token") or ""
def agent_id():     return config.get("agent_id") or "shop-agent"
def poll_seconds(): return float(config.get("poll_seconds") or 3)
def width():        return int(config.get("printer_width") or 576)
def printer_type(): return (config.get("printer_type") or "file").lower()
def font_path():    return config.font_path()

_FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
def fa_num(n):
    try: s = f"{int(round(float(n))):,}"
    except Exception: s = str(n)
    return s.translate(_FA)
def fa_dig(s): return str(s or "").translate(_FA)
def rt(t):
    """متنِ آمادهٔ رسم. با raqm خام برمی‌گردد (Pillow خودش RTL/شکل‌دهی می‌کند)؛
    بدونِ raqm دستی reshape+bidi می‌شود."""
    s = str(t if t is not None else "")
    return s if _HAS_RAQM else get_display(arabic_reshaper.reshape(s))

# آیا Pillow می‌تواند فونت TrueType (freetype) را لود کند؟ اگر نه، فارسی درست چاپ
# نمی‌شود و باید Pillow با پشتیبانی freetype نصب شود.
FONT_ERROR = None
try:
    ImageFont.truetype(config.font_path(), 20)
except Exception as _e:
    FONT_ERROR = (f"فونت لود نشد ({type(_e).__name__}: {_e}). Pillow با پشتیبانی "
                  "freetype نصب نیست یا فایل فونت ناقص است.")
    print("⚠️  " + FONT_ERROR)

def _default_font(size):
    """فونتِ فال‌بک که getmetrics دارد (تا کد کرش نکند)؛ فارسی را درست نشان نمی‌دهد."""
    try:
        return ImageFont.load_default(size=size)   # Pillow ≥ 10.1: فونت واقعی با متریک
    except Exception:
        return ImageFont.load_default()

def font(size, weight=400):
    try:
        f = ImageFont.truetype(font_path(), size)
        try: f.set_variation_by_axes([weight])
        except Exception: pass
        return f
    except Exception:
        return _default_font(size)

# لوگوی برند (data URI) — یک‌بار از سرور گرفته و کش می‌شود
_logo = "unset"
def get_logo():
    global _logo
    if _logo == "unset":
        _logo = None
        try:
            r = requests.get(f"{server_url()}/api/public/logo", timeout=8)
            uri = (r.json() or {}).get("logo")
            if uri and uri.startswith("data:image") and "," in uri:
                _logo = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1]))).convert("RGBA")
        except Exception:
            _logo = None
    return _logo


# ---------------- بوم رسم (۸۰م‌م) ----------------
class Canvas:
    def __init__(self, w=None, pad=16):
        self.w, self.pad = (w or width()), pad
        self.ops = []
    def _h(self, f):
        try:
            a, d = f.getmetrics(); return a + d + 6
        except AttributeError:
            try:
                b = f.getbbox("لبیآگ"); return (b[3] - b[1]) + 6
            except Exception:
                return 24
    def rl(self, t, f, gap=0): self.ops.append(("rl", t, f, gap))
    def lr(self, t, f, gap=0): self.ops.append(("lr", t, f, gap))
    def center(self, t, f, gap=0): self.ops.append(("c", t, f, gap))
    def between(self, right, left, f, gap=0, lc=(0,0,0)): self.ops.append(("bt", right, left, f, gap, lc))
    def hr(self, gap=6, dash=True): self.ops.append(("hr", gap, dash))
    def sp(self, h=8): self.ops.append(("sp", h))
    def img(self, im, gap=6): self.ops.append(("img", im, gap))
    def box_center(self, t, f, gap=4): self.ops.append(("box", t, f, gap))
    def render(self):
        h = self.pad
        for o in self.ops:
            k = o[0]
            if k == "hr": h += o[1] + 3
            elif k == "sp": h += o[1]
            elif k == "img": h += (o[1].height + o[2])
            elif k == "bt": h += self._h(o[3]) + o[4]
            elif k == "box": h += self._h(o[2]) + o[3] + 10
            else: h += self._h(o[2]) + o[3]
        img = Image.new("L", (self.w, h + self.pad), 255)
        d = ImageDraw.Draw(img)
        y = self.pad; R = self.w - self.pad; L = self.pad
        for o in self.ops:
            k = o[0]
            if k == "hr":
                y += o[1]
                if o[2]:
                    x = L
                    while x < R: d.line([(x, y), (min(x+6, R), y)], fill=0, width=2); x += 12
                else: d.line([(L, y), (R, y)], fill=0, width=2)
                y += 3; continue
            if k == "sp": y += o[1]; continue
            if k == "img":
                im = o[1]; x = (self.w - im.width)//2
                img.paste(im, (x, y)); y += im.height + o[2]; continue
            if k == "bt":
                _, right, left, f, gap, lc = o
                d.text((R, y), rt(right), font=f, fill=0, anchor="ra")
                d.text((L, y), rt(left), font=f, fill=0, anchor="la")
                y += self._h(f) + gap; continue
            if k == "box":
                _, t, f, gap = o; tw = d.textlength(rt(t), font=f)
                bx0 = (self.w - tw)//2 - 12; bx1 = (self.w + tw)//2 + 12
                d.rectangle([bx0, y, bx1, y + self._h(f) + 4], outline=0, width=2)
                d.text((self.w//2, y + 4), rt(t), font=f, fill=0, anchor="ma")
                y += self._h(f) + gap + 10; continue
            kind, t, f, gap = o
            tt = rt(t)
            if kind == "rl": d.text((R, y), tt, font=f, fill=0, anchor="ra")
            elif kind == "lr": d.text((L, y), tt, font=f, fill=0, anchor="la")
            else: d.text((self.w//2, y), tt, font=f, fill=0, anchor="ma")
            y += self._h(f) + gap
        return img

def _logo_or_none(c):
    lg = get_logo()
    if lg:
        im = lg.copy(); im.thumbnail((110, 110)); bg = Image.new("L", im.size, 255)
        bg.paste(im.convert("L"), (0, 0), im.split()[-1] if im.mode == "RGBA" else None)
        c.img(bg, gap=6)

def _qr(c, url):
    if not url: return
    try:
        import qrcode
        q = qrcode.make(url).convert("L"); q.thumbnail((230, 230))
        c.sp(6); c.img(q, gap=2); c.center("اسکن برای مشاهدهٔ فاکتور", font(18))
    except Exception: pass

def _footer(c, b):
    if b.get("phone") or b.get("address"):
        c.hr()
        if b.get("phone"): c.center("تلفن: " + fa_dig(b["phone"]), font(18), gap=2)
        if b.get("address"): c.center(b["address"], font(18))


# ---------------- رندرِ هر سند (سبک، بدون کروم) ----------------
def render_light(p):
    doc = p.get("doc"); b = p.get("branch") or {}
    c = Canvas()
    _logo_or_none(c)
    c.center(b.get("name", "لبنیات محمدپور"), font(38, 800), gap=4)
    if doc == "test":
        c.box_center("چاپ آزمایشی", font(26, 700))
        c.center(p.get("message", "اتصال سالم است ✔"), font(24), gap=6)
        c.center("MILKWEAR", font(18)); return c.render()

    c.box_center(p.get("title", ""), font(24, 700))
    c.hr()
    if doc == "waybill":
        c.between(p.get("waybill_no") or p.get("order_no", ""), "شماره:", font(22))
        c.between(p.get("date_jalali", ""), "تاریخ:", font(22))
        c.between(p.get("receiver", ""), "تحویل‌گیرنده:", font(22))
        if p.get("mobile"): c.between(fa_dig(p["mobile"]), "تلفن:", font(22))
        if p.get("destination"): c.between(p["destination"], "مقصد:", font(22))
        c.hr()
        for it in p.get("items", []):
            c.between(fa_num(it["amount"]), it["name"], font(24, 700))
            c.rl(f"{fa_num(it['qty'])} {it.get('unit','')} × {fa_num(it['price'])}", font(18), gap=4)
        c.hr(dash=False)
        _bal = lambda v: (fa_num(-int(v or 0)) + " بدهکار") if int(v or 0) < 0 else ((fa_num(int(v or 0)) + " بستانکار") if int(v or 0) > 0 else "تسویه")
        c.between(_bal(p.get("balance_before", 0)), "بدهیِ قبل:", font(20))
        c.between(fa_num(p.get("total", 0)), "جمعِ این بارنامه:", font(22, 700))
        c.between(_bal(p.get("balance_after", 0)) + " ریال", "بدهیِ بعد:", font(26, 800))
        _qr(c, p.get("qr_url")); _footer(c, b); return c.render()

    if doc == "statement":
        person = p.get("person") or {}
        c.center("بازه: " + p.get("from_jalali","") + " تا " + p.get("to_jalali",""), font(18), gap=4)
        c.hr()
        c.between(person.get("fullname",""), "طرف حساب:", font(22))
        c.between(fa_dig(person.get("person_code","")), "کد:", font(20))
        c.between(fa_num(p.get("opening",0)), "ماندهٔ قبلی:", font(22)); c.hr()
        for r in p.get("ledger", []):
            cr = r["credit"] > 0; amt = r["credit"] if cr else r["debit"]
            d = (r.get("description") or r.get("tx_type") or "")[:26]
            short = "/".join(str(r.get("date","")).split("/")[1:]) or r.get("date","")
            c.between(fa_num(amt) + ("+" if cr else "−"), f"{short} {d}", font(18), gap=2)
        c.hr(dash=False)
        c.between(fa_num(p.get("total_debit",0)), "جمع بدهکار:", font(20))
        c.between(fa_num(p.get("total_credit",0)), "جمع بستانکار:", font(20))
        cl = p.get("closing", 0); lbl = "بدهکار" if cl < 0 else ("بستانکار" if cl > 0 else "تسویه")
        c.between(fa_num(abs(cl)) + " " + lbl, "مانده نهایی:", font(26, 800), gap=4)
        _footer(c, b); return c.render()

    if doc == "manifest":
        c.between(fa_num(p.get("order_count",0)), "تعداد سفارش:", font(22)); c.hr()
        for it in p.get("items", []):
            c.between(f"{fa_num(it['qty'])} {it.get('unit','')}", it["name"], font(24, 700), gap=4)
        c.hr(dash=False)
        c.between(fa_num(p.get("total",0)) + " ریال", "ارزش کل بار:", font(24, 800))
        c.center("راننده اقلام بالا را بار بزند", font(16), gap=2); return c.render()

    # receipt (پیش‌فرض)
    c.between(p.get("receipt_no",""), "شماره فاکتور:", font(20))
    c.between(p.get("date_jalali",""), "تاریخ ثبت:", font(22))
    c.between(p.get("person",""), "طرف حساب:", font(22)); c.hr()
    if p.get("milk"):
        m = p["milk"]; lbl = "شیر صبح" if m.get("shift") == "morning" else "شیر شب"
        c.between("+" + fa_num(m.get("amount",0)), lbl, font(24, 700))
        c.rl(f"{fa_num(m.get('weight_kg',0))} کیلو × {fa_num(m.get('price_per_kg',0))}", font(18), gap=4)
    for it in p.get("items", []):
        c.between("−" + fa_num(it["amount"]), it["name"], font(24, 700))
        c.rl(f"{fa_num(it['qty'])} {it.get('unit','')} × {fa_num(it['price'])}", font(18), gap=4)
    c.hr(dash=False)
    c.between(fa_num(p.get("milk_amount",0)), "جمع بستانکار (شیر):", font(18))
    c.between(fa_num(p.get("purchase_amount",0)), "جمع بدهکار (خرید):", font(18))
    c.between(fa_num(p.get("net_amount",0)) + " ریال", "خالص فاکتور:", font(26, 800), gap=4)
    _qr(c, p.get("qr_url")); _footer(c, b); return c.render()


# ---------------- پرینتر ----------------
def _hexid(v):
    """'0x0416' یا '0416' → عدد صحیح. مقادیر VID/PID همیشه هگز ذخیره می‌شوند."""
    s = str(v).strip().lower().replace("0x", "")
    return int(s or "0", 16)

def make_printer():
    from escpos import printer as P
    pt = printer_type()
    if pt == "network":
        return P.Network(config.get("printer_host"), port=int(config.get("printer_port")), timeout=15)
    if pt == "usb":
        return P.Usb(
            _hexid(config.get("printer_usb_vendor")),
            _hexid(config.get("printer_usb_product")),
            interface=int(config.get("printer_usb_interface")),
            in_ep=_hexid(config.get("printer_usb_in_ep")),
            out_ep=_hexid(config.get("printer_usb_out_ep")),
        )
    if pt == "serial":
        return P.Serial(devfile=config.get("printer_serial_dev"), baudrate=int(config.get("printer_baud")))
    raise RuntimeError(f"PRINTER_TYPE ناشناخته: {pt}")

def fetch_image(session, job_id):
    r = session.get(f"{server_url()}/api/agent/jobs/{job_id}/image", params={"w": width()}, timeout=40)
    r.raise_for_status(); return r.content

def to_width(img):
    w = width()
    if img.mode != "L": img = img.convert("L")
    if img.width != w:
        img = img.resize((w, max(1, round(img.height * w / img.width))))
    return img

def print_job(session, job):
    copies = max(1, int(job.get("copies", 1)))
    if job.get("light"):
        img = to_width(render_light(job.get("payload") or {}))         # بدون کروم
    else:
        img = to_width(Image.open(io.BytesIO(fetch_image(session, job["id"]))))  # تصویرِ کرومِ سرور
    if printer_type() == "file":
        os.makedirs("out", exist_ok=True)
        path = os.path.join("out", f"job-{job['id']}-{job.get('kind','doc')}.png")
        img.save(path); print(f"  [file] {path} ({img.width}×{img.height})"); return
    p = make_printer()
    try:
        for _ in range(copies): p.image(img); p.text("\n"); p.cut()
    finally:
        try: p.close()
        except Exception: pass


def _session():
    """سشنِ requests با هدرهای جاری (توکن/شناسه ممکن است از پنل عوض شده باشند)."""
    s = requests.Session()
    s.headers.update({"x-agent-token": agent_token(), "x-agent-id": agent_id()})
    return s


def do_test_print():
    """چاپ آزمایشی با تنظیماتِ جاری — برای دکمهٔ پنل. (ok, message) برمی‌گرداند."""
    STATUS["printer_type"] = printer_type()
    payload = {"doc": "test", "message": "اتصال سالم است ✔",
               "branch": {"name": "لبنیات محمدپور"}}
    job = {"id": "test", "kind": "test", "light": True, "payload": payload, "copies": 1}
    try:
        print_job(_session(), job)
        note = "  ⚠ " + FONT_ERROR if FONT_ERROR else ""
        if printer_type() == "file":
            return True, "سند تست در پوشهٔ out/ ذخیره شد." + note
        return True, "به پرینتر ارسال شد." + note
    except Exception as e:
        STATUS["last_error"] = str(e)[:120]
        return False, str(e)


def get_status():
    st = dict(STATUS)
    if FONT_ERROR and not st.get("last_error"):
        st["last_error"] = FONT_ERROR
    return st


def main():
    webpanel.start(test_print_fn=do_test_print, status_fn=get_status)
    print("🖨  پرینت‌ایجنت آماده است. تنظیمات را از پنل وب انجام دهید.")
    while True:
        try:
            STATUS["printer_type"] = printer_type()
            if not agent_token():
                STATUS["connected"] = False
                time.sleep(2); continue
            s = _session()
            r = s.post(f"{server_url()}/api/agent/poll", timeout=20)
            if r.status_code == 401:
                STATUS["connected"] = False
                STATUS["last_error"] = "توکن رد شد"
                print("❌ توکن رد شد؛ ۱۰ ثانیه صبر"); time.sleep(10); continue
            r.raise_for_status()
            STATUS["connected"] = True; STATUS["last_error"] = None
            job = r.json().get("job")
            if not job: time.sleep(poll_seconds()); continue
            print(f"📄 کار #{job['id']} ({job['kind']}, {'سبک' if job.get('light') else 'دقیق'}) …")
            try:
                print_job(s, job)
                s.post(f"{server_url()}/api/agent/jobs/{job['id']}/done", timeout=15)
                STATUS["last_job"] = job["id"]; print(f"✔ #{job['id']} چاپ شد")
            except Exception as e:
                STATUS["last_error"] = str(e)[:120]
                print(f"✖ خطای #{job['id']}: {e}")
                try: s.post(f"{server_url()}/api/agent/jobs/{job['id']}/error", json={"error": str(e)[:200]}, timeout=15)
                except Exception: pass
                time.sleep(2)
        except requests.RequestException as e:
            STATUS["connected"] = False; STATUS["last_error"] = "شبکه در دسترس نیست"
            print(f"… شبکه در دسترس نیست ({e})؛ ۵ ثانیه"); time.sleep(5)
        except KeyboardInterrupt:
            print("\nخروج."); break


if __name__ == "__main__":
    main()
