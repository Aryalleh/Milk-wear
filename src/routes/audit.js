// مشاهدهٔ لاگ تغییرات — فقط ادمین
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { wrap, toJalaliDate } from '../util.js';

const router = Router();
router.use(requireRole('admin'));

router.get('/', wrap(async (req, res) => {
  const { q, action } = req.query;
  const where = [], params = [];
  if (q) { where.push('(a.reason LIKE ? OR a.entity_type LIKE ? OR a.new_json LIKE ?)');
           params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (action) { where.push('a.action = ?'); params.push(action); }
  const [rows] = await pool.query(
    `SELECT a.id, a.entity_type, a.entity_id, a.action, a.new_json, a.ip, a.created_at,
            u.fullname AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.id DESC LIMIT 300`, params);

  res.json(rows.map((r) => {
    // ستون JSON را mysql2 خودکار به آبجکت تبدیل می‌کند؛ اگر رشته بود parse کن
    let d = r.new_json;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
    d = d || {};
    return {
      id: r.id,
      when: toJalaliDate(r.created_at) + ' ' + new Date(r.created_at).toTimeString().slice(0, 5),
      actor: r.user_name || d.actor || 'مهمان',
      action: r.action,
      resource: r.entity_type,
      entity_id: r.entity_id,
      path: d.path || r.reason,
      status: d.status,
      body: d.body || null,
      ip: r.ip,
    };
  }));
}));

export default router;
