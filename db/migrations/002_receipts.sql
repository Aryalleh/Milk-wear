-- مهاجرت ۰۰۲: فاکتور ترکیبی تحویل شیر + خرید (قابل ذخیره و پرینت)
USE milk_wear;

CREATE TABLE IF NOT EXISTS receipts (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id         BIGINT,
  receipt_no        VARCHAR(30) NOT NULL UNIQUE,
  person_id         BIGINT NOT NULL,
  issued_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  year_month_jalali CHAR(7) NOT NULL,
  milk_delivery_id  BIGINT NULL,
  order_id          BIGINT NULL,
  milk_amount       DECIMAL(18,0) NOT NULL DEFAULT 0,  -- بستانکار شیر این فاکتور
  purchase_amount   DECIMAL(18,0) NOT NULL DEFAULT 0,  -- بدهکار خرید این فاکتور
  net_amount        DECIMAL(18,0) NOT NULL DEFAULT 0,  -- milk - purchase (خالص این فاکتور)
  balance_after     DECIMAL(18,0) NOT NULL DEFAULT 0,  -- مانده کل حساب پس از این فاکتور
  note              VARCHAR(255),
  printed_at        TIMESTAMP NULL,
  created_by        BIGINT,
  CONSTRAINT fk_rc_person FOREIGN KEY (person_id) REFERENCES persons(id),
  CONSTRAINT fk_rc_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  INDEX idx_rc_person (person_id),
  INDEX idx_rc_branch (branch_id, issued_at)
) ENGINE=InnoDB;
