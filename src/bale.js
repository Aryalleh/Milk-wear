// ارتباط با Bot API بله برای ارسال پیام/اطلاع‌رسانی به کاربران
const API = 'https://tapi.bale.ai/bot';

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

// دیپ‌لینک باز کردن فاکتور در مینی‌اپ بله
export function receiptDeepLink(receiptId) {
  const bot = process.env.BALE_BOT_USERNAME;
  if (!bot) return null;
  return `https://ble.ir/${bot}?startapp=receipt_${receiptId}`;
}

// اطلاع‌رسانی فاکتور به شخص در بله (متن خلاصه + لینک مشاهده/چاپ)
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

  const link = receiptDeepLink(receipt.id);
  const markup = link ? { inline_keyboard: [[{ text: '📄 مشاهده و چاپ فاکتور', web_app: { url: link } }]] } : null;

  return baleSendMessage(person.bale_user_id, lines.join('\n'), markup);
}
