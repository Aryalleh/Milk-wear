#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
پرینت‌ایجنت سامانهٔ لبنیات محمدپور
----------------------------------
کنارِ پرینتر حرارتی ۸۰م‌م (ESC/POS) اجرا می‌شود، به سرور وصل می‌شود، کارهای
چاپ (بارنامه/فاکتور) را می‌گیرد، متنِ فارسی را به تصویر تبدیل و چاپ می‌کند و
QR را به‌صورت بومی پرینتر چاپ می‌کند. هیچ پورتی روی پرینتر باز نمی‌شود؛ ایجنت
فقط اتصال خروجی به سرور می‌زند، پس از پشت اینترنت هم کار می‌کند.

اجرا:
    pip install -r requirements.txt
    cp .env.example .env   # مقادیر را تنظیم کنید
    python print_agent.py

تست بدون پرینتر:  PRINTER_TYPE=file  →  هر سند به‌صورت PNG در پوشهٔ out/ ذخیره می‌شود.
"""
import os
import sys
import time
import textwrap

import requests
from PIL import Image, ImageDraw, ImageFont

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:
    pass  # اختیاری؛ در نبود python-dotenv از متغیرهای محیطی استفاده می‌شود

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except Exception:  # pragma: no cover
    print("نصب نشده: arabic-reshaper و python-bidi  →  pip install -r requirements.txt")
    raise

# ----------------------------- پیکربندی -----------------------------
def env(k, d=None):
    v = os.environ.get(k)
    return v if v not in (None, "") else d

SERVER_URL   = env("SERVER_URL", "http://localhost:3000").rstrip("/")
AGENT_TOKEN  = env("AGENT_TOKEN", "")
AGENT_ID     = env("AGENT_ID", "shop-agent")
POLL_SECONDS = float(env("POLL_SECONDS", "3"))
WIDTH        = int(env("PRINTER_WIDTH", "576"))       # 576 برای 80mm@203dpi (بعضی مدل‌ها 512)
FONT_REG     = env("FONT_REGULAR", "fonts/Vazirmatn-Regular.ttf")
FONT_BOLD    = env("FONT_BOLD", "fonts/Vazirmatn-Bold.ttf")

PRINTER_TYPE = env("PRINTER_TYPE", "file").lower()    # network | usb | serial | file | dummy

if not AGENT_TOKEN:
    sys.exit("AGENT_TOKEN تنظیم نشده. آن را از تنظیمات ← چاپ و سفارش‌گیری کپی کنید.")

# ----------------------------- کمک‌ابزار متن -----------------------------
_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")

def fa_num(n):
    try:
        n = int(round(float(n)))
        s = f"{n:,}"
    except Exception:
        s = str(n)
    return s.translate(_FA_DIGITS)

def rt(text):
    """آماده‌سازی متن فارسی برای رسم (شکل‌دهی حروف + راست‌چین بصری)."""
    if text is None:
        text = ""
    return get_display(arabic_reshaper.reshape(str(text)))

def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

F_SM   = lambda: load_font(FONT_REG, 22)
F_MD   = lambda: load_font(FONT_REG, 26)
F_BD   = lambda: load_font(FONT_BOLD, 28)
F_BG   = lambda: load_font(FONT_BOLD, 40)

# ----------------------------- ساخت تصویر سند -----------------------------
class Canvas:
    """بوم عمودیِ ۸۰م‌م که خطوط راست‌چین/چپ‌چین/وسط را می‌چیند."""
    def __init__(self, width):
        self.w = width
        self.pad = 12
        self.lines = []      # (kind, ...) دستورهای رسم؛ اول ارتفاع را می‌سنجیم بعد رسم می‌کنیم

    def _text_h(self, font):
        asc, desc = font.getmetrics()
        return asc + desc + 6

    def row_rl(self, text, font, gap=0):
        self.lines.append(("rl", text, font, gap)); return self

    def row_lr(self, text, font, gap=0):
        self.lines.append(("lr", text, font, gap)); return self

    def row_center(self, text, font, gap=0):
        self.lines.append(("c", text, font, gap)); return self

    def row_between(self, right, left, font, gap=0):
        self.lines.append(("bt", right, left, font, gap)); return self

    def hr(self, gap=6):
        self.lines.append(("hr", gap)); return self

    def space(self, h=10):
        self.lines.append(("sp", h)); return self

    def render(self):
        # اندازه‌گیری ارتفاع
        h = self.pad
        for ln in self.lines:
            if ln[0] == "hr": h += ln[1] + 3
            elif ln[0] == "sp": h += ln[1]
            elif ln[0] == "bt": h += self._text_h(ln[3]) + ln[4]
            else: h += self._text_h(ln[2]) + ln[3]
        h += self.pad
        img = Image.new("L", (self.w, h), 255)
        d = ImageDraw.Draw(img)
        y = self.pad
        R = self.w - self.pad
        L = self.pad
        for ln in self.lines:
            if ln[0] == "hr":
                y += ln[1]; d.line([(L, y), (R, y)], fill=0, width=2); y += 3
                continue
            if ln[0] == "sp":
                y += ln[1]; continue
            if ln[0] == "bt":
                _, right, left, font, gap = ln
                d.text((R, y), rt(right), font=font, fill=0, anchor="ra")
                d.text((L, y), rt(left),  font=font, fill=0, anchor="la")
                y += self._text_h(font) + gap
                continue
            kind, text, font, gap = ln
            t = rt(text)
            if kind == "rl":   d.text((R, y), t, font=font, fill=0, anchor="ra")
            elif kind == "lr": d.text((L, y), t, font=font, fill=0, anchor="la")
            else:              d.text((self.w // 2, y), t, font=font, fill=0, anchor="ma")
            y += self._text_h(font) + gap
        return img


def build_document(payload):
    """از payload سند، تصویر و (در صورت وجود) URLِ QR را می‌سازد."""
    doc = payload.get("doc")
    c = Canvas(WIDTH)
    branch = payload.get("branch", {}) or {}

    # سربرگ
    c.row_center(branch.get("name", "سامانه لبنیات"), F_BG(), gap=2)
    c.row_center(payload.get("title", ""), F_BD(), gap=4)
    c.hr()

    if doc == "test":
        c.space(8)
        c.row_center(payload.get("message", "تست"), F_MD(), gap=6)
        c.row_center("MILKWEAR", F_SM())
        return c.render(), None

    # متادیتا
    if payload.get("date_jalali"):
        c.row_between(payload["date_jalali"], "تاریخ:", F_MD(), gap=2)
    if doc == "waybill":
        c.row_between(payload.get("order_no", ""), "شماره سفارش:", F_MD(), gap=2)
        c.row_between(payload.get("receiver", ""), "تحویل‌گیرنده:", F_MD(), gap=2)
        if payload.get("mobile"):
            c.row_between(fa_num(payload["mobile"]), "تلفن:", F_MD(), gap=2)
        if payload.get("destination"):
            c.row_between(payload["destination"], "مقصد:", F_MD(), gap=2)
    else:  # receipt
        c.row_between(payload.get("receipt_no", ""), "شماره فاکتور:", F_MD(), gap=2)
        c.row_between(payload.get("person", ""), "طرف حساب:", F_MD(), gap=2)
    c.hr()

    # اقلام
    if payload.get("milk"):
        m = payload["milk"]
        lbl = "شیر صبح" if m.get("shift") == "morning" else "شیر شب"
        c.row_between(f"+{fa_num(m.get('amount', 0))}", lbl, F_BD(), gap=0)
        c.row_rl(f"{fa_num(m.get('weight_kg', 0))} کیلو × {fa_num(m.get('price_per_kg', 0))}", F_SM(), gap=4)
    for it in payload.get("items", []):
        c.row_between(fa_num(it.get("amount", 0)), it.get("name", ""), F_BD(), gap=0)
        c.row_rl(f"{fa_num(it.get('qty', 0))} {it.get('unit','')} × {fa_num(it.get('price', 0))}", F_SM(), gap=4)
    if not payload.get("items") and not payload.get("milk"):
        c.row_center("قلمی ثبت نشده", F_SM(), gap=4)
    c.hr()

    # جمع‌ها
    if doc == "receipt":
        c.row_between(fa_num(payload.get("milk_amount", 0)), "جمع بستانکار (شیر):", F_SM())
        c.row_between(fa_num(payload.get("purchase_amount", 0)), "جمع بدهکار (خرید):", F_SM())
        c.row_between(f"{fa_num(payload.get('net_amount', 0))} ریال", "خالص فاکتور:", F_BD(), gap=4)
    else:
        c.row_between(f"{fa_num(payload.get('total', 0))} ریال", "جمع کل:", F_BD(), gap=4)

    # فوتر: تلفن و آدرس سایت
    c.hr()
    if branch.get("phone"):
        c.row_center("تلفن: " + fa_num(branch["phone"]), F_SM(), gap=2)
    if branch.get("address"):
        c.row_center(branch["address"], F_SM(), gap=2)
    c.space(4)
    c.row_center("اسکن QR برای مشاهدهٔ فاکتور", F_SM(), gap=2)

    return c.render(), payload.get("qr_url")


# ----------------------------- اتصال پرینتر -----------------------------
def make_printer():
    if PRINTER_TYPE in ("file", "dummy"):
        return None  # حالت تست؛ در print_job مدیریت می‌شود
    from escpos import printer as P
    if PRINTER_TYPE == "network":
        return P.Network(env("PRINTER_HOST", "192.168.1.50"), port=int(env("PRINTER_PORT", "9100")), timeout=15)
    if PRINTER_TYPE == "usb":
        return P.Usb(int(env("PRINTER_USB_VENDOR", "0x0416"), 16), int(env("PRINTER_USB_PRODUCT", "0x5011"), 16))
    if PRINTER_TYPE == "serial":
        return P.Serial(devfile=env("PRINTER_SERIAL_DEV", "/dev/ttyUSB0"), baudrate=int(env("PRINTER_BAUD", "9600")))
    raise SystemExit(f"PRINTER_TYPE ناشناخته: {PRINTER_TYPE}")


def print_job(job):
    payload = job["payload"]
    copies = max(1, int(job.get("copies", 1)))
    img, qr_url = build_document(payload)

    if PRINTER_TYPE in ("file", "dummy"):
        os.makedirs("out", exist_ok=True)
        path = os.path.join("out", f"job-{job['id']}-{payload.get('doc','doc')}.png")
        img.save(path)
        print(f"  [file] ذخیره شد: {path}" + (f"  | QR: {qr_url}" if qr_url else ""))
        return

    p = make_printer()
    try:
        for _ in range(copies):
            p.image(img)
            if qr_url:
                p.qr(qr_url, size=6, center=True)
            p.text("\n")
            p.cut()
    finally:
        try: p.close()
        except Exception: pass


# ----------------------------- حلقهٔ اصلی -----------------------------
def main():
    s = requests.Session()
    s.headers.update({"x-agent-token": AGENT_TOKEN, "x-agent-id": AGENT_ID})
    print(f"🖨  پرینت‌ایجنت به {SERVER_URL} وصل می‌شود (نوع پرینتر: {PRINTER_TYPE}) …")
    # بررسی اتصال
    try:
        r = s.get(f"{SERVER_URL}/api/agent/ping", timeout=10)
        if r.status_code == 401:
            sys.exit("توکن نامعتبر است. AGENT_TOKEN را بررسی کنید.")
        r.raise_for_status()
        print("✅ اتصال و توکن معتبر است. در حال گوش‌دادن به صف چاپ …")
    except requests.RequestException as e:
        print(f"⚠️  اتصال اولیه ناموفق ({e}); با این حال تلاش برای poll ادامه می‌یابد …")

    while True:
        try:
            r = s.post(f"{SERVER_URL}/api/agent/poll", timeout=20)
            if r.status_code == 401:
                print("❌ توکن رد شد؛ ۳۰ ثانیه صبر …"); time.sleep(30); continue
            r.raise_for_status()
            job = r.json().get("job")
            if not job:
                time.sleep(POLL_SECONDS); continue
            print(f"📄 کار #{job['id']} ({job['kind']}) دریافت شد؛ در حال چاپ …")
            try:
                print_job(job)
                s.post(f"{SERVER_URL}/api/agent/jobs/{job['id']}/done", timeout=15)
                print(f"✔ کار #{job['id']} چاپ شد.")
            except Exception as e:
                print(f"✖ خطای چاپ کار #{job['id']}: {e}")
                try: s.post(f"{SERVER_URL}/api/agent/jobs/{job['id']}/error", json={"error": str(e)[:200]}, timeout=15)
                except Exception: pass
                time.sleep(2)
        except requests.RequestException as e:
            print(f"… شبکه در دسترس نیست ({e})؛ ۵ ثانیه صبر"); time.sleep(5)
        except KeyboardInterrupt:
            print("\nخروج."); break


if __name__ == "__main__":
    main()
