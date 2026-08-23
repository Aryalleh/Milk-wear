-- مهاجرت ۰۰۹: حد نرمال موجودی هر کالا (برای هشدار نیاز به شارژ)
USE milk_wear;
ALTER TABLE products ADD COLUMN reorder_level DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER track_stock;
