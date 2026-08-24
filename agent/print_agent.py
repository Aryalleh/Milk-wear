#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
پرینت‌ایجنت سامانهٔ لبنیات محمدپور
----------------------------------
کنارِ پرینتر حرارتی ۸۰م‌م (ESC/POS) اجرا می‌شود. به سرور وصل می‌شود، کار چاپ را
می‌گیرد، **تصویرِ آمادهٔ سرور** (رندرِ دقیقِ همان تمپلیت HTML فاکتور/بارنامه به‌همراه QR)
را دریافت و روی پرینتر چاپ می‌کند. هیچ رندری سمت ایجنت انجام نمی‌شود؛ خروجی مو‌به‌مو
مثل طراحی HTML است.

اجرا:
    pip install -r requirements.txt
    cp .env.example .env      # مقادیر را تنظیم کنید
    python print_agent.py

تست بدون پرینتر:  PRINTER_TYPE=file  →  هر سند به‌صورت PNG در پوشهٔ out/ ذخیره می‌شود.
"""
import os
import sys
import time

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:
    pass


def env(k, d=None):
    v = os.environ.get(k)
    return v if v not in (None, "") else d


SERVER_URL   = env("SERVER_URL", "http://localhost:3000").rstrip("/")
AGENT_TOKEN  = env("AGENT_TOKEN", "")
AGENT_ID     = env("AGENT_ID", "shop-agent")
POLL_SECONDS = float(env("POLL_SECONDS", "3"))
WIDTH        = int(env("PRINTER_WIDTH", "576"))    # 80mm@203dpi = 576 نقطه (بعضی مدل‌ها 512)
PRINTER_TYPE = env("PRINTER_TYPE", "file").lower() # network | usb | serial | file

if not AGENT_TOKEN or AGENT_TOKEN.strip().startswith("#"):
    sys.exit("AGENT_TOKEN تنظیم نشده. آن را از «تنظیمات ← چاپ و سفارش‌گیری» کپی کنید.")


def make_printer():
    from escpos import printer as P
    if PRINTER_TYPE == "network":
        return P.Network(env("PRINTER_HOST", "192.168.1.50"), port=int(env("PRINTER_PORT", "9100")), timeout=15)
    if PRINTER_TYPE == "usb":
        return P.Usb(int(env("PRINTER_USB_VENDOR", "0x0416"), 16), int(env("PRINTER_USB_PRODUCT", "0x5011"), 16))
    if PRINTER_TYPE == "serial":
        return P.Serial(devfile=env("PRINTER_SERIAL_DEV", "/dev/ttyUSB0"), baudrate=int(env("PRINTER_BAUD", "9600")))
    raise SystemExit(f"PRINTER_TYPE ناشناخته: {PRINTER_TYPE}")


def fetch_image(session, job_id):
    r = session.get(f"{SERVER_URL}/api/agent/jobs/{job_id}/image", params={"w": WIDTH}, timeout=40)
    r.raise_for_status()
    return r.content  # PNG bytes


def to_printer_image(png):
    """PNG سرور را به عرضِ پرینتر مقیاس می‌کند (۱px = ۱ نقطه)."""
    import io
    from PIL import Image
    img = Image.open(io.BytesIO(png)).convert("L")
    if img.width != WIDTH:
        h = max(1, round(img.height * WIDTH / img.width))
        img = img.resize((WIDTH, h))
    return img


def print_job(session, job):
    copies = max(1, int(job.get("copies", 1)))
    png = fetch_image(session, job["id"])
    img = to_printer_image(png)

    if PRINTER_TYPE == "file":
        os.makedirs("out", exist_ok=True)
        path = os.path.join("out", f"job-{job['id']}-{job.get('kind','doc')}.png")
        img.save(path)
        print(f"  [file] ذخیره شد: {path} ({img.width}×{img.height})")
        return

    # چاپ روی پرینتر حرارتی: تصویر را رستر می‌کنیم و کاغذ را می‌بریم
    p = make_printer()
    try:
        for _ in range(copies):
            p.image(img)
            p.text("\n")
            p.cut()
    finally:
        try: p.close()
        except Exception: pass


def main():
    s = requests.Session()
    s.headers.update({"x-agent-token": AGENT_TOKEN, "x-agent-id": AGENT_ID})
    print(f"🖨  پرینت‌ایجنت به {SERVER_URL} وصل می‌شود (نوع پرینتر: {PRINTER_TYPE}) …")
    try:
        r = s.get(f"{SERVER_URL}/api/agent/ping", timeout=10)
        if r.status_code == 401:
            sys.exit("توکن نامعتبر است. AGENT_TOKEN را بررسی کنید.")
        r.raise_for_status()
        print("✅ اتصال و توکن معتبر است. در حال گوش‌دادن به صف چاپ …")
    except requests.RequestException as e:
        print(f"⚠️  اتصال اولیه ناموفق ({e})؛ با این حال تلاش برای poll ادامه می‌یابد …")

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
                print_job(s, job)
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
