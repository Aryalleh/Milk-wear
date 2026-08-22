import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { AppError, wrap } from '../util.js';

const router = Router();

// شکل یکسان خروجی کاربر برای login و me
function userPayload(u) {
  return { id: u.uid, name: u.name, role: u.role, branch_id: u.branch, branch_name: u.branch_name };
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
