// ارتباط با Bot API بله برای ارسال پیام/اطلاع‌رسانی به کاربران
import { renderUrlToPdf } from './pdf.js';
const API = 'https://tapi.bale.ai/bot';

// ارسال سند (PDF) با کپشن
export async function baleSendDocument(chatId, buffer, filename, caption) {
  const token = process.env.BALE_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, skipped: true };
  try {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    if (caption) fd.append('caption', caption);
    fd.append('document', new Blob([buffer], { type: 'application/pdf' }), filename);
    const r = await fetch(`${API}${token}/sendDocument`, { method: 'POST', body: fd });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ارسال پیام متنی به یک کاربر بله (chat_id = شناسهٔ کاربر بله)
export async function baleSendMessage(chatId, text, replyMarkup = null) {
  const token = process.env.BALE_BOT_TOKEN;
  if (!token || !chatId) return { ok: false, skipped: true };
  try {
    const r = await fetch(`${API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup || undefined }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// لینک رنگیِ فاکتور (نمایش با توکن هش‌شده) — قابل باز شدن داخل بله
export function receiptColorLink(token) {
  const base = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  return token && base ? `${base}/r/${token}` : null;
}

// اطلاع‌رسانی فاکتور به شخص در بله + لینک فاکتور رنگی
export async function notifyReceipt(person, receipt) {
  if (!person?.bale_user_id) return { ok: false, skipped: true };
  const fmt = (n) => Number(n || 0).toLocaleString('fa-IR');
  const lines = [
    `🧾 فاکتور جدید برای شما ثبت شد`,
    `شماره: ${receipt.receipt_no}`,
  ];
  if (Number(receipt.milk_amount) > 0) lines.push(`بستانکار شیر: ${fmt(receipt.milk_amount)} ریال`);
  if (Number(receipt.purchase_amount) > 0) lines.push(`بدهکار خرید: ${fmt(receipt.purchase_amount)} ریال`);
  lines.push(`مانده کل حساب: ${fmt(Math.abs(receipt.balance_after))} ${receipt.balance_after >= 0 ? '(بستانکار)' : '(بدهکار)'}`);

  const link = receiptColorLink(receipt.public_token);
  const base = (process.env.APP_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');

  // ۱) تلاش برای ارسال PDF رنگی با کپشن لینک
  if (receipt.public_token) {
    try {
      const pdf = await renderUrlToPdf(`${base}/r/${receipt.public_token}`);
      const cap = `🧾 فاکتور ${receipt.receipt_no}` + (link ? `\n📄 لینک: ${link}` : '');
      const res = await baleSendDocument(person.bale_user_id, pdf, `receipt-${receipt.receipt_no}.pdf`, cap);
      if (res && res.ok) return res;
    } catch { /* اگر Chrome/رندر نبود → پیام متنی */ }
  }

  // ۲) fallback: پیام متنی + لینک رنگی
  if (link) lines.push(`\n📄 مشاهدهٔ فاکتور رنگی:\n${link}`);
  const markup = link ? { inline_keyboard: [[{ text: '📄 مشاهدهٔ فاکتور رنگی', url: link }]] } : null;
  return baleSendMessage(person.bale_user_id, lines.join('\n'), markup);
}
