// 報表匯出：CSV（預設）／Excel .xlsx／PDF（瀏覽器列印檢視）
// 三種格式共用同一個出口 sendCsv()，各報表毋須各自處理格式
const express = require('express');
const { db, today, thisMonth, getSetting } = require('../db');
const { requireStaff } = require('../auth');
const { buildWorkbook } = require('../xlsx');

const router = express.Router();

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function download(res, filename, type, body) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(body);
}

// 列印檢視：開新分頁後自動叫出列印對話框，由瀏覽器「另存為 PDF」
// （不在伺服器產 PDF：避免綁 headless Chrome 等重相依，客戶自架環境不一定有）
function printableHtml(title, headers, rows) {
  const company = getSetting('company_name', 'CoolCare 冷凍空調');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif; color:#1f2d3d; margin:0; }
  h1 { font-size: 15pt; margin: 0 0 2px; }
  .meta { font-size: 9pt; color:#6b7a8c; margin-bottom: 10px; }
  table { width:100%; border-collapse: collapse; }
  th { background:#eef2f6; text-align:left; font-size:8.5pt; padding:5px 6px; border:1px solid #cdd8e3; }
  td { font-size:8.5pt; padding:4px 6px; border:1px solid #dfe6ec; vertical-align:top; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  @media print { .no-print { display:none; } }
</style></head><body>
<h1>${escHtml(company)}　${escHtml(title)}</h1>
<div class="meta">共 ${rows.length} 筆　列印時間：${escHtml(new Date().toLocaleString('zh-TW'))}</div>
<table><thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<script>window.onload=()=>window.print()<\/script></body></html>`;
}

function sendCsv(res, filename, headers, rows) {
  const format = ((res.req.query || {}).format || 'csv').toLowerCase();
  const base = filename.replace(/\.csv$/i, '');
  if (format === 'xlsx') {
    const columns = headers.map((h, i) => ({ key: String(i), label: h }));
    const objs = rows.map(r => Object.fromEntries(r.map((v, i) => [String(i), v == null ? '' : v])));
    return download(res, `${base}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buildWorkbook(base, columns, objs));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(printableHtml(base, headers, rows));
  }
  const csv = '﻿' + [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  download(res, `${base}.csv`, 'text/csv; charset=utf-8', csv);
}

const TYPE_TW = { repair: '維修', install: '安裝', maintain: '保養', inspect: '檢測', move: '移機', dismantle: '拆機', other: '其他' };
const STATUS_TW = {
  draft: '待派工', assigned: '已派工', departed: '已出發', working: '施工中',
  done: '已完工', confirmed: '客戶已確認', billed: '已請款', cancelled: '已取消'
};
const MOVE_TW = {
  purchase: '採購進貨', purchase_return: '採購退貨', sale: '銷貨出庫', sale_return: '銷貨退回',
  issue: '工單領料', issue_return: '工單退料', transfer_in: '調撥入庫', transfer_out: '調撥出庫', adjust: '盤點調整'
};
const ACTION_TW = { charge: '充填', recover: '回收', leak: '洩漏', dispose: '銷毀' };

// ---- 工單明細 ----
router.get('/export/work-orders', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT w.order_no, w.type, w.status, w.appoint_date, w.finished_at, c.name AS customer_name, w.address,
      w.title, w.cause, w.action, w.work_hours, w.labor_fee, w.travel_fee, w.parts_fee, w.other_fee,
      w.discount, w.total, w.parts_cost, w.is_warranty, w.is_contract,
      (SELECT GROUP_CONCAT(u.name, '、') FROM work_order_techs t JOIN users u ON u.id = t.user_id WHERE t.order_id = w.id) AS techs
    FROM work_orders w JOIN customers c ON c.id = w.customer_id
    WHERE w.appoint_date >= ? AND w.appoint_date <= ? ORDER BY w.appoint_date, w.id`).all(from, to);
  sendCsv(res, `工單明細_${from}_${to}.csv`,
    ['工單號', '類別', '狀態', '預約日', '完工時間', '客戶', '施工地址', '案由', '故障原因', '處理方式',
      '工時', '工資', '車馬費', '材料費', '其他', '折扣', '含稅總額', '材料成本', '毛利', '保固內', '合約內', '技師'],
    rows.map(r => [r.order_no, TYPE_TW[r.type] || r.type, STATUS_TW[r.status] || r.status, r.appoint_date,
      r.finished_at, r.customer_name, r.address, r.title, r.cause, r.action, r.work_hours,
      r.labor_fee, r.travel_fee, r.parts_fee, r.other_fee, r.discount, r.total, r.parts_cost,
      r.total - r.parts_cost, r.is_warranty ? 'Y' : '', r.is_contract ? 'Y' : '', r.techs || '']));
});

// ---- 技師產值 ----
router.get('/export/tech-performance', requireStaff('reports'), (req, res) => {
  const month = req.query.month || thisMonth();
  const rows = db.prepare(`
    SELECT u.name, u.tech_no,
      COUNT(DISTINCT w.id) AS orders,
      COALESCE(SUM(w.work_hours),0) AS hours,
      COALESCE(SUM(w.total),0) AS revenue,
      COALESCE(SUM(w.parts_cost),0) AS cost,
      COALESCE((SELECT SUM(cm.amount) FROM commissions cm WHERE cm.user_id = u.id AND cm.period = ?),0) AS commission,
      COALESCE(AVG(w.rating),0) AS rating
    FROM users u
    LEFT JOIN work_order_techs t ON t.user_id = u.id
    LEFT JOIN work_orders w ON w.id = t.order_id AND substr(w.finished_at,1,7) = ?
      AND w.status IN ('done','confirmed','billed')
    WHERE u.is_tech = 1 AND u.active = 1
    GROUP BY u.id ORDER BY revenue DESC`).all(month, month);
  sendCsv(res, `技師產值_${month}.csv`,
    ['技師', '技師編號', '完工單數', '總工時', '營收(含稅)', '材料成本', '毛利', '抽成', '平均評分'],
    rows.map(r => [r.name, r.tech_no, r.orders, r.hours, r.revenue, r.cost, r.revenue - r.cost,
      r.commission, r.rating ? r.rating.toFixed(1) : '']));
});

// ---- 客戶消費排行 ----
router.get('/export/customer-ranking', requireStaff('reports'), (req, res) => {
  const from = req.query.from || (Number(thisMonth().slice(0, 4)) + '-01-01');
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT c.name, c.tax_id, c.phone, c.payment_terms,
      COUNT(w.id) AS orders, COALESCE(SUM(w.total),0) AS revenue, COALESCE(SUM(w.parts_cost),0) AS cost,
      MAX(w.appoint_date) AS last_service,
      (SELECT COUNT(*) FROM equipments e WHERE e.customer_id = c.id AND e.status != 'scrapped') AS equipments,
      (SELECT COALESCE(SUM(total - paid),0) FROM invoices i WHERE i.customer_id = c.id AND i.status IN ('unpaid','partial')) AS ar
    FROM customers c
    LEFT JOIN work_orders w ON w.customer_id = c.id AND w.appoint_date >= ? AND w.appoint_date <= ?
      AND w.status IN ('done','confirmed','billed')
    GROUP BY c.id HAVING orders > 0 ORDER BY revenue DESC`).all(from, to);
  sendCsv(res, `客戶消費排行_${from}_${to}.csv`,
    ['客戶', '統編', '電話', '付款條件', '工單數', '營收', '材料成本', '毛利', '最後服務日', '設備台數', '未收款'],
    rows.map(r => [r.name, r.tax_id, r.phone, r.payment_terms, r.orders, r.revenue, r.cost,
      r.revenue - r.cost, r.last_service, r.equipments, r.ar]));
});

// ---- 庫存清冊（含庫存價值） ----
router.get('/export/stock', requireStaff('reports'), (req, res) => {
  const rows = db.prepare(`
    SELECT p.sku, p.name, p.spec, p.unit, pc.name AS category, p.brand, w.name AS warehouse,
      s.qty, p.cost, (s.qty * p.cost) AS value, p.price_retail, p.safety_qty
    FROM stocks s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE s.qty != 0 ORDER BY w.id, p.sku`).all();
  sendCsv(res, `庫存清冊_${today()}.csv`,
    ['料號', '品名', '規格', '單位', '分類', '品牌', '倉別', '庫存數', '平均成本', '庫存價值', '售價', '安全庫存'],
    rows.map(r => [r.sku, r.name, r.spec, r.unit, r.category || '', r.brand, r.warehouse,
      r.qty, r.cost, Math.round(r.value), r.price_retail, r.safety_qty]));
});

// ---- 庫存異動明細（進銷存流水帳） ----
router.get('/export/stock-moves', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT m.move_date, p.sku, p.name, p.spec, w.name AS warehouse, m.kind, m.qty, m.cost,
      (m.qty * m.cost) AS value, m.balance, m.ref_no, u.name AS user_name, m.note
    FROM stock_moves m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.move_date >= ? AND m.move_date <= ? ORDER BY m.id`).all(from, to);
  sendCsv(res, `庫存異動_${from}_${to}.csv`,
    ['日期', '料號', '品名', '規格', '倉別', '異動別', '數量', '單位成本', '金額', '結存', '來源單號', '經手人', '備註'],
    rows.map(r => [r.move_date, r.sku, r.name, r.spec, r.warehouse, MOVE_TW[r.kind] || r.kind,
      r.qty, r.cost, Math.round(r.value), r.balance, r.ref_no, r.user_name || '', r.note]));
});

// ---- 進貨明細 ----
router.get('/export/purchases', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT po.po_no, po.order_date, po.arrive_date, s.name AS supplier, po.invoice_no,
      p.sku, p.name, p.spec, pi.qty, pi.price, (pi.qty * pi.price) AS amount, po.status, po.paid, po.total
    FROM purchase_items pi JOIN purchase_orders po ON po.id = pi.po_id
    JOIN suppliers s ON s.id = po.supplier_id JOIN products p ON p.id = pi.product_id
    WHERE po.order_date >= ? AND po.order_date <= ? ORDER BY po.id, pi.id`).all(from, to);
  sendCsv(res, `進貨明細_${from}_${to}.csv`,
    ['採購單號', '訂購日', '入庫日', '廠商', '廠商發票', '料號', '品名', '規格', '數量', '進價', '小計', '狀態', '已付', '單據總額'],
    rows.map(r => [r.po_no, r.order_date, r.arrive_date, r.supplier, r.invoice_no, r.sku, r.name, r.spec,
      r.qty, r.price, Math.round(r.amount), r.status === 'received' ? '已進貨' : r.status, r.paid, r.total]));
});

// ---- 銷貨明細（銷貨單 + 工單用料合併看） ----
router.get('/export/sales', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const so = db.prepare(`
    SELECT so.order_date AS d, so.so_no AS no, '銷貨單' AS src, c.name AS customer, p.sku, p.name AS pname, p.spec,
      si.qty, si.price, si.cost
    FROM sales_items si JOIN sales_orders so ON so.id = si.so_id
    JOIN customers c ON c.id = so.customer_id JOIN products p ON p.id = si.product_id
    WHERE so.status = 'shipped' AND so.order_date >= ? AND so.order_date <= ?`).all(from, to);
  const wo = db.prepare(`
    SELECT w.appoint_date AS d, w.order_no AS no, '工單用料' AS src, c.name AS customer,
      COALESCE(p.sku,'') AS sku, i.name AS pname, i.spec, i.qty, i.price, i.cost
    FROM work_order_items i JOIN work_orders w ON w.id = i.order_id
    JOIN customers c ON c.id = w.customer_id LEFT JOIN products p ON p.id = i.product_id
    WHERE w.status IN ('done','confirmed','billed') AND w.appoint_date >= ? AND w.appoint_date <= ?`).all(from, to);
  const rows = [...so, ...wo].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  sendCsv(res, `銷貨明細_${from}_${to}.csv`,
    ['日期', '單號', '來源', '客戶', '料號', '品名', '規格', '數量', '售價', '成本', '銷售額', '毛利'],
    rows.map(r => [r.d, r.no, r.src, r.customer, r.sku, r.pname, r.spec, r.qty, r.price, r.cost,
      Math.round(r.qty * r.price), Math.round(r.qty * (r.price - r.cost))]));
});

// ---- 應收帳款 ----
router.get('/export/ar', requireStaff('reports'), (req, res) => {
  const d = today();
  const rows = db.prepare(`
    SELECT i.inv_no, i.issue_date, i.due_date, c.name AS customer, c.phone, c.payment_terms,
      i.tax_invoice_no, i.total, i.paid, (i.total - i.paid) AS balance, i.status
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.status IN ('unpaid','partial') ORDER BY i.due_date`).all();
  sendCsv(res, `應收帳款_${d}.csv`,
    ['請款單號', '開立日', '到期日', '客戶', '電話', '付款條件', '發票號碼', '應收', '已收', '未收', '逾期天數'],
    rows.map(r => [r.inv_no, r.issue_date, r.due_date, r.customer, r.phone, r.payment_terms,
      r.tax_invoice_no, r.total, r.paid, r.balance,
      r.due_date && r.due_date < d ? Math.floor((new Date(d) - new Date(r.due_date)) / 86400000) : 0]));
});

// ---- 應付帳款 ----
router.get('/export/ap', requireStaff('reports'), (req, res) => {
  const rows = db.prepare(`
    SELECT po.po_no, po.arrive_date, po.due_date, s.name AS supplier, s.phone, po.invoice_no,
      po.total, po.paid, (po.total - po.paid) AS balance
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status = 'received' AND po.total > po.paid ORDER BY po.due_date`).all();
  sendCsv(res, `應付帳款_${today()}.csv`,
    ['採購單號', '入庫日', '到期日', '廠商', '電話', '發票號碼', '應付', '已付', '未付'],
    rows.map(r => [r.po_no, r.arrive_date, r.due_date, r.supplier, r.phone, r.invoice_no, r.total, r.paid, r.balance]));
});

// ---- 設備清冊 ----
router.get('/export/equipments', requireStaff('reports'), (req, res) => {
  const rows = db.prepare(`
    SELECT c.name AS customer, s.name AS site, e.asset_no, e.category, e.brand, e.model, e.serial_no,
      e.location, e.tonnage, e.refrigerant, e.refrigerant_kg, e.power_spec, e.install_date,
      e.warranty_end, e.last_service_date, e.next_service_date, e.status,
      (SELECT COUNT(*) FROM work_order_equipments woe WHERE woe.equipment_id = e.id) AS services
    FROM equipments e JOIN customers c ON c.id = e.customer_id LEFT JOIN sites s ON s.id = e.site_id
    ORDER BY c.name, e.id`).all();
  sendCsv(res, `設備清冊_${today()}.csv`,
    ['客戶', '地點', '機號', '機種', '品牌', '型號', '原廠序號', '安裝位置', '噸數', '冷媒', '充填量kg',
      '電源', '安裝日', '保固到期', '上次保養', '下次保養', '狀態', '服務次數'],
    rows.map(r => [r.customer, r.site || '', r.asset_no, r.category, r.brand, r.model, r.serial_no,
      r.location, r.tonnage ?? '', r.refrigerant, r.refrigerant_kg ?? '', r.power_spec, r.install_date,
      r.warranty_end, r.last_service_date, r.next_service_date,
      ({ active: '使用中', repair: '維修中', scrapped: '已報廢' })[r.status] || r.status, r.services]));
});

// ---- 保養合約清冊 ----
router.get('/export/contracts', requireStaff('reports'), (req, res) => {
  const rows = db.prepare(`
    SELECT sc.contract_no, c.name AS customer, sc.title, sc.start_date, sc.end_date, sc.interval_months,
      sc.times_per_year, sc.amount, sc.billing_cycle, sc.status, sc.next_visit_date,
      (SELECT COUNT(*) FROM contract_equipments ce WHERE ce.contract_id = sc.id) AS equipments,
      (SELECT COUNT(*) FROM work_orders w WHERE w.contract_id = sc.id AND w.status IN ('done','confirmed','billed')) AS visits
    FROM service_contracts sc JOIN customers c ON c.id = sc.customer_id
    ORDER BY sc.status, sc.end_date`).all();
  sendCsv(res, `保養合約_${today()}.csv`,
    ['合約號', '客戶', '合約名稱', '起始日', '到期日', '週期(月)', '年次數', '合約金額', '收費方式',
      '狀態', '下次到場', '涵蓋設備', '已執行次數'],
    rows.map(r => [r.contract_no, r.customer, r.title, r.start_date, r.end_date, r.interval_months,
      r.times_per_year, r.amount, r.billing_cycle,
      ({ active: '生效中', expired: '已到期', terminated: '已終止' })[r.status] || r.status,
      r.next_visit_date, r.equipments, r.visits]));
});

// ---- 冷媒管制申報底稿（環境部 F-gas） ----
router.get('/export/refrigerant', requireStaff('reports'), (req, res) => {
  const from = req.query.from || (Number(thisMonth().slice(0, 4)) + '-01-01');
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT r.log_date, r.action, r.refrigerant, r.kg, r.cylinder_no, u.name AS tech, w.order_no,
      c.name AS customer, e.asset_no, e.brand, e.model, e.refrigerant_kg, r.leak_point, r.note
    FROM refrigerant_logs r
    LEFT JOIN users u ON u.id = r.tech_id
    LEFT JOIN work_orders w ON w.id = r.order_id
    LEFT JOIN equipments e ON e.id = r.equipment_id
    LEFT JOIN customers c ON c.id = e.customer_id
    WHERE r.log_date >= ? AND r.log_date <= ? ORDER BY r.log_date, r.id`).all(from, to);
  sendCsv(res, `冷媒管制紀錄_${from}_${to}.csv`,
    ['日期', '作業別', '冷媒種類', '重量kg', '鋼瓶編號', '施作技師', '工單號', '客戶', '機號',
      '品牌', '型號', '系統充填量kg', '洩漏點', '備註'],
    rows.map(r => [r.log_date, ACTION_TW[r.action] || r.action, r.refrigerant, r.kg, r.cylinder_no,
      r.tech || '', r.order_no || '', r.customer || '', r.asset_no || '', r.brand || '', r.model || '',
      r.refrigerant_kg ?? '', r.leak_point, r.note]));
});

// ---- 抽成明細 ----
router.get('/export/commissions', requireStaff('reports'), (req, res) => {
  const period = req.query.period || thisMonth();
  const rows = db.prepare(`
    SELECT u.name, u.tech_no, w.order_no, w.title, w.finished_at, c.name AS customer,
      cm.basis, cm.base_amount, cm.rate, cm.amount, cm.status, cm.settled_at
    FROM commissions cm JOIN users u ON u.id = cm.user_id
    LEFT JOIN work_orders w ON w.id = cm.order_id LEFT JOIN customers c ON c.id = w.customer_id
    WHERE cm.period = ? ORDER BY u.name, cm.id`).all(period);
  sendCsv(res, `技師抽成_${period}.csv`,
    ['技師', '編號', '工單號', '案由', '完工時間', '客戶', '計算基準', '基準金額', '抽成率', '抽成金額', '狀態', '結算日'],
    rows.map(r => [r.name, r.tech_no, r.order_no || '', r.title || '', r.finished_at || '', r.customer || '',
      ({ profit: '毛利', labor: '工資', revenue: '營收' })[r.basis] || r.basis,
      r.base_amount, (r.rate * 100).toFixed(1) + '%', r.amount,
      ({ pending: '未結', settled: '已結算', void: '作廢' })[r.status] || r.status, r.settled_at]));
});

// ---- 營運月報（老闆最常看的一張） ----
router.get('/export/monthly-summary', requireStaff('reports'), (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const wo = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) rev, COALESCE(SUM(parts_cost),0) cost,
        COALESCE(SUM(labor_fee),0) labor
      FROM work_orders WHERE status IN ('done','confirmed','billed') AND substr(finished_at,1,7) = ?`).get(key);
    const so = db.prepare(`SELECT COALESCE(SUM(total),0) rev, COALESCE(SUM(cost_total),0) cost
      FROM sales_orders WHERE status = 'shipped' AND substr(order_date,1,7) = ?`).get(key);
    const po = db.prepare(`SELECT COALESCE(SUM(total),0) v FROM purchase_orders
      WHERE status = 'received' AND substr(arrive_date,1,7) = ?`).get(key);
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments
      WHERE direction = 'in' AND substr(pay_date,1,7) = ?`).get(key);
    const comm = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM commissions WHERE period = ?').get(key);
    const rev = wo.rev + so.rev, cost = wo.cost + so.cost;
    rows.push([key, wo.n, wo.rev, so.rev, rev, cost, rev - cost,
      rev ? ((rev - cost) / rev * 100).toFixed(1) + '%' : '', wo.labor, comm.v, po.v, paid.v]);
  }
  sendCsv(res, `營運月報_${year}.csv`,
    ['月份', '完工單數', '工單營收', '銷貨營收', '總營收', '材料成本', '毛利', '毛利率', '工資收入', '技師抽成', '進貨金額', '實收現金'],
    rows);
});

// ---- 工程專案彙總 ----
const TRADE_TW = { water: '給水排水', electric: '電氣配線', hvac: '空調冷凍', fire: '消防', weak: '弱電', mixed: '綜合水電' };
const PROJ_STATUS_TW = {
  draft: '未開工', ongoing: '施工中', paused: '暫停', completed: '已完工',
  accepted: '已驗收', settled: '已結案', cancelled: '已取消'
};

router.get('/export/projects', requireStaff('reports'), (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, c.name AS customer_name, u.name AS pm_name,
      (SELECT COALESCE(SUM(gross_amount),0) FROM project_billings b
        WHERE b.project_id = p.id AND b.status != 'cancelled' AND b.kind != 'retention') AS billed,
      (SELECT COALESCE(SUM(retention),0) FROM project_billings b
        WHERE b.project_id = p.id AND b.status != 'cancelled') AS retention,
      (SELECT COALESCE(SUM(it.qty * it.cost),0) FROM work_order_items it
        JOIN work_orders w ON w.id = it.order_id WHERE w.project_id = p.id AND w.status != 'cancelled') AS mat_cost,
      (SELECT COALESCE(SUM(b.gross_amount),0) FROM subcontract_billings b
        JOIN subcontracts s ON s.id = b.subcontract_id
        WHERE s.project_id = p.id AND b.status != 'cancelled') AS sub_cost,
      (SELECT COALESCE(SUM(amount),0) FROM labor_logs l WHERE l.project_id = p.id) AS labor_cost
    FROM projects p JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users u ON u.id = p.pm_id ORDER BY p.id`).all();
  sendCsv(res, `工程專案彙總_${today()}.csv`,
    ['案號', '工程名稱', '業主', '工種', '狀態', '合約金額', '追加減帳', '合約總額', '已計價', '未計價',
      '保留款', '材料成本', '分包成本', '工資成本', '成本合計', '毛利', '毛利率', '進度',
      '開工日', '契約完工日', '實際完工', '驗收日', '保固到期', '工地主任'],
    rows.map(r => {
      const total = r.contract_amount + r.change_amount;
      const cost = r.mat_cost + r.sub_cost + r.labor_cost;
      return [r.proj_no, r.name, r.customer_name, TRADE_TW[r.trade] || r.trade,
        PROJ_STATUS_TW[r.status] || r.status, r.contract_amount, r.change_amount, total,
        r.billed, total - r.billed, r.retention - r.retention_released,
        r.mat_cost, r.sub_cost, r.labor_cost, cost, total - cost,
        total ? ((total - cost) / total * 100).toFixed(1) + '%' : '', r.progress + '%',
        r.start_date, r.due_date, r.finish_date, r.accept_date, r.warranty_end, r.pm_name || ''];
    }));
});

// ---- 估驗計價明細 ----
router.get('/export/project-billings', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT b.*, p.proj_no, p.name AS project_name, c.name AS customer_name, i.inv_no, i.paid AS invoice_paid
    FROM project_billings b JOIN projects p ON p.id = b.project_id
    JOIN customers c ON c.id = p.customer_id LEFT JOIN invoices i ON i.id = b.invoice_id
    WHERE b.bill_date >= ? AND b.bill_date <= ? ORDER BY b.bill_date, b.id`).all(from, to);
  const KIND = { deposit: '訂金', progress: '估驗計價', final: '尾款', retention: '保留款退還' };
  sendCsv(res, `估驗計價明細_${from}_${to}.csv`,
    ['估驗日', '案號', '工程名稱', '業主', '期別', '類別', '累計完成', '估驗金額', '保留款',
      '其他扣款', '扣款說明', '本期請款', '請款單號', '已收金額', '狀態'],
    rows.map(r => [r.bill_date, r.proj_no, r.project_name, r.customer_name, `第 ${r.seq} 期`,
      KIND[r.kind] || r.kind, r.progress_pct + '%', r.gross_amount, r.retention, r.deduct,
      r.deduct_note, r.net_amount, r.inv_no || '', r.invoice_paid || 0,
      ({ draft: '草稿', confirmed: '已確認', billed: '已請款', cancelled: '已取消' })[r.status] || r.status]));
});

// ---- 分包計價與扣繳（會計師申報扣繳憑單的底稿） ----
router.get('/export/subcontract-billings', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT b.*, sc.sc_no, sc.title, sb.name AS sub_name, sb.tax_id, sb.is_individual,
      p.proj_no, p.name AS project_name
    FROM subcontract_billings b JOIN subcontracts sc ON sc.id = b.subcontract_id
    JOIN subcontractors sb ON sb.id = sc.subcontractor_id
    LEFT JOIN projects p ON p.id = sc.project_id
    WHERE b.bill_date >= ? AND b.bill_date <= ? ORDER BY b.bill_date, b.id`).all(from, to);
  sendCsv(res, `分包計價與扣繳_${from}_${to}.csv`,
    ['計價日', '發包單號', '工班', '統編／身分證', '身分別', '工程', '工項', '期別', '完成度',
      '計價金額', '材料扣回', '罰款', '保留款', '扣繳稅額', '二代健保', '實付金額', '已付', '付款日', '發票號碼', '狀態'],
    rows.map(r => [r.bill_date, r.sc_no, r.sub_name, r.tax_id, r.is_individual ? '個人' : '公司',
      r.project_name || '', r.title || '', `第 ${r.seq} 期`, r.progress_pct + '%',
      r.gross_amount, r.material_deduct, r.penalty, r.retention, r.wht_tax, r.nhi_fee,
      r.net_pay, r.paid, r.pay_date, r.invoice_no,
      ({ draft: '草稿', confirmed: '待付款', paid: '已付清', cancelled: '已取消' })[r.status] || r.status]));
});

// ---- 出工日報 ----
router.get('/export/labor-logs', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT l.*, u.name AS user_name, sb.name AS sub_name, p.proj_no, p.name AS project_name, w.order_no
    FROM labor_logs l LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN subcontractors sb ON sb.id = l.subcontractor_id
    LEFT JOIN projects p ON p.id = l.project_id LEFT JOIN work_orders w ON w.id = l.order_id
    WHERE l.log_date >= ? AND l.log_date <= ? ORDER BY l.log_date, l.id`).all(from, to);
  sendCsv(res, `出工日報_${from}_${to}.csv`,
    ['日期', '人員', '來源', '工別', '工程', '工單', '工數', '工時', '單價',
      '加班時數', '加班時薪', '工資金額', '天氣', '施工內容'],
    rows.map(r => [r.log_date, r.user_name || r.sub_name || r.worker_name,
      r.user_id ? '自家' : r.subcontractor_id ? '外包' : '臨時', r.worker_type,
      r.project_name || '', r.order_no || '', r.days, r.hours, r.rate,
      r.overtime_hours, r.overtime_rate, r.amount, r.weather, r.work_desc]));
});

// ---- 報驗申報清冊 ----
router.get('/export/filings', requireStaff('reports'), (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, p.proj_no, p.name AS project_name, c.name AS customer_name, u.name AS owner_name
    FROM filings f LEFT JOIN projects p ON p.id = f.project_id
    LEFT JOIN customers c ON c.id = f.customer_id LEFT JOIN users u ON u.id = f.owner_id
    ORDER BY f.apply_date DESC, f.id DESC`).all();
  const RESULT = {
    pending: '待送件', applied: '已送件', inspecting: '審查中',
    passed: '合格', failed: '不合格', fixed: '已改善', cancelled: '已撤案'
  };
  sendCsv(res, `報驗申報清冊_${today()}.csv`,
    ['類別', '受理機關', '案號', '工程', '客戶', '送件日', '會驗日', '結果', '不合格原因',
      '複驗日', '合格日', '下次應申報', '規費', '承辦人'],
    rows.map(r => [r.kind, r.authority, r.apply_no, r.project_name || '', r.customer_name || '',
      r.apply_date, r.inspect_date, RESULT[r.result] || r.result, r.fail_reason,
      r.recheck_date, r.pass_date, r.next_due_date, r.fee, r.owner_name || '']));
});

// ---- 線上估價詢問 ----
router.get('/export/enquiries', requireStaff('reports'), (req, res) => {
  const from = req.query.from || thisMonth() + '-01';
  const to = req.query.to || today();
  const rows = db.prepare(`
    SELECT e.*, u.name AS handler_name, w.order_no FROM enquiries e
    LEFT JOIN users u ON u.id = e.handled_by LEFT JOIN work_orders w ON w.id = e.order_id
    WHERE substr(e.created_at,1,10) >= ? AND substr(e.created_at,1,10) <= ?
    ORDER BY e.id DESC`).all(from, to);
  const ST = {
    new: '新進', contacted: '已聯絡', quoted: '已報價',
    converted: '已成案', closed: '已結案', spam: '無效詢問'
  };
  sendCsv(res, `線上估價詢問_${from}_${to}.csv`,
    ['詢價編號', '收到時間', '姓名', '電話', 'Email', 'LINE', '需求類別', '服務項目', '地區',
      '場所', '預算', '希望到場', '需求描述', '狀態', '轉出工單', '承辦', '客服紀錄'],
    rows.map(r => [r.enq_no, r.created_at, r.name, r.phone, r.email, r.line_id,
      TRADE_TW[r.trade] || r.trade, r.service, r.area, r.building_type, r.budget, r.expect_date,
      r.content, ST[r.status] || r.status, r.order_no || '', r.handler_name || '', r.reply_note]));
});

module.exports = router;
