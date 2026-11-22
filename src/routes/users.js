import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { AppError, wrap } from '../util.js';

const router = Router();
router.use(requireRole('admin'));   // مدیریت کاربران فقط برای ادمین اصلی

// لیست کاربران سایت‌ها
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.fullname, u.username, u.mobile, u.is_active,
            u.bale_user_id, u.bale_username,
            r.name AS role, r.title AS role_title,
            b.name AS branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.deleted_at IS NULL
      ORDER BY u.id`);
  res.json(rows);
}));

// آیا این کاربر در سوابق (تراکنش/شیر/پرداخت/سفارش/فاکتور) استفاده شده؟
async function userReferenced(id) {
  for (const t of ['transactions', 'milk_deliveries', 'payments', 'orders', 'receipts']) {
    const [[r]] = await pool.query(`SELECT COUNT(*) c FROM \`${t}\` WHERE created_by = ?`, [id]);
    if (r.c > 0) return true;
  }
  return false;
}

// حذف کاربر — اگر در سوابق استفاده شده باشد حذفِ نرم (غیرفعال + مخفی)، وگرنه حذفِ کامل
router.delete('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.uid) throw new AppError(400, 'نمی‌توانید حساب خودتان را حذف کنید');

  const [[u]] = await pool.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!u) throw new AppError(404, 'کاربر یافت نشد');
  if (String(u.username||'').toLowerCase() === 'aryalleh') throw new AppError(400, 'کاربرِ پشتیبان قابل حذف نیست');

  // جلوگیری از حذفِ آخرین مدیرِ فعال (قفل‌شدنِ سیستم)
  const [[adminRole]] = await pool.query("SELECT id FROM roles WHERE name = 'admin'");
  if (adminRole && u.role_id === adminRole.id) {
    const [[cnt]] = await pool.query(
      'SELECT COUNT(*) c FROM users WHERE role_id = ? AND is_active = 1 AND deleted_at IS NULL AND id <> ?',
      [adminRole.id, id]);
    if (cnt.c === 0) throw new AppError(400, 'آخرین مدیرِ فعال قابل حذف نیست');
  }

  const referenced = await userReferenced(id);
  if (referenced) {
    // حذفِ نرم: غیرفعال، مخفی، و آزادسازیِ نام کاربری برای استفادهٔ مجدد
    await pool.query(
      "UPDATE users SET is_active = 0, deleted_at = NOW(), username = CONCAT('del', id, '_', LEFT(username, 40)) WHERE id = ?",
      [id]);
  } else {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
  }
  await pool.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, old_json, user_id, reason)
     VALUES ('users', ?, 'delete', ?, ?, ?)`,
    [id, JSON.stringify({ id: u.id, username: u.username, fullname: u.fullname, role_id: u.role_id }),
     req.user.uid, req.body?.reason || null]);
  res.json({ ok: true, soft: referenced });
}));

// نقش‌های قابل‌انتخاب
router.get('/roles', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, title FROM roles ORDER BY id');
  res.json(rows);
}));

// ساخت کاربر برای یک سایت (مثلاً مسئول ایستگاه)
router.post('/', wrap(async (req, res) => {
  const { fullname, username, password, role, branch_id, mobile, bale_user_id } = req.body;
  if (!fullname || !username || !password || !role)
    throw new AppError(400, 'نام، نام‌کاربری، رمز و نقش لازم است');

  const [[roleRow]] = await pool.query('SELECT id FROM roles WHERE name = ?', [role]);
  if (!roleRow) throw new AppError(400, 'نقش نامعتبر');

  const [[dup]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (dup) throw new AppError(409, 'این نام کاربری قبلاً ثبت شده');

  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query(
    `INSERT INTO users (branch_id, fullname, username, password_hash, role_id, mobile, bale_user_id)
     VALUES (?,?,?,?,?,?,?)`,
    [branch_id || null, fullname, username, hash, roleRow.id, mobile || null, bale_user_id || null]
  );
  res.status(201).json({ id: r.insertId });
}));

// بازنشانیِ رمزِ کاربر (فقط مدیر)
router.put('/:id/password', wrap(async (req, res) => {
  const { password } = req.body;
  if (!password || String(password).length < 4) throw new AppError(400, 'رمز باید حداقل ۴ کاراکتر باشد');
  const hash = await bcrypt.hash(String(password), 10);
  const [r] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL', [hash, req.params.id]);
  if (!r.affectedRows) throw new AppError(404, 'کاربر یافت نشد');
  await pool.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, reason)
     VALUES ('users', ?, 'password_reset', ?, 'بازنشانی رمز')`, [req.params.id, req.user?.uid || null]);
  res.json({ ok: true });
}));

// اتصال/تغییر شناسهٔ بله یک کاربر موجود (برای لاگین خودکار مینی‌اپ)
router.put('/:id/bale', wrap(async (req, res) => {
  const { bale_user_id } = req.body;
  const [r] = await pool.query(
    'UPDATE users SET bale_user_id = ? WHERE id = ?',
    [bale_user_id || null, req.params.id]
  );
  if (!r.affectedRows) throw new AppError(404, 'کاربر یافت نشد');
  res.json({ ok: true });
}));

export default router;
