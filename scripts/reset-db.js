// ساخت دیتابیس از صفر: اجرای schema.sql سپس seed.sql
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  for (const f of ['../db/schema.sql', '../db/seed.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, f), 'utf8');
    await conn.query(sql);
    console.log(`✔ اجرا شد: ${f}`);
  }
  await conn.end();
  console.log('✅ دیتابیس ساخته شد. حالا: npm run db:seed');
}
run().catch((e) => { console.error('❌', e.message); process.exit(1); });
