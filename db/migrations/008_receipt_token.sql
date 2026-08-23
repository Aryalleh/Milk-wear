-- مهاجرت ۰۰۸: توکن تصادفی هش‌شده برای لینک/QR فاکتور
USE milk_wear;
ALTER TABLE receipts ADD COLUMN public_token CHAR(32) NULL UNIQUE AFTER receipt_no;
