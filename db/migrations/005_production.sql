-- مهاجرت ۰۰۵: جدول‌های تولید (فراوری شیر خام به محصولات)
USE milk_wear;

CREATE TABLE IF NOT EXISTS production_batches (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id  BIGINT,
  batch_code VARCHAR(30) NOT NULL UNIQUE,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  status     ENUM('planned','running','done') NOT NULL DEFAULT 'done',
  note       VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pb_started (started_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS production_inputs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id     BIGINT NOT NULL,
  product_id   BIGINT NOT NULL,
  warehouse_id BIGINT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  CONSTRAINT fk_pi_batch FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_prod  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS production_outputs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id     BIGINT NOT NULL,
  product_id   BIGINT NOT NULL,
  warehouse_id BIGINT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  CONSTRAINT fk_po_batch FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_prod  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;
