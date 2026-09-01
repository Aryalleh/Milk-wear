// قیمت‌گذاری FIFO بسته‌بندی/ظرف: مصرف لایه‌های قیمت به‌ترتیب قدیمی‌ترین
// همهٔ توابع باید درون یک تراکنش (conn) فراخوانی شوند.

// مصرف `need` عدد ظرف از انبارِ FIFO؛ هزینه را برمی‌گرداند و مصرف هر لایه را ثبت می‌کند
export async function consumePackaging(conn, packagingId, need, orderId, orderItemId, defaultPrice = 0) {
  need = Number(need) || 0;
  if (!packagingId || need <= 0) return { cost: 0, consumed: 0 };
  let cost = 0, consumed = 0;
  let lastPrice = Number(defaultPrice) || 0;
  const [layers] = await conn.query(
    'SELECT id, remaining_qty, unit_price FROM packaging_layers WHERE packaging_id=? AND remaining_qty>0 ORDER BY purchased_at, id',
    [packagingId]);
  for (const L of layers) {
    if (need <= 0) break;
    lastPrice = Number(L.unit_price);
    const take = Math.min(Number(L.remaining_qty), need);
    const c = Math.round(take * lastPrice);
    cost += c; consumed += take; need -= take;
    await conn.query('UPDATE packaging_layers SET remaining_qty = remaining_qty - ? WHERE id=?', [take, L.id]);
    await conn.query('INSERT INTO packaging_consumptions (order_id, order_item_id, layer_id, qty, cost) VALUES (?,?,?,?,?)',
      [orderId, orderItemId, L.id, take, c]);
  }
  // کسری لایه: با آخرین قیمت/پیش‌فرض محاسبه می‌شود (layer_id=0 یعنی بدون لایه)
  if (need > 0) {
    const c = Math.round(need * lastPrice);
    cost += c; consumed += need;
    await conn.query('INSERT INTO packaging_consumptions (order_id, order_item_id, layer_id, qty, cost) VALUES (?,?,?,?,?)',
      [orderId, orderItemId, 0, need, c]);
  }
  return { cost, consumed };
}

// بازگردانی مصرفِ ظرفِ یک سفارش به لایه‌ها (برای ویرایش/حذف سفارش)
export async function restorePackagingForOrder(conn, orderId) {
  const [cons] = await conn.query('SELECT layer_id, qty FROM packaging_consumptions WHERE order_id=?', [orderId]);
  for (const c of cons) {
    if (c.layer_id) await conn.query('UPDATE packaging_layers SET remaining_qty = remaining_qty + ? WHERE id=?', [c.qty, c.layer_id]);
  }
  await conn.query('DELETE FROM packaging_consumptions WHERE order_id=?', [orderId]);
}
