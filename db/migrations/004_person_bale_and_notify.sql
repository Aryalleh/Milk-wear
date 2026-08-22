-- مهاجرت ۰۰۴: اتصال اشخاص (دامدار/مشتری) به بله + وضعیت اطلاع‌رسانی فاکتور
USE milk_wear;

ALTER TABLE persons
  ADD COLUMN bale_user_id  BIGINT NULL UNIQUE AFTER mobile,
  ADD COLUMN bale_username VARCHAR(64) NULL AFTER bale_user_id;

ALTER TABLE receipts
  ADD COLUMN notified_at TIMESTAMP NULL AFTER printed_at;

-- بارنامه برای سفارش‌های پخش/فروش
ALTER TABLE orders
  ADD COLUMN waybill_no VARCHAR(30) NULL AFTER order_no,
  ADD COLUMN destination VARCHAR(255) NULL AFTER note;
