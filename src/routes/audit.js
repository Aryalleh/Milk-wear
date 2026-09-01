// مشاهدهٔ لاگ تغییرات — فقط ادمین
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { wrap, toJalaliDate } from '../util.js';

const router = Router();
router.use(requireRole('admin'));

// شرح خواناى رويداد از روى مسير و متد
function describe(resource, path, method, id) {
  const p = path || '';
  const M = { POST: 'ثبت', PUT: 'ویرایش', PATCH: 'ویرایش', DELETE: 'حذف' }[method] || method;
  if (/\/orders\/\d+\/deliver/.test(p)) return `تحویل سفارش #${id}`;
  if (/\/orders\/\d+\/status/.test(p)) return `تغییر وضعیت سفارش #${id}`;
  if (/\/orders\/\d+\/edit/.test(p)) return `ویرایش سفارش #${id}`;
  if (/\/orders\b/.test(p) && method === 'POST') return 'ثبت سفارش/فروش';
  if (/\/receipts\b/.test(p) && method === 'POST') return 'ثبت فاکتور';
  if (/\/production\b/.test(p) && method === 'POST') return 'ثبت بچ تولید';
  if (/\/milk\b/.test(p) && method === 'POST') return 'ثبت تحویل شیر';
  if (/\/payments\b/.test(p) && method === 'POST') return 'ثبت پرداخت/دریافت';
  if (/\/expenses\/templates/.test(p)) return `${M} قالب هزینه`;
  if (/\/expenses\b/.test(p)) return `${M} هزینه`;
  if (/\/reports\/months\/.*\/close/.test(p)) return 'بستن ماه';
  if (/\/reports\/months\/.*\/reopen/.test(p)) return 'بازگشایی ماه';
  if (/\/persons\b/.test(p)) return `${M} شخص`;
  if (/\/users\b/.test(p)) return `${M} کاربر`;
  if (/\/products\b/.test(p)) return `${M} کالا`;
  if (/\/inventory\b/.test(p)) return `${M} انبار`;
  if (/\/branches\b/.test(p)) return `${M} سایت`;
  if (/\/settings\b/.test(p)) return 'تغییر تنظیمات';
  if (/\/print\b/.test(p)) return 'ارسال به چاپ';
  if (/\/submissions\b/.test(p)) return `${M} فاکتور مشتری`;
  const RES_FA = { persons: 'شخص', users: 'کاربر', orders: 'سفارش', receipts: 'فاکتور', payments: 'پرداخت', products: 'کالا' };
  return `${M} ${RES_FA[resource] || resource || ''}`.trim();
}

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
      label: describe(r.entity_type, d.path || r.reason, r.action, r.entity_id),
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
