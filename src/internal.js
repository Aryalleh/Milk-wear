// توکن رندرِ داخلی: به سرور اجازه می‌دهد صفحات واقعیِ HTML را با کروم بی‌سر
// و با دسترسی مدیر رندر کند (برای چاپِ عیناً همان فایل‌های HTML توسط ایجنت).
import crypto from 'crypto';

export const RENDER_TOKEN = process.env.RENDER_TOKEN || crypto.randomBytes(24).toString('hex');
