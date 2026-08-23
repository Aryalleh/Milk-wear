import express from 'express';
import 'dotenv/config';
import session from 'express-session';
import expressMySQLSession from 'express-mysql-session';
import { fileURLToPath } from 'url';
import path from 'path';
import { authRequired, staffRequired } from './auth.js';
import authRoutes from './routes/auth.js';
import personRoutes from './routes/persons.js';
import milkRoutes from './routes/milk.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import branchRoutes from './routes/branches.js';
import userRoutes from './routes/users.js';
import receiptRoutes from './routes/receipts.js';
import meRoutes from './routes/me.js';
import inventoryRoutes from './routes/inventory.js';
import dashboardRoutes from './routes/dashboard.js';
import productionRoutes from './routes/production.js';
import auditRoutes from './routes/audit.js';
import { auditLogger } from './audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// اجازهٔ باز شدن مینی‌اپ داخل iframe نسخهٔ وب بله (بدون X-Frame-Options)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    'frame-ancestors https://*.bale.ai; frame-src https://*.bale.ai');
  next();
});

app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    // HTML همیشه تازه بارگذاری شود تا نسخهٔ قدیمیِ کش‌شده باعث خطای ورود نشود
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));

// ---- session سمت سرور، ذخیره‌شده در MySQL (پایدار در برابر ری‌استارت) ----
const MySQLStore = expressMySQLSession(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'milk_wear',
  createDatabaseTable: true,          // جدول sessions را خودکار می‌سازد
  clearExpired: true,
  charset: 'utf8mb4_unicode_ci',
});
app.use(session({
  name: 'mw.sid',
  secret: process.env.SESSION_SECRET || 'milk-wear-dev-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,                      // با هر درخواست، عمر کوکی تمدید می‌شود
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 12 * 60 * 60 * 1000 },
}));

// ثبت خودکار همهٔ عملیات تغییردهنده در لاگ (بعد از session تا کاربر مشخص باشد)
app.use(auditLogger);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// اپ تک‌صفحه‌ای است؛ /login (و /app) هم همان صفحهٔ اصلی را می‌دهد
app.get(['/login', '/app'], (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html')));

app.use('/api/auth', authRoutes);

// پنل شخصی دامدار/مشتری (فقط دادهٔ خودش)
app.use('/api/me', authRequired, meRoutes);

// کالاها برای همهٔ کاربران واردشده (شخص برای سفارش لازم دارد)
app.use('/api/products', authRequired, productRoutes);
// سفارش و فاکتور خودگارد هستند (کارمند یا صاحب سند)
app.use('/api/orders', authRequired, orderRoutes);
app.use('/api/receipts', authRequired, receiptRoutes);

// بخش‌های کارمندی
app.use('/api/persons', staffRequired, personRoutes);
app.use('/api/milk', staffRequired, milkRoutes);
app.use('/api/payments', staffRequired, paymentRoutes);
app.use('/api/branches', staffRequired, branchRoutes);
app.use('/api/users', staffRequired, userRoutes);
app.use('/api/inventory', staffRequired, inventoryRoutes);
app.use('/api/dashboard', staffRequired, dashboardRoutes);
app.use('/api/production', staffRequired, productionRoutes);
app.use('/api/audit', staffRequired, auditRoutes);

// هندلر خطای مرکزی
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'خطای سرور' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🥛 Milk-wear روی http://localhost:${PORT} اجرا شد`));
