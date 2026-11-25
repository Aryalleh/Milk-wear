// واحد پولِ نمایش: همهٔ مبالغ در دیتابیس «ریال» ذخیره می‌شوند؛ این تنظیم فقط نمایش و ورودی را عوض می‌کند.
//  تنظیم: settings.currency = 'rial' | 'toman'  (در «تنظیمات ← عمومی»)
import { getSettings } from './print.js';

let cache = { v: 'rial', at: 0 };
export async function getCurrency() {
  if (Date.now() - cache.at < 10000) return cache.v;
  const s = await getSettings();
  cache = { v: s.currency === 'toman' ? 'toman' : 'rial', at: Date.now() };
  return cache.v;
}
export function clearCurrencyCache() { cache.at = 0; }
export const curLabel = (c) => (c === 'toman' ? 'تومان' : 'ریال');
// مبلغِ ریالی → عددِ قابل‌نمایش در واحدِ انتخابی
export const inCur = (rial, c) => (c === 'toman' ? Math.round(Number(rial || 0) / 10) : Number(rial || 0));
export const fmtMoney = (rial, c) => inCur(rial, c).toLocaleString('fa-IR');
