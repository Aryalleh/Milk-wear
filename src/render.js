// رندر HTML به PNG با کروم بی‌سر (یک نمونهٔ مرورگر که بازاستفاده می‌شود)
import { RENDER_TOKEN } from './internal.js';

const PORT = process.env.PORT || 3000;
let _browser = null;
let _launching = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  if (_launching) return _launching;
  _launching = (async () => {
    const pp = (await import('puppeteer')).default;
    _browser = await pp.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    _browser.on('disconnected', () => { _browser = null; });
    _launching = null;
    return _browser;
  })();
  return _launching;
}

// HTML خودبسنده → بافر PNG (عرض ثابت، ارتفاع بر اساس محتوا)
export async function renderHtmlToPng(html, width = 576) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height: 100, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    // فرصت کوتاه برای اعمال فونت
    await new Promise((r) => setTimeout(r, 80));
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await page.close();
  }
}

// رندرِ عیناً یک صفحهٔ واقعیِ برنامه (با دسترسی داخلی) → PNG از یک المان
// pathAndQuery مثل: /statement.html?person_id=1  |  selector مثل: #receipt
export async function renderElementToPng(pathAndQuery, selector, { scale = 2, width = 576 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'x-internal-render': RENDER_TOKEN });
    // عرضِ viewport = عرضِ کاغذ ۸۰م‌م تا نسبت‌ها درست بمانند (print media = width:100%)
    await page.setViewport({ width, height: 100, deviceScaleFactor: scale });
    await page.emulateMediaType('print');   // نسخهٔ چاپِ همان صفحه (سیاه‌سفید)
    await page.goto(`http://127.0.0.1:${PORT}${pathAndQuery}`, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 200));
    const el = selector ? await page.$(selector) : null;
    if (el) return await el.screenshot({ type: 'png' });
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch {} _browser = null; }
}
