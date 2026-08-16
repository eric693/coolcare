// 客戶專區：線上報修、進度查詢、設備清單、保養合約、帳單
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit, getSetting, today, nowStamp, nextDocNo } = require('../db');
const {
  PORTAL_COOKIE, signToken, setAuthCookie, clearAuthCookie, requireCustomer,
  loginLockedMinutes, loginFailed, loginSucceeded, rateLimit
} = require('../auth');

const router = express.Router();
const portalRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, prefix: 'portal:' });

const STATUS_TW = {
  draft: '受理中', assigned: '已排定師傅', departed: '師傅已出發', working: '施工中',
  done: '已完工', confirmed: '已確認', billed: '已請款', cancelled: '已取消'
};

router.post('/login', portalRateLimit, (req, res) => {
  const { phone, password } = req.body || {};
  const key = `portal:${phone || ''}`;
  const locked = loginLockedMinutes(key);
  if (locked) return res.status(429).json({ error: `登入失敗次數過多，請 ${locked} 分鐘後再試` });
  const cu = db.prepare('SELECT * FROM customer_users WHERE phone = ? AND active = 1').get(String(phone || '').replace(/\D/g, ''));
  if (!cu || !bcrypt.compareSync(password || '', cu.password_hash)) {
    loginFailed(key);
    return res.status(401).json({ error: '手機號碼或密碼錯誤' });
  }
  loginSucceeded(key);
  db.prepare('UPDATE customer_users SET last_login = ? WHERE id = ?').run(nowStamp(), cu.id);
  setAuthCookie(res, PORTAL_COOKIE, signToken({ t: 'customer', id: cu.id }));
  audit('customer', cu.id, cu.name || cu.phone, '客戶登入');
  res.json({ ok: true, must_change_password: !!cu.must_change_password });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res, PORTAL_COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireCustomer, (req, res) => {
  res.json({
    id: req.cu.id, name: req.cu.name, phone: req.cu.phone,
    must_change_password: !!req.cu.must_change_password,
    customer: { id: req.customer.id, name: req.customer.name, payment_terms: req.customer.payment_terms },
    company_name: getSetting('company_name'),
    company_phone: getSetting('company_phone')
  });
});

router.put('/password', requireCustomer, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!bcrypt.compareSync(old_password || '', req.cu.password_hash)) {
    return res.status(400).json({ error: '舊密碼不正確' });
  }
  if (!new_password || String(new_password).length < 6) return res.status(400).json({ error: '新密碼至少 6 碼' });
  db.prepare('UPDATE customer_users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(String(new_password), 10), req.cu.id);
  res.json({ ok: true });
});

// 首頁：進行中案件、設備、合約、未付帳單
router.get('/overview', requireCustomer, (req, res) => {
  const cid = req.customer.id;
  const d = today();
  res.json({
    open_orders: db.prepare(`SELECT id, order_no, type, title, status, appoint_date, appoint_slot, address
      FROM work_orders WHERE customer_id = ? AND status IN ('draft','assigned','departed','working')
      ORDER BY appoint_date`).all(cid),
    equipment_count: db.prepare("SELECT COUNT(*) n FROM equipments WHERE customer_id = ? AND status != 'scrapped'").get(cid).n,
    due_services: db.prepare(`SELECT e.id, e.asset_no, e.brand, e.model, e.location, e.next_service_date
      FROM equipments e WHERE e.customer_id = ? AND e.status = 'active'
      AND e.next_service_date != '' AND e.next_service_date <= date(?, '+30 days')
      ORDER BY e.next_service_date`).all(cid, d),
    contracts: db.prepare(`SELECT id, contract_no, title, start_date, end_date, next_visit_date, status
      FROM service_contracts WHERE customer_id = ? AND status = 'active' ORDER BY end_date`).all(cid),
    unpaid: db.prepare(`SELECT id, inv_no, issue_date, due_date, total, paid, (total - paid) AS balance, status
      FROM invoices WHERE customer_id = ? AND status IN ('unpaid','partial') ORDER BY due_date`).all(cid),
    announcements: db.prepare(`SELECT title, body, publish_date FROM announcements
      WHERE to_customer = 1 AND (publish_date = '' OR publish_date <= ?) AND (expire_date = '' OR expire_date >= ?)
      ORDER BY publish_date DESC LIMIT 5`).all(d, d)
  });
});

// 線上報修
router.post('/repair-request', requireCustomer, (req, res) => {
  const b = req.body || {};
  if (!b.symptom) return res.status(400).json({ error: '請描述故障狀況' });
  const site = b.site_id
    ? db.prepare('SELECT * FROM sites WHERE id = ? AND customer_id = ?').get(b.site_id, req.customer.id)
    : null;
  if (b.site_id && !site) return res.status(400).json({ error: '服務地點不存在' });
  const appointDate = b.appoint_date || today();

  const out = db.transaction(() => {
    const no = nextDocNo('WO', appointDate);
    const info = db.prepare(`INSERT INTO work_orders
        (order_no, type, source, customer_id, site_id, contact, phone, address, title, symptom,
         priority, status, appoint_date, appoint_slot, note)
        VALUES (?,?, '客戶專區',?,?,?,?,?,?,?,?,'draft',?,?,?)`)
      .run(no, b.type === 'maintain' ? 'maintain' : 'repair', req.customer.id, b.site_id || null,
        b.contact || req.cu.name || req.customer.contact, b.phone || req.cu.phone,
        (site && site.address) || req.customer.address, b.title || '客戶線上報修', b.symptom,
        b.priority === 'urgent' ? 'urgent' : 'normal', appointDate, b.appoint_slot || '',
        `由客戶專區送出（${req.cu.phone}）`);
    const id = info.lastInsertRowid;
    // 客戶勾選的機台一併帶入，師傅出門前就知道要處理哪幾台
    if (Array.isArray(b.equipment_ids) && b.equipment_ids.length) {
      const own = db.prepare(`SELECT id FROM equipments WHERE customer_id = ? AND id IN (${b.equipment_ids.map(() => '?').join(',')})`)
        .all(req.customer.id, ...b.equipment_ids);
      const ins = db.prepare('INSERT OR IGNORE INTO work_order_equipments (order_id, equipment_id) VALUES (?,?)');
      for (const e of own) ins.run(id, e.id);
    }
    return { id, order_no: no };
  })();
  audit('customer', req.cu.id, req.cu.name || req.cu.phone, '線上報修', out.order_no, b.symptom.slice(0, 60));
  res.json(out);
});

// 案件列表與進度
router.get('/orders', requireCustomer, (req, res) => {
  const rows = db.prepare(`SELECT id, order_no, type, title, symptom, status, priority, appoint_date, appoint_slot,
      finished_at, total, is_warranty, is_contract, rating
    FROM work_orders WHERE customer_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 100`)
    .all(req.customer.id);
  res.json(rows.map(r => ({ ...r, status_text: STATUS_TW[r.status] || r.status })));
});

router.get('/orders/:id', requireCustomer, (req, res) => {
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ? AND customer_id = ?')
    .get(req.params.id, req.customer.id);
  if (!w) return res.status(404).json({ error: '案件不存在' });
  res.json({
    id: w.id, order_no: w.order_no, type: w.type, title: w.title, symptom: w.symptom,
    status: w.status, status_text: STATUS_TW[w.status] || w.status,
    appoint_date: w.appoint_date, appoint_slot: w.appoint_slot, address: w.address,
    departed_at: w.departed_at, arrived_at: w.arrived_at, finished_at: w.finished_at,
    cause: w.cause, action: w.action, suggestion: w.suggestion,
    labor_fee: w.labor_fee, travel_fee: w.travel_fee, parts_fee: w.parts_fee,
    other_fee: w.other_fee, discount: w.discount, total: w.total,
    is_warranty: w.is_warranty, is_contract: w.is_contract, rating: w.rating,
    // 客戶看得到品名數量與售價，但看不到我們的進價
    items: db.prepare('SELECT name, spec, unit, qty, price FROM work_order_items WHERE order_id = ?').all(w.id),
    techs: db.prepare(`SELECT u.name, u.phone FROM work_order_techs t JOIN users u ON u.id = t.user_id
      WHERE t.order_id = ?`).all(w.id),
    equipments: db.prepare(`SELECT e.asset_no, e.brand, e.model, e.location FROM equipments e
      JOIN work_order_equipments woe ON woe.equipment_id = e.id WHERE woe.order_id = ?`).all(w.id),
    photos: db.prepare("SELECT stage, path, caption FROM work_order_photos WHERE order_id = ? ORDER BY stage").all(w.id),
    checks: db.prepare(`SELECT ck.item, ck.result, ck.value, e.asset_no FROM work_order_checks ck
      LEFT JOIN equipments e ON e.id = ck.equipment_id WHERE ck.order_id = ?`).all(w.id)
  });
});

// 完工後評分
router.post('/orders/:id/rate', requireCustomer, (req, res) => {
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.customer.id);
  if (!w) return res.status(404).json({ error: '案件不存在' });
  if (!['done', 'confirmed', 'billed'].includes(w.status)) return res.status(400).json({ error: '案件尚未完工' });
  const rating = Number(req.body?.rating);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: '請給 1 到 5 分' });
  db.prepare('UPDATE work_orders SET rating = ?, rating_comment = ? WHERE id = ?')
    .run(rating, req.body?.comment || '', w.id);
  res.json({ ok: true });
});

// 我的設備
router.get('/equipments', requireCustomer, (req, res) => {
  res.json(db.prepare(`SELECT e.id, e.asset_no, e.category, e.brand, e.model, e.location, e.refrigerant,
      e.install_date, e.warranty_end, e.last_service_date, e.next_service_date, e.status, s.name AS site_name
    FROM equipments e LEFT JOIN sites s ON s.id = e.site_id
    WHERE e.customer_id = ? AND e.status != 'scrapped' ORDER BY s.name, e.location`).all(req.customer.id));
});

router.get('/equipments/:id', requireCustomer, (req, res) => {
  const e = db.prepare('SELECT * FROM equipments WHERE id = ? AND customer_id = ?').get(req.params.id, req.customer.id);
  if (!e) return res.status(404).json({ error: '設備不存在' });
  e.history = db.prepare(`SELECT w.order_no, w.type, w.title, w.cause, w.action, w.finished_at, w.total, w.status
    FROM work_orders w JOIN work_order_equipments woe ON woe.order_id = w.id
    WHERE woe.equipment_id = ? AND w.status IN ('done','confirmed','billed') ORDER BY w.id DESC`).all(e.id);
  res.json(e);
});

// 服務地點（報修時選）
router.get('/sites', requireCustomer, (req, res) => {
  res.json(db.prepare('SELECT id, name, address FROM sites WHERE customer_id = ? AND active = 1 ORDER BY id')
    .all(req.customer.id));
});

// 帳單
router.get('/invoices', requireCustomer, (req, res) => {
  res.json(db.prepare(`SELECT id, inv_no, issue_date, due_date, total, paid, (total - paid) AS balance,
      status, tax_invoice_no FROM invoices WHERE customer_id = ? AND status != 'void'
    ORDER BY id DESC LIMIT 60`).all(req.customer.id));
});

router.get('/invoices/:id', requireCustomer, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND customer_id = ?').get(req.params.id, req.customer.id);
  if (!inv) return res.status(404).json({ error: '帳單不存在' });
  inv.items = db.prepare('SELECT name, qty, unit, price, amount FROM invoice_items WHERE invoice_id = ?').all(inv.id);
  inv.payments = db.prepare("SELECT pay_date, amount, method FROM payments WHERE invoice_id = ? AND direction = 'in'").all(inv.id);
  inv.company = {
    name: getSetting('company_name'), tax_id: getSetting('company_tax_id'),
    phone: getSetting('company_phone'), address: getSetting('company_address'), bank: getSetting('company_bank')
  };
  res.json(inv);
});

module.exports = router;
