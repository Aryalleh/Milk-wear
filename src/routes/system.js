// به‌روزرسانیِ برنامه از داخلِ اپ (فقط مدیر): git pull + npm install + مایگریشن + ری‌استارت.
// دستورها ثابت‌اند و هیچ ورودیِ کاربری در آن‌ها تزریق نمی‌شود.
import { Router } from 'express';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireRole } from '../auth.js';
import { wrap } from '../util.js';

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

export default router;
