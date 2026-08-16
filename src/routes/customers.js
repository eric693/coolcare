// 客戶、服務地點、設備履歷、保養合約、客戶專區帳號
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit, getSetting, today, addMonths, nextDocNo } = require('../db');
const { requireStaff } = require('../auth');

const router = express.Router();

// ================= 客戶 =================

router.get('/customers', requireStaff(), (req, res) => {
  const { q = '', status = 'active' } = req.query;
  const where = [], args = [];
  if (status === 'active') where.push('c.active = 1');
  else if (status === 'inactive') where.push('c.active = 0');
  if (q) {
    where.push('(c.name LIKE ? OR c.code LIKE ? OR c.phone LIKE ? OR c.tax_id LIKE ? OR c.contact LIKE ? OR c.address LIKE ?)');
    for (let i = 0; i < 6; i++) args.push(`%${q}%`);
  }
  res.json(db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM sites s WHERE s.customer_id = c.id AND s.active = 1) AS site_count,
      (SELECT COUNT(*) FROM equipments e WHERE e.customer_id = c.id AND e.status != 'scrapped') AS equip_count,
      (SELECT COUNT(*) FROM work_orders w WHERE w.customer_id = c.id AND w.status != 'cancelled') AS order_count,
      (SELECT MAX(appoint_date) FROM work_orders w WHERE w.customer_id = c.id) AS last_service,
      (SELECT COALESCE(SUM(total - paid),0) FROM invoices i WHERE i.customer_id = c.id AND i.status IN ('unpaid','partial')) AS ar,
      (SELECT COUNT(*) FROM service_contracts sc WHERE sc.customer_id = c.id AND sc.status = 'active') AS contract_count
    FROM customers c
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.name LIMIT 500`).all(...args));
});

router.get('/customers/:id', requireStaff(), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '客戶不存在' });
  c.sites = db.prepare('SELECT * FROM sites WHERE customer_id = ? ORDER BY active DESC, id').all(c.id);
  c.equipments = db.prepare(`SELECT e.*, s.name AS site_name FROM equipments e
    LEFT JOIN sites s ON s.id = e.site_id WHERE e.customer_id = ? ORDER BY e.status, e.id`).all(c.id);
  c.contracts = db.prepare('SELECT * FROM service_contracts WHERE customer_id = ? ORDER BY status, end_date DESC').all(c.id);
  c.orders = db.prepare(`SELECT w.id, w.order_no, w.type, w.title, w.status, w.appoint_date, w.finished_at, w.total
    FROM work_orders w WHERE w.customer_id = ? ORDER BY w.id DESC LIMIT 50`).all(c.id);
  c.invoices = db.prepare(`SELECT id, inv_no, issue_date, due_date, total, paid, status
    FROM invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 30`).all(c.id);
  c.portal_users = db.prepare('SELECT id, phone, name, active, last_login FROM customer_users WHERE customer_id = ?').all(c.id);
  res.json(c);
});

const CUSTOMER_FIELDS = ['code', 'name', 'kind', 'tax_id', 'contact', 'phone', 'phone2', 'email', 'address',
  'invoice_title', 'invoice_type', 'payment_terms', 'price_level', 'credit_limit', 'source', 'note'];

router.post('/customers', requireStaff('customers'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫客戶名稱' });
  if (b.kind === 'company' && !b.tax_id) return res.status(400).json({ error: '公司戶請填寫統一編號' });
  if (b.tax_id && !/^\d{8}$/.test(b.tax_id)) return res.status(400).json({ error: '統一編號應為 8 位數字' });
  const code = b.code || nextDocNo('C', today());
  const vals = CUSTOMER_FIELDS.map(f => (f === 'code' ? code : (f === 'credit_limit' ? Number(b[f]) || 0 : (b[f] ?? ''))));
  const info = db.prepare(`INSERT INTO customers (${CUSTOMER_FIELDS.join(',')})
    VALUES (${CUSTOMER_FIELDS.map(() => '?').join(',')})`).run(...vals);
  audit('staff', req.user.id, req.user.name, '新增客戶', b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/customers/:id', requireStaff('customers'), (req, res) => {
  const b = req.body || {};
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '客戶不存在' });
  if (b.tax_id && !/^\d{8}$/.test(b.tax_id)) return res.status(400).json({ error: '統一編號應為 8 位數字' });
  const vals = CUSTOMER_FIELDS.map(f => (f === 'credit_limit' ? Number(b[f]) || 0 : (b[f] ?? c[f])));
  db.prepare(`UPDATE customers SET ${CUSTOMER_FIELDS.map(f => `${f} = ?`).join(', ')}, active = ? WHERE id = ?`)
    .run(...vals, b.active === undefined ? c.active : (b.active ? 1 : 0), req.params.id);
  audit('staff', req.user.id, req.user.name, '修改客戶', c.name);
  res.json({ ok: true });
});

router.delete('/customers/:id', requireStaff('customers'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '客戶不存在' });
  const used = db.prepare('SELECT COUNT(*) n FROM work_orders WHERE customer_id = ?').get(c.id).n;
  if (used) return res.status(400).json({ error: `此客戶已有 ${used} 張工單，請改為停用而非刪除` });
  db.prepare('DELETE FROM customers WHERE id = ?').run(c.id);
  audit('staff', req.user.id, req.user.name, '刪除客戶', c.name);
  res.json({ ok: true });
});

// ================= 服務地點 =================

router.post('/sites', requireStaff('customers'), (req, res) => {
  const b = req.body || {};
  if (!b.customer_id || !b.name) return res.status(400).json({ error: '請選擇客戶並填寫地點名稱' });
  const info = db.prepare(`INSERT INTO sites (customer_id, name, address, contact, phone, floor_note, lat, lng)
    VALUES (?,?,?,?,?,?,?,?)`).run(b.customer_id, b.name, b.address || '', b.contact || '', b.phone || '',
    b.floor_note || '', b.lat || '', b.lng || '');
  res.json({ id: info.lastInsertRowid });
});

router.put('/sites/:id', requireStaff('customers'), (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE sites SET name = ?, address = ?, contact = ?, phone = ?, floor_note = ?, lat = ?, lng = ?, active = ?
    WHERE id = ?`).run(b.name, b.address || '', b.contact || '', b.phone || '', b.floor_note || '',
    b.lat || '', b.lng || '', b.active === undefined ? 1 : (b.active ? 1 : 0), req.params.id);
  res.json({ ok: true });
});

router.delete('/sites/:id', requireStaff('customers'), (req, res) => {
  const n = db.prepare('SELECT COUNT(*) n FROM equipments WHERE site_id = ?').get(req.params.id).n;
  if (n) return res.status(400).json({ error: `此地點掛有 ${n} 台設備，請先移轉或停用` });
  db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ================= 設備履歷 =================

router.get('/equipments', requireStaff(), (req, res) => {
  const { q = '', customer_id = '', site_id = '', category = '', status = 'active', due = '' } = req.query;
  const where = [], args = [];
  if (status) { where.push('e.status = ?'); args.push(status); }
  if (customer_id) { where.push('e.customer_id = ?'); args.push(customer_id); }
  if (site_id) { where.push('e.site_id = ?'); args.push(site_id); }
  if (category) { where.push('e.category = ?'); args.push(category); }
  if (due === '1') { where.push("e.next_service_date != '' AND e.next_service_date <= ?"); args.push(today()); }
  if (q) {
    where.push('(e.asset_no LIKE ? OR e.brand LIKE ? OR e.model LIKE ? OR e.serial_no LIKE ? OR e.location LIKE ? OR c.name LIKE ?)');
    for (let i = 0; i < 6; i++) args.push(`%${q}%`);
  }
  res.json(db.prepare(`
    SELECT e.*, c.name AS customer_name, s.name AS site_name,
      (SELECT COUNT(*) FROM work_order_equipments woe WHERE woe.equipment_id = e.id) AS service_count
    FROM equipments e JOIN customers c ON c.id = e.customer_id LEFT JOIN sites s ON s.id = e.site_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.name, e.location, e.id LIMIT 500`).all(...args));
});

router.get('/equipments/:id', requireStaff(), (req, res) => {
  const e = db.prepare(`SELECT e.*, c.name AS customer_name, s.name AS site_name, s.address AS site_address
    FROM equipments e JOIN customers c ON c.id = e.customer_id LEFT JOIN sites s ON s.id = e.site_id
    WHERE e.id = ?`).get(req.params.id);
  if (!e) return res.status(404).json({ error: '設備不存在' });
  // 維修履歷：這台機器每次被處理的紀錄
  e.history = db.prepare(`SELECT w.id, w.order_no, w.type, w.title, w.cause, w.action, w.status,
      w.appoint_date, w.finished_at, w.total,
      (SELECT GROUP_CONCAT(u.name, '、') FROM work_order_techs t JOIN users u ON u.id = t.user_id WHERE t.order_id = w.id) AS techs
    FROM work_orders w JOIN work_order_equipments woe ON woe.order_id = w.id
    WHERE woe.equipment_id = ? ORDER BY w.id DESC`).all(e.id);
  e.refrigerant_logs = db.prepare(`SELECT r.*, u.name AS tech_name FROM refrigerant_logs r
    LEFT JOIN users u ON u.id = r.tech_id WHERE r.equipment_id = ? ORDER BY r.log_date DESC`).all(e.id);
  e.checks = db.prepare(`SELECT ck.*, w.order_no, w.finished_at FROM work_order_checks ck
    JOIN work_orders w ON w.id = ck.order_id WHERE ck.equipment_id = ? ORDER BY ck.id DESC LIMIT 100`).all(e.id);
  // 累計花在這台機器上的維修金額，供「修不如換」判斷
  e.total_spent = e.history.filter(h => h.status !== 'cancelled').reduce((s, h) => s + (h.total || 0), 0);
  res.json(e);
});

const EQUIP_FIELDS = ['customer_id', 'site_id', 'asset_no', 'category', 'brand', 'model', 'serial_no', 'location',
  'capacity_kw', 'tonnage', 'refrigerant', 'refrigerant_kg', 'power_spec', 'install_date', 'warranty_end',
  'compressor_warranty_end', 'next_service_date', 'status', 'note'];

function equipVals(b, old = {}) {
  return EQUIP_FIELDS.map(f => {
    const v = b[f] ?? old[f];
    if (['capacity_kw', 'tonnage', 'refrigerant_kg'].includes(f)) return v === '' || v == null ? null : Number(v);
    if (f === 'site_id') return v || null;
    if (f === 'customer_id') return Number(v);
    return v ?? '';
  });
}

router.post('/equipments', requireStaff('equipments'), (req, res) => {
  const b = req.body || {};
  if (!b.customer_id) return res.status(400).json({ error: '請選擇客戶' });
  if (!b.asset_no) {
    // 未填機號時自動編：客戶編號 + 序號
    const n = db.prepare('SELECT COUNT(*) n FROM equipments WHERE customer_id = ?').get(b.customer_id).n;
    b.asset_no = `EQ${String(b.customer_id).padStart(4, '0')}-${String(n + 1).padStart(3, '0')}`;
  }
  // 依安裝日與保固月數自動推保固到期
  if (b.install_date && !b.warranty_end) {
    b.warranty_end = addMonths(b.install_date, Number(getSetting('warranty_months_default', '12')));
  }
  const info = db.prepare(`INSERT INTO equipments (${EQUIP_FIELDS.join(',')})
    VALUES (${EQUIP_FIELDS.map(() => '?').join(',')})`).run(...equipVals(b));
  audit('staff', req.user.id, req.user.name, '新增設備', b.asset_no);
  res.json({ id: info.lastInsertRowid, asset_no: b.asset_no });
});

router.put('/equipments/:id', requireStaff('equipments'), (req, res) => {
  const old = db.prepare('SELECT * FROM equipments WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '設備不存在' });
  db.prepare(`UPDATE equipments SET ${EQUIP_FIELDS.map(f => `${f} = ?`).join(', ')} WHERE id = ?`)
    .run(...equipVals(req.body || {}, old), req.params.id);
  audit('staff', req.user.id, req.user.name, '修改設備', old.asset_no);
  res.json({ ok: true });
});

router.delete('/equipments/:id', requireStaff('equipments'), (req, res) => {
  const n = db.prepare('SELECT COUNT(*) n FROM work_order_equipments WHERE equipment_id = ?').get(req.params.id).n;
  if (n) return res.status(400).json({ error: `此設備已有 ${n} 筆維修履歷，請改標記為報廢` });
  db.prepare('DELETE FROM equipments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ================= 保養合約 =================

router.get('/service-contracts', requireStaff(), (req, res) => {
  const { status = '', q = '' } = req.query;
  const where = [], args = [];
  if (status) { where.push('sc.status = ?'); args.push(status); }
  if (q) { where.push('(sc.contract_no LIKE ? OR sc.title LIKE ? OR c.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(db.prepare(`
    SELECT sc.*, c.name AS customer_name, s.name AS site_name,
      (SELECT COUNT(*) FROM contract_equipments ce WHERE ce.contract_id = sc.id) AS equip_count,
      (SELECT COUNT(*) FROM work_orders w WHERE w.contract_id = sc.id AND w.status IN ('done','confirmed','billed')) AS done_visits
    FROM service_contracts sc JOIN customers c ON c.id = sc.customer_id LEFT JOIN sites s ON s.id = sc.site_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sc.status, sc.next_visit_date, sc.end_date`).all(...args));
});

router.get('/service-contracts/:id', requireStaff(), (req, res) => {
  const sc = db.prepare(`SELECT sc.*, c.name AS customer_name, s.name AS site_name
    FROM service_contracts sc JOIN customers c ON c.id = sc.customer_id LEFT JOIN sites s ON s.id = sc.site_id
    WHERE sc.id = ?`).get(req.params.id);
  if (!sc) return res.status(404).json({ error: '合約不存在' });
  sc.equipments = db.prepare(`SELECT e.* FROM equipments e JOIN contract_equipments ce ON ce.equipment_id = e.id
    WHERE ce.contract_id = ?`).all(sc.id);
  sc.visits = db.prepare(`SELECT id, order_no, appoint_date, finished_at, status, title FROM work_orders
    WHERE contract_id = ? ORDER BY id DESC`).all(sc.id);
  res.json(sc);
});

router.post('/service-contracts', requireStaff('contracts'), (req, res) => {
  const b = req.body || {};
  if (!b.customer_id) return res.status(400).json({ error: '請選擇客戶' });
  if (!b.start_date || !b.end_date) return res.status(400).json({ error: '請填寫合約起訖日' });
  if (b.end_date < b.start_date) return res.status(400).json({ error: '合約結束日不可早於起始日' });
  const no = b.contract_no || nextDocNo('SC', b.start_date);
  const info = db.prepare(`INSERT INTO service_contracts
      (contract_no, customer_id, site_id, title, start_date, end_date, interval_months, times_per_year,
       amount, billing_cycle, scope, include_parts, next_visit_date, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(no, b.customer_id, b.site_id || null, b.title || '定期保養約', b.start_date, b.end_date,
      Number(b.interval_months) || 3, Number(b.times_per_year) || 4, Number(b.amount) || 0,
      b.billing_cycle || 'yearly', b.scope || '', b.include_parts ? 1 : 0,
      b.next_visit_date || b.start_date, b.note || '');
  const id = info.lastInsertRowid;
  if (Array.isArray(b.equipment_ids)) {
    const ins = db.prepare('INSERT OR IGNORE INTO contract_equipments (contract_id, equipment_id) VALUES (?,?)');
    for (const eid of b.equipment_ids) ins.run(id, eid);
  }
  audit('staff', req.user.id, req.user.name, '新增保養合約', no);
  res.json({ id, contract_no: no });
});

router.put('/service-contracts/:id', requireStaff('contracts'), (req, res) => {
  const b = req.body || {};
  const sc = db.prepare('SELECT * FROM service_contracts WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: '合約不存在' });
  db.prepare(`UPDATE service_contracts SET site_id = ?, title = ?, start_date = ?, end_date = ?, interval_months = ?,
      times_per_year = ?, amount = ?, billing_cycle = ?, scope = ?, include_parts = ?, status = ?,
      next_visit_date = ?, note = ? WHERE id = ?`)
    .run(b.site_id || null, b.title ?? sc.title, b.start_date ?? sc.start_date, b.end_date ?? sc.end_date,
      Number(b.interval_months) || sc.interval_months, Number(b.times_per_year) || sc.times_per_year,
      Number(b.amount) || 0, b.billing_cycle || sc.billing_cycle, b.scope ?? sc.scope,
      b.include_parts ? 1 : 0, b.status || sc.status, b.next_visit_date ?? sc.next_visit_date,
      b.note ?? sc.note, sc.id);
  if (Array.isArray(b.equipment_ids)) {
    db.prepare('DELETE FROM contract_equipments WHERE contract_id = ?').run(sc.id);
    const ins = db.prepare('INSERT OR IGNORE INTO contract_equipments (contract_id, equipment_id) VALUES (?,?)');
    for (const eid of b.equipment_ids) ins.run(sc.id, eid);
  }
  audit('staff', req.user.id, req.user.name, '修改保養合約', sc.contract_no);
  res.json({ ok: true });
});

// 由合約開出一張保養工單：帶入合約涵蓋設備與預設檢查項目，並把合約下次到場日往後推一個週期。
// 保養約系統的關鍵在此——不靠人腦記，到期就開得出單。
const generateContractOrder = db.transaction((sc, visitDate, userId) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(sc.customer_id);
  const site = sc.site_id ? db.prepare('SELECT * FROM sites WHERE id = ?').get(sc.site_id) : null;
  const no = nextDocNo('WO', visitDate);
  const info = db.prepare(`INSERT INTO work_orders
      (order_no, type, source, customer_id, site_id, contract_id, contact, phone, address, title,
       priority, status, appoint_date, is_contract, created_by)
      VALUES (?,'maintain','合約排程',?,?,?,?,?,?,?,'normal','draft',?,1,?)`)
    .run(no, sc.customer_id, sc.site_id || null, sc.id,
      (site && site.contact) || customer.contact, (site && site.phone) || customer.phone,
      (site && site.address) || customer.address, `${sc.title}（定期保養）`, visitDate, userId);
  const orderId = info.lastInsertRowid;

  const equips = db.prepare('SELECT equipment_id FROM contract_equipments WHERE contract_id = ?').all(sc.id);
  const insE = db.prepare('INSERT OR IGNORE INTO work_order_equipments (order_id, equipment_id) VALUES (?,?)');
  const insC = db.prepare('INSERT INTO work_order_checks (order_id, equipment_id, item) VALUES (?,?,?)');
  const items = getSetting('check_items_default', '').split(';').map(s => s.trim()).filter(Boolean);
  for (const e of equips) {
    insE.run(orderId, e.equipment_id);
    for (const it of items) insC.run(orderId, e.equipment_id, it);
  }
  db.prepare('UPDATE service_contracts SET next_visit_date = ? WHERE id = ?')
    .run(addMonths(visitDate, sc.interval_months), sc.id);
  return { id: orderId, order_no: no, equipment_count: equips.length };
});

router.post('/service-contracts/generate-due', requireStaff('contracts'), (req, res) => {
  const until = req.body?.until || today();
  const list = db.prepare(`SELECT * FROM service_contracts
    WHERE status = 'active' AND next_visit_date != '' AND next_visit_date <= ?`).all(until);
  const created = [];
  for (const sc of list) {
    // 已有未完成的保養工單就不重複開，避免同一份合約堆出兩三張單
    const open = db.prepare(`SELECT 1 FROM work_orders WHERE contract_id = ?
      AND status IN ('draft','assigned','departed','working')`).get(sc.id);
    if (open) continue;
    created.push(generateContractOrder(sc, sc.next_visit_date || today(), req.user.id).order_no);
  }
  audit('staff', req.user.id, req.user.name, '批次產生保養工單', `${created.length} 張`);
  res.json({ created: created.length, order_nos: created });
});

router.post('/service-contracts/:id/generate-order', requireStaff('contracts'), (req, res) => {
  const sc = db.prepare('SELECT * FROM service_contracts WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: '合約不存在' });
  if (sc.status !== 'active') return res.status(400).json({ error: '僅生效中的合約可產生保養工單' });
  const out = generateContractOrder(sc, req.body?.appoint_date || sc.next_visit_date || today(), req.user.id);
  audit('staff', req.user.id, req.user.name, '合約產生保養工單', out.order_no, sc.contract_no);
  res.json(out);
});

// ================= 客戶專區帳號 =================

router.post('/customers/:id/portal-user', requireStaff('customers'), (req, res) => {
  const b = req.body || {};
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '客戶不存在' });
  const phone = String(b.phone || '').replace(/\D/g, '');
  if (!/^09\d{8}$/.test(phone)) return res.status(400).json({ error: '請填寫正確的手機號碼（09 開頭 10 碼）' });
  if (db.prepare('SELECT 1 FROM customer_users WHERE phone = ?').get(phone)) {
    return res.status(400).json({ error: '此手機號碼已建立過客戶帳號' });
  }
  const initPassword = phone.slice(-6);   // 預設密碼為手機末 6 碼，首次登入強制更換
  const info = db.prepare(`INSERT INTO customer_users (customer_id, phone, name, password_hash) VALUES (?,?,?,?)`)
    .run(c.id, phone, b.name || c.contact || '', bcrypt.hashSync(initPassword, 10));
  audit('staff', req.user.id, req.user.name, '建立客戶專區帳號', `${c.name} / ${phone}`);
  res.json({ id: info.lastInsertRowid, phone, init_password: initPassword });
});

router.put('/portal-users/:id', requireStaff('customers'), (req, res) => {
  const b = req.body || {};
  const cu = db.prepare('SELECT * FROM customer_users WHERE id = ?').get(req.params.id);
  if (!cu) return res.status(404).json({ error: '帳號不存在' });
  db.prepare('UPDATE customer_users SET name = ?, active = ? WHERE id = ?')
    .run(b.name ?? cu.name, b.active === undefined ? cu.active : (b.active ? 1 : 0), cu.id);
  if (b.reset_password) {
    const pw = cu.phone.slice(-6);
    db.prepare('UPDATE customer_users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(bcrypt.hashSync(pw, 10), cu.id);
    audit('staff', req.user.id, req.user.name, '重設客戶密碼', cu.phone);
    return res.json({ ok: true, init_password: pw });
  }
  res.json({ ok: true });
});

module.exports = router;
