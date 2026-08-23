-- مهاجرت ۰۰۶: درصد چربی شیر، ثبت ضایعات، ظرفیت مخزن (برای داشبورد مطابق طراحی)
USE milk_wear;

ALTER TABLE milk_deliveries
  ADD COLUMN fat_pct DECIMAL(4,2) NULL AFTER weight_kg;

CREATE TABLE IF NOT EXISTS waste_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id   BIGINT,
  kind        ENUM('milk','product') NOT NULL DEFAULT 'milk',
  product_id  BIGINT NULL,
  quantity    DECIMAL(14,3) NOT NULL,           -- کیلو/واحد
  reason      VARCHAR(255),
  occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by  BIGINT,
  INDEX idx_waste_date (occurred_at)
) ENGINE=InnoDB;

-- ظرفیت مخزن شیر خام (برای درصد پر بودن)
INSERT INTO settings (scope, scope_id, `key`, value_json)
  VALUES ('global', NULL, 'silo_capacity_kg', '20000')
  ON DUPLICATE KEY UPDATE value_json = value_json;
