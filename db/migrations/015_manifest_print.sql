-- افزودن نوع «مانیفست بارگیری» به صف چاپ
ALTER TABLE print_jobs
  MODIFY kind ENUM('waybill','receipt','statement','manifest','test') NOT NULL;
