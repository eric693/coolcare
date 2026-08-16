// 初始化資料：管理員帳號、倉別、料件分類與示範資料
// 用法：npm run seed（已有資料時僅補管理員與基礎主檔；加 --demo 強制重建示範資料）
const bcrypt = require('bcryptjs');
const { db, today, addDays, addMonths, nextDocNo } = require('../src/db');
const { TECH_DEFAULT_MODULES } = require('../src/auth');
const { applyMove } = require('../src/stock');

const FORCE_DEMO = process.argv.includes('--demo');

// ---- 管理員 ----
function seedAdmin() {
  const exists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (exists) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'coolcare123', 10), exists.id);
    return console.log('管理員 admin 密碼已重設');
  }
  db.prepare(`INSERT INTO users (username, password_hash, name, role, title, permissions)
    VALUES ('admin', ?, '系統管理員', 'admin', '負責人', '[]')`)
    .run(bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'coolcare123', 10));
  console.log('已建立管理員 admin / coolcare123');
}

// ---- 倉別與料件分類 ----
function seedBase() {
  if (!db.prepare('SELECT 1 FROM warehouses').get()) {
    const ins = db.prepare('INSERT INTO warehouses (name, kind, note) VALUES (?,?,?)');
    ins.run('主倉（公司）', 'main', '公司倉庫');
    console.log('已建立主倉');
  }
  if (!db.prepare('SELECT 1 FROM product_categories').get()) {
    const cats = ['主機／機器', '冷媒', '銅管配管', '電料電控', '壓縮機零件', '風扇馬達',
      '濾網濾清', '五金耗材', '保溫材料', '排水配件', '工具', '服務項目'];
    const ins = db.prepare('INSERT INTO product_categories (name, sort) VALUES (?,?)');
    cats.forEach((c, i) => ins.run(c, i));
    console.log(`已建立 ${cats.length} 個料件分類`);
  }
}

// ---- 示範資料 ----
const DEMO_TECHS = [
  { username: 'wang', name: '王志明', tech_no: 'T01', title: '工務主管', license: '冷凍空調裝修乙級技術士', hourly_rate: 400, commission_rate: 0.18 },
  { username: 'lin', name: '林俊傑', tech_no: 'T02', title: '技師', license: '冷凍空調裝修丙級技術士', hourly_rate: 320, commission_rate: 0.15 }
];

const DEMO_PRODUCTS = [
  { sku: 'AC-DA-3600', name: '變頻分離式冷氣 一對一', spec: '3.6kW（4-6坪）R32', kind: 'machine', cat: '主機／機器', unit: '台', cost: 18500, retail: 26800, contract: 25000, safety: 2, warranty: 36, serial: 1 },
  { sku: 'AC-DA-5000', name: '變頻分離式冷氣 一對一', spec: '5.0kW（7-9坪）R32', kind: 'machine', cat: '主機／機器', unit: '台', cost: 24000, retail: 33800, contract: 31500, safety: 2, warranty: 36, serial: 1 },
  { sku: 'RF-R32-10', name: 'R32 冷媒', spec: '10kg 鋼瓶', kind: 'consumable', cat: '冷媒', unit: '罐', cost: 2800, retail: 4500, contract: 4000, safety: 2, refrigerant: 1 },
  { sku: 'RF-R410-11', name: 'R410A 冷媒', spec: '11.3kg 鋼瓶', kind: 'consumable', cat: '冷媒', unit: '罐', cost: 3600, retail: 5600, contract: 5000, safety: 1, refrigerant: 1 },
  { sku: 'CU-1438-3', name: '銅管配管組', spec: '1/4" x 3/8" 3M 含保溫', kind: 'part', cat: '銅管配管', unit: '組', cost: 850, retail: 1600, contract: 1400, safety: 10 },
  { sku: 'CU-1412-5', name: '銅管配管組', spec: '1/4" x 1/2" 5M 含保溫', kind: 'part', cat: '銅管配管', unit: '組', cost: 1450, retail: 2600, contract: 2300, safety: 6 },
  { sku: 'EL-CAP-35', name: '啟動電容', spec: '35uF 450V', kind: 'part', cat: '電料電控', unit: '個', cost: 180, retail: 600, contract: 500, safety: 8 },
  { sku: 'EL-CAP-45', name: '啟動電容', spec: '45uF 450V', kind: 'part', cat: '電料電控', unit: '個', cost: 220, retail: 700, contract: 600, safety: 8 },
  { sku: 'EL-CT-25', name: '電磁接觸器', spec: '25A 220V', kind: 'part', cat: '電料電控', unit: '個', cost: 480, retail: 1200, contract: 1000, safety: 4 },
  { sku: 'FA-MOT-30', name: '室外機風扇馬達', spec: '30W 220V', kind: 'part', cat: '風扇馬達', unit: '顆', cost: 950, retail: 2400, contract: 2100, safety: 3 },
  { sku: 'FA-BLADE', name: '室外機扇葉', spec: '通用型 400mm', kind: 'part', cat: '風扇馬達', unit: '片', cost: 260, retail: 800, contract: 700, safety: 3 },
  { sku: 'FL-STD', name: '濾網（標準型）', spec: '可裁切 60x40cm', kind: 'consumable', cat: '濾網濾清', unit: '片', cost: 60, retail: 250, contract: 200, safety: 20 },
  { sku: 'CL-COIL', name: '冷凝器清洗劑', spec: '中性 5L', kind: 'consumable', cat: '五金耗材', unit: '桶', cost: 420, retail: 1100, contract: 950, safety: 4 },
  { sku: 'DR-PIPE-25', name: '排水管', spec: 'PVC 25mm 4M', kind: 'part', cat: '排水配件', unit: '支', cost: 90, retail: 300, contract: 250, safety: 15 },
  { sku: 'DR-PUMP', name: '排水泵浦', spec: '吊隱式專用 220V', kind: 'part', cat: '排水配件', unit: '台', cost: 1800, retail: 4200, contract: 3800, safety: 2 },
  { sku: 'IN-FOAM-20', name: '保溫材', spec: 'PE 20mm 2M', kind: 'consumable', cat: '保溫材料', unit: '支', cost: 75, retail: 260, contract: 220, safety: 20 },
  { sku: 'HW-BRACKET', name: '室外機安裝架', spec: '角鋼 加厚型', kind: 'part', cat: '五金耗材', unit: '組', cost: 380, retail: 1200, contract: 1000, safety: 6 },
  { sku: 'SV-LABOR', name: '施工工資', spec: '標準工班每人時', kind: 'service', cat: '服務項目', unit: '小時', cost: 0, retail: 800, contract: 700, safety: 0 },
  { sku: 'SV-TRAVEL', name: '車馬出勤費', spec: '大台北區', kind: 'service', cat: '服務項目', unit: '式', cost: 0, retail: 500, contract: 0, safety: 0 },
  { sku: 'SV-CLEAN', name: '分離式冷氣保養清洗', spec: '室內外機各一台', kind: 'service', cat: '服務項目', unit: '台', cost: 0, retail: 1800, contract: 1500, safety: 0 }
];

const DEMO_CUSTOMERS = [
  {
    name: '大安連鎖餐飲有限公司', kind: 'company', tax_id: '53012345', contact: '陳店長', phone: '0912345678',
    address: '台北市大安區忠孝東路四段 100 號', payment_terms: '月結30天', price_level: 'contract',
    invoice_type: 'triplicate', source: '介紹',
    sites: [
      { name: '忠孝旗艦店', address: '台北市大安區忠孝東路四段 100 號 3F', contact: '陳店長', phone: '0912345678', floor_note: '後門進貨電梯，需事先報備管理室' },
      { name: '信義分店', address: '台北市信義區松高路 12 號 2F', contact: '李副理', phone: '0922333444', floor_note: '營業時間 11:00 後不可施工' }
    ]
  },
  {
    name: '林小姐', kind: 'personal', contact: '林小姐', phone: '0933555777',
    address: '新北市板橋區文化路一段 55 號 8F', payment_terms: '現金', price_level: 'retail',
    invoice_type: 'duplicate', source: '網路',
    sites: [{ name: '住家', address: '新北市板橋區文化路一段 55 號 8F', contact: '林小姐', phone: '0933555777', floor_note: '無電梯，5F 以上需吊車' }]
  },
  {
    name: '永昌食品工業股份有限公司', kind: 'company', tax_id: '28776655', contact: '張課長', phone: '0955888999',
    address: '桃園市龜山區工業一路 8 號', payment_terms: '月結60天', price_level: 'contract',
    invoice_type: 'triplicate', source: '舊客',
    sites: [{ name: '龜山廠', address: '桃園市龜山區工業一路 8 號', contact: '張課長', phone: '0955888999', floor_note: '需穿安全鞋，進廠登記' }]
  }
];

function seedDemo() {
  if (!FORCE_DEMO && db.prepare('SELECT 1 FROM customers').get()) {
    return console.log('已有客戶資料，略過示範資料（要強制重建請加 --demo）');
  }
  const d = today();

  // 技師
  const techIds = [];
  for (const t of DEMO_TECHS) {
    let u = db.prepare('SELECT id FROM users WHERE username = ?').get(t.username);
    if (!u) {
      const info = db.prepare(`INSERT INTO users
        (username, password_hash, name, role, title, phone, permissions, is_tech, tech_no, license,
         license_expiry, hourly_rate, commission_rate, base_salary)
        VALUES (?,?,?,'staff',?,?,?,1,?,?,?,?,?,?)`)
        .run(t.username, bcrypt.hashSync('123456', 10), t.name, t.title, '',
          JSON.stringify(TECH_DEFAULT_MODULES), t.tech_no, t.license,
          addMonths(d, 18), t.hourly_rate, t.commission_rate, 38000);
      u = { id: info.lastInsertRowid };
    }
    techIds.push(u.id);
  }
  console.log(`示範技師 ${DEMO_TECHS.length} 位（密碼皆為 123456）`);

  // 技師車庫存
  const mainWh = db.prepare("SELECT id FROM warehouses WHERE kind = 'main'").get().id;
  const vehicleIds = [];
  DEMO_TECHS.forEach((t, i) => {
    let w = db.prepare('SELECT id FROM warehouses WHERE name = ?').get(`${t.name} 工程車`);
    if (!w) {
      const info = db.prepare('INSERT INTO warehouses (name, kind, keeper_id, note) VALUES (?,?,?,?)')
        .run(`${t.name} 工程車`, 'vehicle', techIds[i], '隨車庫存');
      w = { id: info.lastInsertRowid };
    }
    vehicleIds.push(w.id);
  });

  // 廠商
  const suppliers = [
    { name: '冠揚冷凍材料行', tax_id: '12345678', contact: '吳老闆', phone: '02-2765-1234', address: '台北市松山區八德路四段 200 號', payment_terms: '月結30天' },
    { name: '日盛空調設備有限公司', tax_id: '87654321', contact: '黃經理', phone: '03-322-5678', address: '桃園市桃園區中山路 500 號', payment_terms: '月結60天' },
    { name: '全能電料五金', tax_id: '', contact: '許先生', phone: '02-2222-8888', address: '新北市三重區重新路三段 88 號', payment_terms: '現金' }
  ];
  const supIds = [];
  for (const s of suppliers) {
    let row = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(s.name);
    if (!row) {
      const info = db.prepare(`INSERT INTO suppliers (name, tax_id, contact, phone, address, payment_terms)
        VALUES (?,?,?,?,?,?)`).run(s.name, s.tax_id, s.contact, s.phone, s.address, s.payment_terms);
      row = { id: info.lastInsertRowid };
    }
    supIds.push(row.id);
  }

  // 料件
  const catId = name => {
    const r = db.prepare('SELECT id FROM product_categories WHERE name = ?').get(name);
    return r ? r.id : null;
  };
  const productIds = {};
  for (const p of DEMO_PRODUCTS) {
    let row = db.prepare('SELECT id FROM products WHERE sku = ?').get(p.sku);
    if (!row) {
      const info = db.prepare(`INSERT INTO products
        (sku, name, spec, category_id, kind, unit, cost, price_retail, price_contract, price_wholesale,
         safety_qty, default_supplier_id, is_refrigerant, serial_tracked, warranty_months)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(p.sku, p.name, p.spec, catId(p.cat), p.kind, p.unit, p.cost, p.retail, p.contract,
          Math.round(p.cost * 1.15), p.safety, supIds[p.kind === 'machine' ? 1 : 0],
          p.refrigerant ? 1 : 0, p.serial ? 1 : 0, p.warranty || 0);
      row = { id: info.lastInsertRowid };
    }
    productIds[p.sku] = row.id;
  }
  console.log(`示範料件 ${DEMO_PRODUCTS.length} 項`);

  // 期初進貨：開一張已進貨的採購單，庫存與移動平均成本就是真的算出來的
  const poDate = addDays(d, -20);
  const poNo = nextDocNo('PO', poDate);
  const poInfo = db.prepare(`INSERT INTO purchase_orders
    (po_no, supplier_id, warehouse_id, order_date, arrive_date, status, tax_mode, due_date, invoice_no, note, created_by)
    VALUES (?,?,?,?,?, 'received','exclusive',?,?,?,1)`)
    .run(poNo, supIds[0], mainWh, poDate, poDate, addDays(poDate, 30), 'AB12345678', '期初備料');
  const poId = poInfo.lastInsertRowid;
  const insPI = db.prepare('INSERT INTO purchase_items (po_id, product_id, qty, price, received_qty) VALUES (?,?,?,?,?)');
  let poSub = 0;
  for (const p of DEMO_PRODUCTS) {
    if (p.kind === 'service') continue;
    const qty = p.kind === 'machine' ? 3 : Math.max(5, (p.safety || 5) * 2);
    insPI.run(poId, productIds[p.sku], qty, p.cost, qty);
    applyMove({
      product_id: productIds[p.sku], warehouse_id: mainWh, kind: 'purchase', qty, cost: p.cost,
      move_date: poDate, ref_type: 'purchase_order', ref_id: poId, ref_no: poNo, user_id: 1, note: '期初進貨'
    });
    poSub += qty * p.cost;
  }
  db.prepare('UPDATE purchase_orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?')
    .run(poSub, Math.round(poSub * 0.05), poSub + Math.round(poSub * 0.05), poId);
  console.log(`期初進貨單 ${poNo}（未稅 ${poSub.toLocaleString()}）`);

  // 撥一些常用零件到工程車
  for (const wh of vehicleIds) {
    for (const sku of ['EL-CAP-35', 'EL-CAP-45', 'FL-STD', 'DR-PIPE-25', 'IN-FOAM-20']) {
      applyMove({ product_id: productIds[sku], warehouse_id: mainWh, kind: 'transfer_out', qty: -3, move_date: poDate, ref_type: 'transfer', ref_no: '調撥', user_id: 1, note: '配車' });
      applyMove({ product_id: productIds[sku], warehouse_id: wh, kind: 'transfer_in', qty: 3, move_date: poDate, ref_type: 'transfer', ref_no: '調撥', user_id: 1, note: '配車' });
    }
  }

  // 客戶、地點、設備
  const customerIds = [];
  for (const c of DEMO_CUSTOMERS) {
    const info = db.prepare(`INSERT INTO customers
      (code, name, kind, tax_id, contact, phone, address, payment_terms, price_level, invoice_type, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(nextDocNo('C', d), c.name, c.kind, c.tax_id || '', c.contact, c.phone, c.address,
        c.payment_terms, c.price_level, c.invoice_type, c.source);
    const cid = info.lastInsertRowid;
    customerIds.push(cid);
    for (const s of c.sites) {
      db.prepare('INSERT INTO sites (customer_id, name, address, contact, phone, floor_note) VALUES (?,?,?,?,?,?)')
        .run(cid, s.name, s.address, s.contact, s.phone, s.floor_note);
    }
  }

  const siteOf = (cid, n) => db.prepare('SELECT id FROM sites WHERE customer_id = ? ORDER BY id').all(cid)[n].id;
  const DEMO_EQUIPS = [
    { c: 0, s: 0, cat: '箱型冷氣', brand: '日立', model: 'RAS-100NK', loc: '1F 用餐區', ton: 4, ref: 'R410A', kg: 3.8, power: '220V 3φ', install: addMonths(d, -40) },
    { c: 0, s: 0, cat: '吊隱式冷氣', brand: '大金', model: 'FDBQ50', loc: '3F 包廂', ton: 2, ref: 'R32', kg: 1.5, power: '220V 1φ', install: addMonths(d, -26) },
    { c: 0, s: 0, cat: '冷藏庫', brand: '瑞智', model: 'WR-30', loc: '後場冷藏室', ton: 3, ref: 'R404A', kg: 5.2, power: '220V 3φ', install: addMonths(d, -55) },
    { c: 0, s: 1, cat: '分離式冷氣', brand: '國際牌', model: 'CS-K50FA2', loc: '2F 座位區', ton: 2, ref: 'R32', kg: 1.2, power: '220V 1φ', install: addMonths(d, -14) },
    { c: 1, s: 0, cat: '分離式冷氣', brand: '大金', model: 'RXV41SVLT', loc: '主臥', ton: 1.5, ref: 'R32', kg: 1.0, power: '220V 1φ', install: addMonths(d, -8) },
    { c: 1, s: 0, cat: '窗型冷氣', brand: '日立', model: 'RA-25NV', loc: '次臥', ton: 1, ref: 'R410A', kg: 0.7, power: '110V 1φ', install: addMonths(d, -62) },
    { c: 2, s: 0, cat: '冰水主機', brand: '約克', model: 'YCAE-60', loc: '頂樓機房', ton: 60, ref: 'R134a', kg: 42, power: '380V 3φ', install: addMonths(d, -70) },
    { c: 2, s: 0, cat: '冷卻水塔', brand: '良機', model: 'RTM-80', loc: '頂樓機房', ton: 80, ref: '', kg: null, power: '380V 3φ', install: addMonths(d, -70) },
    { c: 2, s: 0, cat: '冷凍庫', brand: '谷輪', model: 'ZB-45KQE', loc: '一廠冷凍庫', ton: 8, ref: 'R404A', kg: 12.5, power: '380V 3φ', install: addMonths(d, -34) }
  ];
  const equipIds = [];
  DEMO_EQUIPS.forEach((e, i) => {
    const cid = customerIds[e.c];
    const info = db.prepare(`INSERT INTO equipments
      (customer_id, site_id, asset_no, category, brand, model, serial_no, location, tonnage, refrigerant,
       refrigerant_kg, power_spec, install_date, warranty_end, next_service_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(cid, siteOf(cid, e.s), `EQ${String(cid).padStart(4, '0')}-${String(i + 1).padStart(3, '0')}`,
        e.cat, e.brand, e.model, `SN${2020 + (i % 5)}${String(1000 + i * 137).slice(0, 4)}`, e.loc,
        e.ton, e.ref, e.kg, e.power, e.install, addMonths(e.install, 12),
        addDays(d, [3, 20, -5, 40, 60, 90, 8, 8, 25][i]));
    equipIds.push(info.lastInsertRowid);
  });
  console.log(`示範設備 ${DEMO_EQUIPS.length} 台`);

  // 保養合約（餐飲與工廠各一份）
  const contracts = [
    { c: 0, title: '全門市空調季保養約', months: 3, times: 4, amount: 96000, equips: [0, 1, 2, 3] },
    { c: 2, title: '廠務冰水主機月保養約', months: 1, times: 12, amount: 360000, equips: [6, 7, 8] }
  ];
  for (const ct of contracts) {
    const cid = customerIds[ct.c];
    const start = addMonths(d, -4);
    const info = db.prepare(`INSERT INTO service_contracts
      (contract_no, customer_id, site_id, title, start_date, end_date, interval_months, times_per_year,
       amount, billing_cycle, scope, include_parts, next_visit_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(nextDocNo('SC', start), cid, siteOf(cid, 0), ct.title, start, addMonths(start, 12),
        ct.months, ct.times, ct.amount, 'quarterly',
        '濾網清洗、冷凝器清洗、排水疏通、電流與壓力量測、冷媒洩漏檢查', 0, addDays(d, 5));
    const scId = info.lastInsertRowid;
    const insCE = db.prepare('INSERT OR IGNORE INTO contract_equipments (contract_id, equipment_id) VALUES (?,?)');
    for (const i of ct.equips) insCE.run(scId, equipIds[i]);
  }
  console.log(`示範保養合約 ${contracts.length} 份`);

  // 示範工單：一張已完工（含用料與抽成）、一張施工中、一張待派工
  const mkOrder = (opts) => {
    const cid = customerIds[opts.c];
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(cid);
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteOf(cid, opts.s || 0));
    const no = nextDocNo('WO', opts.date);
    const info = db.prepare(`INSERT INTO work_orders
      (order_no, type, source, customer_id, site_id, contact, phone, address, title, symptom, priority,
       status, appoint_date, appoint_slot, work_hours, headcount, cause, action, suggestion,
       labor_fee, travel_fee, tax_mode, finished_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'exclusive',?,1)`)
      .run(no, opts.type, opts.source, cid, site.id, site.contact, site.phone, site.address,
        opts.title, opts.symptom, opts.priority || 'normal', opts.status, opts.date, opts.slot || '上午(09-12)',
        opts.hours || 0, opts.heads || 1, opts.cause || '', opts.action || '', opts.suggestion || '',
        opts.labor || 0, opts.travel || 500, opts.finished || '');
    const oid = info.lastInsertRowid;
    const insT = db.prepare('INSERT OR IGNORE INTO work_order_techs (order_id, user_id, is_lead) VALUES (?,?,?)');
    (opts.techs || []).forEach((ti, i) => insT.run(oid, techIds[ti], i === 0 ? 1 : 0));
    const insE = db.prepare('INSERT OR IGNORE INTO work_order_equipments (order_id, equipment_id) VALUES (?,?)');
    for (const ei of (opts.equips || [])) insE.run(oid, equipIds[ei]);
    return oid;
  };

  // 1. 已完工的維修單
  const o1Date = addDays(d, -6);
  const o1 = mkOrder({
    c: 0, s: 0, type: 'repair', source: '電話', date: o1Date, status: 'confirmed',
    title: '1F 箱型機不冷', symptom: '出風口有風但不冷，室外機運轉聲音變大', priority: 'high',
    hours: 2.5, heads: 2, techs: [0, 1], equips: [0],
    cause: '室外機風扇馬達軸承磨損導致散熱不良，冷凝壓力偏高',
    action: '更換室外機風扇馬達與扇葉，冷凝器高壓水洗，補充冷媒 1.2kg，測試高低壓正常',
    suggestion: '此機已使用超過 3 年，建議納入季保養約定期清洗冷凝器',
    labor: 3200, travel: 500, finished: `${o1Date} 15:40`
  });
  const insWI = db.prepare(`INSERT INTO work_order_items
    (order_id, product_id, name, spec, unit, qty, price, cost, warehouse_id) VALUES (?,?,?,?,?,?,?,?,?)`);
  const useItem = (oid, sku, qty, wh) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productIds[sku]);
    const mv = applyMove({
      product_id: p.id, warehouse_id: wh, kind: 'issue', qty: -qty, move_date: o1Date,
      ref_type: 'work_order', ref_id: oid, ref_no: '', user_id: 1, note: '示範領料'
    });
    insWI.run(oid, p.id, p.name, p.spec, p.unit, qty, p.price_contract || p.price_retail, mv.cost, wh);
  };
  useItem(o1, 'FA-MOT-30', 1, mainWh);
  useItem(o1, 'FA-BLADE', 1, mainWh);
  useItem(o1, 'RF-R410-11', 0.2, mainWh);
  useItem(o1, 'CL-COIL', 0.5, mainWh);
  db.prepare(`INSERT INTO refrigerant_logs (order_id, equipment_id, log_date, action, refrigerant, kg, cylinder_no, tech_id, note)
    VALUES (?,?,?,'charge','R410A',1.2,'CY-2024-018',?,'冷凝壓力回復正常')`).run(o1, equipIds[0], o1Date, techIds[0]);
  require('../src/routes/orders').recalcOrder(o1);
  require('../src/routes/orders').buildCommissions(o1, null);
  db.prepare("UPDATE work_orders SET confirmed_at = ?, signer_name = '陳店長', rating = 5 WHERE id = ?")
    .run(`${o1Date} 15:55`, o1);

  // 2. 施工中的安裝單
  mkOrder({
    c: 1, s: 0, type: 'install', source: 'LINE', date: d, status: 'working',
    title: '主臥新機安裝', symptom: '購買新機需安裝，舊機一併拆除', hours: 0, heads: 2,
    techs: [1], equips: [4], slot: '下午(13-17)', travel: 800
  });

  // 3. 待派工的急件
  mkOrder({
    c: 2, s: 0, type: 'repair', source: '電話', date: d, status: 'draft', priority: 'urgent',
    title: '冷凍庫溫度上不去', symptom: '冷凍庫溫度從 -18°C 升到 -8°C，庫內貨品有風險', equips: [8], slot: '上午(09-12)'
  });

  // 4. 保養合約排定的保養單
  mkOrder({
    c: 0, s: 0, type: 'maintain', source: '合約排程', date: addDays(d, 5), status: 'assigned',
    title: '全門市空調季保養約（定期保養）', symptom: '', techs: [0], equips: [0, 1, 2], slot: '上午(09-12)'
  });

  // 客戶專區帳號
  for (const cid of customerIds) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(cid);
    const phone = c.phone.replace(/\D/g, '');
    if (!/^09\d{8}$/.test(phone)) continue;
    if (db.prepare('SELECT 1 FROM customer_users WHERE phone = ?').get(phone)) continue;
    db.prepare('INSERT INTO customer_users (customer_id, phone, name, password_hash) VALUES (?,?,?,?)')
      .run(cid, phone, c.contact, bcrypt.hashSync(phone.slice(-6), 10));
  }
  console.log('客戶專區帳號已建立（帳號＝手機、密碼＝末 6 碼）');

  // 公告
  db.prepare(`INSERT INTO announcements (title, body, publish_date, to_customer, created_by)
    VALUES (?,?,?,1,1)`)
    .run('夏季旺季服務時間調整', '6 至 9 月為空調維修旺季，急件請直接來電；一般報修約 2 至 3 個工作天到場，敬請見諒。', d);

  console.log('示範資料建立完成');
}

seedAdmin();
seedBase();
seedDemo();
console.log('\n完成。啟動：npm start');
