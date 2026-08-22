import express from 'express';
import 'dotenv/config';
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

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
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
