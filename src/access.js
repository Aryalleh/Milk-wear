// دسترسی داینامیکِ نقش‌ها به صفحات (قابل تنظیم توسط مدیر در «تنظیمات ← دسترسی نقش‌ها»)
import { getSettings } from './print.js';

// همهٔ صفحات کارمندی
export const ALL_PAGES = ['dashboard', 'operations', 'orders', 'production', 'inventory', 'reports', 'settings'];
// پیش‌فرض برای نقش‌هایی که در تنظیمات مشخص نشده‌اند (همه‌چیز جز تنظیمات)
const DEFAULT_NONADMIN = ['dashboard', 'operations', 'orders', 'production', 'inventory', 'reports'];
// پیش‌فرضِ نقشِ کارگر/راننده: فروش + تحویل شیر + بردن بار
export const DEFAULT_ROLE_PAGES = { driver: ['operations', 'orders'] };

// فهرست صفحاتِ مجاز برای یک نقش
export async function pagesForRole(role) {
  if (role === 'admin') return ALL_PAGES;
  const s = await getSettings();
  const map = (s.role_pages && typeof s.role_pages === 'object') ? s.role_pages : {};
  if (Array.isArray(map[role])) return map[role].filter((p) => ALL_PAGES.includes(p));
  if (Array.isArray(DEFAULT_ROLE_PAGES[role])) return DEFAULT_ROLE_PAGES[role];
  return DEFAULT_NONADMIN;
}

// آیا این نقش می‌تواند سفارشِ ارسالی (تحویل با راننده) ثبت کند؟ کارگر/راننده نمی‌تواند.
export function canCreateDelivery(role) {
  return role !== 'driver';
}
