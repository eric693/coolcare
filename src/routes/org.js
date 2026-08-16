// 共用參數、總覽儀表板、帳號權限、系統設定、公告、稽核軌跡
const express = require('express');
const bcrypt = require('bcryptjs');
const {
  db, audit, getSetting, setSetting, listSetting, today, thisMonth, addDays, daysBetween
} = require('../db');
const { requireStaff, requireAdmin, MODULES, MODULE_KEYS, TECH_DEFAULT_MODULES, parsePermissions } = require('../auth');
const { lowStockList } = require('../stock');

const router = express.Router();

// ---- 共用參數：前端一次抓齊下拉選項與基礎主檔 ----

router.get('/meta', requireStaff(), (req, res) => {
  res.json({
    company_name: getSetting('company_name'),
    tax_rate: Number(getSetting('tax_rate', '0.05')),
    modules: MODULES,
    order_sources: listSetting('order_sources'),
    appoint_slots: listSetting('appoint_slots'),
    equipment_categories: listSetting('equipment_categories'),
    power_specs: listSetting('power_specs'),
    refrigerants: listSetting('refrigerants'),
    units: listSetting('units'),
    payment_terms: listSetting('payment_terms'),
    pay_methods: listSetting('pay_methods'),
    check_items_default: listSetting('check_items_default').length
      ? getSetting('check_items_default').split(';').map(s => s.trim()).filter(Boolean)
      : [],
    labor_rate_hour: Number(getSetting('labor_rate_hour', '800')),
    travel_fee_default: Number(getSetting('travel_fee_default', '500')),
    min_labor_fee: Number(getSetting('min_labor_fee', '800')),
    warranty_months_default: Number(getSetting('warranty_months_default', '12')),
    commission_basis: getSetting('commission_basis', 'profit'),
    warehouses: db.prepare('SELECT id, name, kind, keeper_id FROM warehouses WHERE active = 1 ORDER BY kind, id').all(),
    techs: db.prepare("SELECT id, name, tech_no FROM users WHERE active = 1 AND is_tech = 1 ORDER BY name").all(),
    categories: db.prepare('SELECT id, name FROM product_categories ORDER BY sort, id').all(),

    // ---- 水電工程模組 ----
    trades: listSetting('trades'),
    project_kinds: listSetting('project_kinds'),
    order_sub_types: listSetting('order_sub_types'),
    worker_types: listSetting('worker_types'),
    unit_price_categories: listSetting('unit_price_categories'),
    unit_price_units: listSetting('unit_price_units'),
    filing_kinds: listSetting('filing_kinds'),
    filing_authorities: listSetting('filing_authorities'),
    retention_rate_default: Number(getSetting('retention_rate_default', '0.05')),
    sub_retention_rate: Number(getSetting('sub_retention_rate', '0.05')),
    project_warranty_months: Number(getSetting('project_warranty_months', '12')),
    day_rate_default: Number(getSetting('day_rate_default', '2800')),
    wht_rate: Number(getSetting('wht_rate', '0.10')),
    wht_threshold: Number(getSetting('wht_threshold', '20010')),
    nhi_rate: Number(getSetting('nhi_rate', '0.0211')),
    nhi_threshold: Number(getSetting('nhi_threshold', '20000')),
    subcontractors: db.prepare('SELECT id, name, trade, is_individual, day_rate FROM subcontractors WHERE active = 1 ORDER BY name').all(),
    open_projects: db.prepare(`SELECT id, proj_no, name FROM projects
      WHERE status IN ('draft','ongoing','paused') ORDER BY id DESC LIMIT 200`).all()
  });
});

// ---- 總覽儀表板 ----

router.get('/dashboard', requireStaff(), (req, res) => {
  const d = today();
  const month = thisMonth();
  const one = sql => db.prepare(sql).get();

  const openStatuses = "('draft','assigned','departed','working')";
  const stat = {
    pending: one(`SELECT COUNT(*) n FROM work_orders WHERE status = 'draft'`).n,
    assigned: one(`SELECT COUNT(*) n FROM work_orders WHERE status IN ('assigned','departed','working')`).n,
    today_orders: one(`SELECT COUNT(*) n FROM work_orders WHERE appoint_date = '${d}' AND status != 'cancelled'`).n,
    overdue: one(`SELECT COUNT(*) n FROM work_orders WHERE appoint_date != '' AND appoint_date < '${d}' AND status IN ${openStatuses}`).n,
    urgent: one(`SELECT COUNT(*) n FROM work_orders WHERE priority = 'urgent' AND status IN ${openStatuses}`).n,
    done_unbilled: one(`SELECT COUNT(*) n FROM work_orders WHERE status IN ('done','confirmed') AND is_contract = 0 AND is_warranty = 0`).n,
    month_revenue: one(`SELECT COALESCE(SUM(total),0) v FROM work_orders WHERE status IN ('done','confirmed','billed') AND substr(finished_at,1,7) = '${month}'`).v,
    unpaid_count: one(`SELECT COUNT(*) n FROM invoices WHERE status IN ('unpaid','partial')`).n,
    unpaid_amount: one(`SELECT COALESCE(SUM(total - paid),0) v FROM invoices WHERE status IN ('unpaid','partial')`).v,
    payable_amount: one(`SELECT COALESCE(SUM(total - paid),0) v FROM purchase_orders WHERE status = 'received' AND total > paid`).v,
    stock_value: one(`SELECT COALESCE(SUM(s.qty * p.cost),0) v FROM stocks s JOIN products p ON p.id = s.product_id`).v
  };

  // 逾期未收（超過到期日）
  stat.overdue_ar = one(`SELECT COUNT(*) n FROM invoices WHERE status IN ('unpaid','partial') AND due_date != '' AND due_date < '${d}'`).n;

  // 工程專案：進行中案量、逾期工程、被業主扣在手上的保留款、待付工班
  Object.assign(stat, {
    projects_open: one("SELECT COUNT(*) n FROM projects WHERE status IN ('draft','ongoing','paused')").n,
    projects_overdue: one(`SELECT COUNT(*) n FROM projects
      WHERE status IN ('draft','ongoing','paused') AND due_date != '' AND due_date < '${d}'`).n,
    project_backlog: one(`SELECT COALESCE(SUM(p.contract_amount + p.change_amount),0) - COALESCE((
        SELECT SUM(b.gross_amount) FROM project_billings b JOIN projects p2 ON p2.id = b.project_id
        WHERE b.status != 'cancelled' AND b.kind != 'retention' AND p2.status IN ('draft','ongoing','paused')
      ),0) AS v FROM projects p WHERE p.status IN ('draft','ongoing','paused')`).v,
    retention_held: one(`SELECT COALESCE((SELECT SUM(retention) FROM project_billings WHERE status != 'cancelled'),0)
      - COALESCE((SELECT SUM(retention_released) FROM projects),0) AS v`).v,
    sub_payable: one(`SELECT COALESCE(SUM(net_pay - paid),0) v FROM subcontract_billings
      WHERE status IN ('confirmed','paid') AND net_pay > paid`).v,
    enquiries_new: one("SELECT COUNT(*) n FROM enquiries WHERE status = 'new'").n,
    filings_open: one("SELECT COUNT(*) n FROM filings WHERE result IN ('pending','applied','inspecting','failed')").n
  });

  const lowStock = lowStockList().slice(0, 10);

  // 今日行程（依技師分組給派工看板用）
  const todayOrders = db.prepare(`
    SELECT w.id, w.order_no, w.type, w.status, w.priority, w.appoint_slot, w.title,
           c.name AS customer_name, w.address,
           (SELECT GROUP_CONCAT(u.name, '、') FROM work_order_techs t JOIN users u ON u.id = t.user_id WHERE t.order_id = w.id) AS techs
    FROM work_orders w JOIN customers c ON c.id = w.customer_id
    WHERE w.appoint_date = ? AND w.status != 'cancelled'
    ORDER BY w.priority = 'urgent' DESC, w.appoint_slot, w.id`).all(d);

  // 到期提醒
  const contractAlert = addDays(d, Number(getSetting('contract_alert_days', '60')));
  const warrantyAlert = addDays(d, Number(getSetting('warranty_alert_days', '30')));
  const serviceAlert = addDays(d, Number(getSetting('service_due_alert_days', '14')));
  const licenseAlert = addDays(d, Number(getSetting('license_alert_days', '60')));

  const alerts = {
    contracts: db.prepare(`SELECT sc.id, sc.contract_no, sc.title, sc.end_date, c.name AS customer_name
      FROM service_contracts sc JOIN customers c ON c.id = sc.customer_id
      WHERE sc.status = 'active' AND sc.end_date != '' AND sc.end_date <= ? ORDER BY sc.end_date`).all(contractAlert),
    services_due: db.prepare(`SELECT sc.id, sc.contract_no, sc.title, sc.next_visit_date, c.name AS customer_name
      FROM service_contracts sc JOIN customers c ON c.id = sc.customer_id
      WHERE sc.status = 'active' AND sc.next_visit_date != '' AND sc.next_visit_date <= ? ORDER BY sc.next_visit_date`).all(serviceAlert),
    warranties: db.prepare(`SELECT e.id, e.asset_no, e.brand, e.model, e.warranty_end, c.name AS customer_name
      FROM equipments e JOIN customers c ON c.id = e.customer_id
      WHERE e.status = 'active' AND e.warranty_end != '' AND e.warranty_end <= ? AND e.warranty_end >= ?
      ORDER BY e.warranty_end`).all(warrantyAlert, d),
    licenses: db.prepare(`SELECT id, name, license, license_expiry FROM users
      WHERE active = 1 AND license_expiry != '' AND license_expiry <= ? ORDER BY license_expiry`).all(licenseAlert),
    // 公司承裝業登記過期就不能承攬，提前提醒換證
    company_licenses: db.prepare(`SELECT id, name, grade, reg_no, expire_date FROM company_licenses
      WHERE active = 1 AND expire_date != '' AND expire_date <= ? ORDER BY expire_date`)
      .all(addDays(d, Number(getSetting('company_license_alert_days', '90')))),
    // 報驗待辦：待送件、審查中、不合格待複驗，以及定期申報到期
    filings: db.prepare(`SELECT f.id, f.kind, f.authority, f.apply_no, f.result, f.apply_date, f.next_due_date,
        p.name AS project_name
      FROM filings f LEFT JOIN projects p ON p.id = f.project_id
      WHERE f.result IN ('pending','applied','inspecting','failed')
         OR (f.next_due_date != '' AND f.next_due_date <= ?)
      ORDER BY f.result = 'failed' DESC, f.next_due_date != '' DESC, f.apply_date LIMIT 20`)
      .all(addDays(d, Number(getSetting('filing_alert_days', '30')))),
    // 工程逾期：已過契約完工日還沒完工，違約金風險
    projects_overdue: db.prepare(`SELECT p.id, p.proj_no, p.name, p.due_date, p.progress, c.name AS customer_name
      FROM projects p JOIN customers c ON c.id = p.customer_id
      WHERE p.status IN ('draft','ongoing','paused') AND p.due_date != '' AND p.due_date < ?
      ORDER BY p.due_date`).all(d)
  };

  // 官網待處理詢價：這是會流失的生意，放在總覽第一時間看到
  const enquiries = db.prepare(`SELECT id, enq_no, name, phone, service, area, content, created_at
    FROM enquiries WHERE status = 'new' ORDER BY id DESC LIMIT 10`).all();

  // 本月營運（毛利＝營收－材料成本；工資與車馬視為服務收入不扣料本）
  const monthWO = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) rev, COALESCE(SUM(parts_cost),0) cost
    FROM work_orders WHERE status IN ('done','confirmed','billed') AND substr(finished_at,1,7) = '${month}'`);
  const monthSO = one(`SELECT COALESCE(SUM(total),0) rev, COALESCE(SUM(cost_total),0) cost
    FROM sales_orders WHERE status = 'shipped' AND substr(order_date,1,7) = '${month}'`);

  // 上線安全檢查（沿用 kidcare 的作法：預設密碼與展示提示未清空即警示）
  const admin = db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get();
  const security = {
    default_admin_password: !!(admin && bcrypt.compareSync('coolcare123', admin.password_hash)),
    weak_staff_password: db.prepare("SELECT password_hash FROM users WHERE username != 'admin' AND active = 1").all()
      .some(u => bcrypt.compareSync('123456', u.password_hash)),
    demo_hint_staff: !!getSetting('ui_demo_staff'),
    demo_hint_portal: !!getSetting('ui_demo_portal')
  };

  res.json({
    stat, low_stock: lowStock, today_orders: todayOrders, alerts, security, enquiries,
    month: {
      key: month,
      orders: monthWO.n,
      revenue: monthWO.rev + monthSO.rev,
      cost: monthWO.cost + monthSO.cost,
      profit: (monthWO.rev + monthSO.rev) - (monthWO.cost + monthSO.cost)
    },
    my_orders: db.prepare(`
      SELECT w.id, w.order_no, w.title, w.status, w.appoint_date, w.appoint_slot, c.name AS customer_name, w.address
      FROM work_orders w JOIN customers c ON c.id = w.customer_id
      JOIN work_order_techs t ON t.order_id = w.id
      WHERE t.user_id = ? AND w.status IN ('assigned','departed','working')
      ORDER BY w.appoint_date, w.appoint_slot`).all(req.user.id)
  });
});

// ---- 公告 ----

router.get('/announcements', requireStaff(), (req, res) => {
  res.json(db.prepare(`SELECT a.*, u.name AS creator FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by ORDER BY a.publish_date DESC, a.id DESC LIMIT 200`).all());
});

router.post('/announcements', requireStaff('announcements'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: '請填寫標題' });
  const info = db.prepare(`INSERT INTO announcements (title, body, publish_date, expire_date, to_customer, created_by)
    VALUES (?,?,?,?,?,?)`).run(b.title, b.body || '', b.publish_date || today(), b.expire_date || '',
    b.to_customer ? 1 : 0, req.user.id);
  audit('staff', req.user.id, req.user.name, '新增公告', b.title);
  res.json({ id: info.lastInsertRowid });
});

router.put('/announcements/:id', requireStaff('announcements'), (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE announcements SET title = ?, body = ?, publish_date = ?, expire_date = ?, to_customer = ? WHERE id = ?`)
    .run(b.title, b.body || '', b.publish_date || today(), b.expire_date || '', b.to_customer ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/announcements/:id', requireStaff('announcements'), (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  audit('staff', req.user.id, req.user.name, '刪除公告', req.params.id);
  res.json({ ok: true });
});

// ---- 帳號權限 ----

router.get('/users', requireStaff('users'), (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY active DESC, role, id').all();
  res.json(rows.map(u => ({
    id: u.id, username: u.username, name: u.name, role: u.role, title: u.title, phone: u.phone,
    is_tech: u.is_tech, tech_no: u.tech_no, license: u.license, license_expiry: u.license_expiry,
    hourly_rate: u.hourly_rate, commission_rate: u.commission_rate, base_salary: u.base_salary,
    active: u.active, modules: u.role === 'admin' ? MODULE_KEYS : parsePermissions(u.permissions)
  })));
});

router.post('/users', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.username || !b.password || !b.name) return res.status(400).json({ error: '帳號、密碼與姓名為必填' });
  if (String(b.password).length < 6) return res.status(400).json({ error: '密碼至少 6 碼' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)) {
    return res.status(400).json({ error: '此帳號已存在' });
  }
  const modules = Array.isArray(b.modules) ? b.modules.filter(k => MODULE_KEYS.includes(k))
    : (b.is_tech ? TECH_DEFAULT_MODULES : []);
  const info = db.prepare(`INSERT INTO users
      (username, password_hash, name, role, title, phone, permissions, is_tech, tech_no, license, license_expiry,
       hourly_rate, commission_rate, base_salary)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.username, bcrypt.hashSync(String(b.password), 10), b.name, b.role === 'admin' ? 'admin' : 'staff',
      b.title || '', b.phone || '', JSON.stringify(modules), b.is_tech ? 1 : 0, b.tech_no || '',
      b.license || '', b.license_expiry || '', Number(b.hourly_rate) || 0,
      Number(b.commission_rate) || 0, Number(b.base_salary) || 0);
  audit('staff', req.user.id, req.user.name, '新增帳號', b.username);
  res.json({ id: info.lastInsertRowid });
});

router.put('/users/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '帳號不存在' });
  const modules = Array.isArray(b.modules) ? b.modules.filter(k => MODULE_KEYS.includes(k)) : parsePermissions(u.permissions);
  // 不允許停用或降級最後一個管理員，避免把自己鎖在系統外
  const adminCount = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;
  const willLoseAdmin = u.role === 'admin' && (b.role !== 'admin' || b.active === 0 || b.active === false);
  if (willLoseAdmin && adminCount <= 1) return res.status(400).json({ error: '系統至少需保留一名啟用中的管理員' });
  db.prepare(`UPDATE users SET name = ?, role = ?, title = ?, phone = ?, permissions = ?, is_tech = ?, tech_no = ?,
      license = ?, license_expiry = ?, hourly_rate = ?, commission_rate = ?, base_salary = ?, active = ? WHERE id = ?`)
    .run(b.name || u.name, b.role === 'admin' ? 'admin' : 'staff', b.title || '', b.phone || '',
      JSON.stringify(modules), b.is_tech ? 1 : 0, b.tech_no || '', b.license || '', b.license_expiry || '',
      Number(b.hourly_rate) || 0, Number(b.commission_rate) || 0, Number(b.base_salary) || 0,
      b.active === undefined ? u.active : (b.active ? 1 : 0), req.params.id);
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: '密碼至少 6 碼' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(b.password), 10), req.params.id);
  }
  audit('staff', req.user.id, req.user.name, '修改帳號', u.username);
  res.json({ ok: true });
});

// ---- 倉別 ----

router.get('/warehouses', requireStaff(), (req, res) => {
  res.json(db.prepare(`SELECT w.*, u.name AS keeper_name,
      (SELECT COUNT(*) FROM stocks s WHERE s.warehouse_id = w.id AND s.qty != 0) AS item_count,
      (SELECT COALESCE(SUM(s.qty * p.cost),0) FROM stocks s JOIN products p ON p.id = s.product_id WHERE s.warehouse_id = w.id) AS value
    FROM warehouses w LEFT JOIN users u ON u.id = w.keeper_id ORDER BY w.kind, w.id`).all());
});

router.post('/warehouses', requireStaff('inventory'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫倉別名稱' });
  const info = db.prepare('INSERT INTO warehouses (name, kind, keeper_id, note) VALUES (?,?,?,?)')
    .run(b.name, b.kind || 'main', b.keeper_id || null, b.note || '');
  res.json({ id: info.lastInsertRowid });
});

router.put('/warehouses/:id', requireStaff('inventory'), (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE warehouses SET name = ?, kind = ?, keeper_id = ?, note = ?, active = ? WHERE id = ?')
    .run(b.name, b.kind || 'main', b.keeper_id || null, b.note || '', b.active === undefined ? 1 : (b.active ? 1 : 0), req.params.id);
  res.json({ ok: true });
});

// ---- 系統設定 ----

router.get('/settings', requireStaff('settings'), (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

router.put('/settings', requireStaff('settings'), (req, res) => {
  const b = req.body || {};
  const changed = [];
  for (const [k, v] of Object.entries(b)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    setSetting(k, v);
    changed.push(k);
  }
  audit('staff', req.user.id, req.user.name, '修改系統設定', changed.join(','));
  res.json({ ok: true });
});

// ---- 稽核軌跡 ----

router.get('/audit-logs', requireStaff('settings'), (req, res) => {
  const { q = '', from = '', to = '' } = req.query;
  const where = [], args = [];
  if (q) { where.push('(actor_name LIKE ? OR action LIKE ? OR target LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (from) { where.push('created_at >= ?'); args.push(from); }
  if (to) { where.push('created_at <= ?'); args.push(to + ' 23:59'); }
  const sql = `SELECT * FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT 500`;
  res.json(db.prepare(sql).all(...args));
});

// ---- 料件分類 ----

router.get('/product-categories', requireStaff(), (req, res) => {
  res.json(db.prepare('SELECT * FROM product_categories ORDER BY sort, id').all());
});
router.post('/product-categories', requireStaff('inventory'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: '請填寫分類名稱' });
  const info = db.prepare('INSERT INTO product_categories (name, sort) VALUES (?,?)').run(b.name, Number(b.sort) || 0);
  res.json({ id: info.lastInsertRowid });
});
router.delete('/product-categories/:id', requireStaff('inventory'), (req, res) => {
  db.prepare('DELETE FROM product_categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
