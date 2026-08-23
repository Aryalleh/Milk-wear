import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, withTx } from '../db.js';
import { recomputeBalance } from '../ledger.js';
import { AppError, wrap, toJalaliDate } from '../util.js';

const router = Router();

// لیست/جستجوی اشخاص همراه با مانده زنده
router.get('/', wrap(async (req, res) => {
  const { q, type } = req.query;
  const params = [];
  let sql = `
    SELECT p.id, p.person_code, p.fullname, p.mobile, p.is_active,
           COALESCE(b.current_balance,0) AS balance,
           COALESCE(b.status,'settled') AS status
      FROM persons p
      LEFT JOIN account_balances b ON b.person_id = p.id`;
  const where = ['p.deleted_at IS NULL'];
  if (q) { where.push('(p.fullname LIKE ? OR p.mobile LIKE ? OR p.person_code LIKE ?)');
           params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (type) {
    sql += ` JOIN person_roles pr ON pr.person_id = p.id
             JOIN person_types pt ON pt.id = pr.person_type_id AND pt.\`key\` = ?`;
    params.push(type);
  }
  sql += ` WHERE ${where.join(' AND ')} ORDER BY p.fullname LIMIT 200`;
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

// ایجاد شخص (با نقش‌ها)
router.post('/', wrap(async (req, res) => {
  const { person_code, fullname, national_code, mobile, address, credit_limit, roles = [], username, password } = req.body;
  if (!fullname) throw new AppError(400, 'نام لازم است');
  const code = person_code || `P${Date.now().toString().slice(-8)}`;
  const passHash = password ? await bcrypt.hash(password, 10) : null;
  if (username) {
    const [[dup]] = await pool.query('SELECT id FROM persons WHERE username = ?', [username]);
    if (dup) throw new AppError(409, 'این نام کاربری قبلاً ثبت شده');
  }

  const id = await withTx(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO persons (person_code, username, password_hash, fullname, national_code, mobile, address, credit_limit)
       VALUES (?,?,?,?,?,?,?,?)`,
      [code, username || null, passHash, fullname, national_code || null, mobile || null, address || null, credit_limit || null]
    );
    const pid = r.insertId;
    for (const key of roles) {
      await conn.query(
        `INSERT IGNORE INTO person_roles (person_id, person_type_id)
         SELECT ?, id FROM person_types WHERE \`key\` = ?`, [pid, key]
      );
    }
    await recomputeBalance(conn, pid);
    return pid;
  });
  res.status(201).json({ id, person_code: code });
}));

// داشبورد خلاصهٔ شخص (کارت بالای صفحه)
router.get('/:id/dashboard', wrap(async (req, res) => {
  const { id } = req.params;
  const [[person]] = await pool.query(
    `SELECT p.*, GROUP_CONCAT(pt.\`key\`) AS role_keys
       FROM persons p
       LEFT JOIN person_roles pr ON pr.person_id = p.id
       LEFT JOIN person_types pt ON pt.id = pr.person_type_id
      WHERE p.id = ? GROUP BY p.id`, [id]);
  if (!person) throw new AppError(404, 'شخص یافت نشد');

  const [[bal]] = await pool.query('SELECT * FROM account_balances WHERE person_id = ?', [id]);
  const b = bal || { current_balance: 0, status: 'settled' };

  const daysSince = b.last_settlement_at
    ? Math.floor((Date.now() - new Date(b.last_settlement_at)) / 86400000)
    : null;

  res.json({
    person: {
      id: person.id, code: person.person_code, fullname: person.fullname,
      mobile: person.mobile, credit_limit: person.credit_limit,
      roles: person.role_keys ? person.role_keys.split(',') : [],
    },
    balance: {
      current_balance: Number(b.current_balance),
      payable_now: Number(b.current_balance) > 0 ? Number(b.current_balance) : 0,
      receivable_now: Number(b.current_balance) < 0 ? -Number(b.current_balance) : 0,
      milk_kg_month: Number(b.milk_kg_month || 0),
      milk_value_month: Number(b.milk_value_month || 0),
      purchases_total: Number(b.purchases_total || 0),
      cash_withdrawal_total: Number(b.cash_withdrawal_total || 0),
      payments_total: Number(b.payments_total || 0),
      last_payment_at: b.last_payment_at,
      last_order_at: b.last_order_at,
      days_since_settlement: daysSince,
      status: b.status,
    },
  });
}));

// گردش حساب (دفتر) با مانده رونده — قلب سیستم
router.get('/:id/ledger', wrap(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT t.id, t.tx_date, t.tx_type, t.description, t.direction, t.amount, t.status,
            SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END)
              OVER (ORDER BY t.tx_date, t.id) AS running_balance
       FROM transactions t
      WHERE t.person_id = ? AND t.status='active'
      ORDER BY t.tx_date, t.id`, [id]);
  res.json(rows.map((r) => ({
    id: r.id,
    date: r.tx_date,
    date_jalali: toJalaliDate(r.tx_date),
    type: r.tx_type,
    description: r.description,
    debit: r.direction === 'debit' ? Number(r.amount) : 0,
    credit: r.direction === 'credit' ? Number(r.amount) : 0,
    balance: Number(r.running_balance),
  })));
}));

export default router;
