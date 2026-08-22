import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { requireRole } from '../auth.js';
import { AppError, wrap } from '../util.js';

const router = Router();

// لیست سایت‌ها (همه کاربران) — همراه با آمار خلاصه
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM warehouses w WHERE w.branch_id=b.id) AS warehouse_count,
            (SELECT COUNT(*) FROM users u WHERE u.branch_id=b.id AND u.is_active=1) AS user_count
       FROM branches b ORDER BY b.id`);
  res.json(rows);
}));

// تعریف سایت جدید (فقط ادمین اصلی) — به‌همراه ساخت خودکار انبار سایت
router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const { code, name, type = 'station', address, phone } = req.body;
  if (!code || !name) throw new AppError(400, 'کد و نام سایت لازم است');

  const id = await withTx(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO branches (code, name, type, address, phone) VALUES (?,?,?,?,?)`,
      [code, name, type, address || null, phone || null]
    );
    // هر سایت جمع‌آوری یک انبار پیش‌فرض دارد (برای خروج خوراک/کالا)
    const whType = type === 'store' ? 'store' : type === 'distribution' ? 'distribution' : 'station';
    await conn.query(
      `INSERT INTO warehouses (branch_id, name, type) VALUES (?,?,?)`,
      [r.insertId, `انبار ${name}`, whType]
    );
    return r.insertId;
  });
  res.status(201).json({ id });
}));

// ویرایش سایت (فقط ادمین اصلی)
router.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const { name, type, address, phone, is_active } = req.body;
  const [r] = await pool.query(
    `UPDATE branches SET
       name = COALESCE(?, name), type = COALESCE(?, type),
       address = COALESCE(?, address), phone = COALESCE(?, phone),
       is_active = COALESCE(?, is_active)
     WHERE id = ?`,
    [name ?? null, type ?? null, address ?? null, phone ?? null,
     is_active ?? null, req.params.id]
  );
  if (!r.affectedRows) throw new AppError(404, 'سایت یافت نشد');
  res.json({ ok: true });
}));

// انبارهای یک سایت
router.get('/:id/warehouses', wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM warehouses WHERE branch_id = ? AND is_active = 1', [req.params.id]);
  res.json(rows);
}));

export default router;
