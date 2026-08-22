-- مهاجرت ۰۰۳: اتصال حساب کاربر سیستم به کاربر بله (برای لاگین خودکار مینی‌اپ)
USE milk_wear;

ALTER TABLE users
  ADD COLUMN bale_user_id BIGINT NULL UNIQUE AFTER mobile,
  ADD COLUMN bale_username VARCHAR(64) NULL AFTER bale_user_id;
