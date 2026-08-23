-- مهاجرت ۰۰۷: لاگین اختیاری برای اشخاص (دامدار/مشتری) با نام‌کاربری و رمز
USE milk_wear;

ALTER TABLE persons
  ADD COLUMN username      VARCHAR(60) NULL UNIQUE AFTER person_code,
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER username;

-- حذف کاربر کارمندِ اشتباه با نقش مشتری/دامدار (اگر وجود دارد) — این‌ها باید «شخص» باشند نه کارمند
DELETE u FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name IN ('customer','farmer');
