-- ادغام فروشگاه در سفارش‌ها + پرداخت هنگام تحویل + دریافت کالا بابت بدهی
-- --------------------------------------------------------------------

-- نوع تحویل سفارش: حضوری (درجا می‌گیرد) یا ارسال (راننده می‌برد)
ALTER TABLE orders
  ADD COLUMN fulfillment_type ENUM('pickup','delivery') NOT NULL DEFAULT 'delivery' AFTER channel;

-- مبلغی که هنگام ثبت/تحویل پرداخت شده (نقد/کارت). ممکن است کمتر/بیشتر از فاکتور باشد.
ALTER TABLE orders
  ADD COLUMN paid_amount DECIMAL(18,0) NOT NULL DEFAULT 0 AFTER total_amount;

-- نوع تراکنش «دریافت کالا از دامدار بابت پرداخت بدهی» (بستانکار شخص = کاهش بدهی او)
ALTER TABLE transactions
  MODIFY tx_type ENUM('MILK_DELIVERY','PRODUCT_SALE','FEED_SALE','CASH_WITHDRAWAL',
                      'PAYMENT_OUT','PAYMENT_IN','ADJUSTMENT','REFUND','OPENING_BALANCE',
                      'VOID','PURCHASE','GOODS_IN') NOT NULL;
