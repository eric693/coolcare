// 工程專案（承攬案）、追加減帳、估驗計價、分包工班發包與計價付款、出工日報
//
// 台灣水電工程實務的三個核心：
//   1. 一個「案」從報價成交到驗收保固，中間會有追加減帳，合約金額是浮動的。
//   2. 業主不會一次付清，而是分期估驗計價，每期扣留保留款，驗收後才退還。
//   3. 工程行自己不見得出全部的工，會發包給工班；付給個人工班要辦理扣繳。
const express = require('express');
const {
  db, audit, getSetting, today, addDays, addMonths, nextDocNo, calcTax
} = require('../db');
const { requireStaff } = require('../auth');

const router = express.Router();

const num = v => Math.round(Number(v) || 0);
const rate = (key, fallback) => Number(getSetting(key, fallback));

// ================= 工程專案 =================

// 專案的金額狀況：合約（含追加減）、已計價、已請款、保留款、成本與毛利
function projectFinance(id) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return null;

  const changes = db.prepare(
    "SELECT COALESCE(SUM(amount),0) v FROM project_changes WHERE project_id = ? AND status = 'approved'").get(id).v;
  const contract = p.contract_amount + changes;

  const bill = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind != 'retention' THEN gross_amount ELSE 0 END),0) AS billed,
      COALESCE(SUM(retention),0) AS retention_held,
      COALESCE(SUM(net_amount),0) AS net_billed
    FROM project_billings WHERE project_id = ? AND status != 'cancelled'`).get(id);

  // 實際收款：透過估驗計價開出的請款單
  const received = db.prepare(`SELECT COALESCE(SUM(i.paid),0) v FROM project_billings b
    JOIN invoices i ON i.id = b.invoice_id
    WHERE b.project_id = ? AND i.status != 'void'`).get(id).v;

  // 成本三源：工單領料、分包計價、出工工資
  const matCost = db.prepare(`SELECT COALESCE(SUM(it.qty * it.cost),0) v
    FROM work_order_items it JOIN work_orders w ON w.id = it.order_id
    WHERE w.project_id = ? AND w.status != 'cancelled'`).get(id).v;
  const subCost = db.prepare(`SELECT COALESCE(SUM(b.gross_amount),0) v
    FROM subcontract_billings b JOIN subcontracts s ON s.id = b.subcontract_id
    WHERE s.project_id = ? AND b.status != 'cancelled'`).get(id).v;
  const laborCost = db.prepare(
    'SELECT COALESCE(SUM(amount),0) v FROM labor_logs WHERE project_id = ?').get(id).v;
  const cost = matCost + subCost + laborCost;

  // 已發包但尚未計價的金額，是還沒發生但躲不掉的成本
  const subCommitted = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM subcontracts
    WHERE project_id = ? AND status NOT IN ('draft','cancelled')`).get(id).v;

  return {
    change_amount: changes,
    contract_total: contract,
    billed: bill.billed,
    unbilled: contract - bill.billed,
    billed_pct: contract > 0 ? Math.round(bill.billed / contract * 100) : 0,
    retention_held: bill.retention_held - p.retention_released,
    retention_total: bill.retention_held,
    net_billed: bill.net_billed,
    received,
    receivable: bill.net_billed - received,
    material_cost: matCost,
    sub_cost: subCost,
    sub_committed: subCommitted,
    labor_cost: laborCost,
    cost,
    profit: contract - cost,
    profit_pct: contract > 0 ? Number(((contract - cost) / contract * 100).toFixed(1)) : 0,
    budget_left: p.budget_cost ? p.budget_cost - cost : null
  };
}

router.get('/projects', requireStaff('projects'), (req, res) => {
  const { status = 'open', trade = '', customer_id = '', q = '' } = req.query;
  const where = [], args = [];
  if (status === 'open') where.push("p.status IN ('draft','ongoing','paused')");
  else if (status) { where.push('p.status = ?'); args.push(status); }
  if (trade) { where.push('p.trade = ?'); args.push(trade); }
  if (customer_id) { where.push('p.customer_id = ?'); args.push(customer_id); }
  if (q) {
    where.push('(p.proj_no LIKE ? OR p.name LIKE ? OR p.address LIKE ? OR c.name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db.prepare(`
    SELECT p.*, c.name AS customer_name, u.name AS pm_name
    FROM projects p JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users u ON u.id = p.pm_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.id DESC LIMIT 300`).all(...args);
  for (const r of rows) {
    const f = projectFinance(r.id);
    r.contract_total = f.contract_total;
    r.billed = f.billed;
    r.billed_pct = f.billed_pct;
    r.receivable = f.receivable;
    r.retention_held = f.retention_held;
    r.profit = f.profit;
    // 逾期：已過契約完工日仍未完工
    r.overdue = !!(r.due_date && r.due_date < today() && ['draft', 'ongoing', 'paused'].includes(r.status));
  }
  res.json(rows);
});

router.get('/projects/:id', requireStaff('projects'), (req, res) => {
  const p = db.prepare(`SELECT p.*, c.name AS customer_name, c.tax_id, c.phone AS customer_phone,
      c.payment_terms, s.name AS site_name, u.name AS pm_name, q.quote_no
    FROM projects p JOIN customers c ON c.id = p.customer_id
    LEFT JOIN sites s ON s.id = p.site_id LEFT JOIN users u ON u.id = p.pm_id
    LEFT JOIN quotes q ON q.id = p.quote_id WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: '工程專案不存在' });

  p.finance = projectFinance(p.id);
  p.changes = db.prepare('SELECT * FROM project_changes WHERE project_id = ? ORDER BY change_date, id').all(p.id);
  p.billings = db.prepare(`SELECT b.*, i.inv_no, i.status AS invoice_status, i.paid AS invoice_paid, i.total AS invoice_total
    FROM project_billings b LEFT JOIN invoices i ON i.id = b.invoice_id
    WHERE b.project_id = ? ORDER BY b.seq, b.id`).all(p.id);
  p.orders = db.prepare(`SELECT w.id, w.order_no, w.type, w.title, w.status, w.appoint_date, w.total,
      (SELECT GROUP_CONCAT(u.name, '、') FROM work_order_techs t JOIN users u ON u.id = t.user_id WHERE t.order_id = w.id) AS techs
    FROM work_orders w WHERE w.project_id = ? ORDER BY w.appoint_date DESC, w.id DESC`).all(p.id);
  p.subcontracts = db.prepare(`SELECT sc.*, sb.name AS sub_name, sb.phone AS sub_phone,
      (SELECT COALESCE(SUM(gross_amount),0) FROM subcontract_billings b
        WHERE b.subcontract_id = sc.id AND b.status != 'cancelled') AS billed,
      (SELECT COALESCE(SUM(paid),0) FROM subcontract_billings b
        WHERE b.subcontract_id = sc.id AND b.status != 'cancelled') AS paid
    FROM subcontracts sc JOIN subcontractors sb ON sb.id = sc.subcontractor_id
    WHERE sc.project_id = ? ORDER BY sc.id`).all(p.id);
  p.labor = db.prepare(`SELECT l.*, u.name AS user_name, sb.name AS sub_name
    FROM labor_logs l LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN subcontractors sb ON sb.id = l.subcontractor_id
    WHERE l.project_id = ? ORDER BY l.log_date DESC, l.id DESC LIMIT 200`).all(p.id);
  p.filings = db.prepare(`SELECT f.*, u.name AS owner_name FROM filings f
    LEFT JOIN users u ON u.id = f.owner_id WHERE f.project_id = ? ORDER BY f.apply_date, f.id`).all(p.id);
  p.materials = db.prepare(`SELECT it.name, it.spec, it.unit, SUM(it.qty) AS qty,
      SUM(it.qty * it.cost) AS cost, SUM(it.qty * it.price) AS price
    FROM work_order_items it JOIN work_orders w ON w.id = it.order_id
    WHERE w.project_id = ? AND w.status != 'cancelled'
    GROUP BY it.name, it.spec, it.unit ORDER BY cost DESC`).all(p.id);
  res.json(p);
});

function writeProject(id, b, isNew) {
  const warrantyMonths = b.warranty_months === undefined
    ? Number(getSetting('project_warranty_months', '12')) : Number(b.warranty_months) || 0;
  // 保固到期日由驗收日（無則完工日）推算，欄位留給使用者手動覆寫
  const base = b.accept_date || b.finish_date || '';
  const warrantyEnd = b.warranty_end || (base ? addMonths(base, warrantyMonths) : '');
  db.prepare(`UPDATE projects SET name = ?, customer_id = ?, site_id = ?, trade = ?, kind = ?, address = ?,
      contact = ?, phone = ?, contract_no = ?, contract_date = ?, contract_amount = ?, tax_mode = ?,
      budget_cost = ?, retention_rate = ?, guarantee_amount = ?, guarantee_type = ?, guarantee_return_date = ?,
      pm_id = ?, start_date = ?, due_date = ?, finish_date = ?, accept_date = ?, warranty_months = ?,
      warranty_end = ?, progress = ?, status = ?, scope = ?, note = ? WHERE id = ?`)
    .run(b.name, b.customer_id, b.site_id || null, b.trade || 'mixed', b.kind || 'new', b.address || '',
      b.contact || '', b.phone || '', b.contract_no || '', b.contract_date || '', num(b.contract_amount),
      b.tax_mode || 'exclusive', num(b.budget_cost),
      b.retention_rate === undefined ? rate('retention_rate_default', '0.05') : Number(b.retention_rate) || 0,
      num(b.guarantee_amount), b.guarantee_type || '', b.guarantee_return_date || '',
      b.pm_id || null, b.start_date || '', b.due_date || '', b.finish_date || '', b.accept_date || '',
      warrantyMonths, warrantyEnd, Math.min(100, Math.max(0, num(b.progress))),
      isNew ? (b.status || 'draft') : (b.status || 'ongoing'), b.scope || '', b.note || '', id);
}

router.post('/projects', requireStaff('projects'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫工程名稱' });
  if (!b.customer_id) return res.status(400).json({ error: '請選擇業主（客戶）' });
  const date = b.contract_date || today();
  const out = db.transaction(() => {
    const no = nextDocNo('PJ', date);
    const info = db.prepare('INSERT INTO projects (proj_no, name, customer_id, created_by) VALUES (?,?,?,?)')
      .run(no, b.name, b.customer_id, req.user.id);
    writeProject(info.lastInsertRowid, b, true);
    return { id: info.lastInsertRowid, proj_no: no };
  })();
  audit('staff', req.user.id, req.user.name, '新增工程專案', out.proj_no, b.name);
  res.json(out);
});

router.put('/projects/:id', requireStaff('projects'), (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '工程專案不存在' });
  if (p.status === 'settled') return res.status(400).json({ error: '已結案的工程不可修改' });
  const b = { ...p, ...req.body };
  writeProject(p.id, b, false);
  audit('staff', req.user.id, req.user.name, '修改工程專案', p.proj_no);
  res.json({ ok: true });
});

router.delete('/projects/:id', requireStaff('projects'), (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '工程專案不存在' });
  const billed = db.prepare("SELECT COUNT(*) n FROM project_billings WHERE project_id = ? AND status != 'draft'").get(p.id).n;
  if (billed) return res.status(400).json({ error: '已有估驗計價紀錄，不可刪除；請改為取消結案' });
  // 工單與發包單都會外鍵參照工程，直接刪會被資料庫擋下並回 500，先給出看得懂的訊息
  const orders = db.prepare('SELECT COUNT(*) n FROM work_orders WHERE project_id = ?').get(p.id).n;
  if (orders) return res.status(400).json({ error: `此工程底下有 ${orders} 張工單，請先解除工單的工程歸屬` });
  const subs = db.prepare('SELECT COUNT(*) n FROM subcontracts WHERE project_id = ?').get(p.id).n;
  if (subs) return res.status(400).json({ error: `此工程底下有 ${subs} 張發包單，請先處理` });
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  audit('staff', req.user.id, req.user.name, '刪除工程專案', p.proj_no);
  res.json({ ok: true });
});

// 報價成交 → 直接開工程專案（合約金額帶報價未稅小計）
router.post('/projects/from-quote/:quoteId', requireStaff('projects'), (req, res) => {
  const qt = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.quoteId);
  if (!qt) return res.status(404).json({ error: '報價單不存在' });
  const exists = db.prepare('SELECT proj_no FROM projects WHERE quote_id = ?').get(qt.id);
  if (exists) return res.status(400).json({ error: `此報價已建立工程專案 ${exists.proj_no}` });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(qt.customer_id);
  const site = qt.site_id ? db.prepare('SELECT * FROM sites WHERE id = ?').get(qt.site_id) : null;
  const date = today();
  const out = db.transaction(() => {
    const no = nextDocNo('PJ', date);
    const info = db.prepare(`INSERT INTO projects
        (proj_no, name, customer_id, site_id, quote_id, address, contact, phone, contract_date,
         contract_amount, tax_mode, trade, kind, retention_rate, warranty_months, status, scope, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`)
      .run(no, qt.title || `${qt.quote_no} 工程`, customer.id, qt.site_id || null, qt.id,
        (site && site.address) || customer.address, (site && site.contact) || customer.contact,
        (site && site.phone) || customer.phone, date, qt.subtotal, qt.tax_mode,
        req.body?.trade || 'mixed', req.body?.kind || 'new',
        rate('retention_rate_default', '0.05'), Number(getSetting('project_warranty_months', '12')),
        qt.terms || '', req.user.id);
    db.prepare("UPDATE quotes SET status = 'accepted' WHERE id = ?").run(qt.id);
    return { id: info.lastInsertRowid, proj_no: no };
  })();
  audit('staff', req.user.id, req.user.name, '報價轉工程專案', qt.quote_no, out.proj_no);
  res.json(out);
});

// ---- 追加減帳 ----

router.post('/projects/:id/changes', requireStaff('projects'), (req, res) => {
  const b = req.body || {};
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '工程專案不存在' });
  if (!b.title) return res.status(400).json({ error: '請填寫變更項目' });
  const seq = db.prepare('SELECT COUNT(*) n FROM project_changes WHERE project_id = ?').get(p.id).n + 1;
  const info = db.prepare(`INSERT INTO project_changes
      (project_id, change_no, change_date, title, amount, reason, status, approved_by, approved_date, note)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(p.id, b.change_no || `CO-${String(seq).padStart(2, '0')}`, b.change_date || today(), b.title,
      num(b.amount), b.reason || '', b.status || 'draft', b.approved_by || '', b.approved_date || '', b.note || '');
  syncChangeAmount(p.id);
  audit('staff', req.user.id, req.user.name, '新增工程變更', p.proj_no, `${b.title} ${num(b.amount)}`);
  res.json({ id: info.lastInsertRowid });
});

function syncChangeAmount(projectId) {
  const v = db.prepare(
    "SELECT COALESCE(SUM(amount),0) v FROM project_changes WHERE project_id = ? AND status = 'approved'").get(projectId).v;
  db.prepare('UPDATE projects SET change_amount = ? WHERE id = ?').run(v, projectId);
}

router.put('/project-changes/:id', requireStaff('projects'), (req, res) => {
  const b = req.body || {};
  const c = db.prepare('SELECT * FROM project_changes WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '變更單不存在' });
  db.prepare(`UPDATE project_changes SET change_no = ?, change_date = ?, title = ?, amount = ?, reason = ?,
      status = ?, approved_by = ?, approved_date = ?, note = ? WHERE id = ?`)
    .run(b.change_no ?? c.change_no, b.change_date || c.change_date, b.title || c.title,
      b.amount === undefined ? c.amount : num(b.amount), b.reason ?? c.reason, b.status || c.status,
      b.approved_by ?? c.approved_by,
      b.status === 'approved' && !c.approved_date ? (b.approved_date || today()) : (b.approved_date ?? c.approved_date),
      b.note ?? c.note, c.id);
  syncChangeAmount(c.project_id);
  res.json({ ok: true });
});

router.delete('/project-changes/:id', requireStaff('projects'), (req, res) => {
  const c = db.prepare('SELECT * FROM project_changes WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '變更單不存在' });
  db.prepare('DELETE FROM project_changes WHERE id = ?').run(c.id);
  syncChangeAmount(c.project_id);
  res.json({ ok: true });
});

// ---- 估驗計價 ----

// 本期估驗金額算法：合約總額 ×（本期累計完成% － 前期累計完成%）
router.post('/projects/:id/billings', requireStaff('projects'), (req, res) => {
  const b = req.body || {};
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '工程專案不存在' });
  const f = projectFinance(p.id);
  const kind = b.kind || 'progress';

  let gross = num(b.gross_amount);
  let retention = num(b.retention);
  const prevPct = db.prepare(
    "SELECT COALESCE(MAX(progress_pct),0) v FROM project_billings WHERE project_id = ? AND status != 'cancelled' AND kind != 'retention'")
    .get(p.id).v;
  const pct = b.progress_pct === undefined ? prevPct : Math.min(100, Math.max(0, num(b.progress_pct)));

  if (kind === 'retention') {
    // 保留款退還：不再扣留，金額不計入計價進度
    if (!gross) gross = f.retention_held;
    if (gross > f.retention_held) return res.status(400).json({ error: `保留款餘額僅 ${f.retention_held}` });
    retention = 0;
  } else {
    if (!gross) {
      if (pct <= prevPct) return res.status(400).json({ error: '本期累計完成度需高於前期，或直接填寫本期估驗金額' });
      gross = Math.round(f.contract_total * (pct - prevPct) / 100);
    }
    if (gross > f.unbilled) {
      return res.status(400).json({ error: `本期估驗 ${gross} 已超過未計價餘額 ${f.unbilled}，請先辦理追加帳` });
    }
    if (b.retention === undefined) retention = Math.round(gross * p.retention_rate);
  }

  const deduct = num(b.deduct);
  const net = gross - retention - deduct;
  if (net < 0) return res.status(400).json({ error: '扣款與保留款合計已超過本期估驗金額' });

  const seq = db.prepare('SELECT COALESCE(MAX(seq),0) v FROM project_billings WHERE project_id = ?').get(p.id).v + 1;
  const info = db.prepare(`INSERT INTO project_billings
      (project_id, seq, kind, bill_date, progress_pct, gross_amount, retention, deduct, deduct_note,
       net_amount, status, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.id, seq, kind, b.bill_date || today(), pct, gross, retention, deduct, b.deduct_note || '',
      net, b.status || 'confirmed', b.note || '', req.user.id);

  // 計價後同步專案進度，省得兩邊各填一次
  if (kind !== 'retention' && pct > p.progress) {
    db.prepare("UPDATE projects SET progress = ?, status = CASE WHEN status = 'draft' THEN 'ongoing' ELSE status END WHERE id = ?")
      .run(pct, p.id);
  }
  audit('staff', req.user.id, req.user.name, '新增估驗計價', p.proj_no, `第 ${seq} 期 ${net}`);
  res.json({ id: info.lastInsertRowid, seq, gross_amount: gross, retention, net_amount: net });
});

router.put('/project-billings/:id', requireStaff('projects'), (req, res) => {
  const b = req.body || {};
  const row = db.prepare('SELECT * FROM project_billings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '估驗計價單不存在' });
  if (row.invoice_id) return res.status(400).json({ error: '已開立請款單，請先作廢請款單再修改' });
  const gross = b.gross_amount === undefined ? row.gross_amount : num(b.gross_amount);
  const retention = b.retention === undefined ? row.retention : num(b.retention);
  const deduct = b.deduct === undefined ? row.deduct : num(b.deduct);
  db.prepare(`UPDATE project_billings SET bill_date = ?, progress_pct = ?, gross_amount = ?, retention = ?,
      deduct = ?, deduct_note = ?, net_amount = ?, status = ?, note = ? WHERE id = ?`)
    .run(b.bill_date || row.bill_date,
      b.progress_pct === undefined ? row.progress_pct : num(b.progress_pct),
      gross, retention, deduct, b.deduct_note ?? row.deduct_note,
      gross - retention - deduct, b.status || row.status, b.note ?? row.note, row.id);
  res.json({ ok: true });
});

router.delete('/project-billings/:id', requireStaff('projects'), (req, res) => {
  const row = db.prepare('SELECT * FROM project_billings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '估驗計價單不存在' });
  if (row.invoice_id) return res.status(400).json({ error: '已開立請款單，請先作廢請款單' });
  db.prepare('DELETE FROM project_billings WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// 估驗計價 → 開立請款單（金額用扣完保留款的淨額，保留款欄位在明細裡寫清楚）
router.post('/project-billings/:id/to-invoice', requireStaff('billing'), (req, res) => {
  const row = db.prepare('SELECT * FROM project_billings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '估驗計價單不存在' });
  if (row.invoice_id) return res.status(400).json({ error: '此期已開立請款單' });
  if (row.status === 'cancelled') return res.status(400).json({ error: '已取消的計價單不可請款' });
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id);
  const issueDate = req.body?.issue_date || today();
  const dueDays = Number(getSetting('invoice_due_days', '30'));
  const kindTw = { deposit: '訂金', progress: '估驗計價', final: '尾款', retention: '保留款退還' };

  const out = db.transaction(() => {
    const no = nextDocNo('IV', issueDate);
    const info = db.prepare(`INSERT INTO invoices
        (inv_no, customer_id, issue_date, due_date, period, source_type, source_ids, note, created_by)
        VALUES (?,?,?,?,?,'project',?,?,?)`)
      .run(no, p.customer_id, issueDate, req.body?.due_date || addDays(issueDate, dueDays),
        issueDate.slice(0, 7), ',' + row.id + ',',
        `${p.proj_no} ${p.name} 第 ${row.seq} 期`, req.user.id);
    const invId = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id, name, qty, unit, price, amount, note) VALUES (?,?,?,?,?,?,?)');
    ins.run(invId, `${p.name}　${kindTw[row.kind] || row.kind}（第 ${row.seq} 期，累計完成 ${row.progress_pct}%）`,
      1, '式', row.gross_amount, row.gross_amount, p.address);
    if (row.retention) ins.run(invId, `減：保留款（${(p.retention_rate * 100).toFixed(0)}%，驗收後退還）`, 1, '式', -row.retention, -row.retention, '');
    if (row.deduct) ins.run(invId, `減：${row.deduct_note || '其他扣款'}`, 1, '式', -row.deduct, -row.deduct, '');

    db.prepare("UPDATE project_billings SET invoice_id = ?, status = 'billed' WHERE id = ?").run(invId, row.id);
    // 保留款退還時，把退還金額累計回專案
    if (row.kind === 'retention') {
      db.prepare('UPDATE projects SET retention_released = retention_released + ? WHERE id = ?')
        .run(row.gross_amount, p.id);
    }
    return { id: invId, inv_no: no };
  })();

  // 沿用 billing 模組的加總邏輯（明細含負數，calcTax 以未稅小計計算）
  const sub = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM invoice_items WHERE invoice_id = ?').get(out.id).v;
  const { net, tax, total } = calcTax(sub, p.tax_mode === 'free' ? 'free' : 'exclusive');
  db.prepare('UPDATE invoices SET subtotal = ?, tax = ?, total = ? WHERE id = ?').run(net, tax, total, out.id);

  audit('staff', req.user.id, req.user.name, '估驗計價開立請款單', p.proj_no, out.inv_no);
  res.json(out);
});

// ================= 分包工班 =================

router.get('/subcontractors', requireStaff('subcontract'), (req, res) => {
  const { q = '', trade = '', status = 'active' } = req.query;
  const where = [], args = [];
  if (status === 'active') where.push('s.active = 1');
  else if (status === 'inactive') where.push('s.active = 0');
  if (trade) { where.push('s.trade = ?'); args.push(trade); }
  if (q) { where.push('(s.name LIKE ? OR s.phone LIKE ? OR s.contact LIKE ? OR s.trade LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM subcontracts sc WHERE sc.subcontractor_id = s.id) AS contract_count,
      (SELECT COALESCE(SUM(sc.amount),0) FROM subcontracts sc
        WHERE sc.subcontractor_id = s.id AND sc.status NOT IN ('draft','cancelled')) AS total_amount,
      (SELECT COALESCE(SUM(b.net_pay - b.paid),0) FROM subcontract_billings b
        JOIN subcontracts sc ON sc.id = b.subcontract_id
        WHERE sc.subcontractor_id = s.id AND b.status IN ('confirmed','paid')) AS payable
    FROM subcontractors s
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.active DESC, s.name LIMIT 300`).all(...args));
});

router.get('/subcontractors/:id', requireStaff('subcontract'), (req, res) => {
  const s = db.prepare('SELECT * FROM subcontractors WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '工班資料不存在' });
  s.subcontracts = db.prepare(`SELECT sc.*, p.proj_no, p.name AS project_name,
      (SELECT COALESCE(SUM(gross_amount),0) FROM subcontract_billings b
        WHERE b.subcontract_id = sc.id AND b.status != 'cancelled') AS billed
    FROM subcontracts sc LEFT JOIN projects p ON p.id = sc.project_id
    WHERE sc.subcontractor_id = ? ORDER BY sc.id DESC`).all(s.id);
  s.billings = db.prepare(`SELECT b.*, sc.sc_no, sc.title FROM subcontract_billings b
    JOIN subcontracts sc ON sc.id = b.subcontract_id
    WHERE sc.subcontractor_id = ? ORDER BY b.bill_date DESC, b.id DESC LIMIT 100`).all(s.id);
  // 年度給付累計：報稅開立扣繳憑單時要用
  const year = today().slice(0, 4);
  s.year_summary = db.prepare(`SELECT COALESCE(SUM(b.gross_amount),0) AS gross,
      COALESCE(SUM(b.wht_tax),0) AS wht, COALESCE(SUM(b.nhi_fee),0) AS nhi
    FROM subcontract_billings b JOIN subcontracts sc ON sc.id = b.subcontract_id
    WHERE sc.subcontractor_id = ? AND b.status = 'paid' AND substr(b.pay_date,1,4) = ?`).get(s.id, year);
  s.year_summary.year = year;
  res.json(s);
});

router.post('/subcontractors', requireStaff('subcontract'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫工班名稱' });
  const info = db.prepare(`INSERT INTO subcontractors
      (code, name, trade, is_individual, tax_id, contact, phone, address, bank_account, license, license_no,
       license_expiry, labor_insurance, insurance_end, payment_terms, day_rate, rating, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.code || '', b.name, b.trade || 'mixed', b.is_individual ? 1 : 0, b.tax_id || '',
      b.contact || '', b.phone || '', b.address || '', b.bank_account || '', b.license || '',
      b.license_no || '', b.license_expiry || '', b.labor_insurance ? 1 : 0, b.insurance_end || '',
      b.payment_terms || '月結30天', num(b.day_rate), Number(b.rating) || 0, b.note || '');
  audit('staff', req.user.id, req.user.name, '新增分包工班', b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/subcontractors/:id', requireStaff('subcontract'), (req, res) => {
  const b = req.body || {};
  const s = db.prepare('SELECT * FROM subcontractors WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '工班資料不存在' });
  db.prepare(`UPDATE subcontractors SET code = ?, name = ?, trade = ?, is_individual = ?, tax_id = ?, contact = ?,
      phone = ?, address = ?, bank_account = ?, license = ?, license_no = ?, license_expiry = ?,
      labor_insurance = ?, insurance_end = ?, payment_terms = ?, day_rate = ?, rating = ?, note = ?, active = ?
      WHERE id = ?`)
    .run(b.code ?? s.code, b.name || s.name, b.trade || s.trade, b.is_individual ? 1 : 0, b.tax_id ?? s.tax_id,
      b.contact ?? s.contact, b.phone ?? s.phone, b.address ?? s.address, b.bank_account ?? s.bank_account,
      b.license ?? s.license, b.license_no ?? s.license_no, b.license_expiry ?? s.license_expiry,
      b.labor_insurance ? 1 : 0, b.insurance_end ?? s.insurance_end, b.payment_terms || s.payment_terms,
      b.day_rate === undefined ? s.day_rate : num(b.day_rate),
      b.rating === undefined ? s.rating : Number(b.rating) || 0, b.note ?? s.note,
      b.active === undefined ? s.active : (b.active ? 1 : 0), s.id);
  res.json({ ok: true });
});

// ---- 發包單 ----

router.get('/subcontracts', requireStaff('subcontract'), (req, res) => {
  const { status = '', project_id = '', subcontractor_id = '', q = '' } = req.query;
  const where = [], args = [];
  if (status === 'open') where.push("sc.status IN ('signed','working','done')");
  else if (status) { where.push('sc.status = ?'); args.push(status); }
  if (project_id) { where.push('sc.project_id = ?'); args.push(project_id); }
  if (subcontractor_id) { where.push('sc.subcontractor_id = ?'); args.push(subcontractor_id); }
  if (q) { where.push('(sc.sc_no LIKE ? OR sc.title LIKE ? OR sb.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(db.prepare(`
    SELECT sc.*, sb.name AS sub_name, sb.phone AS sub_phone, sb.is_individual, p.proj_no, p.name AS project_name,
      w.order_no,
      (SELECT COALESCE(SUM(gross_amount),0) FROM subcontract_billings b
        WHERE b.subcontract_id = sc.id AND b.status != 'cancelled') AS billed,
      (SELECT COALESCE(SUM(net_pay),0) FROM subcontract_billings b
        WHERE b.subcontract_id = sc.id AND b.status != 'cancelled') AS net_billed,
      (SELECT COALESCE(SUM(paid),0) FROM subcontract_billings b
        WHERE b.subcontract_id = sc.id AND b.status != 'cancelled') AS paid,
      (SELECT COALESCE(SUM(retention),0) FROM subcontract_billings b
        WHERE b.subcontract_id = sc.id AND b.status != 'cancelled') AS retention_held
    FROM subcontracts sc JOIN subcontractors sb ON sb.id = sc.subcontractor_id
    LEFT JOIN projects p ON p.id = sc.project_id LEFT JOIN work_orders w ON w.id = sc.order_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sc.id DESC LIMIT 300`).all(...args));
});

router.get('/subcontracts/:id', requireStaff('subcontract'), (req, res) => {
  const sc = db.prepare(`SELECT sc.*, sb.name AS sub_name, sb.phone AS sub_phone, sb.contact AS sub_contact,
      sb.is_individual, sb.tax_id AS sub_tax_id, sb.bank_account, sb.payment_terms,
      p.proj_no, p.name AS project_name, w.order_no
    FROM subcontracts sc JOIN subcontractors sb ON sb.id = sc.subcontractor_id
    LEFT JOIN projects p ON p.id = sc.project_id LEFT JOIN work_orders w ON w.id = sc.order_id
    WHERE sc.id = ?`).get(req.params.id);
  if (!sc) return res.status(404).json({ error: '發包單不存在' });
  sc.billings = db.prepare('SELECT * FROM subcontract_billings WHERE subcontract_id = ? ORDER BY seq, id').all(sc.id);
  const s = sc.billings.filter(b => b.status !== 'cancelled');
  sc.summary = {
    billed: s.reduce((a, b) => a + b.gross_amount, 0),
    retention: s.reduce((a, b) => a + b.retention, 0),
    wht: s.reduce((a, b) => a + b.wht_tax, 0),
    nhi: s.reduce((a, b) => a + b.nhi_fee, 0),
    net: s.reduce((a, b) => a + b.net_pay, 0),
    paid: s.reduce((a, b) => a + b.paid, 0)
  };
  sc.summary.unbilled = sc.amount - sc.summary.billed;
  sc.summary.unpaid = sc.summary.net - sc.summary.paid;
  res.json(sc);
});

router.post('/subcontracts', requireStaff('subcontract'), (req, res) => {
  const b = req.body || {};
  if (!b.subcontractor_id) return res.status(400).json({ error: '請選擇分包工班' });
  if (!b.project_id && !b.order_id) return res.status(400).json({ error: '請指定所屬工程專案或工單' });
  const date = b.start_date || today();
  const out = db.transaction(() => {
    const no = nextDocNo('SC', date);
    const info = db.prepare(`INSERT INTO subcontracts
        (sc_no, subcontractor_id, project_id, order_id, title, trade, pay_kind, scope, amount, tax_mode,
         retention_rate, start_date, end_date, warranty_months, status, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no, b.subcontractor_id, b.project_id || null, b.order_id || null, b.title || '', b.trade || '',
        b.pay_kind || 'lump', b.scope || '', num(b.amount), b.tax_mode || 'exclusive',
        b.retention_rate === undefined ? rate('sub_retention_rate', '0.05') : Number(b.retention_rate) || 0,
        b.start_date || '', b.end_date || '', Number(b.warranty_months) || 12,
        b.status || 'draft', b.note || '', req.user.id);
    return { id: info.lastInsertRowid, sc_no: no };
  })();
  audit('staff', req.user.id, req.user.name, '新增發包單', out.sc_no, b.title || '');
  res.json(out);
});

router.put('/subcontracts/:id', requireStaff('subcontract'), (req, res) => {
  const b = req.body || {};
  const sc = db.prepare('SELECT * FROM subcontracts WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: '發包單不存在' });
  if (sc.status === 'settled') return res.status(400).json({ error: '已結案的發包單不可修改' });
  const billed = db.prepare(
    "SELECT COALESCE(SUM(gross_amount),0) v FROM subcontract_billings WHERE subcontract_id = ? AND status != 'cancelled'")
    .get(sc.id).v;
  const amount = b.amount === undefined ? sc.amount : num(b.amount);
  if (amount < billed) return res.status(400).json({ error: `發包金額不可低於已計價金額 ${billed}` });
  db.prepare(`UPDATE subcontracts SET title = ?, trade = ?, pay_kind = ?, scope = ?, amount = ?, tax_mode = ?,
      retention_rate = ?, start_date = ?, end_date = ?, warranty_months = ?, status = ?, note = ? WHERE id = ?`)
    .run(b.title ?? sc.title, b.trade ?? sc.trade, b.pay_kind || sc.pay_kind, b.scope ?? sc.scope,
      amount, b.tax_mode || sc.tax_mode,
      b.retention_rate === undefined ? sc.retention_rate : Number(b.retention_rate) || 0,
      b.start_date ?? sc.start_date, b.end_date ?? sc.end_date,
      b.warranty_months === undefined ? sc.warranty_months : Number(b.warranty_months) || 0,
      b.status || sc.status, b.note ?? sc.note, sc.id);
  res.json({ ok: true });
});

router.delete('/subcontracts/:id', requireStaff('subcontract'), (req, res) => {
  const sc = db.prepare('SELECT * FROM subcontracts WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: '發包單不存在' });
  const n = db.prepare('SELECT COUNT(*) n FROM subcontract_billings WHERE subcontract_id = ?').get(sc.id).n;
  if (n) return res.status(400).json({ error: '已有計價紀錄，不可刪除' });
  db.prepare('DELETE FROM subcontracts WHERE id = ?').run(sc.id);
  res.json({ ok: true });
});

/**
 * 分包計價的稅費試算。
 * 個人工班（無統編）：依所得稅法第 88 條辦理扣繳，並代扣二代健保補充保費；
 * 公司行號：取具發票，不扣繳，發包若為未稅則加計 5% 營業稅一併支付。
 */
function calcSubBilling(sc, isIndividual, gross, opts = {}) {
  const materialDeduct = num(opts.material_deduct);
  const penalty = num(opts.penalty);
  const retention = opts.retention === undefined ? Math.round(gross * sc.retention_rate) : num(opts.retention);
  let wht = 0, nhi = 0, tax = 0;

  if (isIndividual) {
    if (opts.wht_tax !== undefined) wht = num(opts.wht_tax);
    else if (gross >= rate('wht_threshold', '20010')) wht = Math.round(gross * rate('wht_rate', '0.10'));
    if (opts.nhi_fee !== undefined) nhi = num(opts.nhi_fee);
    else if (gross >= rate('nhi_threshold', '20000')) nhi = Math.round(gross * rate('nhi_rate', '0.0211'));
  } else if (sc.tax_mode === 'exclusive') {
    tax = calcTax(gross, 'exclusive').tax;
  }

  const net = gross + tax - materialDeduct - penalty - retention - wht - nhi;
  return { gross, tax, material_deduct: materialDeduct, penalty, retention, wht_tax: wht, nhi_fee: nhi, net_pay: net };
}

// 試算端點：前端填金額時即時顯示會扣多少、實付多少
router.post('/subcontracts/:id/calc', requireStaff('subcontract'), (req, res) => {
  const sc = db.prepare('SELECT * FROM subcontracts WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: '發包單不存在' });
  const sb = db.prepare('SELECT is_individual FROM subcontractors WHERE id = ?').get(sc.subcontractor_id);
  res.json(calcSubBilling(sc, sb.is_individual, num(req.body?.gross_amount), req.body || {}));
});

router.post('/subcontracts/:id/billings', requireStaff('subcontract'), (req, res) => {
  const b = req.body || {};
  const sc = db.prepare('SELECT * FROM subcontracts WHERE id = ?').get(req.params.id);
  if (!sc) return res.status(404).json({ error: '發包單不存在' });
  const sb = db.prepare('SELECT * FROM subcontractors WHERE id = ?').get(sc.subcontractor_id);
  const billed = db.prepare(
    "SELECT COALESCE(SUM(gross_amount),0) v FROM subcontract_billings WHERE subcontract_id = ? AND status != 'cancelled'")
    .get(sc.id).v;

  const prevPct = db.prepare(
    "SELECT COALESCE(MAX(progress_pct),0) v FROM subcontract_billings WHERE subcontract_id = ? AND status != 'cancelled'")
    .get(sc.id).v;
  const pct = b.progress_pct === undefined ? prevPct : Math.min(100, Math.max(0, num(b.progress_pct)));
  let gross = num(b.gross_amount);
  if (!gross) {
    if (pct <= prevPct) return res.status(400).json({ error: '本期完成度需高於前期，或直接填寫本期計價金額' });
    gross = Math.round(sc.amount * (pct - prevPct) / 100);
  }
  if (gross > sc.amount - billed) {
    return res.status(400).json({ error: `本期計價 ${gross} 超過未計價餘額 ${sc.amount - billed}` });
  }

  const c = calcSubBilling(sc, sb.is_individual, gross, b);
  if (c.net_pay < 0) return res.status(400).json({ error: '扣款合計已超過本期計價金額' });

  const seq = db.prepare('SELECT COALESCE(MAX(seq),0) v FROM subcontract_billings WHERE subcontract_id = ?').get(sc.id).v + 1;
  const info = db.prepare(`INSERT INTO subcontract_billings
      (subcontract_id, seq, bill_date, progress_pct, gross_amount, material_deduct, penalty, retention,
       wht_tax, nhi_fee, net_pay, invoice_no, status, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sc.id, seq, b.bill_date || today(), pct, c.gross, c.material_deduct, c.penalty, c.retention,
      c.wht_tax, c.nhi_fee, c.net_pay, b.invoice_no || '', b.status || 'confirmed', b.note || '', req.user.id);

  if (sc.status === 'draft' || sc.status === 'signed') {
    db.prepare("UPDATE subcontracts SET status = 'working' WHERE id = ?").run(sc.id);
  }
  audit('staff', req.user.id, req.user.name, '分包計價', sc.sc_no, `第 ${seq} 期 實付 ${c.net_pay}`);
  res.json({ id: info.lastInsertRowid, seq, ...c });
});

// 付款給工班
router.post('/subcontract-billings/:id/pay', requireStaff('subcontract'), (req, res) => {
  const b = req.body || {};
  const row = db.prepare('SELECT * FROM subcontract_billings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '計價單不存在' });
  if (row.status === 'cancelled') return res.status(400).json({ error: '已取消的計價單不可付款' });
  const amount = b.amount === undefined ? row.net_pay - row.paid : num(b.amount);
  if (amount <= 0) return res.status(400).json({ error: '付款金額需大於 0' });
  if (row.paid + amount > row.net_pay) return res.status(400).json({ error: `付款超過未付餘額 ${row.net_pay - row.paid}` });
  const paid = row.paid + amount;
  db.prepare(`UPDATE subcontract_billings SET paid = ?, pay_date = ?, method = ?, invoice_no = ?,
      status = ? WHERE id = ?`)
    .run(paid, b.pay_date || today(), b.method || '匯款', b.invoice_no ?? row.invoice_no,
      paid >= row.net_pay ? 'paid' : row.status, row.id);
  audit('staff', req.user.id, req.user.name, '分包付款', String(row.id), String(amount));
  res.json({ ok: true, paid });
});

router.put('/subcontract-billings/:id', requireStaff('subcontract'), (req, res) => {
  const b = req.body || {};
  const row = db.prepare('SELECT * FROM subcontract_billings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '計價單不存在' });
  if (row.paid > 0 && b.status !== 'cancelled') return res.status(400).json({ error: '已付款的計價單不可修改金額' });
  if (b.status === 'cancelled' && row.paid > 0) return res.status(400).json({ error: '已付款，請先沖銷付款再取消' });
  const sc = db.prepare('SELECT * FROM subcontracts WHERE id = ?').get(row.subcontract_id);
  const sb = db.prepare('SELECT is_individual FROM subcontractors WHERE id = ?').get(sc.subcontractor_id);
  const gross = b.gross_amount === undefined ? row.gross_amount : num(b.gross_amount);
  const c = calcSubBilling(sc, sb.is_individual, gross, { ...row, ...b });
  db.prepare(`UPDATE subcontract_billings SET bill_date = ?, progress_pct = ?, gross_amount = ?,
      material_deduct = ?, penalty = ?, retention = ?, wht_tax = ?, nhi_fee = ?, net_pay = ?,
      invoice_no = ?, status = ?, note = ? WHERE id = ?`)
    .run(b.bill_date || row.bill_date, b.progress_pct === undefined ? row.progress_pct : num(b.progress_pct),
      c.gross, c.material_deduct, c.penalty, c.retention, c.wht_tax, c.nhi_fee, c.net_pay,
      b.invoice_no ?? row.invoice_no, b.status || row.status, b.note ?? row.note, row.id);
  res.json({ ok: true });
});

// 應付工班總表（含保留款與年度扣繳彙總，報稅用）
router.get('/subcontract-payable', requireStaff('subcontract'), (req, res) => {
  const rows = db.prepare(`SELECT b.id, b.seq, b.bill_date, b.gross_amount, b.retention, b.wht_tax, b.nhi_fee,
      b.net_pay, b.paid, (b.net_pay - b.paid) AS balance, b.status,
      sc.sc_no, sc.title, sb.id AS sub_id, sb.name AS sub_name, sb.phone, sb.is_individual, sb.payment_terms,
      p.proj_no, p.name AS project_name
    FROM subcontract_billings b
    JOIN subcontracts sc ON sc.id = b.subcontract_id
    JOIN subcontractors sb ON sb.id = sc.subcontractor_id
    LEFT JOIN projects p ON p.id = sc.project_id
    WHERE b.status IN ('confirmed','paid') AND b.net_pay > b.paid
    ORDER BY b.bill_date`).all();
  const year = req.query.year || today().slice(0, 4);
  const wht = db.prepare(`SELECT sb.id, sb.name, sb.tax_id, sb.is_individual,
      COALESCE(SUM(b.gross_amount),0) AS gross, COALESCE(SUM(b.wht_tax),0) AS wht, COALESCE(SUM(b.nhi_fee),0) AS nhi
    FROM subcontract_billings b JOIN subcontracts sc ON sc.id = b.subcontract_id
    JOIN subcontractors sb ON sb.id = sc.subcontractor_id
    WHERE b.status = 'paid' AND substr(b.pay_date,1,4) = ? AND sb.is_individual = 1
    GROUP BY sb.id ORDER BY gross DESC`).all(year);
  const retention = db.prepare(`SELECT sb.name AS sub_name, sc.sc_no, sc.title, sc.status,
      COALESCE(SUM(b.retention),0) AS retention
    FROM subcontract_billings b JOIN subcontracts sc ON sc.id = b.subcontract_id
    JOIN subcontractors sb ON sb.id = sc.subcontractor_id
    WHERE b.status != 'cancelled' GROUP BY sc.id HAVING retention > 0 ORDER BY sb.name`).all();
  res.json({
    rows, total: rows.reduce((s, r) => s + r.balance, 0),
    wht_year: year, wht_summary: wht, retention
  });
});

// ================= 出工日報／點工 =================

router.get('/labor-logs', requireStaff('labor'), (req, res) => {
  const { from = '', to = '', project_id = '', user_id = '', subcontractor_id = '' } = req.query;
  const where = [], args = [];
  if (from) { where.push('l.log_date >= ?'); args.push(from); }
  if (to) { where.push('l.log_date <= ?'); args.push(to); }
  if (project_id) { where.push('l.project_id = ?'); args.push(project_id); }
  if (user_id) { where.push('l.user_id = ?'); args.push(user_id); }
  if (subcontractor_id) { where.push('l.subcontractor_id = ?'); args.push(subcontractor_id); }
  const rows = db.prepare(`
    SELECT l.*, u.name AS user_name, sb.name AS sub_name, p.proj_no, p.name AS project_name, w.order_no
    FROM labor_logs l LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN subcontractors sb ON sb.id = l.subcontractor_id
    LEFT JOIN projects p ON p.id = l.project_id LEFT JOIN work_orders w ON w.id = l.order_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.log_date DESC, l.id DESC LIMIT 500`).all(...args);
  res.json({
    rows,
    summary: {
      days: rows.reduce((s, r) => s + r.days, 0),
      hours: rows.reduce((s, r) => s + r.hours + r.overtime_hours, 0),
      amount: rows.reduce((s, r) => s + r.amount, 0)
    }
  });
});

function laborAmount(b) {
  if (b.amount !== undefined && b.amount !== '') return num(b.amount);
  const days = Number(b.days) || 0, hours = Number(b.hours) || 0;
  const r = num(b.rate);
  // 有填工數就以日薪計，否則以時薪計；加班另計
  const base = days > 0 ? days * r : hours * r;
  return Math.round(base + (Number(b.overtime_hours) || 0) * num(b.overtime_rate));
}

router.post('/labor-logs', requireStaff('labor'), (req, res) => {
  const b = req.body || {};
  if (!b.user_id && !b.subcontractor_id && !b.worker_name) {
    return res.status(400).json({ error: '請指定出工人員（自家技師、工班或直接填姓名）' });
  }
  // 未填單價時，自家技師取時薪、外包工班取日薪參考價
  if (!b.rate) {
    if (b.user_id) {
      const u = db.prepare('SELECT hourly_rate FROM users WHERE id = ?').get(b.user_id);
      if (u && Number(b.days) > 0) b.rate = u.hourly_rate * 8;
      else if (u) b.rate = u.hourly_rate;
    } else if (b.subcontractor_id) {
      const s = db.prepare('SELECT day_rate FROM subcontractors WHERE id = ?').get(b.subcontractor_id);
      if (s) b.rate = s.day_rate || Number(getSetting('day_rate_default', '2800'));
    }
  }
  const info = db.prepare(`INSERT INTO labor_logs
      (log_date, project_id, order_id, user_id, subcontractor_id, worker_name, worker_type, days, hours,
       rate, overtime_hours, overtime_rate, amount, weather, work_desc, is_billed, created_by, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.log_date || today(), b.project_id || null, b.order_id || null, b.user_id || null,
      b.subcontractor_id || null, b.worker_name || '', b.worker_type || '技師',
      Number(b.days) || 0, Number(b.hours) || 0, num(b.rate), Number(b.overtime_hours) || 0,
      num(b.overtime_rate), laborAmount(b), b.weather || '', b.work_desc || '',
      b.is_billed ? 1 : 0, req.user.id, b.note || '');
  res.json({ id: info.lastInsertRowid });
});

router.put('/labor-logs/:id', requireStaff('labor'), (req, res) => {
  const row = db.prepare('SELECT * FROM labor_logs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '出工紀錄不存在' });
  const b = { ...row, ...req.body };
  db.prepare(`UPDATE labor_logs SET log_date = ?, project_id = ?, order_id = ?, user_id = ?, subcontractor_id = ?,
      worker_name = ?, worker_type = ?, days = ?, hours = ?, rate = ?, overtime_hours = ?, overtime_rate = ?,
      amount = ?, weather = ?, work_desc = ?, is_billed = ?, note = ? WHERE id = ?`)
    .run(b.log_date, b.project_id || null, b.order_id || null, b.user_id || null, b.subcontractor_id || null,
      b.worker_name || '', b.worker_type || '技師', Number(b.days) || 0, Number(b.hours) || 0, num(b.rate),
      Number(b.overtime_hours) || 0, num(b.overtime_rate), laborAmount(b), b.weather || '',
      b.work_desc || '', b.is_billed ? 1 : 0, b.note || '', row.id);
  res.json({ ok: true });
});

router.delete('/labor-logs/:id', requireStaff('labor'), (req, res) => {
  db.prepare('DELETE FROM labor_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
