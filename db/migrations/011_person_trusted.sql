-- مهاجرت ۰۱۱: فلگ «معتمد» برای شخص → فاکتور فروش او مستقیم و بدون تأیید ثبت می‌شود
USE milk_wear;
ALTER TABLE persons ADD COLUMN trusted TINYINT(1) NOT NULL DEFAULT 0 AFTER credit_limit;
