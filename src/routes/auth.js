import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { AppError, wrap } from '../util.js';

const router = Router();

// شکل یکسان خروجی کاربر برای login و me
function userPayload(u) {
  return {
    kind: u.kind, id: u.uid, person_id: u.person_id, name: u.name,
    role: u.role, branch_id: u.branch, branch_name: u.branch_name,
  };
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

  // ۱) کاربر کارمند
  const [[user]] = await pool.query(
    `SELECT u.*, r.name AS role_name, b.name AS branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.username = ? AND u.is_active = 1`,
    [username]
  );
  if (user) {
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new AppError(401, 'نام کاربری یا رمز اشتباه است');
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    req.session.user = {
      kind: 'staff', uid: user.id, role: user.role_name, branch: user.branch_id,
      branch_name: user.branch_name, name: user.fullname,
    };
    return res.json({ user: userPayload(req.session.user) });
  }

  // ۲) شخص (دامدار/مشتری) با لاگین اختصاصی
  const [[person]] = await pool.query(
    `SELECT p.*, GROUP_CONCAT(pt.\`key\`) AS role_keys
       FROM persons p
       LEFT JOIN person_roles pr ON pr.person_id = p.id
       LEFT JOIN person_types pt ON pt.id = pr.person_type_id
      WHERE p.username = ? AND p.deleted_at IS NULL GROUP BY p.id`,
    [username]
  );
  if (!person || !person.password_hash) throw new AppError(401, 'نام کاربری یا رمز اشتباه است');
  const okP = await bcrypt.compare(password, person.password_hash);
  if (!okP) throw new AppError(401, 'نام کاربری یا رمز اشتباه است');

  const roles = (person.role_keys || 'customer').split(',');
  req.session.user = {
    kind: 'person', person_id: person.id, role: roles.includes('farmer') ? 'farmer' : 'customer',
    name: person.fullname, branch: null, branch_name: null,
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

  // ۱) اتصال به حساب کارمند → ورود کارمندی
  const [[staff]] = await pool.query(
    `SELECT u.*, r.name AS role_name, b.name AS branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.bale_user_id = ? AND u.is_active = 1`,
    [bale.id]
  );
  if (staff) {
    await pool.query('UPDATE users SET bale_username = ?, last_login_at = NOW() WHERE id = ?',
      [bale.username || null, staff.id]);
    req.session.user = {
      kind: 'staff', uid: staff.id, role: staff.role_name, branch: staff.branch_id,
      branch_name: staff.branch_name, name: staff.fullname,
    };
    return res.json({ user: userPayload(req.session.user) });
  }

  // ۲) اتصال به یک شخص (دامدار/مشتری) → پنل شخصی
  let [[person]] = await pool.query(
    `SELECT p.*, GROUP_CONCAT(pt.\`key\`) AS role_keys
       FROM persons p
       LEFT JOIN person_roles pr ON pr.person_id = p.id
       LEFT JOIN person_types pt ON pt.id = pr.person_type_id
      WHERE p.bale_user_id = ? AND p.deleted_at IS NULL
      GROUP BY p.id`,
    [bale.id]
  );

  // ۳) کاربر بلهِ ناشناس → ساخت خودکار «مشتری» و اتصال به بله
  if (!person) {
    const code = `C${Date.now().toString().slice(-8)}`;
    const [ins] = await pool.query(
      `INSERT INTO persons (person_code, fullname, bale_user_id, bale_username) VALUES (?,?,?,?)`,
      [code, bale.first_name || `کاربر ${bale.id}`, bale.id, bale.username || null]);
    await pool.query(
      `INSERT IGNORE INTO person_roles (person_id, person_type_id)
       SELECT ?, id FROM person_types WHERE \`key\` = 'customer'`, [ins.insertId]);
    person = { id: ins.insertId, fullname: bale.first_name || `کاربر ${bale.id}`, role_keys: 'customer' };
  } else {
    await pool.query('UPDATE persons SET bale_username = ? WHERE id = ?',
      [bale.username || null, person.id]);
  }

  const roles = (person.role_keys || 'customer').split(',');
  const primaryRole = roles.includes('farmer') ? 'farmer' : 'customer';
  req.session.user = {
    kind: 'person', person_id: person.id, role: primaryRole,
    name: person.fullname, branch: null, branch_name: null,
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
