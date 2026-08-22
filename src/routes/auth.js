import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { AppError, wrap } from '../util.js';

const router = Router();

// شکل یکسان خروجی کاربر برای login و me
function userPayload(u) {
  return { id: u.uid, name: u.name, role: u.role, branch_id: u.branch, branch_name: u.branch_name };
}

// اعتبارسنجی initData دریافت‌شده از مینی‌اپ بله
// طبق مستندات: secret = HMAC_SHA256(bot_token, "WebAppData")؛ hash = HMAC_SHA256(data_check_string, secret)
function validateBaleInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  // مقایسهٔ زمان‌ثابت برای جلوگیری از timing attack
  const ok = computed.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  if (!ok) return null;
  const userRaw = params.get('user');
  return {
    user: userRaw ? JSON.parse(userRaw) : null,
    auth_date: Number(params.get('auth_date') || 0),
  };
}

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) throw new AppError(400, 'نام کاربری و رمز لازم است');

  const [[user]] = await pool.query(
    `SELECT u.*, r.name AS role_name, b.name AS branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.username = ? AND u.is_active = 1`,
    [username]
  );
  if (!user) throw new AppError(401, 'نام کاربری یا رمز اشتباه است');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new AppError(401, 'نام کاربری یا رمز اشتباه است');

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  // ذخیرهٔ کاربر در session سمت سرور
  req.session.user = {
    uid: user.id, role: user.role_name, branch: user.branch_id,
    branch_name: user.branch_name, name: user.fullname,
  };
  res.json({ user: userPayload(req.session.user) });
}));

// لاگین خودکار از داخل مینی‌اپ بله
router.post('/bale', wrap(async (req, res) => {
  const { initData } = req.body;
  const botToken = process.env.BALE_BOT_TOKEN;
  if (!botToken) throw new AppError(500, 'BALE_BOT_TOKEN در سرور تنظیم نشده است');
  if (!initData) throw new AppError(400, 'initData ارسال نشده است');

  const data = validateBaleInitData(initData, botToken);
  if (!data || !data.user) throw new AppError(401, 'اعتبارسنجی داده‌های بله ناموفق بود');

  // جلوگیری از استفادهٔ داده‌های قدیمی (۲۴ ساعت)
  if (data.auth_date && (Date.now() / 1000 - data.auth_date) > 86400)
    throw new AppError(401, 'نشست بله منقضی شده است');

  const bale = data.user;   // { id, first_name, username, ... }

  // اتصال کاربر بله به حساب سیستم
  const [[user]] = await pool.query(
    `SELECT u.*, r.name AS role_name, b.name AS branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.bale_user_id = ? AND u.is_active = 1`,
    [bale.id]
  );
  if (!user) {
    // کاربر بله هنوز به هیچ حسابی متصل نیست؛ شناسه را برمی‌گردانیم تا مدیر متصلش کند
    throw new AppError(403,
      `حساب بله شما (شناسه ${bale.id}) به هیچ کاربری متصل نیست. لطفاً با مدیر تماس بگیرید.`);
  }

  // به‌روزرسانی نام‌کاربری بله و آخرین ورود
  await pool.query(
    'UPDATE users SET bale_username = ?, last_login_at = NOW() WHERE id = ?',
    [bale.username || null, user.id]
  );

  req.session.user = {
    uid: user.id, role: user.role_name, branch: user.branch_id,
    branch_name: user.branch_name, name: user.fullname,
  };
  res.json({ user: userPayload(req.session.user) });
}));

// وضعیت نشست جاری (برای بارگذاری اولیهٔ صفحه)
router.get('/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: userPayload(req.session.user) });
  res.status(401).json({ error: 'ورود لازم است' });
});

// خروج: نابودی session و پاک‌کردن کوکی
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('mw.sid');
    res.json({ ok: true });
  });
});

export default router;
