-- مهاجرت ۰۱۰: فاکتور فروش ارسالی توسط شخص (خرید از او) با عکس و تأیید مدیر
USE milk_wear;
ALTER TABLE transactions
  MODIFY tx_type ENUM('MILK_DELIVERY','PRODUCT_SALE','FEED_SALE','CASH_WITHDRAWAL','PAYMENT_OUT','PAYMENT_IN','ADJUSTMENT','REFUND','OPENING_BALANCE','VOID','PURCHASE') NOT NULL;
CREATE TABLE IF NOT EXISTS purchase_submissions (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_id   BIGINT NOT NULL,
  amount      DECIMAL(18,0) NOT NULL,   -- ریال
  description VARCHAR(255),
  photo       MEDIUMTEXT,               -- data URL (base64)
  status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by BIGINT, approved_at TIMESTAMP NULL, tx_id BIGINT,
  CONSTRAINT fk_ps_person FOREIGN KEY (person_id) REFERENCES persons(id),
  INDEX idx_ps_status (status)
) ENGINE=InnoDB;
