// 工項單價庫、報驗申報作業、公司承裝業登記證照
//
// 這三塊是水電行跟一般維修業最大的差別：
//   單價庫 —— 水電報價是「工項 × 數量」堆出來的，沒有單價庫每次報價都要重算。
//   報驗申報 —— 竣工要向台電、自來水處報驗，用電設備還要定期申報檢驗維護。
//   承裝業登記 —— 電器承裝業、自來水管承裝商都要登記且定期換證，過期就不能承攬。
const express = require('express');
const { db, audit, getSetting, today, addDays, addMonths, deleteUpload } = require('../db');
const { requireStaff } = require('../auth');
const { upload } = require('../upload');

const router = express.Router();
const num = v => Math.round(Number(v) || 0);

// ================= 工項單價庫 =================

router.get('/unit-prices', requireStaff('unitprice'), (req, res) => {
  const { trade = '', category = '', q = '', status = 'active' } = req.query;
  const where = [], args = [];
  if (status === 'active') where.push('active = 1');
  else if (status === 'inactive') where.push('active = 0');
  if (trade) { where.push('trade = ?'); args.push(trade); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (q) { where.push('(code LIKE ? OR name LIKE ? OR spec LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(db.prepare(`SELECT * FROM unit_prices
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY trade, category, sort, id LIMIT 1000`).all(...args));
});

function upsertBody(b, old = {}) {
  const labor = b.labor_price === undefined ? (old.labor_price || 0) : num(b.labor_price);
  const material = b.material_price === undefined ? (old.material_price || 0) : num(b.material_price);
  // 報價單價留空時，以工資＋材料當底價（利潤自行加成，不替使用者亂算）
  const price = b.price === undefined || b.price === '' ? (old.price || labor + material) : num(b.price);
  const cost = b.cost === undefined || b.cost === '' ? (old.cost || labor + material) : num(b.cost);
  return { labor, material, price, cost };
}

router.post('/unit-prices', requireStaff('unitprice'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫工項名稱' });
  const v = upsertBody(b);
  const info = db.prepare(`INSERT INTO unit_prices
      (code, trade, category, name, spec, unit, labor_price, material_price, price, cost, sub_price, note, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.code || '', b.trade || 'water', b.category || '', b.name, b.spec || '', b.unit || '式',
      v.labor, v.material, v.price, v.cost, num(b.sub_price), b.note || '', Number(b.sort) || 0);
  res.json({ id: info.lastInsertRowid });
});

router.put('/unit-prices/:id', requireStaff('unitprice'), (req, res) => {
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM unit_prices WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '工項不存在' });
  const v = upsertBody(b, old);
  db.prepare(`UPDATE unit_prices SET code = ?, trade = ?, category = ?, name = ?, spec = ?, unit = ?,
      labor_price = ?, material_price = ?, price = ?, cost = ?, sub_price = ?, note = ?, sort = ?, active = ?
      WHERE id = ?`)
    .run(b.code ?? old.code, b.trade || old.trade, b.category ?? old.category, b.name || old.name,
      b.spec ?? old.spec, b.unit || old.unit, v.labor, v.material, v.price, v.cost,
      b.sub_price === undefined ? old.sub_price : num(b.sub_price), b.note ?? old.note,
      b.sort === undefined ? old.sort : Number(b.sort) || 0,
      b.active === undefined ? old.active : (b.active ? 1 : 0), old.id);
  res.json({ ok: true });
});

router.delete('/unit-prices/:id', requireStaff('unitprice'), (req, res) => {
  db.prepare('DELETE FROM unit_prices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 整批調價：例如工資全面調漲 5%（材料漲價、基本工資調整時很常用）
router.post('/unit-prices/bulk-adjust', requireStaff('unitprice'), (req, res) => {
  const b = req.body || {};
  const pct = Number(b.percent);
  if (!pct || !isFinite(pct)) return res.status(400).json({ error: '請填寫調整百分比' });
  const field = ['labor_price', 'material_price', 'price', 'cost', 'sub_price'].includes(b.field) ? b.field : 'price';
  const where = ['active = 1'], args = [];
  if (b.trade) { where.push('trade = ?'); args.push(b.trade); }
  if (b.category) { where.push('category = ?'); args.push(b.category); }
  const factor = 1 + pct / 100;
  const info = db.prepare(`UPDATE unit_prices SET ${field} = CAST(ROUND(${field} * ?) AS INTEGER)
    WHERE ${where.join(' AND ')}`).run(factor, ...args);
  audit('staff', req.user.id, req.user.name, '單價庫整批調價',
    `${b.trade || '全部'}/${b.category || '全部'}`, `${field} ${pct}% 共 ${info.changes} 筆`);
  res.json({ changed: info.changes });
});

// 從單價庫帶一批工項進報價單（前端選好 id 與數量即可）
router.post('/unit-prices/to-quote-items', requireStaff('quotes'), (req, res) => {
  const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
  const out = [];
  for (const p of picks) {
    const up = db.prepare('SELECT * FROM unit_prices WHERE id = ?').get(p.id);
    if (!up) continue;
    out.push({
      name: up.name, spec: up.spec, unit: up.unit,
      qty: Number(p.qty) || 1, price: up.price, cost: up.cost,
      note: up.code ? `工項 ${up.code}` : ''
    });
  }
  res.json({ items: out });
});

// ================= 報驗／申報作業 =================

router.get('/filings', requireStaff('filings'), (req, res) => {
  const { result = 'open', kind = '', project_id = '', q = '', due = '' } = req.query;
  const where = [], args = [];
  if (result === 'open') where.push("f.result IN ('pending','applied','inspecting','failed')");
  else if (result) { where.push('f.result = ?'); args.push(result); }
  if (kind) { where.push('f.kind = ?'); args.push(kind); }
  if (project_id) { where.push('f.project_id = ?'); args.push(project_id); }
  if (due === '1') {
    where.push('f.next_due_date != \'\' AND f.next_due_date <= ?');
    args.push(addDays(today(), Number(getSetting('filing_alert_days', '30'))));
  }
  if (q) { where.push('(f.filing_no LIKE ? OR f.apply_no LIKE ? OR f.kind LIKE ? OR f.authority LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = db.prepare(`
    SELECT f.*, p.proj_no, p.name AS project_name, c.name AS customer_name, u.name AS owner_name, w.order_no
    FROM filings f LEFT JOIN projects p ON p.id = f.project_id
    LEFT JOIN customers c ON c.id = f.customer_id LEFT JOIN users u ON u.id = f.owner_id
    LEFT JOIN work_orders w ON w.id = f.order_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY f.result = 'failed' DESC, f.apply_date DESC, f.id DESC LIMIT 300`).all(...args);
  const d = today();
  for (const r of rows) r.overdue = !!(r.next_due_date && r.next_due_date < d);
  res.json(rows);
});

router.post('/filings', requireStaff('filings'), (req, res) => {
  const b = req.body || {};
  if (!b.kind) return res.status(400).json({ error: '請選擇報驗／申報類別' });
  const info = db.prepare(`INSERT INTO filings
      (filing_no, project_id, order_id, customer_id, kind, authority, apply_no, apply_date, inspect_date,
       result, fail_reason, recheck_date, pass_date, next_due_date, fee, owner_id, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.filing_no || '', b.project_id || null, b.order_id || null, b.customer_id || null, b.kind,
      b.authority || '', b.apply_no || '', b.apply_date || today(), b.inspect_date || '',
      b.result || 'pending', b.fail_reason || '', b.recheck_date || '', b.pass_date || '',
      b.next_due_date || '', num(b.fee), b.owner_id || req.user.id, b.note || '');
  audit('staff', req.user.id, req.user.name, '新增報驗案件', b.kind, b.apply_no || '');
  res.json({ id: info.lastInsertRowid });
});

router.put('/filings/:id', requireStaff('filings'), (req, res) => {
  const f = db.prepare('SELECT * FROM filings WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: '報驗案件不存在' });
  const b = { ...f, ...req.body };
  // 標記合格時自動補上合格日；定期申報類則順推下次應申報日
  if (b.result === 'passed' && !b.pass_date) b.pass_date = today();
  if (b.result === 'passed' && !b.next_due_date && Number(b.recur_months) > 0) {
    b.next_due_date = addMonths(b.pass_date, Number(b.recur_months));
  }
  db.prepare(`UPDATE filings SET filing_no = ?, project_id = ?, order_id = ?, customer_id = ?, kind = ?,
      authority = ?, apply_no = ?, apply_date = ?, inspect_date = ?, result = ?, fail_reason = ?,
      recheck_date = ?, pass_date = ?, next_due_date = ?, fee = ?, owner_id = ?, note = ? WHERE id = ?`)
    .run(b.filing_no || '', b.project_id || null, b.order_id || null, b.customer_id || null, b.kind,
      b.authority || '', b.apply_no || '', b.apply_date || '', b.inspect_date || '', b.result || 'pending',
      b.fail_reason || '', b.recheck_date || '', b.pass_date || '', b.next_due_date || '', num(b.fee),
      b.owner_id || null, b.note || '', f.id);
  audit('staff', req.user.id, req.user.name, '更新報驗案件', b.kind, b.result || '');
  res.json({ ok: true });
});

router.delete('/filings/:id', requireStaff('filings'), (req, res) => {
  const f = db.prepare('SELECT * FROM filings WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: '報驗案件不存在' });
  if (f.doc_path) deleteUpload(f.doc_path);
  db.prepare('DELETE FROM filings WHERE id = ?').run(f.id);
  res.json({ ok: true });
});

router.post('/filings/:id/doc', requireStaff('filings'), upload.single('doc'), (req, res) => {
  const f = db.prepare('SELECT * FROM filings WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: '報驗案件不存在' });
  if (!req.file) return res.status(400).json({ error: '請選擇檔案（圖片或 PDF）' });
  if (f.doc_path) deleteUpload(f.doc_path);
  const web = '/uploads/' + req.file.filename;
  db.prepare('UPDATE filings SET doc_path = ? WHERE id = ?').run(web, f.id);
  res.json({ path: web });
});

// ================= 公司證照／承裝業登記 =================

router.get('/company-licenses', requireStaff('licenses'), (req, res) => {
  const rows = db.prepare('SELECT * FROM company_licenses ORDER BY active DESC, expire_date, id').all();
  const alertDate = addDays(today(), Number(getSetting('company_license_alert_days', '90')));
  for (const r of rows) {
    r.expired = !!(r.expire_date && r.expire_date < today());
    r.expiring = !r.expired && !!(r.expire_date && r.expire_date <= alertDate);
  }
  res.json(rows);
});

router.post('/company-licenses', requireStaff('licenses'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫證照／登記名稱' });
  const info = db.prepare(`INSERT INTO company_licenses
      (name, reg_no, grade, authority, holder, holder_license, issue_date, expire_date, note)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(b.name, b.reg_no || '', b.grade || '', b.authority || '', b.holder || '', b.holder_license || '',
      b.issue_date || '', b.expire_date || '', b.note || '');
  audit('staff', req.user.id, req.user.name, '新增公司證照', b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/company-licenses/:id', requireStaff('licenses'), (req, res) => {
  const l = db.prepare('SELECT * FROM company_licenses WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: '證照資料不存在' });
  const b = { ...l, ...req.body };
  db.prepare(`UPDATE company_licenses SET name = ?, reg_no = ?, grade = ?, authority = ?, holder = ?,
      holder_license = ?, issue_date = ?, expire_date = ?, note = ?, active = ? WHERE id = ?`)
    .run(b.name, b.reg_no || '', b.grade || '', b.authority || '', b.holder || '', b.holder_license || '',
      b.issue_date || '', b.expire_date || '', b.note || '',
      req.body.active === undefined ? l.active : (req.body.active ? 1 : 0), l.id);
  res.json({ ok: true });
});

router.delete('/company-licenses/:id', requireStaff('licenses'), (req, res) => {
  const l = db.prepare('SELECT * FROM company_licenses WHERE id = ?').get(req.params.id);
  if (l && l.doc_path) deleteUpload(l.doc_path);
  db.prepare('DELETE FROM company_licenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/company-licenses/:id/doc', requireStaff('licenses'), upload.single('doc'), (req, res) => {
  const l = db.prepare('SELECT * FROM company_licenses WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: '證照資料不存在' });
  if (!req.file) return res.status(400).json({ error: '請選擇檔案（圖片或 PDF）' });
  if (l.doc_path) deleteUpload(l.doc_path);
  const web = '/uploads/' + req.file.filename;
  db.prepare('UPDATE company_licenses SET doc_path = ? WHERE id = ?').run(web, l.id);
  res.json({ path: web });
});

module.exports = router;
