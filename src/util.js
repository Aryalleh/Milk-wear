import jalaali from 'jalaali-js';

// ماه شمسی جاری به شکل 1405-05
export function currentJalaliMonth(date = new Date()) {
  const { jy, jm } = jalaali.toJalaali(date);
  return `${jy}-${String(jm).padStart(2, '0')}`;
}

// تبدیل تاریخ میلادی به رشتهٔ شمسی برای نمایش
export function toJalaliDate(date) {
  const d = new Date(date);
  const { jy, jm, jd } = jalaali.toJalaali(d);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

// خطای برنامه‌ای با کد وضعیت HTTP
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// wrapper برای هندلرهای async اکسپرس
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
