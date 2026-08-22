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
            r.name AS role, r.title AS role_title,
            b.name AS branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
      ORDER BY u.id`);
  res.json(rows);
}));

// نقش‌های قابل‌انتخاب
router.get('/roles', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, title FROM roles ORDER BY id');
  res.json(rows);
}));

// ساخت کاربر برای یک سایت (مثلاً مسئول ایستگاه)
router.post('/', wrap(async (req, res) => {
  const { fullname, username, password, role, branch_id, mobile } = req.body;
  if (!fullname || !username || !password || !role)
    throw new AppError(400, 'نام، نام‌کاربری، رمز و نقش لازم است');

  const [[roleRow]] = await pool.query('SELECT id FROM roles WHERE name = ?', [role]);
  if (!roleRow) throw new AppError(400, 'نقش نامعتبر');

  const [[dup]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (dup) throw new AppError(409, 'این نام کاربری قبلاً ثبت شده');

  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query(
    `INSERT INTO users (branch_id, fullname, username, password_hash, role_id, mobile)
     VALUES (?,?,?,?,?,?)`,
    [branch_id || null, fullname, username, hash, roleRow.id, mobile || null]
  );
  res.status(201).json({ id: r.insertId });
}));

export default router;
