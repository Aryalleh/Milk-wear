// رندر یک URL به PDF رنگی با puppeteer (نیازمند Chrome روی سرور)
// روی سرور واقعی یک‌بار: npx puppeteer browsers install chrome
export async function renderUrlToPdf(url) {
  const pp = (await import('puppeteer')).default;
  const browser = await pp.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.emulateMediaType('screen');   // نسخهٔ رنگی (نه حالت چاپ سیاه‌سفید)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));   // فرصت رندر QR/فونت
    return await page.pdf({ printBackground: true, width: '80mm', height: '300mm', margin: { top: '4mm', bottom: '4mm', left: '2mm', right: '2mm' } });
  } finally {
    await browser.close();
  }
}
