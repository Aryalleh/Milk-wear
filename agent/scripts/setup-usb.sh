#!/usr/bin/env bash
# رفعِ خطای «Access denied» پرینتر USB روی لینوکس.
# نصبِ libusb + ساختِ قانون udev برای دسترسیِ بدون‌روت.
#
# استفاده:
#   ./setup-usb.sh 0x0471 0x0055      # با Vendor و Product ID
#   ./setup-usb.sh                    # بدون آرگومان: با lsusb کمک می‌گیرد
set -euo pipefail

VID="${1:-}"
PID="${2:-}"

echo "→ نصب libusb …"
if command -v apt >/dev/null 2>&1; then
  sudo apt update -y && sudo apt install -y libusb-1.0-0
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y libusbx
elif command -v pacman >/dev/null 2>&1; then
  sudo pacman -S --noconfirm libusb
else
  echo "  ⚠ مدیر بستهٔ شناخته‌شده‌ای پیدا نشد؛ libusb-1.0 را دستی نصب کنید."
fi

if [[ -z "$VID" || -z "$PID" ]]; then
  echo
  echo "→ دستگاه‌های USB متصل (خطی مثل 'ID 0471:0055' را پیدا کنید):"
  lsusb || true
  echo
  read -rp "Vendor ID (مثلاً 0x0471): " VID
  read -rp "Product ID (مثلاً 0x0055): " PID
fi

# نرمال‌سازی به چهاررقمِ هگزِ کوچک، بدونِ 0x
norm() { local s="${1,,}"; s="${s#0x}"; printf "%04x" "$((16#$s))"; }
V="$(norm "$VID")"
P="$(norm "$PID")"

RULE="SUBSYSTEM==\"usb\", ATTRS{idVendor}==\"$V\", ATTRS{idProduct}==\"$P\", MODE=\"0666\""
echo
echo "→ نوشتنِ قانون udev:"
echo "  $RULE"
echo "$RULE" | sudo tee /etc/udev/rules.d/99-escpos.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger

echo
echo "✅ انجام شد. حالا پرینتر را یک‌بار جدا و دوباره وصل کنید، سپس ایجنت را اجرا کنید."
echo "   اگر بازهم 'Resource busy' دیدید:  sudo modprobe -r usblp"
