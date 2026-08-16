// 進銷存：料件主檔、廠商、採購進貨、銷貨出庫、庫存查詢與異動、調撥、盤點
const express = require('express');
const { db, audit, getSetting, today, addDays, nextDocNo, calcTax } = require('../db');
const { requireStaff } = require('../auth');
const { applyMove, revertMoves, getStock, priceFor, lowStockList, KIND_TW } = require('../stock');

const router = express.Router();

// ================= 料件主檔 =================

router.get('/products', requireStaff(), (req, res) => {
  const { q = '', category_id = '', kind = '', low = '', active = '1' } = req.query;
  const where = [], args = [];
  if (active !== '') { where.push('p.active = ?'); args.push(Number(active)); }
  if (category_id) { where.push('p.category_id = ?'); args.push(category_id); }
  if (kind) { where.push('p.kind = ?'); args.push(kind); }
  if (q) {
    where.push('(p.sku LIKE ? OR p.name LIKE ? OR p.spec LIKE ? OR p.brand LIKE ? OR p.model LIKE ? OR p.barcode LIKE ?)');
    for (let i = 0; i < 6; i++) args.push(`%${q}%`);
  }
  let rows = db.prepare(`
    SELECT p.*, pc.name AS category_name, s.name AS supplier_name,
      COALESCE((SELECT SUM(st.qty) FROM stocks st WHERE st.product_id = p.id), 0) AS qty
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.default_supplier_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.sku LIMIT 1000`).all(...args);
  if (low === '1') rows = rows.filter(r => r.safety_qty > 0 && r.qty < r.safety_qty);
  res.json(rows);
});

router.get('/products/:id', requireStaff(), (req, res) => {
  const p = db.prepare(`SELECT p.*, pc.name AS category_name, s.name AS supplier_name
    FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.default_supplier_id WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: '料件不存在' });
  p.stocks = db.prepare(`SELECT st.*, w.name AS warehouse_name, w.kind AS warehouse_kind
    FROM stocks st JOIN warehouses w ON w.id = st.warehouse_id
    WHERE st.product_id = ? ORDER BY w.kind, w.id`).all(p.id);
  p.qty = p.stocks.reduce((s, r) => s + r.qty, 0);
  p.moves = db.prepare(`SELECT m.*, w.name AS warehouse_name, u.name AS user_name
    FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN users u ON u.id = m.user_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`).all(p.id);
  res.json(p);
});

const PRODUCT_FIELDS = ['sku', 'name', 'spec', 'category_id', 'kind', 'brand', 'model', 'unit', 'barcode',
  'price_retail', 'price_contract', 'price_wholesale', 'safety_qty', 'default_supplier_id',
  'is_refrigerant', 'serial_tracked', 'warranty_months', 'note'];

function productVals(b, old = {}) {
  return PRODUCT_FIELDS.map(f => {
    const v = b[f] ?? old[f];
    if (['category_id', 'default_supplier_id'].includes(f)) return v || null;
    if (['is_refrigerant', 'serial_tracked'].includes(f)) return (b[f] === undefined ? (old[f] || 0) : (b[f] ? 1 : 0));
    if (['price_retail', 'price_contract', 'price_wholesale', 'warranty_months'].includes(f)) return Math.round(Number(v) || 0);
    if (f === 'safety_qty') return Number(v) || 0;
    return v ?? '';
  });
}

router.post('/products', requireStaff('inventory'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫品名' });
  b.sku = b.sku || nextDocNo('P', today());
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(b.sku)) {
    return res.status(400).json({ error: '此料號已存在' });
  }
  const info = db.prepare(`INSERT INTO products (${PRODUCT_FIELDS.join(',')}, cost)
    VALUES (${PRODUCT_FIELDS.map(() => '?').join(',')}, ?)`)
    .run(...productVals(b), Math.round(Number(b.cost) || 0));
  audit('staff', req.user.id, req.user.name, '新增料件', `${b.sku} ${b.name}`);
  res.json({ id: info.lastInsertRowid, sku: b.sku });
});

router.put('/products/:id', requireStaff('inventory'), (req, res) => {
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '料件不存在' });
  if (b.sku && b.sku !== old.sku && db.prepare('SELECT 1 FROM products WHERE sku = ?').get(b.sku)) {
    return res.status(400).json({ error: '此料號已存在' });
  }
  db.prepare(`UPDATE products SET ${PRODUCT_FIELDS.map(f => `${f} = ?`).join(', ')}, active = ? WHERE id = ?`)
    .run(...productVals(b, old), b.active === undefined ? old.active : (b.active ? 1 : 0), req.params.id);
  // 成本只允許在「尚無異動紀錄」時直接改，有進出後一律由進貨移動平均決定
  if (b.cost !== undefined && b.cost !== '') {
    const moved = db.prepare('SELECT 1 FROM stock_moves WHERE product_id = ?').get(old.id);
    if (!moved) db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(Math.round(Number(b.cost) || 0), old.id);
  }
  audit('staff', req.user.id, req.user.name, '修改料件', old.sku);
  res.json({ ok: true });
});

router.delete('/products/:id', requireStaff('inventory'), (req, res) => {
  const moved = db.prepare('SELECT COUNT(*) n FROM stock_moves WHERE product_id = ?').get(req.params.id).n;
  if (moved) return res.status(400).json({ error: `此料件已有 ${moved} 筆庫存異動，請改為停用` });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 依客戶價格等級回報售價（工單／報價選料時用）
router.get('/products/:id/price', requireStaff(), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '料件不存在' });
  const level = req.query.level || 'retail';
  res.json({
    price: priceFor(p, level), cost: p.cost, unit: p.unit, name: p.name, spec: p.spec,
    qty: db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stocks WHERE product_id = ?').get(p.id).q
  });
});

// ================= 廠商 =================

router.get('/suppliers', requireStaff(), (req, res) => {
  const q = req.query.q || '';
  const rows = db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id) AS po_count,
      (SELECT COALESCE(SUM(total - paid),0) FROM purchase_orders po
        WHERE po.supplier_id = s.id AND po.status = 'received' AND po.total > po.paid) AS payable
    FROM suppliers s
    ${q ? 'WHERE s.name LIKE ? OR s.contact LIKE ? OR s.phone LIKE ? OR s.tax_id LIKE ?' : ''}
    ORDER BY s.active DESC, s.name`).all(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : []));
  res.json(rows);
});

const SUPPLIER_FIELDS = ['code', 'name', 'tax_id', 'contact', 'phone', 'email', 'address', 'payment_terms', 'bank_account', 'note'];

router.post('/suppliers', requireStaff('purchase'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫廠商名稱' });
  const info = db.prepare(`INSERT INTO suppliers (${SUPPLIER_FIELDS.join(',')})
    VALUES (${SUPPLIER_FIELDS.map(() => '?').join(',')})`).run(...SUPPLIER_FIELDS.map(f => b[f] ?? ''));
  audit('staff', req.user.id, req.user.name, '新增廠商', b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/suppliers/:id', requireStaff('purchase'), (req, res) => {
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '廠商不存在' });
  db.prepare(`UPDATE suppliers SET ${SUPPLIER_FIELDS.map(f => `${f} = ?`).join(', ')}, active = ? WHERE id = ?`)
    .run(...SUPPLIER_FIELDS.map(f => b[f] ?? old[f]), b.active === undefined ? old.active : (b.active ? 1 : 0), req.params.id);
  res.json({ ok: true });
});

// ================= 採購單 =================

router.get('/purchase-orders', requireStaff('purchase'), (req, res) => {
  const { status = '', supplier_id = '', from = '', to = '', unpaid = '' } = req.query;
  const where = [], args = [];
  if (status) { where.push('po.status = ?'); args.push(status); }
  if (supplier_id) { where.push('po.supplier_id = ?'); args.push(supplier_id); }
  if (from) { where.push('po.order_date >= ?'); args.push(from); }
  if (to) { where.push('po.order_date <= ?'); args.push(to); }
  if (unpaid === '1') where.push("po.status = 'received' AND po.total > po.paid");
  res.json(db.prepare(`
    SELECT po.*, s.name AS supplier_name, w.name AS warehouse_name,
      (SELECT COUNT(*) FROM purchase_items pi WHERE pi.po_id = po.id) AS item_count
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN warehouses w ON w.id = po.warehouse_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY po.order_date DESC, po.id DESC LIMIT 300`).all(...args));
});

router.get('/purchase-orders/:id', requireStaff('purchase'), (req, res) => {
  const po = db.prepare(`SELECT po.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id, s.phone AS supplier_phone,
      w.name AS warehouse_name, u.name AS creator
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN warehouses w ON w.id = po.warehouse_id
    LEFT JOIN users u ON u.id = po.created_by WHERE po.id = ?`).get(req.params.id);
  if (!po) return res.status(404).json({ error: '採購單不存在' });
  po.items = db.prepare(`SELECT pi.*, p.sku, p.name, p.spec, p.unit FROM purchase_items pi
    JOIN products p ON p.id = pi.product_id WHERE pi.po_id = ? ORDER BY pi.id`).all(po.id);
  po.payments = db.prepare('SELECT * FROM payments WHERE po_id = ? ORDER BY pay_date').all(po.id);
  res.json(po);
});

function sumPO(poId) {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId);
  const sub = db.prepare('SELECT COALESCE(SUM(qty * price),0) v FROM purchase_items WHERE po_id = ?').get(poId).v;
  const { net, tax, total } = calcTax(sub, po.tax_mode);
  db.prepare('UPDATE purchase_orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?').run(net, tax, total, poId);
  return { subtotal: net, tax, total };
}

router.post('/purchase-orders', requireStaff('purchase'), (req, res) => {
  const b = req.body || {};
  if (!b.supplier_id || !b.warehouse_id) return res.status(400).json({ error: '請選擇廠商與入庫倉別' });
  const date = b.order_date || today();
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(b.supplier_id);
  const out = db.transaction(() => {
    const no = nextDocNo('PO', date);
    const info = db.prepare(`INSERT INTO purchase_orders
        (po_no, supplier_id, warehouse_id, order_date, tax_mode, due_date, note, created_by)
        VALUES (?,?,?,?,?,?,?,?)`)
      .run(no, b.supplier_id, b.warehouse_id, date, b.tax_mode || 'exclusive',
        b.due_date || addDays(date, 30), b.note || '', req.user.id);
    const id = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO purchase_items (po_id, product_id, qty, price, note) VALUES (?,?,?,?,?)');
    for (const it of (b.items || [])) {
      if (!it.product_id || !Number(it.qty)) continue;
      ins.run(id, it.product_id, Number(it.qty), Math.round(Number(it.price) || 0), it.note || '');
    }
    return { id, po_no: no };
  })();
  sumPO(out.id);
  audit('staff', req.user.id, req.user.name, '新增採購單', out.po_no, supplier.name);
  res.json(out);
});

router.put('/purchase-orders/:id', requireStaff('purchase'), (req, res) => {
  const b = req.body || {};
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '採購單不存在' });
  if (po.status === 'received') return res.status(400).json({ error: '已進貨的採購單不可修改，請先取消進貨' });
  db.transaction(() => {
    db.prepare(`UPDATE purchase_orders SET supplier_id = ?, warehouse_id = ?, order_date = ?, tax_mode = ?,
        due_date = ?, invoice_no = ?, note = ?, status = ? WHERE id = ?`)
      .run(b.supplier_id || po.supplier_id, b.warehouse_id || po.warehouse_id, b.order_date || po.order_date,
        b.tax_mode || po.tax_mode, b.due_date ?? po.due_date, b.invoice_no ?? po.invoice_no,
        b.note ?? po.note, b.status && b.status !== 'received' ? b.status : po.status, po.id);
    if (Array.isArray(b.items)) {
      db.prepare('DELETE FROM purchase_items WHERE po_id = ?').run(po.id);
      const ins = db.prepare('INSERT INTO purchase_items (po_id, product_id, qty, price, note) VALUES (?,?,?,?,?)');
      for (const it of b.items) {
        if (!it.product_id || !Number(it.qty)) continue;
        ins.run(po.id, it.product_id, Number(it.qty), Math.round(Number(it.price) || 0), it.note || '');
      }
    }
  })();
  sumPO(po.id);
  res.json({ ok: true });
});

// 進貨：整張單入庫並以進價重算移動平均成本
router.post('/purchase-orders/:id/receive', requireStaff('purchase'), (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '採購單不存在' });
  if (po.status === 'received') return res.status(400).json({ error: '此採購單已進貨' });
  if (po.status === 'cancelled') return res.status(400).json({ error: '已取消的採購單不可進貨' });
  const items = db.prepare('SELECT * FROM purchase_items WHERE po_id = ?').all(po.id);
  if (!items.length) return res.status(400).json({ error: '採購單沒有品項' });
  const arriveDate = req.body?.arrive_date || today();

  try {
    db.transaction(() => {
      for (const it of items) {
        applyMove({
          product_id: it.product_id, warehouse_id: po.warehouse_id, kind: 'purchase',
          qty: it.qty, cost: it.price, move_date: arriveDate,
          ref_type: 'purchase_order', ref_id: po.id, ref_no: po.po_no, user_id: req.user.id,
          note: `${po.po_no} 進貨`
        });
        db.prepare('UPDATE purchase_items SET received_qty = qty WHERE id = ?').run(it.id);
      }
      db.prepare("UPDATE purchase_orders SET status = 'received', arrive_date = ? WHERE id = ?").run(arriveDate, po.id);
    })();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  audit('staff', req.user.id, req.user.name, '採購進貨', po.po_no, `${items.length} 項`);
  res.json({ ok: true });
});

// 取消進貨：回沖庫存（成本不回頭改，避免歷史毛利跳動）
router.post('/purchase-orders/:id/unreceive', requireStaff('purchase'), (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '採購單不存在' });
  if (po.status !== 'received') return res.status(400).json({ error: '此採購單尚未進貨' });
  if (po.paid > 0) return res.status(400).json({ error: '已有付款紀錄，請先刪除付款再取消進貨' });
  db.transaction(() => {
    revertMoves('purchase_order', po.id, req.user.id);
    db.prepare("UPDATE purchase_orders SET status = 'ordered', arrive_date = '' WHERE id = ?").run(po.id);
    db.prepare('UPDATE purchase_items SET received_qty = 0 WHERE po_id = ?').run(po.id);
  })();
  audit('staff', req.user.id, req.user.name, '取消採購進貨', po.po_no);
  res.json({ ok: true });
});

// ================= 銷貨單 =================

router.get('/sales-orders', requireStaff('sales'), (req, res) => {
  const { status = '', customer_id = '', from = '', to = '' } = req.query;
  const where = [], args = [];
  if (status) { where.push('so.status = ?'); args.push(status); }
  if (customer_id) { where.push('so.customer_id = ?'); args.push(customer_id); }
  if (from) { where.push('so.order_date >= ?'); args.push(from); }
  if (to) { where.push('so.order_date <= ?'); args.push(to); }
  res.json(db.prepare(`
    SELECT so.*, c.name AS customer_name, w.name AS warehouse_name,
      (SELECT COUNT(*) FROM sales_items si WHERE si.so_id = so.id) AS item_count
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN warehouses w ON w.id = so.warehouse_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY so.order_date DESC, so.id DESC LIMIT 300`).all(...args));
});

router.get('/sales-orders/:id', requireStaff('sales'), (req, res) => {
  const so = db.prepare(`SELECT so.*, c.name AS customer_name, c.tax_id, c.address, w.name AS warehouse_name, u.name AS creator
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN warehouses w ON w.id = so.warehouse_id
    LEFT JOIN users u ON u.id = so.created_by WHERE so.id = ?`).get(req.params.id);
  if (!so) return res.status(404).json({ error: '銷貨單不存在' });
  so.items = db.prepare(`SELECT si.*, p.sku, p.name, p.spec, p.unit FROM sales_items si
    JOIN products p ON p.id = si.product_id WHERE si.so_id = ? ORDER BY si.id`).all(so.id);
  res.json(so);
});

function sumSO(soId) {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(soId);
  const agg = db.prepare('SELECT COALESCE(SUM(qty * price),0) v, COALESCE(SUM(qty * cost),0) c FROM sales_items WHERE so_id = ?').get(soId);
  const { net, tax, total } = calcTax(Math.max(0, agg.v - so.discount), so.tax_mode);
  db.prepare('UPDATE sales_orders SET subtotal = ?, tax = ?, total = ?, cost_total = ? WHERE id = ?')
    .run(net, tax, total, Math.round(agg.c), soId);
}

router.post('/sales-orders', requireStaff('sales'), (req, res) => {
  const b = req.body || {};
  if (!b.customer_id || !b.warehouse_id) return res.status(400).json({ error: '請選擇客戶與出貨倉別' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(b.customer_id);
  if (!customer) return res.status(400).json({ error: '客戶不存在' });
  const date = b.order_date || today();
  const out = db.transaction(() => {
    const no = nextDocNo('SO', date);
    const info = db.prepare(`INSERT INTO sales_orders
        (so_no, customer_id, warehouse_id, order_date, tax_mode, discount, note, created_by)
        VALUES (?,?,?,?,?,?,?,?)`)
      .run(no, b.customer_id, b.warehouse_id, date, b.tax_mode || 'exclusive',
        Math.round(Number(b.discount) || 0), b.note || '', req.user.id);
    const id = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO sales_items (so_id, product_id, qty, price, cost, note) VALUES (?,?,?,?,?,?)');
    for (const it of (b.items || [])) {
      if (!it.product_id || !Number(it.qty)) continue;
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      const price = it.price === undefined || it.price === '' ? priceFor(p, customer.price_level) : Math.round(Number(it.price));
      ins.run(id, it.product_id, Number(it.qty), price, p.cost, it.note || '');
    }
    return { id, so_no: no };
  })();
  sumSO(out.id);
  audit('staff', req.user.id, req.user.name, '新增銷貨單', out.so_no, customer.name);
  res.json(out);
});

router.put('/sales-orders/:id', requireStaff('sales'), (req, res) => {
  const b = req.body || {};
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!so) return res.status(404).json({ error: '銷貨單不存在' });
  if (so.status === 'shipped') return res.status(400).json({ error: '已出貨的銷貨單不可修改，請先取消出貨' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(b.customer_id || so.customer_id);
  db.transaction(() => {
    db.prepare(`UPDATE sales_orders SET customer_id = ?, warehouse_id = ?, order_date = ?, tax_mode = ?,
        discount = ?, note = ? WHERE id = ?`)
      .run(customer.id, b.warehouse_id || so.warehouse_id, b.order_date || so.order_date,
        b.tax_mode || so.tax_mode, Math.round(Number(b.discount) || 0), b.note ?? so.note, so.id);
    if (Array.isArray(b.items)) {
      db.prepare('DELETE FROM sales_items WHERE so_id = ?').run(so.id);
      const ins = db.prepare('INSERT INTO sales_items (so_id, product_id, qty, price, cost, note) VALUES (?,?,?,?,?,?)');
      for (const it of b.items) {
        if (!it.product_id || !Number(it.qty)) continue;
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
        const price = it.price === undefined || it.price === '' ? priceFor(p, customer.price_level) : Math.round(Number(it.price));
        ins.run(so.id, it.product_id, Number(it.qty), price, p.cost, it.note || '');
      }
    }
  })();
  sumSO(so.id);
  res.json({ ok: true });
});

router.post('/sales-orders/:id/ship', requireStaff('sales'), (req, res) => {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!so) return res.status(404).json({ error: '銷貨單不存在' });
  if (so.status === 'shipped') return res.status(400).json({ error: '此銷貨單已出貨' });
  const items = db.prepare('SELECT * FROM sales_items WHERE so_id = ?').all(so.id);
  if (!items.length) return res.status(400).json({ error: '銷貨單沒有品項' });
  try {
    db.transaction(() => {
      const upd = db.prepare('UPDATE sales_items SET cost = ? WHERE id = ?');
      for (const it of items) {
        const p = db.prepare('SELECT kind FROM products WHERE id = ?').get(it.product_id);
        if (p.kind === 'service') continue;
        const mv = applyMove({
          product_id: it.product_id, warehouse_id: so.warehouse_id, kind: 'sale', qty: -it.qty,
          move_date: so.order_date, ref_type: 'sales_order', ref_id: so.id, ref_no: so.so_no,
          user_id: req.user.id, note: `${so.so_no} 出貨`
        });
        upd.run(mv.cost, it.id);   // 出庫成本以當下移動平均為準
      }
      db.prepare("UPDATE sales_orders SET status = 'shipped' WHERE id = ?").run(so.id);
    })();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  sumSO(so.id);
  audit('staff', req.user.id, req.user.name, '銷貨出庫', so.so_no);
  res.json({ ok: true });
});

router.post('/sales-orders/:id/unship', requireStaff('sales'), (req, res) => {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id);
  if (!so) return res.status(404).json({ error: '銷貨單不存在' });
  if (so.status !== 'shipped') return res.status(400).json({ error: '此銷貨單尚未出貨' });
  db.transaction(() => {
    revertMoves('sales_order', so.id, req.user.id);
    db.prepare("UPDATE sales_orders SET status = 'draft' WHERE id = ?").run(so.id);
  })();
  audit('staff', req.user.id, req.user.name, '取消銷貨出庫', so.so_no);
  res.json({ ok: true });
});

// ================= 庫存查詢與異動 =================

router.get('/stocks', requireStaff(), (req, res) => {
  const { warehouse_id = '', q = '', nonzero = '1' } = req.query;
  const where = ['p.active = 1'], args = [];
  if (warehouse_id) { where.push('s.warehouse_id = ?'); args.push(warehouse_id); }
  if (nonzero === '1') where.push('s.qty != 0');
  if (q) { where.push('(p.sku LIKE ? OR p.name LIKE ? OR p.spec LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(db.prepare(`
    SELECT s.qty, s.warehouse_id, w.name AS warehouse_name, w.kind AS warehouse_kind,
      p.id AS product_id, p.sku, p.name, p.spec, p.unit, p.cost, p.safety_qty, p.price_retail,
      (s.qty * p.cost) AS value
    FROM stocks s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id
    WHERE ${where.join(' AND ')}
    ORDER BY w.kind, w.id, p.sku LIMIT 2000`).all(...args));
});

router.get('/stock-moves', requireStaff(), (req, res) => {
  const { product_id = '', warehouse_id = '', kind = '', from = '', to = '', ref_no = '' } = req.query;
  const where = [], args = [];
  if (product_id) { where.push('m.product_id = ?'); args.push(product_id); }
  if (warehouse_id) { where.push('m.warehouse_id = ?'); args.push(warehouse_id); }
  if (kind) { where.push('m.kind = ?'); args.push(kind); }
  if (from) { where.push('m.move_date >= ?'); args.push(from); }
  if (to) { where.push('m.move_date <= ?'); args.push(to); }
  if (ref_no) { where.push('m.ref_no LIKE ?'); args.push(`%${ref_no}%`); }
  res.json(db.prepare(`
    SELECT m.*, p.sku, p.name, p.spec, p.unit, w.name AS warehouse_name, u.name AS user_name
    FROM stock_moves m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id
    LEFT JOIN users u ON u.id = m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.id DESC LIMIT 1000`).all(...args));
});

// 手動調整（盤盈虧、報廢、期初建檔）
router.post('/stock-adjust', requireStaff('inventory'), (req, res) => {
  const b = req.body || {};
  if (!b.product_id || !b.warehouse_id) return res.status(400).json({ error: '請選擇料件與倉別' });
  const qty = Number(b.qty);
  if (!qty) return res.status(400).json({ error: '調整數量不可為 0' });
  if (!b.note) return res.status(400).json({ error: '請填寫調整原因（盤盈／盤虧／報廢／期初）' });
  try {
    applyMove({
      product_id: b.product_id, warehouse_id: b.warehouse_id, kind: 'adjust', qty,
      cost: b.cost, ref_type: 'manual', ref_no: '手動調整', user_id: req.user.id, note: b.note
    });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  audit('staff', req.user.id, req.user.name, '庫存調整', `料件#${b.product_id}`, `${qty} / ${b.note}`);
  res.json({ ok: true });
});

// 倉別調撥（主倉 ↔ 技師車庫存，冷凍空調業很常用）
router.post('/stock-transfer', requireStaff('inventory'), (req, res) => {
  const b = req.body || {};
  const qty = Number(b.qty);
  if (!b.product_id || !b.from_warehouse_id || !b.to_warehouse_id) {
    return res.status(400).json({ error: '請選擇料件與來源／目的倉別' });
  }
  if (Number(b.from_warehouse_id) === Number(b.to_warehouse_id)) {
    return res.status(400).json({ error: '來源與目的倉別不可相同' });
  }
  if (!(qty > 0)) return res.status(400).json({ error: '調撥數量需大於 0' });
  try {
    db.transaction(() => {
      const out = applyMove({
        product_id: b.product_id, warehouse_id: b.from_warehouse_id, kind: 'transfer_out', qty: -qty,
        ref_type: 'transfer', ref_no: '調撥', user_id: req.user.id, note: b.note || ''
      });
      applyMove({
        product_id: b.product_id, warehouse_id: b.to_warehouse_id, kind: 'transfer_in', qty,
        cost: out.cost, ref_type: 'transfer', ref_no: '調撥', user_id: req.user.id, note: b.note || ''
      });
    })();
  } catch (e) { return res.status(400).json({ error: e.message }); }
  audit('staff', req.user.id, req.user.name, '倉別調撥', `料件#${b.product_id}`, `${qty}`);
  res.json({ ok: true });
});

router.get('/low-stock', requireStaff(), (req, res) => res.json(lowStockList()));

// ================= 盤點 =================

router.get('/stocktakes', requireStaff('stocktake'), (req, res) => {
  res.json(db.prepare(`SELECT st.*, w.name AS warehouse_name, u.name AS creator,
      (SELECT COUNT(*) FROM stocktake_items si WHERE si.take_id = st.id) AS item_count,
      (SELECT COUNT(*) FROM stocktake_items si WHERE si.take_id = st.id AND si.counted_qty IS NOT NULL) AS counted
    FROM stocktakes st JOIN warehouses w ON w.id = st.warehouse_id LEFT JOIN users u ON u.id = st.created_by
    ORDER BY st.id DESC LIMIT 100`).all());
});

router.get('/stocktakes/:id', requireStaff('stocktake'), (req, res) => {
  const st = db.prepare(`SELECT st.*, w.name AS warehouse_name FROM stocktakes st
    JOIN warehouses w ON w.id = st.warehouse_id WHERE st.id = ?`).get(req.params.id);
  if (!st) return res.status(404).json({ error: '盤點單不存在' });
  st.items = db.prepare(`SELECT si.*, p.sku, p.name, p.spec, p.unit, p.cost,
      (COALESCE(si.counted_qty, si.system_qty) - si.system_qty) AS diff
    FROM stocktake_items si JOIN products p ON p.id = si.product_id
    WHERE si.take_id = ? ORDER BY p.sku`).all(st.id);
  res.json(st);
});

// 開盤點單：把該倉現有庫存全部拉進來當帳面數
router.post('/stocktakes', requireStaff('stocktake'), (req, res) => {
  const b = req.body || {};
  if (!b.warehouse_id) return res.status(400).json({ error: '請選擇盤點倉別' });
  const open = db.prepare("SELECT take_no FROM stocktakes WHERE warehouse_id = ? AND status = 'open'").get(b.warehouse_id);
  if (open) return res.status(400).json({ error: `此倉尚有未結案的盤點單 ${open.take_no}` });
  const date = b.take_date || today();
  const out = db.transaction(() => {
    const no = nextDocNo('ST', date);
    const info = db.prepare('INSERT INTO stocktakes (take_no, warehouse_id, take_date, note, created_by) VALUES (?,?,?,?,?)')
      .run(no, b.warehouse_id, date, b.note || '', req.user.id);
    const id = info.lastInsertRowid;
    // 含庫存為 0 的品項一併列入，才盤得出「帳上沒有但現場有」的東西
    const rows = db.prepare(`SELECT p.id, COALESCE(s.qty, 0) AS qty FROM products p
      LEFT JOIN stocks s ON s.product_id = p.id AND s.warehouse_id = ?
      WHERE p.active = 1 AND p.kind != 'service'`).all(b.warehouse_id);
    const ins = db.prepare('INSERT INTO stocktake_items (take_id, product_id, system_qty) VALUES (?,?,?)');
    for (const r of rows) ins.run(id, r.id, r.qty);
    return { id, take_no: no, item_count: rows.length };
  })();
  audit('staff', req.user.id, req.user.name, '開立盤點單', out.take_no);
  res.json(out);
});

router.put('/stocktake-items/:id', requireStaff('stocktake'), (req, res) => {
  const it = db.prepare('SELECT * FROM stocktake_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: '盤點項目不存在' });
  const st = db.prepare('SELECT * FROM stocktakes WHERE id = ?').get(it.take_id);
  if (st.status !== 'open') return res.status(400).json({ error: '此盤點單已結案' });
  const v = req.body?.counted_qty;
  db.prepare('UPDATE stocktake_items SET counted_qty = ?, note = ? WHERE id = ?')
    .run(v === '' || v === null || v === undefined ? null : Number(v), req.body?.note || it.note, it.id);
  res.json({ ok: true });
});

// 結案：把實盤與帳面的差額寫成 adjust 異動
router.post('/stocktakes/:id/close', requireStaff('stocktake'), (req, res) => {
  const st = db.prepare('SELECT * FROM stocktakes WHERE id = ?').get(req.params.id);
  if (!st) return res.status(404).json({ error: '盤點單不存在' });
  if (st.status !== 'open') return res.status(400).json({ error: '此盤點單已結案' });
  const items = db.prepare('SELECT * FROM stocktake_items WHERE take_id = ? AND counted_qty IS NOT NULL').all(st.id);
  let adjusted = 0;
  db.transaction(() => {
    for (const it of items) {
      // 以結案當下的實際庫存為準重算差額，避免盤點期間有其他進出造成重複調整
      const current = getStock(it.product_id, st.warehouse_id);
      const diff = Number((it.counted_qty - current).toFixed(4));
      if (!diff) continue;
      applyMove({
        product_id: it.product_id, warehouse_id: st.warehouse_id, kind: 'adjust', qty: diff,
        move_date: st.take_date, ref_type: 'stocktake', ref_id: st.id, ref_no: st.take_no,
        user_id: req.user.id, note: `盤點調整（帳面 ${current} → 實盤 ${it.counted_qty}）`
      });
      adjusted++;
    }
    db.prepare("UPDATE stocktakes SET status = 'closed' WHERE id = ?").run(st.id);
  })();
  audit('staff', req.user.id, req.user.name, '盤點結案', st.take_no, `調整 ${adjusted} 項`);
  res.json({ ok: true, adjusted });
});

router.get('/stock-kinds', requireStaff(), (req, res) => res.json(KIND_TW));

module.exports = router;
