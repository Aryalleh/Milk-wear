// تنظیم/بازنشانیِ رمزِ یک کاربر از خطِ فرمان (بدون نیاز به UI).
//   node scripts/set-password.js <username> <password>
// مثال:  node scripts/set-password.js Aryalleh '1234@mo'
import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('استفاده:  node scripts/set-password.js <username> <password>');
    process.exit(1);
  }
  if (!process.env.DB_NAME) { console.error('❌ DB_NAME در .env نیست'); process.exit(1); }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const hash = await bcrypt.hash(password, 10);
  // نام کاربری در MySQL به‌صورت پیش‌فرض حساس به حروف نیست (collation _ci)
  const [r] = await conn.query('UPDATE users SET password_hash = ?, is_active = 1 WHERE username = ?', [hash, username]);
  if (!r.affectedRows) console.error(`❌ کاربری با نام کاربریِ «${username}» پیدا نشد.`);
  else console.log(`✅ رمزِ «${username}» تنظیم شد.`);
  await conn.end();
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
