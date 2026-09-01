-- درصد سودِ قابل‌تنظیم روی هر ظرف (چون خریدِ ظرف وقت/هزینه دارد)
ALTER TABLE packagings
  ADD COLUMN margin_pct DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER default_price;
