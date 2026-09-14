#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مدیریت تنظیماتِ پرینت‌ایجنت.

تنظیمات در فایل JSON (پیش‌فرض کنار همین اسکریپت: config.json) نگه‌داری می‌شود تا
از **پنل وب** قابل ویرایش باشد. اگر config.json نبود، مقادیر اولیه از متغیرهای محیطی
و .env (سازگاری با نسخهٔ قبل) خوانده و یک‌بار ذخیره می‌شود.

CONFIG یک دیکشنری زندهٔ سراسری است؛ بقیهٔ ماژول‌ها همیشه مقدار جاری را از آن می‌خوانند،
بنابراین ذخیرهٔ تنظیمات از پنل بدون ری‌استارت اعمال می‌شود.
"""
import os
import json
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("AGENT_CONFIG", os.path.join(HERE, "config.json"))
BUNDLED_FONT = os.path.join(HERE, "fonts", "Vazirmatn.ttf")

# فیلدهایی که فقط رشتهٔ ساده‌اند و پاک‌سازیِ خاصی لازم ندارند.
_STR_KEYS = {
    "server_url", "agent_token", "agent_id", "printer_type",
    "printer_host", "printer_usb_vendor", "printer_usb_product",
    "printer_serial_dev", "font_regular", "panel_host",
}
_INT_KEYS = {"printer_width", "printer_port", "printer_baud", "panel_port"}
_FLOAT_KEYS = {"poll_seconds"}

DEFAULTS = {
    # اتصال به سرور
    "server_url": "http://localhost:3000",
    "agent_token": "",
    "agent_id": "shop-agent",
    "poll_seconds": 3.0,
    # پرینتر: file | network | usb | serial
    "printer_type": "file",
    "printer_width": 576,
    "printer_host": "192.168.1.50",
    "printer_port": 9100,
    "printer_usb_vendor": "0x0416",
    "printer_usb_product": "0x5011",
    "printer_serial_dev": "/dev/ttyUSB0",
    "printer_baud": 9600,
    # فونت (خالی = فونت همراهِ ایجنت)
    "font_regular": "",
    # پنل وب مدیریت
    "panel_host": "0.0.0.0",
    "panel_port": 7000,
}

CONFIG = dict(DEFAULTS)
_lock = threading.Lock()


def _from_env():
    """مقادیر اولیه از متغیرهای محیطی/‏.env برای مهاجرت از نسخهٔ قبل."""
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(HERE, ".env"))
    except Exception:
        pass

    def e(k, d=None):
        v = os.environ.get(k)
        return v if v not in (None, "") else d

    out = dict(DEFAULTS)
    mapping = {
        "server_url": "SERVER_URL", "agent_token": "AGENT_TOKEN",
        "agent_id": "AGENT_ID", "poll_seconds": "POLL_SECONDS",
        "printer_type": "PRINTER_TYPE", "printer_width": "PRINTER_WIDTH",
        "printer_host": "PRINTER_HOST", "printer_port": "PRINTER_PORT",
        "printer_usb_vendor": "PRINTER_USB_VENDOR",
        "printer_usb_product": "PRINTER_USB_PRODUCT",
        "printer_serial_dev": "PRINTER_SERIAL_DEV", "printer_baud": "PRINTER_BAUD",
        "font_regular": "FONT_REGULAR", "panel_host": "PANEL_HOST",
        "panel_port": "PANEL_PORT",
    }
    for key, envk in mapping.items():
        v = e(envk)
        if v is not None:
            out[key] = v
    return _coerce(out)


def _coerce(d):
    """تبدیل نوع‌ها و نرمال‌سازیِ مقادیر."""
    out = dict(DEFAULTS)
    for k, v in (d or {}).items():
        if k not in DEFAULTS:
            continue
        try:
            if k in _INT_KEYS:
                out[k] = int(float(v))
            elif k in _FLOAT_KEYS:
                out[k] = float(v)
            else:
                out[k] = str(v).strip()
        except (TypeError, ValueError):
            out[k] = DEFAULTS[k]
    out["printer_type"] = (out.get("printer_type") or "file").lower()
    if out["printer_type"] not in ("file", "network", "usb", "serial"):
        out["printer_type"] = "file"
    # سقف/کف منطقی
    out["poll_seconds"] = min(max(out["poll_seconds"], 0.5), 60.0)
    out["printer_width"] = min(max(out["printer_width"], 200), 1200)
    return out


def load():
    """بارگذاری تنظیمات به CONFIG. اگر فایل نبود از .env می‌سازد و ذخیره می‌کند."""
    global CONFIG
    data = None
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"⚠️  config.json خوانده نشد ({e})؛ از مقادیر محیطی استفاده می‌شود.")
    if data is None:
        merged = _from_env()
        with _lock:
            CONFIG.clear()
            CONFIG.update(merged)
        try:
            save(CONFIG)  # ذخیرهٔ اولیه برای مهاجرت
        except Exception:
            pass
    else:
        merged = _coerce(data)
        with _lock:
            CONFIG.clear()
            CONFIG.update(merged)
    return CONFIG


def save(new_values):
    """به‌روزرسانیِ CONFIG و نوشتن روی دیسک (اتمیک)."""
    merged = _coerce({**CONFIG, **(new_values or {})})
    with _lock:
        CONFIG.clear()
        CONFIG.update(merged)
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(CONFIG, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)
    return dict(CONFIG)


def get(key):
    return CONFIG.get(key, DEFAULTS.get(key))


def font_path():
    return get("font_regular") or BUNDLED_FONT
