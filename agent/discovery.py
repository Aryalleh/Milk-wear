#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
کشفِ پرینترها برای پنل وب:
  • USB   — با pyusb همهٔ دستگاه‌ها را لیست می‌کند و پرینترها را علامت می‌زند.
  • Serial— پورت‌های سریال/COM را لیست می‌کند.
  • LAN   — یک ساب‌نت را برای پرینترهای شبکه (پورت 9100 و…) اسکن می‌کند.
همچنین کمکِ رفعِ دسترسیِ USB روی لینوکس (قانون udev) را تولید می‌کند.
"""
import os
import re
import socket
import ipaddress
from concurrent.futures import ThreadPoolExecutor

USB_PRINTER_CLASS = 7  # کلاس استاندارد USB Printer


# ---------------- USB ----------------
def list_usb():
    """لیست دستگاه‌های USB. هر مورد: vendor/product (hex)، نام، پرینتر بودن، دسترسی."""
    try:
        import usb.core
        import usb.util
    except Exception:
        return {"ok": False, "error": "pyusb نصب نیست. اجرا کنید: pip install pyusb", "devices": []}

    try:
        devices = list(usb.core.find(find_all=True))
    except usb.core.NoBackendError:
        return {"ok": False, "error": "کتابخانهٔ libusb نصب نیست (Linux: sudo apt install libusb-1.0-0).", "devices": []}
    except Exception as e:
        return {"ok": False, "error": f"خطای USB: {e}", "devices": []}

    out = []
    for d in devices:
        vid = f"0x{d.idVendor:04x}"
        pid = f"0x{d.idProduct:04x}"
        is_printer = (getattr(d, "bDeviceClass", 0) == USB_PRINTER_CLASS)
        # بررسیِ کلاسِ اینترفیس‌ها (بیشتر پرینترها کلاس دستگاه را 0 می‌گذارند)
        accessible = True
        manufacturer = product = ""
        try:
            for cfg in d:
                for intf in cfg:
                    if intf.bInterfaceClass == USB_PRINTER_CLASS:
                        is_printer = True
        except Exception:
            accessible = False
        try:
            if d.iManufacturer:
                manufacturer = usb.util.get_string(d, d.iManufacturer) or ""
            if d.iProduct:
                product = usb.util.get_string(d, d.iProduct) or ""
        except Exception:
            # خواندنِ رشته‌ها نیاز به دسترسی دارد؛ نبودنش یعنی مشکل permission
            accessible = False
        label = " ".join(x for x in (manufacturer, product) if x).strip() or "USB Device"
        out.append({
            "vendor": vid,
            "product": pid,
            "label": label,
            "is_printer": bool(is_printer),
            "accessible": bool(accessible),
        })
    # پرینترها اول، سپس بقیه
    out.sort(key=lambda x: (not x["is_printer"], x["label"]))
    return {"ok": True, "devices": out}


def udev_rule(vendor, product):
    """قانون udev برای دسترسیِ بدون‌روت به یک پرینتر USB مشخص."""
    v = _hex4(vendor)
    p = _hex4(product)
    rule = f'SUBSYSTEM=="usb", ATTRS{{idVendor}}=="{v}", ATTRS{{idProduct}}=="{p}", MODE="0666"'
    path = "/etc/udev/rules.d/99-escpos.rules"
    command = (
        f"echo '{rule}' | sudo tee {path} && "
        "sudo udevadm control --reload-rules && sudo udevadm trigger"
    )
    return {"rule": rule, "path": path, "command": command}


def try_install_udev(vendor, product):
    """اگر ایجنت با دسترسیِ روت اجرا شده باشد، قانون udev را می‌نویسد."""
    info = udev_rule(vendor, product)
    if os.name != "posix":
        return {"ok": False, "message": "این قابلیت فقط روی لینوکس است.", **info}
    if os.geteuid() != 0:
        return {"ok": False, "message": "دسترسی روت لازم است؛ دستور زیر را دستی اجرا کنید.", **info}
    try:
        os.makedirs(os.path.dirname(info["path"]), exist_ok=True)
        with open(info["path"], "w") as f:
            f.write(info["rule"] + "\n")
        os.system("udevadm control --reload-rules && udevadm trigger")
        return {"ok": True, "message": "قانون udev نوشته شد. پرینتر را یک‌بار جدا/وصل کنید.", **info}
    except Exception as e:
        return {"ok": False, "message": f"نوشتن قانون udev ناموفق: {e}", **info}


def _hex4(v):
    """نرمال‌سازیِ '0x0471' یا '1137' یا '471' به رشتهٔ چهاررقمیِ هگز مثل '0471'."""
    s = str(v).strip().lower()
    try:
        n = int(s, 16) if s.startswith("0x") else int(s)
    except ValueError:
        n = int(re.sub(r"[^0-9a-f]", "", s) or "0", 16)
    return f"{n:04x}"


# ---------------- Serial ----------------
def list_serial():
    ports = []
    try:
        from serial.tools import list_ports
        for p in list_ports.comports():
            ports.append({"device": p.device, "label": (p.description or p.device)})
    except Exception:
        # فال‌بک: مسیرهای رایج روی لینوکس
        import glob
        for pat in ("/dev/ttyUSB*", "/dev/ttyACM*", "/dev/serial/by-id/*"):
            for dev in sorted(glob.glob(pat)):
                ports.append({"device": dev, "label": dev})
    return {"ok": True, "ports": ports}


# ---------------- LAN ----------------
def local_subnet():
    """حدسِ ساب‌نت محلی به‌شکل CIDR مثل '192.168.1.0/24'."""
    ip = "192.168.1.10"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    parts = ip.split(".")
    return ".".join(parts[:3]) + ".0/24"


def _probe(ip, port, timeout):
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return ip
    except Exception:
        return None


def scan_lan(subnet=None, port=9100, timeout=0.4, max_hosts=1024):
    """اسکنِ ساب‌نت برای پرینترهایی که پورت داده‌شده (پیش‌فرض 9100/RAW) را باز دارند."""
    subnet = subnet or local_subnet()
    try:
        net = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return {"ok": False, "error": f"ساب‌نت نامعتبر: {subnet}", "printers": []}
    hosts = [str(h) for h in net.hosts()][:max_hosts]
    found = []
    with ThreadPoolExecutor(max_workers=128) as ex:
        for res in ex.map(lambda ip: _probe(ip, port, timeout), hosts):
            if res:
                found.append({"host": res, "port": port})
    return {"ok": True, "subnet": subnet, "port": port, "scanned": len(hosts), "printers": found}
