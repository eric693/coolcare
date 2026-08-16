// 派工單：開單 → 指派技師 → 出發／到場 → 施工（用料領料扣庫存）→ 完工結算 → 客戶簽收 → 轉請款
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {
  db, audit, getSetting, today, nowStamp, thisMonth, addMonths, nextDocNo, calcTax
} = require('../db');
const { requireStaff } = require('../auth');
const { applyMove, revertMoves, priceFor } = require('../stock');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

// 狀態流轉規則：只允許往下一步或取消，避免已結算的單被倒回去改
const NEXT_STATUS = {
  draft: ['assigned', 'cancelled'],
  assigned: ['departed', 'working', 'draft', 'cancelled'],
  departed: ['working', 'assigned', 'cancelled'],
  working: ['done', 'departed', 'cancelled'],
  done: ['confirmed', 'working'],
  confirmed: ['billed', 'done'],
  billed: [],
  cancelled: []
};
const STATUS_TW = {
  draft: '待派工', assigned: '已派工', departed: '已出發', working: '施工中',
  done: '已完工', confirmed: '客戶已確認', billed: '已請款', cancelled: '已取消'
};

// ---- 工單列表 ----

router.get('/work-orders', requireStaff(), (req, res) => {
  const { q = '', status = '', type = '', tech = '', from = '', to = '', customer_id = '', mine = '' } = req.query;
  const where = [], args = [];
  if (status === 'open') where.push("w.status IN ('draft','assigned','departed','working')");
  else if (status) { where.push('w.status = ?'); args.push(status); }
  if (type) { where.push('w.type = ?'); args.push(type); }
  if (customer_id) { where.push('w.customer_id = ?'); args.push(customer_id); }
  if (from) { where.push('w.appoint_date >= ?'); args.push(from); }
  if (to) { where.push('w.appoint_date <= ?'); args.push(to); }
  if (tech) { where.push('EXISTS (SELECT 1 FROM work_order_techs t WHERE t.order_id = w.id AND t.user_id = ?)'); args.push(tech); }
  if (mine === '1') { where.push('EXISTS (SELECT 1 FROM work_order_techs t WHERE t.order_id = w.id AND t.user_id = ?)'); args.push(req.user.id); }
  if (q) {
    where.push('(w.order_no LIKE ? OR w.title LIKE ? OR w.symptom LIKE ? OR c.name LIKE ? OR w.address LIKE ? OR w.phone LIKE ?)');
    for (let i = 0; i < 6; i++) args.push(`%${q}%`);
  }
  res.json(db.prepare(`
    SELECT w.*, c.name AS customer_name, s.name AS site_name,
      (SELECT GROUP_CONCAT(u.name, '、') FROM work_order_techs t JOIN users u ON u.id = t.user_id WHERE t.order_id = w.id) AS techs
    FROM work_orders w JOIN customers c ON c.id = w.customer_id LEFT JOIN sites s ON s.id = w.site_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY w.appoint_date DESC, w.id DESC LIMIT 500`).all(...args));
});

// ---- 工單明細 ----

function loadOrder(id) {
  const w = db.prepare(`SELECT w.*, c.name AS customer_name, c.tax_id, c.price_level, c.payment_terms,
      s.name AS site_name, s.floor_note, sc.contract_no, u.name AS creator
    FROM work_orders w JOIN customers c ON c.id = w.customer_id
    LEFT JOIN sites s ON s.id = w.site_id
    LEFT JOIN service_contracts sc ON sc.id = w.contract_id
    LEFT JOIN users u ON u.id = w.created_by
    WHERE w.id = ?`).get(id);
  if (!w) return null;
  w.techs = db.prepare(`SELECT t.*, u.name, u.phone, u.tech_no FROM work_order_techs t
    JOIN users u ON u.id = t.user_id WHERE t.order_id = ? ORDER BY t.is_lead DESC`).all(id);
  w.equipments = db.prepare(`SELECT e.* FROM equipments e JOIN work_order_equipments woe ON woe.equipment_id = e.id
    WHERE woe.order_id = ?`).all(id);
  w.items = db.prepare(`SELECT i.*, p.sku, p.unit AS product_unit, wh.name AS warehouse_name
    FROM work_order_items i LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN warehouses wh ON wh.id = i.warehouse_id WHERE i.order_id = ? ORDER BY i.id`).all(id);
  w.photos = db.prepare('SELECT * FROM work_order_photos WHERE order_id = ? ORDER BY stage, id').all(id);
  w.checks = db.prepare(`SELECT ck.*, e.asset_no, e.brand, e.model FROM work_order_checks ck
    LEFT JOIN equipments e ON e.id = ck.equipment_id WHERE ck.order_id = ? ORDER BY ck.equipment_id, ck.id`).all(id);
  w.refrigerant_logs = db.prepare(`SELECT r.*, u.name AS tech_name FROM refrigerant_logs r
    LEFT JOIN users u ON u.id = r.tech_id WHERE r.order_id = ? ORDER BY r.id`).all(id);
  w.commissions = db.prepare(`SELECT cm.*, u.name FROM commissions cm JOIN users u ON u.id = cm.user_id
    WHERE cm.order_id = ?`).all(id);
  w.invoice = db.prepare(`SELECT id, inv_no, total, paid, status FROM invoices
    WHERE ',' || source_ids || ',' LIKE ? AND source_type = 'work_order'`).get(`%,${id},%`) || null;
  w.next_status = NEXT_STATUS[w.status] || [];
  return w;
}

router.get('/work-orders/:id', requireStaff(), (req, res) => {
  const w = loadOrder(req.params.id);
  if (!w) return res.status(404).json({ error: '工單不存在' });
  res.json(w);
});

// ---- 開單 ----

router.post('/work-orders', requireStaff('orders'), (req, res) => {
  const b = req.body || {};
  if (!b.customer_id) return res.status(400).json({ error: '請選擇客戶' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(b.customer_id);
  if (!customer) return res.status(400).json({ error: '客戶不存在' });
  const site = b.site_id ? db.prepare('SELECT * FROM sites WHERE id = ?').get(b.site_id) : null;
  const appointDate = b.appoint_date || today();

  const run = db.transaction(() => {
    const no = nextDocNo('WO', appointDate);
    const info = db.prepare(`INSERT INTO work_orders
        (order_no, type, source, customer_id, site_id, contract_id, contact, phone, address, title, symptom,
         priority, status, appoint_date, appoint_slot, is_warranty, is_contract, tax_mode,
         travel_fee, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, b.type || 'repair', b.source || '電話', customer.id, b.site_id || null, b.contract_id || null,
        b.contact || (site && site.contact) || customer.contact,
        b.phone || (site && site.phone) || customer.phone,
        b.address || (site && site.address) || customer.address,
        b.title || '', b.symptom || '', b.priority || 'normal',
        b.tech_ids && b.tech_ids.length ? 'assigned' : 'draft',
        appointDate, b.appoint_slot || '', b.is_warranty ? 1 : 0, b.is_contract ? 1 : 0,
        b.tax_mode || 'exclusive', Number(b.travel_fee) || 0, b.note || '', req.user.id);
    const id = info.lastInsertRowid;
    if (Array.isArray(b.tech_ids)) {
      const ins = db.prepare('INSERT OR IGNORE INTO work_order_techs (order_id, user_id, is_lead) VALUES (?,?,?)');
      b.tech_ids.forEach((uid, i) => ins.run(id, uid, i === 0 ? 1 : 0));
    }
    if (Array.isArray(b.equipment_ids)) {
      const ins = db.prepare('INSERT OR IGNORE INTO work_order_equipments (order_id, equipment_id) VALUES (?,?)');
      for (const eid of b.equipment_ids) ins.run(id, eid);
    }
    // 保養／檢修單自動帶入預設檢查表
    if (['maintain', 'inspect'].includes(b.type) && Array.isArray(b.equipment_ids)) {
      const items = getSetting('check_items_default', '').split(';').map(s => s.trim()).filter(Boolean);
      const insC = db.prepare('INSERT INTO work_order_checks (order_id, equipment_id, item) VALUES (?,?,?)');
      for (const eid of b.equipment_ids) for (const it of items) insC.run(id, eid, it);
    }
    return { id, order_no: no };
  });

  const out = run();
  audit('staff', req.user.id, req.user.name, '開立工單', out.order_no, customer.name);
  res.json(out);
});

// ---- 修改工單基本欄位 ----

const EDITABLE = ['type', 'source', 'site_id', 'contract_id', 'contact', 'phone', 'address', 'title', 'symptom',
  'priority', 'appoint_date', 'appoint_slot', 'cause', 'action', 'suggestion', 'work_hours', 'headcount',
  'labor_fee', 'travel_fee', 'other_fee', 'other_fee_name', 'discount', 'tax_mode', 'is_warranty', 'is_contract', 'note'];

router.put('/work-orders/:id', requireStaff('orders'), (req, res) => {
  const b = req.body || {};
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '工單不存在' });
  if (['billed', 'cancelled'].includes(w.status)) return res.status(400).json({ error: `${STATUS_TW[w.status]}的工單不可修改` });
  const vals = EDITABLE.map(f => {
    const v = b[f] ?? w[f];
    if (['site_id', 'contract_id'].includes(f)) return v || null;
    if (['is_warranty', 'is_contract'].includes(f)) return (b[f] === undefined ? w[f] : (b[f] ? 1 : 0));
    if (['work_hours'].includes(f)) return Number(v) || 0;
    if (['headcount', 'labor_fee', 'travel_fee', 'other_fee', 'discount'].includes(f)) return Math.round(Number(v) || 0);
    return v ?? '';
  });
  db.prepare(`UPDATE work_orders SET ${EDITABLE.map(f => `${f} = ?`).join(', ')} WHERE id = ?`).run(...vals, w.id);
  if (Array.isArray(b.equipment_ids)) {
    db.prepare('DELETE FROM work_order_equipments WHERE order_id = ?').run(w.id);
    const ins = db.prepare('INSERT OR IGNORE INTO work_order_equipments (order_id, equipment_id) VALUES (?,?)');
    for (const eid of b.equipment_ids) ins.run(w.id, eid);
  }
  recalcOrder(w.id);
  audit('staff', req.user.id, req.user.name, '修改工單', w.order_no);
  res.json({ ok: true });
});

// ---- 指派技師 ----

router.put('/work-orders/:id/techs', requireStaff('dispatch'), (req, res) => {
  const b = req.body || {};
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '工單不存在' });
  const ids = Array.isArray(b.tech_ids) ? b.tech_ids : [];
  db.transaction(() => {
    db.prepare('DELETE FROM work_order_techs WHERE order_id = ?').run(w.id);
    const ins = db.prepare('INSERT OR IGNORE INTO work_order_techs (order_id, user_id, is_lead) VALUES (?,?,?)');
    ids.forEach((uid, i) => ins.run(w.id, uid, i === 0 ? 1 : 0));
    if (ids.length && w.status === 'draft') {
      db.prepare("UPDATE work_orders SET status = 'assigned' WHERE id = ?").run(w.id);
    }
    if (!ids.length && w.status === 'assigned') {
      db.prepare("UPDATE work_orders SET status = 'draft' WHERE id = ?").run(w.id);
    }
    db.prepare('UPDATE work_orders SET headcount = ? WHERE id = ?').run(Math.max(1, ids.length), w.id);
  })();
  const names = ids.length
    ? db.prepare(`SELECT GROUP_CONCAT(name, '、') n FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids).n
    : '（未指派）';
  audit('staff', req.user.id, req.user.name, '指派技師', w.order_no, names);
  res.json({ ok: true });
});

// ---- 狀態流轉 ----

router.post('/work-orders/:id/status', requireStaff('orders'), (req, res) => {
  const to = req.body?.status;
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '工單不存在' });
  if (!NEXT_STATUS[w.status] || !NEXT_STATUS[w.status].includes(to)) {
    return res.status(400).json({ error: `${STATUS_TW[w.status]} 不可直接改為 ${STATUS_TW[to] || to}` });
  }
  if (to === 'assigned' && !db.prepare('SELECT 1 FROM work_order_techs WHERE order_id = ?').get(w.id)) {
    return res.status(400).json({ error: '請先指派技師' });
  }
  if (to === 'done') {
    if (!w.action) return res.status(400).json({ error: '請先填寫施工內容／處理方式再完工' });
    settleOrder(w.id, req.user.id);
  }
  const stampField = { departed: 'departed_at', working: 'arrived_at', done: 'finished_at', confirmed: 'confirmed_at' }[to];
  db.prepare(`UPDATE work_orders SET status = ?${stampField ? `, ${stampField} = ?` : ''} WHERE id = ?`)
    .run(...(stampField ? [to, nowStamp(), w.id] : [to, w.id]));

  // 完工後回寫設備的保養日與下次應保養日
  if (to === 'done') {
    const equips = db.prepare('SELECT equipment_id FROM work_order_equipments WHERE order_id = ?').all(w.id);
    if (equips.length && ['maintain', 'inspect'].includes(w.type)) {
      const sc = w.contract_id ? db.prepare('SELECT interval_months FROM service_contracts WHERE id = ?').get(w.contract_id) : null;
      const months = sc ? sc.interval_months : 6;
      for (const e of equips) {
        db.prepare('UPDATE equipments SET last_service_date = ?, next_service_date = ? WHERE id = ?')
          .run(today(), addMonths(today(), months), e.equipment_id);
      }
    }
  }
  if (to === 'cancelled') revertMoves('work_order', w.id, req.user.id);   // 已領的料退回庫存

  audit('staff', req.user.id, req.user.name, `工單改為${STATUS_TW[to]}`, w.order_no);
  res.json({ ok: true, order: loadOrder(w.id) });
});

// ---- 用料（領料即扣庫存） ----

router.post('/work-orders/:id/items', requireStaff('orders'), (req, res) => {
  const b = req.body || {};
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '工單不存在' });
  if (['billed', 'cancelled'].includes(w.status)) return res.status(400).json({ error: '此工單已結案，不可再領料' });
  const qty = Number(b.qty) || 0;
  if (qty <= 0) return res.status(400).json({ error: '數量需大於 0' });

  const customer = db.prepare('SELECT price_level FROM customers WHERE id = ?').get(w.customer_id);

  try {
    const out = db.transaction(() => {
      let cost = 0, name = b.name || '', spec = b.spec || '', unit = b.unit || '個';
      let price = b.price === undefined || b.price === '' ? null : Math.round(Number(b.price));
      if (b.product_id) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(b.product_id);
        if (!p) throw new Error('料件不存在');
        name = name || p.name;
        spec = spec || p.spec;
        unit = p.unit;
        if (price === null) price = priceFor(p, customer.price_level);
        if (p.kind !== 'service') {
          if (!b.warehouse_id) throw new Error('請選擇領料倉別');
          const mv = applyMove({
            product_id: p.id, warehouse_id: b.warehouse_id, kind: 'issue', qty: -qty,
            ref_type: 'work_order', ref_id: w.id, ref_no: w.order_no, user_id: req.user.id,
            note: `${w.order_no} 領料`
          });
          cost = mv.cost;
        } else {
          cost = p.cost;
        }
      }
      if (!name) throw new Error('請填寫品名或選擇料件');
      const info = db.prepare(`INSERT INTO work_order_items
          (order_id, product_id, name, spec, unit, qty, price, cost, warehouse_id, note)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(w.id, b.product_id || null, name, spec, unit, qty, price || 0, cost,
          b.warehouse_id || null, b.note || '');
      return info.lastInsertRowid;
    })();
    recalcOrder(w.id);
    res.json({ id: out, order: loadOrder(w.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/work-order-items/:id', requireStaff('orders'), (req, res) => {
  const it = db.prepare('SELECT * FROM work_order_items WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: '用料紀錄不存在' });
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(it.order_id);
  if (['billed', 'cancelled'].includes(w.status)) return res.status(400).json({ error: '此工單已結案，不可退料' });
  db.transaction(() => {
    // 退料回庫（成本沿用領料當下的快照，不重算平均成本）
    if (it.product_id && it.warehouse_id) {
      applyMove({
        product_id: it.product_id, warehouse_id: it.warehouse_id, kind: 'issue_return', qty: it.qty,
        cost: it.cost, ref_type: 'work_order', ref_id: w.id, ref_no: w.order_no, user_id: req.user.id,
        note: `${w.order_no} 退料`
      });
    }
    db.prepare('DELETE FROM work_order_items WHERE id = ?').run(it.id);
  })();
  recalcOrder(w.id);
  audit('staff', req.user.id, req.user.name, '工單退料', w.order_no, `${it.name} x${it.qty}`);
  res.json({ ok: true, order: loadOrder(w.id) });
});

// ---- 檢查表 ----

router.put('/work-orders/:id/checks', requireStaff('orders'), (req, res) => {
  const rows = Array.isArray(req.body?.checks) ? req.body.checks : [];
  const upd = db.prepare('UPDATE work_order_checks SET result = ?, value = ?, note = ? WHERE id = ? AND order_id = ?');
  db.transaction(() => {
    for (const r of rows) upd.run(r.result || 'ok', r.value || '', r.note || '', r.id, req.params.id);
  })();
  res.json({ ok: true });
});

router.post('/work-orders/:id/checks', requireStaff('orders'), (req, res) => {
  const b = req.body || {};
  if (!b.item) return res.status(400).json({ error: '請填寫檢查項目' });
  const info = db.prepare('INSERT INTO work_order_checks (order_id, equipment_id, item, result, value, note) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, b.equipment_id || null, b.item, b.result || 'ok', b.value || '', b.note || '');
  res.json({ id: info.lastInsertRowid });
});

router.delete('/work-order-checks/:id', requireStaff('orders'), (req, res) => {
  db.prepare('DELETE FROM work_order_checks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- 施工照片 ----

router.post('/work-orders/:id/photos', requireStaff('orders'), upload.array('photos', 12), (req, res) => {
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '工單不存在' });
  const stage = ['before', 'during', 'after', 'fault', 'other'].includes(req.body.stage) ? req.body.stage : 'other';
  const ins = db.prepare('INSERT INTO work_order_photos (order_id, stage, path, caption) VALUES (?,?,?,?)');
  const paths = (req.files || []).map(f => {
    const web = '/uploads/' + f.filename;
    ins.run(w.id, stage, web, req.body.caption || '');
    return web;
  });
  res.json({ paths });
});

router.delete('/work-order-photos/:id', requireStaff('orders'), (req, res) => {
  const p = db.prepare('SELECT * FROM work_order_photos WHERE id = ?').get(req.params.id);
  if (p) {
    require('../db').deleteUpload(p.path);
    db.prepare('DELETE FROM work_order_photos WHERE id = ?').run(p.id);
  }
  res.json({ ok: true });
});

// ---- 客戶簽收 ----

router.post('/work-orders/:id/sign', requireStaff('orders'), (req, res) => {
  const b = req.body || {};
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: '工單不存在' });
  if (!b.signature) return res.status(400).json({ error: '請先簽名' });
  db.prepare(`UPDATE work_orders SET signature = ?, signer_name = ?, status = 'confirmed', confirmed_at = ?,
      rating = ?, rating_comment = ? WHERE id = ?`)
    .run(b.signature, b.signer_name || '', nowStamp(), b.rating || null, b.rating_comment || '', w.id);
  audit('staff', req.user.id, req.user.name, '客戶簽收工單', w.order_no, b.signer_name || '');
  res.json({ ok: true });
});

// ---- 冷媒充填／回收紀錄 ----

router.post('/refrigerant-logs', requireStaff('refrigerant'), (req, res) => {
  const b = req.body || {};
  if (!b.refrigerant || !b.kg) return res.status(400).json({ error: '請填寫冷媒種類與重量' });
  const info = db.prepare(`INSERT INTO refrigerant_logs
      (order_id, equipment_id, log_date, action, refrigerant, kg, cylinder_no, tech_id, leak_point, note)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(b.order_id || null, b.equipment_id || null, b.log_date || today(), b.action || 'charge',
      b.refrigerant, Number(b.kg) || 0, b.cylinder_no || '', b.tech_id || req.user.id,
      b.leak_point || '', b.note || '');
  audit('staff', req.user.id, req.user.name, '冷媒紀錄', `${b.refrigerant} ${b.kg}kg`);
  res.json({ id: info.lastInsertRowid });
});

router.get('/refrigerant-logs', requireStaff('refrigerant'), (req, res) => {
  const { from = '', to = '', refrigerant = '', action = '' } = req.query;
  const where = [], args = [];
  if (from) { where.push('r.log_date >= ?'); args.push(from); }
  if (to) { where.push('r.log_date <= ?'); args.push(to); }
  if (refrigerant) { where.push('r.refrigerant = ?'); args.push(refrigerant); }
  if (action) { where.push('r.action = ?'); args.push(action); }
  const rows = db.prepare(`
    SELECT r.*, u.name AS tech_name, w.order_no, e.asset_no, e.brand, e.model, c.name AS customer_name
    FROM refrigerant_logs r
    LEFT JOIN users u ON u.id = r.tech_id
    LEFT JOIN work_orders w ON w.id = r.order_id
    LEFT JOIN equipments e ON e.id = r.equipment_id
    LEFT JOIN customers c ON c.id = e.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.log_date DESC, r.id DESC LIMIT 1000`).all(...args);
  // 依冷媒種類彙總充填／回收量，作為 F-gas 申報底稿
  const summary = {};
  for (const r of rows) {
    const s = summary[r.refrigerant] || (summary[r.refrigerant] = { charge: 0, recover: 0, leak: 0, dispose: 0 });
    s[r.action] = Number((s[r.action] + r.kg).toFixed(3));
  }
  res.json({ rows, summary });
});

// ================= 結算與抽成 =================

// 重算材料售價、材料成本與含稅總額（每次動到費用或用料就呼叫）
function recalcOrder(orderId) {
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(orderId);
  if (!w) return;
  const agg = db.prepare(`SELECT COALESCE(SUM(qty * price),0) fee, COALESCE(SUM(qty * cost),0) cost
    FROM work_order_items WHERE order_id = ?`).get(orderId);
  const partsFee = Math.round(agg.fee), partsCost = Math.round(agg.cost);
  // 保固內或合約內免收費，但材料成本照樣算進去（老闆要看得到這單其實虧多少）
  const chargeable = w.is_warranty || w.is_contract
    ? 0
    : Math.max(0, w.labor_fee + w.travel_fee + partsFee + w.other_fee - w.discount);
  const { total } = calcTax(chargeable, w.tax_mode);
  db.prepare('UPDATE work_orders SET parts_fee = ?, parts_cost = ?, total = ? WHERE id = ?')
    .run(partsFee, partsCost, total, orderId);
}

// 完工結算：確認工資最低收費、重算金額、產生技師抽成
function settleOrder(orderId, userId) {
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(orderId);
  if (!w) return;
  // 工資未填時依實際工時×標準工資帶入，並套用最低收費
  if (!w.labor_fee && !w.is_warranty && !w.is_contract) {
    const rate = Number(getSetting('labor_rate_hour', '800'));
    const min = Number(getSetting('min_labor_fee', '800'));
    const fee = Math.max(min, Math.round((w.work_hours || 1) * (w.headcount || 1) * rate));
    db.prepare('UPDATE work_orders SET labor_fee = ? WHERE id = ?').run(fee, orderId);
  }
  recalcOrder(orderId);
  buildCommissions(orderId, userId);
}

// 產生／重算此工單的技師抽成
function buildCommissions(orderId, userId) {
  const w = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(orderId);
  if (!w) return;
  const basis = getSetting('commission_basis', 'profit');
  const defRate = Number(getSetting('commission_rate_default', '0.15'));
  const techs = db.prepare(`SELECT t.user_id, u.commission_rate FROM work_order_techs t
    JOIN users u ON u.id = t.user_id WHERE t.order_id = ?`).all(orderId);
  if (!techs.length) return;

  const { net } = calcTax(w.total, w.tax_mode === 'free' ? 'free' : 'inclusive');   // 抽成一律以未稅營收為底
  const base = basis === 'labor' ? w.labor_fee
    : basis === 'revenue' ? net
      : Math.max(0, net - w.parts_cost);   // profit：未稅營收扣材料成本
  const share = Math.floor(base / techs.length);   // 多人出工均分

  db.transaction(() => {
    db.prepare("DELETE FROM commissions WHERE order_id = ? AND status = 'pending'").run(orderId);
    const ins = db.prepare(`INSERT INTO commissions
      (user_id, order_id, period, base_amount, rate, amount, basis) VALUES (?,?,?,?,?,?,?)`);
    for (const t of techs) {
      const rate = t.commission_rate > 0 ? t.commission_rate : defRate;
      ins.run(t.user_id, orderId, (w.finished_at || today()).slice(0, 7), share, rate,
        Math.round(share * rate), basis);
    }
  })();
  if (userId) audit('staff', userId, '', '產生工單抽成', w.order_no);
}

router.post('/work-orders/:id/recalc', requireStaff('orders'), (req, res) => {
  recalcOrder(req.params.id);
  buildCommissions(req.params.id, req.user.id);
  res.json({ ok: true, order: loadOrder(req.params.id) });
});

// ================= 派工看板 =================

router.get('/dispatch-board', requireStaff(), (req, res) => {
  const date = req.query.date || today();
  const techs = db.prepare("SELECT id, name, tech_no, phone FROM users WHERE active = 1 AND is_tech = 1 ORDER BY name").all();
  const orders = db.prepare(`
    SELECT w.id, w.order_no, w.type, w.status, w.priority, w.title, w.appoint_slot, w.address, w.phone,
           c.name AS customer_name,
           (SELECT GROUP_CONCAT(t.user_id) FROM work_order_techs t WHERE t.order_id = w.id) AS tech_ids
    FROM work_orders w JOIN customers c ON c.id = w.customer_id
    WHERE w.appoint_date = ? AND w.status != 'cancelled'
    ORDER BY w.priority = 'urgent' DESC, w.appoint_slot, w.id`).all(date);
  const unassigned = db.prepare(`
    SELECT w.id, w.order_no, w.type, w.status, w.priority, w.title, w.appoint_date, w.appoint_slot,
           w.address, c.name AS customer_name
    FROM work_orders w JOIN customers c ON c.id = w.customer_id
    WHERE w.status = 'draft' ORDER BY w.priority = 'urgent' DESC, w.appoint_date, w.id LIMIT 100`).all();
  res.json({
    date,
    techs: techs.map(t => ({
      ...t,
      orders: orders.filter(o => String(o.tech_ids || '').split(',').includes(String(t.id)))
    })),
    unassigned,
    all_today: orders
  });
});

// 月曆：某月每日的工單數與清單
router.get('/order-calendar', requireStaff(), (req, res) => {
  const month = req.query.month || thisMonth();
  const rows = db.prepare(`
    SELECT w.id, w.order_no, w.type, w.status, w.priority, w.title, w.appoint_date, w.appoint_slot,
           c.name AS customer_name,
           (SELECT GROUP_CONCAT(u.name, '、') FROM work_order_techs t JOIN users u ON u.id = t.user_id WHERE t.order_id = w.id) AS techs
    FROM work_orders w JOIN customers c ON c.id = w.customer_id
    WHERE substr(w.appoint_date,1,7) = ? AND w.status != 'cancelled'
    ORDER BY w.appoint_date, w.appoint_slot`).all(month);
  const byDate = {};
  for (const r of rows) (byDate[r.appoint_date] || (byDate[r.appoint_date] = [])).push(r);
  res.json({ month, days: byDate });
});

module.exports = router;
module.exports.recalcOrder = recalcOrder;
module.exports.buildCommissions = buildCommissions;
module.exports.STATUS_TW = STATUS_TW;
