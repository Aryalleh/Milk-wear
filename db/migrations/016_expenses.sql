-- هزینه‌های کسب‌وکار (حقوق، قبوض، خودرو، ملزومات…) برای محاسبهٔ سود دقیق
CREATE TABLE IF NOT EXISTS expenses (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  branch_id    BIGINT NULL,
  category     ENUM('salary','utilities','rent','vehicle','supplies','tax','other') NOT NULL DEFAULT 'other',
  title        VARCHAR(120) NOT NULL,
  amount       DECIMAL(18,0) NOT NULL DEFAULT 0,
  ref_user_id  BIGINT NULL,               -- برای حقوق: کدام کاربر
  spent_at     DATE NOT NULL,
  year_month_jalali CHAR(7) NOT NULL,
  note         VARCHAR(255) NULL,
  created_by   BIGINT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_spent (spent_at),
  INDEX idx_ym (year_month_jalali),
  INDEX idx_cat (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- قالب هزینه‌های تکرارشونده (قبض برق، اجاره…) برای ثبت سریع دفعهٔ بعد
CREATE TABLE IF NOT EXISTS expense_templates (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  category       ENUM('salary','utilities','rent','vehicle','supplies','tax','other') NOT NULL DEFAULT 'other',
  title          VARCHAR(120) NOT NULL,
  default_amount DECIMAL(18,0) NOT NULL DEFAULT 0,
  ref_user_id    BIGINT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
