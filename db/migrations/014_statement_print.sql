-- افزودن نوع «صورتحساب» به صف چاپ (چاپ حرارتی صورتحساب توسط پرینت‌ایجنت)
ALTER TABLE print_jobs
  MODIFY kind ENUM('waybill','receipt','statement','test') NOT NULL;
