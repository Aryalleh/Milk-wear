-- بسته‌بندی/ظرف با قیمت‌گذاری FIFO: هر خرید یک لایهٔ قیمت؛ موقع فروش FIFO مصرف می‌شود
CREATE TABLE IF NOT EXISTS packagings (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(120) NOT NULL,
  unit_id       BIGINT NULL,
  default_price DECIMAL(18,0) NOT NULL DEFAULT 0,   -- قیمت پیش‌فرض اگر لایه‌ای نمانده باشد
  note          VARCHAR(255) NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- لایه‌های قیمت (هر خرید ظرف) — FIFO
CREATE TABLE IF NOT EXISTS packaging_layers (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  packaging_id  BIGINT NOT NULL,
  qty           DECIMAL(14,3) NOT NULL,
  unit_price    DECIMAL(18,0) NOT NULL,
  remaining_qty DECIMAL(14,3) NOT NULL,
  purchased_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note          VARCHAR(255) NULL,
  created_by    BIGINT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pkg (packaging_id, remaining_qty)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ثبتِ مصرفِ هر لایه در هر قلمِ فروش (برای بازگردانی هنگام ویرایش/حذف سفارش)
CREATE TABLE IF NOT EXISTS packaging_consumptions (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id      BIGINT NOT NULL,
  order_item_id BIGINT NULL,
  layer_id      BIGINT NOT NULL,
  qty           DECIMAL(14,3) NOT NULL,
  cost          DECIMAL(18,0) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ord (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- هر کالا در چه بسته‌بندی‌ای می‌رود و چند ظرف per واحد
ALTER TABLE products
  ADD COLUMN packaging_id BIGINT NULL AFTER unit_id,
  ADD COLUMN packaging_per_unit DECIMAL(10,3) NOT NULL DEFAULT 1 AFTER packaging_id;

-- هزینهٔ ظرفِ محاسبه‌شدهٔ FIFO برای هر قلمِ فروش
ALTER TABLE order_items
  ADD COLUMN packaging_qty  DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN packaging_cost DECIMAL(18,0) NOT NULL DEFAULT 0;
