-- داده‌های پایه MVP
USE milk_wear;

-- یک دفتر مرکزی واحد: هم ایستگاه تحویل شیر، هم فروشگاه
INSERT INTO branches (code, name, type) VALUES
  ('MARKAZ', 'دفتر مرکزی', 'head');

INSERT INTO roles (name, title, is_system) VALUES
  ('admin','مدیر',1),
  ('accountant','حسابداری',1),
  ('station','مسئول ایستگاه',1),
  ('store','فروشگاه',1),
  ('distribution','مدیر پخش',1),
  ('driver','راننده',1),
  ('farmer','دامدار',1),
  ('customer','مشتری',1);

INSERT INTO person_types (`key`, title) VALUES
  ('farmer','دامدار'),
  ('customer','مشتری'),
  ('supplier','تامین‌کننده'),
  ('sales_rep','نماینده فروش'),
  ('driver','راننده'),
  ('other','سایر');

INSERT INTO units (name, symbol) VALUES
  ('کیلوگرم','kg'),
  ('عدد','عدد'),
  ('لیتر','L'),
  ('بسته','بسته');

INSERT INTO product_categories (name) VALUES
  ('لبنیات'),('خوراک دام'),('سوپرمارکت'),('سایر');

INSERT INTO warehouses (branch_id, name, type) VALUES
  (1,'انبار مرکزی','store');

-- محصولات نمونه (category: 1=لبنیات 2=خوراک 3=سوپرمارکت | unit: 1=kg 2=عدد 3=L)
INSERT INTO products (code, name, category_id, unit_id, base_price, is_raw_milk, track_stock) VALUES
  ('MILK-RAW','شیر خام',1,1,0,1,0),
  ('YOGURT','ماست',1,1,45000,0,1),
  ('CHEESE','پنیر',1,1,180000,0,1),
  ('CREAM','خامه',1,1,120000,0,1),
  ('FEED','خوراک دام',2,4,850000,0,1),
  ('EGG','تخم مرغ',3,2,4500,0,1),
  ('BUTTER','کره',1,2,95000,0,1);

-- قیمت عمومی شیر برای ماه جاری (نمونه؛ برنامه در صورت نبود، از این استفاده می‌کند)
INSERT INTO milk_price_history (branch_id, year_month_jalali, person_id, price_per_kg)
  VALUES (1, '1405-05', NULL, 38000);

-- کاربر مدیر: username=admin  password=admin123  (هش در seed اسکریپت جایگزین می‌شود)
-- توسط scripts/seed.js ثبت می‌شود تا هش bcrypt درست تولید شود.
