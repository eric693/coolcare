// 報價單、請款單（應收）、收付款、應付帳款、技師抽成結算
const express = require('express');
const { db, audit, getSetting, today, thisMonth, addDays, nextDocNo, calcTax } = require('../db');
const { requireStaff } = require('../auth');
const { priceFor } = require('../stock');

const router = express.Router();

// ================= 報價單 =================

router.get('/quotes', requireStaff('quotes'), (req, res) => {
  const { status = '', customer_id = '', q = '' } = req.query;
  const where = [], args = [];
  if (status) { where.push('qt.status = ?'); args.push(status); }
  if (customer_id) { where.push('qt.customer_id = ?'); args.push(customer_id); }
  if (q) { where.push('(qt.quote_no LIKE ? OR qt.title LIKE ? OR c.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = db.prepare(`
    SELECT qt.*, c.name AS customer_name, s.name AS site_name, u.name AS creator,
      (SELECT COUNT(*) FROM quote_items qi WHERE qi.quote_id = qt.id) AS item_count,
      w.order_no
    FROM quotes qt JOIN customers c ON c.id = qt.customer_id
    LEFT JOIN sites s ON s.id = qt.site_id LEFT JOIN users u ON u.id = qt.created_by
    LEFT JOIN work_orders w ON w.id = qt.order_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY qt.id DESC LIMIT 300`).all(...args);
  // 過期判定：送出後超過有效天數仍未成交
  const d = today();
  for (const r of rows) {
    if (r.status === 'sent' && addDays(r.quote_date, r.valid_days) < d) r.status = 'expired';
  }
  res.json(rows);
});

router.get('/quotes/:id', requireStaff('quotes'), (req, res) => {
  const qt = db.prepare(`SELECT qt.*, c.name AS customer_name, c.tax_id, c.address, c.contact, c.phone,
      s.name AS site_name, s.address AS site_address, u.name AS creator
    FROM quotes qt JOIN customers c ON c.id = qt.customer_id
    LEFT JOIN sites s ON s.id = qt.site_id LEFT JOIN users u ON u.id = qt.created_by WHERE qt.id = ?`)
    .get(req.params.id);
  if (!qt) return res.status(404).json({ error: '報價單不存在' });
  qt.items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id').all(qt.id);
  qt.valid_until = addDays(qt.quote_date, qt.valid_days);
  qt.gross_profit = qt.subtotal - qt.items.reduce((s, i) => s + i.qty * i.cost, 0);
  res.json(qt);
});

function sumQuote(id) {
  const qt = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  const sub = db.prepare('SELECT COALESCE(SUM(qty * price),0) v FROM quote_items WHERE quote_id = ?').get(id).v;
  const { net, tax, total } = calcTax(Math.max(0, sub - qt.discount), qt.tax_mode);
  db.prepare('UPDATE quotes SET subtotal = ?, tax = ?, total = ? WHERE id = ?').run(net, tax, total, id);
}

function writeQuoteItems(quoteId, items, priceLevel) {
  db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
  const ins = db.prepare(`INSERT INTO quote_items (quote_id, product_id, name, spec, unit, qty, price, cost, note)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const it of (items || [])) {
    let { name = '', spec = '', unit = '式', qty = 1, price = 0, cost = 0 } = it;
    if (it.product_id) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (p) {
        name = name || p.name; spec = spec || p.spec; unit = p.unit; cost = p.cost;
        if (price === '' || price === undefined) price = priceFor(p, priceLevel);
      }
    }
    if (!name) continue;
    ins.run(quoteId, it.product_id || null, name, spec, unit, Number(qty) || 0,
      Math.round(Number(price) || 0), Math.round(Number(cost) || 0), it.note || '');
  }
}

router.post('/quotes', requireStaff('quotes'), (req, res) => {
  const b = req.body || {};
  if (!b.customer_id) return res.status(400).json({ error: '請選擇客戶' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(b.customer_id);
  const date = b.quote_date || today();
  const out = db.transaction(() => {
    const no = nextDocNo('QT', date);
    const info = db.prepare(`INSERT INTO quotes
        (quote_no, customer_id, site_id, quote_date, valid_days, title, tax_mode, discount, terms, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(no, customer.id, b.site_id || null, date, Number(b.valid_days) || 30, b.title || '',
        b.tax_mode || 'exclusive', Math.round(Number(b.discount) || 0), b.terms || '', req.user.id);
    const id = info.lastInsertRowid;
    writeQuoteItems(id, b.items, customer.price_level);
    return { id, quote_no: no };
  })();
  sumQuote(out.id);
  audit('staff', req.user.id, req.user.name, '新增報價單', out.quote_no, customer.name);
  res.json(out);
});

router.put('/quotes/:id', requireStaff('quotes'), (req, res) => {
  const b = req.body || {};
  const qt = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!qt) return res.status(404).json({ error: '報價單不存在' });
  if (qt.status === 'accepted') return res.status(400).json({ error: '已成交的報價單不可修改' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(qt.customer_id);
  db.transaction(() => {
    db.prepare(`UPDATE quotes SET site_id = ?, quote_date = ?, valid_days = ?, title = ?, tax_mode = ?,
        discount = ?, terms = ?, status = ? WHERE id = ?`)
      .run(b.site_id || null, b.quote_date || qt.quote_date, Number(b.valid_days) || qt.valid_days,
        b.title ?? qt.title, b.tax_mode || qt.tax_mode, Math.round(Number(b.discount) || 0),
        b.terms ?? qt.terms, b.status || qt.status, qt.id);
    if (Array.isArray(b.items)) writeQuoteItems(qt.id, b.items, customer.price_level);
  })();
  sumQuote(qt.id);
  res.json({ ok: true });
});

router.delete('/quotes/:id', requireStaff('quotes'), (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!qt) return res.status(404).json({ error: '報價單不存在' });
  if (qt.order_id) return res.status(400).json({ error: '已轉工單的報價不可刪除' });
  db.prepare('DELETE FROM quotes WHERE id = ?').run(qt.id);
  res.json({ ok: true });
});

// 報價成交 → 轉開工單，報價品項帶進工單的預定用料
router.post('/quotes/:id/to-order', requireStaff('quotes'), (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!qt) return res.status(404).json({ error: '報價單不存在' });
  if (qt.order_id) return res.status(400).json({ error: `此報價已轉出工單` });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(qt.customer_id);
  const site = qt.site_id ? db.prepare('SELECT * FROM sites WHERE id = ?').get(qt.site_id) : null;
  const appointDate = req.body?.appoint_date || today();

  const out = db.transaction(() => {
    const no = nextDocNo('WO', appointDate);
    const info = db.prepare(`INSERT INTO work_orders
        (order_no, type, source, customer_id, site_id, contact, phone, address, title, status,
         appoint_date, tax_mode, note, created_by)
        VALUES (?,?,'報價成交',?,?,?,?,?,?,'draft',?,?,?,?)`)
      .run(no, req.body?.type || 'install', customer.id, qt.site_id || null,
        (site && site.contact) || customer.contact, (site && site.phone) || customer.phone,
        (site && site.address) || customer.address, qt.title || `${qt.quote_no} 施工`,
        appointDate, qt.tax_mode, `由報價單 ${qt.quote_no} 轉入`, req.user.id);
    const orderId = info.lastInsertRowid;
    db.prepare("UPDATE quotes SET status = 'accepted', order_id = ? WHERE id = ?").run(orderId, qt.id);
    return { id: orderId, order_no: no };
  })();
  audit('staff', req.user.id, req.user.name, '報價轉工單', qt.quote_no, out.order_no);
  res.json(out);
});

// ================= 請款單（應收） =================

router.get('/invoices', requireStaff('billing'), (req, res) => {
  const { status = '', customer_id = '', from = '', to = '', overdue = '' } = req.query;
  const where = [], args = [];
  if (status === 'open') where.push("i.status IN ('unpaid','partial')");
  else if (status) { where.push('i.status = ?'); args.push(status); }
  if (customer_id) { where.push('i.customer_id = ?'); args.push(customer_id); }
  if (from) { where.push('i.issue_date >= ?'); args.push(from); }
  if (to) { where.push('i.issue_date <= ?'); args.push(to); }
  if (overdue === '1') { where.push("i.status IN ('unpaid','partial') AND i.due_date != '' AND i.due_date < ?"); args.push(today()); }
  res.json(db.prepare(`
    SELECT i.*, c.name AS customer_name, c.tax_id, (i.total - i.paid) AS balance
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`).all(...args));
});

router.get('/invoices/:id', requireStaff('billing'), (req, res) => {
  const inv = db.prepare(`SELECT i.*, c.name AS customer_name, c.tax_id, c.invoice_title, c.address, c.contact, c.phone
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`).get(req.params.id);
  if (!inv) return res.status(404).json({ error: '請款單不存在' });
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(inv.id);
  inv.payments = db.prepare(`SELECT p.*, u.name AS user_name FROM payments p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.invoice_id = ? ORDER BY p.pay_date`).all(inv.id);
  inv.company = {
    name: getSetting('company_name'), tax_id: getSetting('company_tax_id'),
    phone: getSetting('company_phone'), address: getSetting('company_address'),
    bank: getSetting('company_bank')
  };
  res.json(inv);
});

function sumInvoice(id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const sub = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM invoice_items WHERE invoice_id = ?').get(id).v;
  // 請款單金額一律以「含稅總額」呈現，明細存未稅
  const { net, tax, total } = calcTax(sub, 'exclusive');
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE invoice_id = ? AND direction = 'in'").get(id).v;
  const status = inv.status === 'void' ? 'void' : (paid <= 0 ? 'unpaid' : (paid >= total ? 'paid' : 'partial'));
  db.prepare('UPDATE invoices SET subtotal = ?, tax = ?, total = ?, paid = ?, status = ? WHERE id = ?')
    .run(net, tax, total, paid, status, id);
}

// 由已完工工單開請款單（可多張工單併成一張月結單）
router.post('/invoices/from-orders', requireStaff('billing'), (req, res) => {
  const ids = Array.isArray(req.body?.order_ids) ? req.body.order_ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: '請選擇要請款的工單' });
  const orders = db.prepare(`SELECT * FROM work_orders WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (orders.length !== ids.length) return res.status(400).json({ error: '部分工單不存在' });
  const bad = orders.find(o => !['done', 'confirmed'].includes(o.status));
  if (bad) return res.status(400).json({ error: `工單 ${bad.order_no} 尚未完工，不可請款` });
  const cid = orders[0].customer_id;
  if (orders.some(o => o.customer_id !== cid)) return res.status(400).json({ error: '同一張請款單只能併同一位客戶的工單' });
  const free = orders.find(o => o.is_warranty || o.is_contract);
  if (free && orders.length === 1) return res.status(400).json({ error: `工單 ${free.order_no} 為保固／合約內免費，無須請款` });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(cid);
  const issueDate = req.body?.issue_date || today();
  const dueDays = Number(getSetting('invoice_due_days', '30'));

  const out = db.transaction(() => {
    const no = nextDocNo('IV', issueDate);
    const info = db.prepare(`INSERT INTO invoices
        (inv_no, customer_id, issue_date, due_date, period, source_type, source_ids, note, created_by)
        VALUES (?,?,?,?,?,'work_order',?,?,?)`)
      .run(no, cid, issueDate, req.body?.due_date || addDays(issueDate, dueDays),
        issueDate.slice(0, 7), ',' + ids.join(',') + ',', req.body?.note || '', req.user.id);
    const id = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id, name, qty, unit, price, amount, note) VALUES (?,?,?,?,?,?,?)');
    for (const o of orders) {
      if (o.is_warranty || o.is_contract) continue;
      // 每張工單列成一行：工資＋車馬＋材料＋其他－折扣的未稅小計
      const net = Math.max(0, o.labor_fee + o.travel_fee + o.parts_fee + o.other_fee - o.discount);
      ins.run(id, `${o.order_no} ${o.title || o.action || '施工服務'}（${o.finished_at ? o.finished_at.slice(0, 10) : o.appoint_date}）`,
        1, '式', net, net, o.address);
      db.prepare("UPDATE work_orders SET status = 'billed' WHERE id = ?").run(o.id);
    }
    return { id, inv_no: no };
  })();
  sumInvoice(out.id);
  audit('staff', req.user.id, req.user.name, '開立請款單', out.inv_no, `${customer.name} / ${ids.length} 張工單`);
  res.json(out);
});

// 手動開立（合約費、工程款分期等）
router.post('/invoices', requireStaff('billing'), (req, res) => {
  const b = req.body || {};
  if (!b.customer_id) return res.status(400).json({ error: '請選擇客戶' });
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: '請至少填寫一筆請款明細' });
  const issueDate = b.issue_date || today();
  const out = db.transaction(() => {
    const no = nextDocNo('IV', issueDate);
    const info = db.prepare(`INSERT INTO invoices
        (inv_no, customer_id, issue_date, due_date, period, source_type, note, created_by)
        VALUES (?,?,?,?,?,?,?,?)`)
      .run(no, b.customer_id, issueDate, b.due_date || addDays(issueDate, Number(getSetting('invoice_due_days', '30'))),
        issueDate.slice(0, 7), b.source_type || 'manual', b.note || '', req.user.id);
    const id = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id, name, qty, unit, price, amount, note) VALUES (?,?,?,?,?,?,?)');
    for (const it of b.items) {
      if (!it.name) continue;
      const qty = Number(it.qty) || 1, price = Math.round(Number(it.price) || 0);
      ins.run(id, it.name, qty, it.unit || '式', price, Math.round(qty * price), it.note || '');
    }
    return { id, inv_no: no };
  })();
  sumInvoice(out.id);
  audit('staff', req.user.id, req.user.name, '手動開立請款單', out.inv_no);
  res.json(out);
});

router.put('/invoices/:id', requireStaff('billing'), (req, res) => {
  const b = req.body || {};
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: '請款單不存在' });
  if (inv.status === 'void') return res.status(400).json({ error: '已作廢的請款單不可修改' });
  db.prepare(`UPDATE invoices SET due_date = ?, tax_invoice_no = ?, tax_invoice_date = ?, note = ? WHERE id = ?`)
    .run(b.due_date ?? inv.due_date, b.tax_invoice_no ?? inv.tax_invoice_no,
      b.tax_invoice_date ?? inv.tax_invoice_date, b.note ?? inv.note, inv.id);
  res.json({ ok: true });
});

router.post('/invoices/:id/void', requireStaff('billing'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: '請款單不存在' });
  if (inv.paid > 0) return res.status(400).json({ error: '已有收款紀錄，請先刪除收款再作廢' });
  db.transaction(() => {
    db.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").run(inv.id);
    // 併入的工單退回「客戶已確認」，可重新請款
    const ids = inv.source_ids.split(',').map(Number).filter(Boolean);
    if (inv.source_type === 'work_order' && ids.length) {
      db.prepare(`UPDATE work_orders SET status = 'confirmed' WHERE id IN (${ids.map(() => '?').join(',')}) AND status = 'billed'`).run(...ids);
    }
  })();
  audit('staff', req.user.id, req.user.name, '作廢請款單', inv.inv_no);
  res.json({ ok: true });
});

// ================= 收付款 =================

router.post('/payments', requireStaff('billing'), (req, res) => {
  const b = req.body || {};
  const amount = Math.round(Number(b.amount) || 0);
  if (!amount) return res.status(400).json({ error: '請填寫金額' });
  if (!b.invoice_id && !b.po_id) return res.status(400).json({ error: '請指定請款單或採購單' });

  if (b.invoice_id) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(b.invoice_id);
    if (!inv) return res.status(404).json({ error: '請款單不存在' });
    if (inv.status === 'void') return res.status(400).json({ error: '已作廢的請款單不可收款' });
    if (amount > inv.total - inv.paid) return res.status(400).json({ error: `收款金額超過未收餘額 ${inv.total - inv.paid}` });
    db.prepare(`INSERT INTO payments (invoice_id, direction, pay_date, amount, method, ref_no, user_id, note)
      VALUES (?,'in',?,?,?,?,?,?)`)
      .run(inv.id, b.pay_date || today(), amount, b.method || '現金', b.ref_no || '', req.user.id, b.note || '');
    sumInvoice(inv.id);
    audit('staff', req.user.id, req.user.name, '登錄收款', inv.inv_no, String(amount));
    return res.json({ ok: true });
  }

  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(b.po_id);
  if (!po) return res.status(404).json({ error: '採購單不存在' });
  if (amount > po.total - po.paid) return res.status(400).json({ error: `付款金額超過未付餘額 ${po.total - po.paid}` });
  db.transaction(() => {
    db.prepare(`INSERT INTO payments (po_id, direction, pay_date, amount, method, ref_no, user_id, note)
      VALUES (?,'out',?,?,?,?,?,?)`)
      .run(po.id, b.pay_date || today(), amount, b.method || '匯款', b.ref_no || '', req.user.id, b.note || '');
    const paid = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE po_id = ? AND direction = 'out'").get(po.id).v;
    db.prepare('UPDATE purchase_orders SET paid = ? WHERE id = ?').run(paid, po.id);
  })();
  audit('staff', req.user.id, req.user.name, '登錄付款', po.po_no, String(amount));
  res.json({ ok: true });
});

router.delete('/payments/:id', requireStaff('billing'), (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '款項紀錄不存在' });
  db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(p.id);
    if (p.invoice_id) sumInvoice(p.invoice_id);
    if (p.po_id) {
      const paid = db.prepare("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE po_id = ? AND direction = 'out'").get(p.po_id).v;
      db.prepare('UPDATE purchase_orders SET paid = ? WHERE id = ?').run(paid, p.po_id);
    }
  })();
  audit('staff', req.user.id, req.user.name, '刪除款項紀錄', String(p.id));
  res.json({ ok: true });
});

// 應收帳齡分析（催收用）
router.get('/ar-aging', requireStaff('billing'), (req, res) => {
  const d = today();
  const rows = db.prepare(`SELECT i.id, i.inv_no, i.issue_date, i.due_date, i.total, i.paid, (i.total - i.paid) AS balance,
      c.name AS customer_name, c.phone, c.payment_terms
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.status IN ('unpaid','partial') ORDER BY i.due_date`).all();
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  for (const r of rows) {
    const overdue = r.due_date ? Math.floor((new Date(d) - new Date(r.due_date)) / 86400000) : 0;
    r.overdue_days = Math.max(0, overdue);
    const k = overdue <= 0 ? 'current' : overdue <= 30 ? 'd30' : overdue <= 60 ? 'd60' : overdue <= 90 ? 'd90' : 'over90';
    r.bucket = k;
    buckets[k] += r.balance;
  }
  res.json({ rows, buckets });
});

// 應付帳款
router.get('/ap-list', requireStaff('billing'), (req, res) => {
  const rows = db.prepare(`SELECT po.id, po.po_no, po.order_date, po.arrive_date, po.due_date, po.invoice_no,
      po.total, po.paid, (po.total - po.paid) AS balance, s.name AS supplier_name, s.phone, s.payment_terms
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status = 'received' AND po.total > po.paid ORDER BY po.due_date`).all();
  res.json({ rows, total: rows.reduce((s, r) => s + r.balance, 0) });
});

// ================= 技師抽成 =================

router.get('/commissions', requireStaff('commission'), (req, res) => {
  const { period = thisMonth(), user_id = '', status = '' } = req.query;
  const where = ['cm.period = ?'], args = [period];
  if (user_id) { where.push('cm.user_id = ?'); args.push(user_id); }
  if (status) { where.push('cm.status = ?'); args.push(status); }
  const rows = db.prepare(`
    SELECT cm.*, u.name AS user_name, u.tech_no, w.order_no, w.title, w.finished_at, w.total AS order_total,
      c.name AS customer_name
    FROM commissions cm JOIN users u ON u.id = cm.user_id
    LEFT JOIN work_orders w ON w.id = cm.order_id
    LEFT JOIN customers c ON c.id = w.customer_id
    WHERE ${where.join(' AND ')} ORDER BY u.name, cm.id`).all(...args);
  // 依技師彙總
  const byUser = {};
  for (const r of rows) {
    const u = byUser[r.user_id] || (byUser[r.user_id] = {
      user_id: r.user_id, name: r.user_name, tech_no: r.tech_no, orders: 0, base: 0, amount: 0, pending: 0, settled: 0
    });
    u.orders++;
    u.base += r.base_amount;
    u.amount += r.amount;
    if (r.status === 'pending') u.pending += r.amount;
    if (r.status === 'settled') u.settled += r.amount;
  }
  res.json({ period, rows, summary: Object.values(byUser) });
});

router.put('/commissions/:id', requireStaff('commission'), (req, res) => {
  const b = req.body || {};
  const cm = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!cm) return res.status(404).json({ error: '抽成紀錄不存在' });
  if (cm.status === 'settled') return res.status(400).json({ error: '已結算的抽成不可修改' });
  const rate = b.rate === undefined ? cm.rate : Number(b.rate);
  const base = b.base_amount === undefined ? cm.base_amount : Math.round(Number(b.base_amount));
  db.prepare('UPDATE commissions SET rate = ?, base_amount = ?, amount = ?, note = ? WHERE id = ?')
    .run(rate, base, Math.round(base * rate), b.note ?? cm.note, cm.id);
  audit('staff', req.user.id, req.user.name, '調整抽成', String(cm.id));
  res.json({ ok: true });
});

// 整月結算：把該期別的 pending 全部轉 settled
router.post('/commissions/settle', requireStaff('commission'), (req, res) => {
  const period = req.body?.period || thisMonth();
  const userId = req.body?.user_id || null;
  const where = ["period = ?", "status = 'pending'"], args = [period];
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  const info = db.prepare(`UPDATE commissions SET status = 'settled', settled_at = ?
    WHERE ${where.join(' AND ')}`).run(today(), ...args);
  audit('staff', req.user.id, req.user.name, '結算抽成', period, `${info.changes} 筆`);
  res.json({ settled: info.changes });
});

module.exports = router;
