-- سامانه یکپارچه مدیریت لبنیات — اسکیمای MVP (MySQL 8)
-- آنلاین، تراکنش‌محور. قلب سیستم: transactions + account_balances

-- دیتابیس milk_wear از قبل موجود است و کاربر برنامه (milk) دسترسی کامل دارد.
USE milk_wear;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS waste_log, receipts, production_outputs, production_inputs, production_batches,
  audit_logs, account_balances, transactions, payments,
  order_items, orders, stock_movements, stock_balances, milk_deliveries,
  milk_price_history, warehouses, products, product_categories, units,
  person_roles, person_types, persons, users, roles, month_closings,
  settings, branches;
SET FOREIGN_KEY_CHECKS = 1;

-- ============ هویت و دسترسی ============
CREATE TABLE branches (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20) NOT NULL UNIQUE,
  name       VARCHAR(120) NOT NULL,
  type       ENUM('station','store','distribution','head') NOT NULL DEFAULT 'head',
  address    VARCHAR(255),
  phone      VARCHAR(20),
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE roles (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(60) NOT NULL UNIQUE,   -- admin, accountant, station, store, distribution, driver, farmer, customer
  title     VARCHAR(80) NOT NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id     BIGINT,
  person_id     BIGINT,
  fullname      VARCHAR(120) NOT NULL,
  username      VARCHAR(60) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id       BIGINT NOT NULL,
  mobile        VARCHAR(15),
  bale_user_id  BIGINT NULL UNIQUE,           -- اتصال به کاربر بله برای لاگین خودکار مینی‌اپ
  bale_username VARCHAR(64) NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role   FOREIGN KEY (role_id)   REFERENCES roles(id),
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB;

-- ============ اشخاص ============
CREATE TABLE persons (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_code  VARCHAR(20) NOT NULL UNIQUE,
  fullname     VARCHAR(120) NOT NULL,
  national_code VARCHAR(10),
  mobile       VARCHAR(15),
  bale_user_id  BIGINT NULL UNIQUE,           -- اتصال دامدار/مشتری به بله برای پنل شخصی
  bale_username VARCHAR(64) NULL,
  address      VARCHAR(255),
  credit_limit DECIMAL(18,0),
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at   TIMESTAMP NULL,
  INDEX idx_persons_name (fullname),
  INDEX idx_persons_mobile (mobile)
) ENGINE=InnoDB;

CREATE TABLE person_types (
  id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(30) NOT NULL UNIQUE,   -- farmer, customer, supplier, sales_rep, driver, other
  title VARCHAR(60) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE person_roles (
  person_id      BIGINT NOT NULL,
  person_type_id BIGINT NOT NULL,
  PRIMARY KEY (person_id, person_type_id),
  CONSTRAINT fk_pr_person FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_type   FOREIGN KEY (person_type_id) REFERENCES person_types(id)
) ENGINE=InnoDB;

-- ============ کالا و انبار ============
CREATE TABLE product_categories (
  id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE units (
  id     BIGINT AUTO_INCREMENT PRIMARY KEY,
  name   VARCHAR(40) NOT NULL,
  symbol VARCHAR(10) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE products (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20) NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  category_id BIGINT,
  unit_id     BIGINT,
  base_price  DECIMAL(18,0) NOT NULL DEFAULT 0,
  is_raw_milk TINYINT(1) NOT NULL DEFAULT 0,
  track_stock TINYINT(1) NOT NULL DEFAULT 1,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_cat  FOREIGN KEY (category_id) REFERENCES product_categories(id),
  CONSTRAINT fk_prod_unit FOREIGN KEY (unit_id)     REFERENCES units(id)
) ENGINE=InnoDB;

CREATE TABLE warehouses (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id BIGINT,
  name      VARCHAR(80) NOT NULL,
  type      ENUM('station','store','distribution') NOT NULL DEFAULT 'store',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_wh_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB;

CREATE TABLE stock_movements (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id    BIGINT,
  warehouse_id BIGINT NOT NULL,
  product_id   BIGINT NOT NULL,
  direction    ENUM('in','out') NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  unit_cost    DECIMAL(18,0),
  source_type  ENUM('purchase','sale','production_in','production_out','adjustment','transfer','return') NOT NULL,
  source_id    BIGINT,
  occurred_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by   BIGINT,
  CONSTRAINT fk_sm_wh   FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_sm_prod FOREIGN KEY (product_id)   REFERENCES products(id),
  INDEX idx_sm_prod (product_id, warehouse_id)
) ENGINE=InnoDB;

-- کَش موجودی (بازسازی‌پذیر از stock_movements)
CREATE TABLE stock_balances (
  warehouse_id     BIGINT NOT NULL,
  product_id       BIGINT NOT NULL,
  quantity         DECIMAL(14,3) NOT NULL DEFAULT 0,
  last_movement_at TIMESTAMP NULL,
  PRIMARY KEY (warehouse_id, product_id)
) ENGINE=InnoDB;

-- ============ تولید (فراوری شیر به محصولات) ============
CREATE TABLE production_batches (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id   BIGINT,
  batch_code  VARCHAR(30) NOT NULL UNIQUE,
  started_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  status      ENUM('planned','running','done') NOT NULL DEFAULT 'done',
  note        VARCHAR(255),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pb_started (started_at)
) ENGINE=InnoDB;

CREATE TABLE production_inputs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id     BIGINT NOT NULL,
  product_id   BIGINT NOT NULL,
  warehouse_id BIGINT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  CONSTRAINT fk_pi_batch FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_prod  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE production_outputs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id     BIGINT NOT NULL,
  product_id   BIGINT NOT NULL,
  warehouse_id BIGINT NULL,
  quantity     DECIMAL(14,3) NOT NULL,
  CONSTRAINT fk_po_batch FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_prod  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

-- ============ شیر ============
CREATE TABLE milk_price_history (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id          BIGINT,
  year_month_jalali  CHAR(7) NOT NULL,          -- 1405-05
  person_id          BIGINT NULL,               -- NULL=قیمت عمومی ماه، مقداردار=اختصاصی (توسعهٔ آینده)
  price_per_kg       DECIMAL(18,0) NOT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by         BIGINT,
  UNIQUE KEY uq_price (year_month_jalali, person_id),
  CONSTRAINT fk_mph_person FOREIGN KEY (person_id) REFERENCES persons(id)
) ENGINE=InnoDB;

CREATE TABLE milk_deliveries (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id         BIGINT,
  person_id         BIGINT NOT NULL,
  shift             ENUM('morning','evening') NOT NULL,
  delivered_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  year_month_jalali CHAR(7) NOT NULL,
  weight_kg         DECIMAL(14,3) NOT NULL,
  fat_pct           DECIMAL(4,2) NULL,          -- درصد چربی
  price_per_kg      DECIMAL(18,0) NOT NULL,     -- قیمت قفل‌شدهٔ لحظهٔ ثبت
  amount            DECIMAL(18,0) NOT NULL,     -- weight * price
  note              VARCHAR(255),
  created_by        BIGINT,
  deleted_at        TIMESTAMP NULL,
  CONSTRAINT fk_md_person FOREIGN KEY (person_id) REFERENCES persons(id),
  INDEX idx_md_person (person_id, year_month_jalali)
) ENGINE=InnoDB;

-- ============ سفارش / فروش ============
CREATE TABLE orders (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id    BIGINT,
  order_no     VARCHAR(20) NOT NULL UNIQUE,
  waybill_no   VARCHAR(30) NULL,
  person_id    BIGINT NOT NULL,
  channel      ENUM('farmer','store','distribution') NOT NULL DEFAULT 'store',
  status       ENUM('draft','confirmed','delivered','settled','canceled') NOT NULL DEFAULT 'confirmed',
  warehouse_id BIGINT,
  ordered_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_amount DECIMAL(18,0) NOT NULL DEFAULT 0,
  note         VARCHAR(255),
  destination  VARCHAR(255),
  created_by   BIGINT,
  deleted_at   TIMESTAMP NULL,
  CONSTRAINT fk_ord_person FOREIGN KEY (person_id) REFERENCES persons(id),
  INDEX idx_ord_person (person_id)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id   BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity   DECIMAL(14,3) NOT NULL,
  unit_price DECIMAL(18,0) NOT NULL,
  amount     DECIMAL(18,0) NOT NULL,
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_prod  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

-- ============ پرداخت ============
CREATE TABLE payments (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id  BIGINT,
  person_id  BIGINT NOT NULL,
  direction  ENUM('in','out') NOT NULL,          -- in=دریافت از مشتری، out=پرداخت به دامدار
  method     ENUM('cash','card','transfer','credit','mixed') NOT NULL DEFAULT 'cash',
  amount     DECIMAL(18,0) NOT NULL,
  ref_no     VARCHAR(60),
  paid_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  note       VARCHAR(255),
  created_by BIGINT,
  CONSTRAINT fk_pay_person FOREIGN KEY (person_id) REFERENCES persons(id),
  INDEX idx_pay_person (person_id)
) ENGINE=InnoDB;

-- ============ دفتر کل تراکنش‌ها (قلب سیستم) ============
CREATE TABLE transactions (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id         BIGINT,
  person_id         BIGINT NOT NULL,
  tx_type           ENUM('MILK_DELIVERY','PRODUCT_SALE','FEED_SALE','CASH_WITHDRAWAL',
                         'PAYMENT_OUT','PAYMENT_IN','ADJUSTMENT','REFUND','OPENING_BALANCE','VOID') NOT NULL,
  direction         ENUM('credit','debit') NOT NULL,  -- نسبت به شخص. مانده = SUM(credit)-SUM(debit)
  amount            DECIMAL(18,0) NOT NULL,
  tx_date           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  year_month_jalali CHAR(7) NOT NULL,
  source_type       ENUM('milk_delivery','order','invoice','payment','production','manual') NOT NULL,
  source_id         BIGINT,
  description       VARCHAR(200),
  reverses_tx_id    BIGINT NULL,
  status            ENUM('active','voided') NOT NULL DEFAULT 'active',
  is_locked         TINYINT(1) NOT NULL DEFAULT 0,
  created_by        BIGINT,
  CONSTRAINT fk_tx_person   FOREIGN KEY (person_id) REFERENCES persons(id),
  CONSTRAINT fk_tx_reverses FOREIGN KEY (reverses_tx_id) REFERENCES transactions(id),
  INDEX idx_tx_person (person_id, tx_date, id),
  INDEX idx_tx_month (year_month_jalali)
) ENGINE=InnoDB;

-- کَش دفتر حساب زنده (بازسازی‌پذیر از transactions)
CREATE TABLE account_balances (
  person_id            BIGINT PRIMARY KEY,
  current_balance      DECIMAL(18,0) NOT NULL DEFAULT 0,  -- +: شرکت بدهکار (قابل پرداخت) | -: شخص بدهکار
  milk_kg_month        DECIMAL(14,3) NOT NULL DEFAULT 0,
  milk_value_month     DECIMAL(18,0) NOT NULL DEFAULT 0,
  milk_value_total     DECIMAL(18,0) NOT NULL DEFAULT 0,
  purchases_total      DECIMAL(18,0) NOT NULL DEFAULT 0,
  cash_withdrawal_total DECIMAL(18,0) NOT NULL DEFAULT 0,
  payments_total       DECIMAL(18,0) NOT NULL DEFAULT 0,
  last_payment_at      TIMESTAMP NULL,
  last_order_at        TIMESTAMP NULL,
  last_settlement_at   TIMESTAMP NULL,
  status               ENUM('settled','debtor','creditor') NOT NULL DEFAULT 'settled',
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ab_person FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============ فاکتور ترکیبی (تحویل شیر + خرید) ============
CREATE TABLE receipts (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id         BIGINT,
  receipt_no        VARCHAR(30) NOT NULL UNIQUE,
  person_id         BIGINT NOT NULL,
  issued_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  year_month_jalali CHAR(7) NOT NULL,
  milk_delivery_id  BIGINT NULL,
  order_id          BIGINT NULL,
  milk_amount       DECIMAL(18,0) NOT NULL DEFAULT 0,
  purchase_amount   DECIMAL(18,0) NOT NULL DEFAULT 0,
  net_amount        DECIMAL(18,0) NOT NULL DEFAULT 0,
  balance_after     DECIMAL(18,0) NOT NULL DEFAULT 0,
  note              VARCHAR(255),
  printed_at        TIMESTAMP NULL,
  notified_at       TIMESTAMP NULL,
  created_by        BIGINT,
  CONSTRAINT fk_rc_person FOREIGN KEY (person_id) REFERENCES persons(id),
  CONSTRAINT fk_rc_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  INDEX idx_rc_person (person_id),
  INDEX idx_rc_branch (branch_id, issued_at)
) ENGINE=InnoDB;

-- ============ ضایعات ============
CREATE TABLE waste_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id   BIGINT,
  kind        ENUM('milk','product') NOT NULL DEFAULT 'milk',
  product_id  BIGINT NULL,
  quantity    DECIMAL(14,3) NOT NULL,
  reason      VARCHAR(255),
  occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by  BIGINT,
  INDEX idx_waste_date (occurred_at)
) ENGINE=InnoDB;

-- ============ سیستمی ============
CREATE TABLE month_closings (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  branch_id         BIGINT,
  year_month_jalali CHAR(7) NOT NULL,
  status            ENUM('open','closed') NOT NULL DEFAULT 'closed',
  closed_by         BIGINT,
  closed_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reopened_by       BIGINT NULL,
  reopened_at       TIMESTAMP NULL,
  UNIQUE KEY uq_month (branch_id, year_month_jalali)
) ENGINE=InnoDB;

CREATE TABLE settings (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  scope      ENUM('global','branch','user') NOT NULL DEFAULT 'global',
  scope_id   BIGINT,
  `key`      VARCHAR(80) NOT NULL,
  value_json JSON,
  UNIQUE KEY uq_setting (scope, scope_id, `key`)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(60) NOT NULL,
  entity_id   BIGINT,
  action      VARCHAR(20) NOT NULL,   -- create/update/void
  old_json    JSON,
  new_json    JSON,
  user_id     BIGINT,
  ip          VARCHAR(45),
  reason      VARCHAR(255),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;
