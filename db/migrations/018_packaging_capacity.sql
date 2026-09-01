-- ظرفیت هر ظرف بسته به نوع کالا (چقدر کالا در یک ظرف جا می‌گیرد) + فروش بدون ظرف
ALTER TABLE products
  ADD COLUMN packaging_capacity DECIMAL(10,3) NOT NULL DEFAULT 1 AFTER packaging_per_unit;

ALTER TABLE orders
  ADD COLUMN no_packaging TINYINT(1) NOT NULL DEFAULT 0 AFTER fulfillment_type;
