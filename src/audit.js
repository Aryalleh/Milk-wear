import { pool } from './db.js';

// فیلدهای حساس که نباید در لاگ ذخیره شوند
const SENSITIVE = ['password', 'password_hash', 'initData', 'token'];

function sanitize(body) {
  if (!body || typeof body !== 'object') return null;
  const clone = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE.includes(k)) clone[k] = '***';
    else if (typeof v === 'string' && v.length > 500) clone[k] = v.slice(0, 500) + '…';
    else clone[k] = v;
  }
  return clone;
}

// میدل‌ور: هر عملیات تغییردهنده را پس از پایان پاسخ در audit_logs ثبت می‌کند
export function auditLogger(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.originalUrl.startsWith('/api/')) return next();

  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    const parts = path.split('/').filter(Boolean);      // ['api','receipts','5','printed']
    const resource = parts[1] || '';
    const idPart = parts.slice(2).find((p) => /^\d+$/.test(p)) || null;

    const u = req.session?.user;
    const actor = u
      ? `${u.name || ''} [${u.kind}${u.kind === 'person' ? ('#' + u.person_id) : (':' + (u.role || ''))}]`
      : 'مهمان';
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0];

    const detail = {
      status: res.statusCode,
      actor,
      path,
      body: sanitize(req.body),
    };

    pool.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_json, user_id, ip, reason)
       VALUES (?,?,?,?,?,?,?)`,
      [resource, idPart, req.method, JSON.stringify(detail),
       u && u.kind === 'staff' ? u.uid : null, ip || null, path]
    ).catch(() => {});   // لاگ نباید هرگز جریان اصلی را مختل کند
  });

  next();
}
