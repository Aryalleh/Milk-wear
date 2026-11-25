// به‌روزرسانیِ برنامه از داخلِ اپ (فقط مدیر): git pull + npm install + مایگریشن + ری‌استارت.
// دستورها ثابت‌اند و هیچ ورودیِ کاربری در آن‌ها تزریق نمی‌شود.
import { Router } from 'express';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireRole } from '../auth.js';
import { wrap, AppError } from '../util.js';
import { pool, withTx } from '../db.js';
import { getSettings, setSetting } from '../print.js';
import { clearCurrencyCache } from '../currency.js';
import { SCOPES, DEFAULT_SCOPES, previewMigration, runMigration } from '../rialMigration.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRANCH = process.env.APP_BRANCH || 'main';
const SERVICE = process.env.APP_SERVICE || 'milk-wear';

const router = Router();
router.use(requireRole('admin'));

async function sh(cmd, args) {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd: ROOT, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: ((stdout || '') + (stderr || '')).trim() };
  } catch (e) {
    return { ok: false, out: ((e.stdout || '') + (e.stderr || '') + '\n' + (e.message || '')).trim() };
  }
}

// نسخهٔ فعلی + بررسیِ وجودِ به‌روزرسانی
router.get('/version', wrap(async (req, res) => {
  const cur = await sh('git', ['log', '-1', '--format=%h — %s', '--date=short']);
  await sh('git', ['fetch', 'origin', BRANCH]);
  const behind = await sh('git', ['rev-list', '--count', `HEAD..origin/${BRANCH}`]);
  const latest = await sh('git', ['log', '-1', `origin/${BRANCH}`, '--format=%h — %s']);
  res.json({
    branch: BRANCH,
    current: cur.ok ? cur.out : '؟',
    latest: latest.ok ? latest.out : '؟',
    behind: Number((behind.out || '0').trim()) || 0,
  });
}));

// اجرای به‌روزرسانی
router.post('/update', wrap(async (req, res) => {
  const log = [];
  const steps = [
    ['git pull', 'git', ['pull', 'origin', BRANCH]],
    ['npm install', 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund']],
    ['db:migrate', 'npm', ['run', 'db:migrate']],
  ];
  for (const [label, cmd, args] of steps) {
    const r = await sh(cmd, args);
    log.push(`$ ${label}\n${r.out}`);
    if (!r.ok) return res.status(500).json({ ok: false, step: label, log: log.join('\n\n') });
  }

  // تلاش برای ری‌استارتِ خودکار پس از ارسالِ پاسخ (نیازمندِ قانونِ sudo برای systemctl)
  let restart = 'manual';
  res.json({
    ok: true, log: log.join('\n\n'), restart,
    note: 'به‌روزرسانی انجام شد. اگر برنامه خودش ری‌استارت نشد، سرویس را یک‌بار دستی ری‌استارت کنید.',
  });
  setTimeout(() => {
    try {
      const p = spawn('sudo', ['-n', 'systemctl', 'restart', SERVICE], { detached: true, stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
    } catch { /* اگر نشد، کدِ جدید با ری‌استارتِ دستی اعمال می‌شود */ }
  }, 700);
}));

// ---- تبدیلِ یک‌بارهٔ تومان → ریال (داده‌هایی که به خیالِ تومان ثبت شده‌اند) ----
const pickScopes = (b) => { const s = Array.isArray(b?.scopes) ? b.scopes.filter((k) => SCOPES[k]) : DEFAULT_SCOPES; return s.length ? s : DEFAULT_SCOPES; };
router.get('/rial-migration', wrap(async (req, res) => {
  const st = await getSettings();
  res.json({ done: st.rial_migration_done || null, scopes: SCOPES, defaults: DEFAULT_SCOPES });
}));
router.post('/rial-migration/preview', wrap(async (req, res) => {
  const conn = await pool.getConnection();
  try { res.json(await previewMigration(conn, pickScopes(req.body))); } finally { conn.release(); }
}));
router.post('/rial-migration/run', wrap(async (req, res) => {
  if (req.body?.confirm !== 'تبدیل') throw new AppError(400, 'برای اجرا عبارتِ «تبدیل» را تأیید کنید');
  const scopes = pickScopes(req.body);
  // قفلِ سراسری تا بعد از commit نگه داشته می‌شود → دو اجرای هم‌زمان ممکن نیست؛ پرچمِ «انجام‌شده» داخلِ همان تراکنش است
  const lockConn = await pool.getConnection();
  let counts;
  try {
    const [[l]] = await lockConn.query("SELECT GET_LOCK('mw_rial_migration', 30) AS ok");
    if (!Number(l.ok)) throw new AppError(409, 'تبدیل در حال اجراست؛ کمی بعد دوباره امتحان کنید');
    counts = await withTx(async (conn) => {
      const [[done]] = await conn.query("SELECT id FROM settings WHERE scope='global' AND `key`='rial_migration_done'");
      if (done) throw new AppError(409, 'این تبدیل قبلاً یک‌بار انجام شده است و دوباره اجرا نمی‌شود');
      const n = await runMigration(conn, scopes);
      await conn.query("INSERT INTO settings (scope, scope_id, `key`, value_json) VALUES ('global', NULL, 'rial_migration_done', ?)",
        [JSON.stringify({ at: new Date().toISOString(), scopes, counts: n, by: req.user?.uid || null })]);
      await conn.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, new_json, user_id, reason)
         VALUES ('settings', NULL, 'rial_migration', ?, ?, 'تبدیل یک‌بارهٔ تومان به ریال')`,
        [JSON.stringify({ scopes, counts: n }), req.user?.uid || null]);
      return n;
    });
  } finally {
    await lockConn.query("SELECT RELEASE_LOCK('mw_rial_migration')").catch(() => {});
    lockConn.release();
  }
  if (req.body?.set_toman) { await setSetting('currency', 'toman'); clearCurrencyCache(); }
  res.json({ ok: true, scopes, counts });
}));

export default router;
