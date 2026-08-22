import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken } from '../auth.js';
import { AppError, wrap } from '../util.js';

const router = Router();

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) throw new AppError(400, 'نام کاربری و رمز لازم است');

  const [[user]] = await pool.query(
    `SELECT u.*, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = ? AND u.is_active = 1`,
    [username]
  );
  if (!user) throw new AppError(401, 'نام کاربری یا رمز اشتباه است');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new AppError(401, 'نام کاربری یا رمز اشتباه است');

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.fullname, role: user.role_name } });
}));

export default router;
