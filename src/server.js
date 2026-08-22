import express from 'express';
import 'dotenv/config';
import session from 'express-session';
import expressMySQLSession from 'express-mysql-session';
import { fileURLToPath } from 'url';
import path from 'path';
import { authRequired } from './auth.js';
import authRoutes from './routes/auth.js';
import personRoutes from './routes/persons.js';
import milkRoutes from './routes/milk.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import branchRoutes from './routes/branches.js';
import userRoutes from './routes/users.js';
import receiptRoutes from './routes/receipts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// اپ تک‌صفحه‌ای است؛ /login (و /app) هم همان صفحهٔ اصلی را می‌دهد
app.get(['/login', '/app'], (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html')));

app.use('/api/auth', authRoutes);

// از اینجا به بعد نیاز به ورود
app.use('/api/persons', authRequired, personRoutes);
app.use('/api/milk', authRequired, milkRoutes);
app.use('/api/products', authRequired, productRoutes);
app.use('/api/orders', authRequired, orderRoutes);
app.use('/api/payments', authRequired, paymentRoutes);
app.use('/api/branches', authRequired, branchRoutes);
app.use('/api/users', authRequired, userRoutes);
app.use('/api/receipts', authRequired, receiptRoutes);

// هندلر خطای مرکزی
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'خطای سرور' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🥛 Milk-wear روی http://localhost:${PORT} اجرا شد`));
