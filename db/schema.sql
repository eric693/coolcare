-- CoolCare 冷凍空調工程管理系統 資料庫結構（SQLite）
-- 設計依據：台灣冷凍空調工程行實務（報修派工、安裝工程、定期保養約、設備履歷、冷媒管制）
-- 與一般商用進銷存作業（採購進貨、銷貨出庫、庫存異動、移動平均成本、盤點、應收應付）。
-- 法規對照：冷媒管理（環境部 F-gas 申報）、營業稅 5%、統一發票開立、消保法定型化契約保固。

PRAGMA foreign_keys = ON;

-- ============ 帳號與權限 ============

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  title TEXT NOT NULL DEFAULT '',                -- 職稱：負責人/工務主管/技師/業務/會計
  phone TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',        -- JSON 陣列，模組 key 清單（admin 不看此欄）
  is_tech INTEGER NOT NULL DEFAULT 0,            -- 是否為施工技師（可被派工、計抽成）
  tech_no TEXT NOT NULL DEFAULT '',              -- 技師編號
  license TEXT NOT NULL DEFAULT '',              -- 證照（冷凍空調裝修技術士/甲級技術士/高壓氣體）
  license_expiry TEXT NOT NULL DEFAULT '',       -- 證照有效期限
  hourly_rate INTEGER NOT NULL DEFAULT 0,        -- 工資時薪（工單工資成本估算）
  commission_rate REAL NOT NULL DEFAULT 0,       -- 抽成比例（0~1，對工單毛利或工資，依系統設定）
  base_salary INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============ 客戶、服務地點、設備履歷 ============

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',                 -- 客戶編號（自動流水或手填）
  name TEXT NOT NULL,                            -- 客戶／公司名稱
  kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal','company')),
  tax_id TEXT NOT NULL DEFAULT '',               -- 統一編號（公司戶開發票用）
  contact TEXT NOT NULL DEFAULT '',              -- 主要聯絡人
  phone TEXT NOT NULL DEFAULT '',
  phone2 TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',              -- 帳單地址
  invoice_title TEXT NOT NULL DEFAULT '',        -- 發票抬頭（空白則用 name）
  invoice_type TEXT NOT NULL DEFAULT 'duplicate' CHECK (invoice_type IN ('duplicate','triplicate','none')),
  payment_terms TEXT NOT NULL DEFAULT '現金',     -- 付款條件：現金/月結30天/月結60天/工程分期
  price_level TEXT NOT NULL DEFAULT 'retail' CHECK (price_level IN ('retail','contract','wholesale')),
  credit_limit INTEGER NOT NULL DEFAULT 0,       -- 信用額度（0 表不限）
  source TEXT NOT NULL DEFAULT '',               -- 來源：介紹/網路/廣告/舊客
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- 服務地點：一個客戶可有多個場所（總公司、分店、廠房、住家）
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                            -- 地點名稱：例「中山門市」
  address TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  floor_note TEXT NOT NULL DEFAULT '',           -- 樓層/門禁/停車/施工注意
  lat TEXT NOT NULL DEFAULT '',
  lng TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id);

-- 設備履歷：客戶端每一台機器（系統的護城河資料）
CREATE TABLE IF NOT EXISTS equipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  asset_no TEXT NOT NULL DEFAULT '',             -- 機號（貼標籤/QR 用）
  category TEXT NOT NULL DEFAULT '分離式冷氣',    -- 機種：分離式/窗型/箱型/吊隱式/冰水主機/冷凍庫/冷藏櫃/製冰機/風管
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial_no TEXT NOT NULL DEFAULT '',            -- 原廠序號
  location TEXT NOT NULL DEFAULT '',             -- 安裝位置：3F 會議室 / 廚房後方
  capacity_kw REAL,                              -- 能力（kW）
  tonnage REAL,                                  -- 噸數（冷凍噸 RT）
  refrigerant TEXT NOT NULL DEFAULT '',          -- 冷媒種類：R32/R410A/R22/R134a/R404A
  refrigerant_kg REAL,                           -- 系統充填量（公斤，F-gas 申報用）
  power_spec TEXT NOT NULL DEFAULT '',           -- 電源規格：220V 1φ / 380V 3φ
  install_date TEXT NOT NULL DEFAULT '',
  warranty_end TEXT NOT NULL DEFAULT '',         -- 保固到期日
  compressor_warranty_end TEXT NOT NULL DEFAULT '', -- 壓縮機保固（通常較長）
  last_service_date TEXT NOT NULL DEFAULT '',    -- 上次保養日（完工時回寫）
  next_service_date TEXT NOT NULL DEFAULT '',    -- 下次應保養日（合約週期推算）
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','repair','scrapped')),
  note TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_equip_customer ON equipments(customer_id);
CREATE INDEX IF NOT EXISTS idx_equip_site ON equipments(site_id);

-- ============ 保養合約 ============

CREATE TABLE IF NOT EXISTS service_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no TEXT NOT NULL DEFAULT '',
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '定期保養約',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  interval_months INTEGER NOT NULL DEFAULT 3,    -- 保養週期（月）
  times_per_year INTEGER NOT NULL DEFAULT 4,     -- 年度保養次數
  amount INTEGER NOT NULL DEFAULT 0,             -- 合約總金額（未稅）
  billing_cycle TEXT NOT NULL DEFAULT 'yearly' CHECK (billing_cycle IN ('yearly','half','quarterly','monthly','per_visit')),
  scope TEXT NOT NULL DEFAULT '',                -- 保養範圍說明
  include_parts INTEGER NOT NULL DEFAULT 0,      -- 是否含零件
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','terminated')),
  next_visit_date TEXT NOT NULL DEFAULT '',      -- 下次應到場日（產生保養工單後推進）
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sc_customer ON service_contracts(customer_id);

-- 合約涵蓋的設備
CREATE TABLE IF NOT EXISTS contract_equipments (
  contract_id INTEGER NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  PRIMARY KEY (contract_id, equipment_id)
);

-- ============ 派工單 ============

CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,                 -- 工單號 WO-YYYYMM-0001
  type TEXT NOT NULL DEFAULT 'repair'
    CHECK (type IN ('repair','install','maintain','inspect','move','dismantle','other')),
  source TEXT NOT NULL DEFAULT 'phone',          -- 來源：電話/LINE/客戶端/合約排程/現場
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  contract_id INTEGER REFERENCES service_contracts(id) ON DELETE SET NULL,
  contact TEXT NOT NULL DEFAULT '',              -- 現場聯絡人（可覆寫客戶主聯絡人）
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',              -- 施工地址（快照，客戶改地址不影響歷史）
  title TEXT NOT NULL DEFAULT '',                -- 案由摘要
  symptom TEXT NOT NULL DEFAULT '',              -- 客戶描述的故障狀況
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','assigned','departed','working','done','confirmed','billed','cancelled')),
  appoint_date TEXT NOT NULL DEFAULT '',         -- 預約到場日
  appoint_slot TEXT NOT NULL DEFAULT '',         -- 時段：上午/下午/晚間/指定時間
  departed_at TEXT NOT NULL DEFAULT '',
  arrived_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT NOT NULL DEFAULT '',
  work_hours REAL NOT NULL DEFAULT 0,            -- 實際工時（人時）
  headcount INTEGER NOT NULL DEFAULT 1,          -- 出工人數
  cause TEXT NOT NULL DEFAULT '',                -- 故障原因判定
  action TEXT NOT NULL DEFAULT '',               -- 處理方式／施工內容
  suggestion TEXT NOT NULL DEFAULT '',           -- 後續建議（下次報價鉤子）
  -- 費用（未稅）
  labor_fee INTEGER NOT NULL DEFAULT 0,          -- 工資
  travel_fee INTEGER NOT NULL DEFAULT 0,         -- 車馬/出勤費
  parts_fee INTEGER NOT NULL DEFAULT 0,          -- 材料售價合計（由用料明細帶入）
  other_fee INTEGER NOT NULL DEFAULT 0,
  other_fee_name TEXT NOT NULL DEFAULT '',
  discount INTEGER NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive','free')),
  total INTEGER NOT NULL DEFAULT 0,              -- 含稅應收（結算時計算）
  parts_cost INTEGER NOT NULL DEFAULT 0,         -- 材料成本合計（毛利用）
  is_warranty INTEGER NOT NULL DEFAULT 0,        -- 保固內免費
  is_contract INTEGER NOT NULL DEFAULT 0,        -- 合約內免費（不另計價）
  signature TEXT NOT NULL DEFAULT '',            -- 客戶簽名圖檔
  signer_name TEXT NOT NULL DEFAULT '',
  rating INTEGER,                                -- 客戶滿意度 1~5
  rating_comment TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_customer ON work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_wo_appoint ON work_orders(appoint_date);

-- 派工（一張工單可多位技師，含主責）
CREATE TABLE IF NOT EXISTS work_order_techs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  is_lead INTEGER NOT NULL DEFAULT 0,
  hours REAL NOT NULL DEFAULT 0,
  UNIQUE (order_id, user_id)
);

-- 工單涉及的設備（一次到場可處理多台）
CREATE TABLE IF NOT EXISTS work_order_equipments (
  order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  PRIMARY KEY (order_id, equipment_id)
);

-- 工單用料（領料即扣庫存，退料回沖）
CREATE TABLE IF NOT EXISTS work_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  name TEXT NOT NULL DEFAULT '',                 -- 品名快照（可為無料號的臨時採購品）
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '個',
  qty REAL NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,              -- 售價（未稅）
  cost INTEGER NOT NULL DEFAULT 0,               -- 出庫成本快照（移動平均）
  warehouse_id INTEGER REFERENCES warehouses(id),
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_woi_order ON work_order_items(order_id);

-- 施工照片（施工前/中/後、故障點、竣工）
CREATE TABLE IF NOT EXISTS work_order_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'before' CHECK (stage IN ('before','during','after','fault','other')),
  path TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 保養／檢修檢查表（可依機種帶入預設項目）
CREATE TABLE IF NOT EXISTS work_order_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  equipment_id INTEGER REFERENCES equipments(id) ON DELETE SET NULL,
  item TEXT NOT NULL,                            -- 檢查項目
  result TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok','fix','ng','na')),
  value TEXT NOT NULL DEFAULT '',                -- 量測值：高低壓/電流/出風溫度
  note TEXT NOT NULL DEFAULT ''
);

-- 冷媒充填／回收紀錄（環境部 F-gas 申報依據，逐筆留存）
CREATE TABLE IF NOT EXISTS refrigerant_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  equipment_id INTEGER REFERENCES equipments(id) ON DELETE SET NULL,
  log_date TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'charge' CHECK (action IN ('charge','recover','leak','dispose')),
  refrigerant TEXT NOT NULL DEFAULT '',
  kg REAL NOT NULL DEFAULT 0,
  cylinder_no TEXT NOT NULL DEFAULT '',          -- 鋼瓶編號
  tech_id INTEGER REFERENCES users(id),
  leak_point TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============ 進銷存：料件、廠商、倉別 ============

CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,                      -- 料號
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',                 -- 規格：1/4" x 3/8" 3M
  category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'part' CHECK (kind IN ('machine','part','consumable','tool','service')),
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '個',
  barcode TEXT NOT NULL DEFAULT '',
  cost INTEGER NOT NULL DEFAULT 0,               -- 移動平均成本（進貨自動更新）
  last_cost INTEGER NOT NULL DEFAULT 0,          -- 最近進價
  price_retail INTEGER NOT NULL DEFAULT 0,       -- 零售價
  price_contract INTEGER NOT NULL DEFAULT 0,     -- 合約價
  price_wholesale INTEGER NOT NULL DEFAULT 0,    -- 同業／批發價
  safety_qty REAL NOT NULL DEFAULT 0,            -- 安全庫存
  default_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  is_refrigerant INTEGER NOT NULL DEFAULT 0,     -- 冷媒品項（出庫時提示登錄充填紀錄）
  serial_tracked INTEGER NOT NULL DEFAULT 0,     -- 是否逐台管序號（主機類）
  warranty_months INTEGER NOT NULL DEFAULT 0,    -- 銷售保固月數（帶入設備履歷）
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  tax_id TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '月結30天',
  bank_account TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                            -- 主倉／二廠倉／A車／B車
  kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main','vehicle','site')),
  keeper_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- 車庫存對應的技師
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

-- 各倉即時庫存
CREATE TABLE IF NOT EXISTS stocks (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

-- 庫存異動流水（所有進出的唯一真相來源）
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_date TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  kind TEXT NOT NULL CHECK (kind IN
    ('purchase','purchase_return','sale','sale_return','issue','issue_return','transfer_in','transfer_out','adjust')),
  qty REAL NOT NULL,                             -- 正數入庫、負數出庫
  cost INTEGER NOT NULL DEFAULT 0,               -- 該筆單位成本
  balance REAL NOT NULL DEFAULT 0,               -- 異動後該倉結存
  ref_type TEXT NOT NULL DEFAULT '',             -- purchase_order / sales_order / work_order / stocktake
  ref_id INTEGER,
  ref_no TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_moves(product_id, move_date);
CREATE INDEX IF NOT EXISTS idx_moves_ref ON stock_moves(ref_type, ref_id);

-- 主機序號追蹤（serial_tracked 品項）
CREATE TABLE IF NOT EXISTS product_serials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  serial_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','installed','returned')),
  warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  purchase_id INTEGER,
  sale_id INTEGER,
  equipment_id INTEGER REFERENCES equipments(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (product_id, serial_no)
);

-- ============ 採購 ============

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_no TEXT NOT NULL UNIQUE,                    -- PO-YYYYMM-0001
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  order_date TEXT NOT NULL,
  arrive_date TEXT NOT NULL DEFAULT '',          -- 實際入庫日
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','cancelled')),
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive','free')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  invoice_no TEXT NOT NULL DEFAULT '',           -- 廠商發票號碼
  paid INTEGER NOT NULL DEFAULT 0,               -- 已付金額
  due_date TEXT NOT NULL DEFAULT '',             -- 應付到期日
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,              -- 進價（未稅）
  received_qty REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

-- ============ 銷貨（純賣料件／機器，不派工的情形） ============

CREATE TABLE IF NOT EXISTS sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  so_no TEXT NOT NULL UNIQUE,                    -- SO-YYYYMM-0001
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shipped','cancelled')),
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive','free')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  cost_total INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

-- ============ 盤點 ============

CREATE TABLE IF NOT EXISTS stocktakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  take_no TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  take_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  take_id INTEGER NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  system_qty REAL NOT NULL DEFAULT 0,            -- 帳面數（開單當下快照）
  counted_qty REAL,                              -- 實盤數（NULL 表未盤）
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (take_id, product_id)
);

-- ============ 報價單 ============

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,                 -- QT-YYYYMM-0001
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  quote_date TEXT NOT NULL,
  valid_days INTEGER NOT NULL DEFAULT 30,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive','free')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  terms TEXT NOT NULL DEFAULT '',                -- 付款條件／保固說明／報價備註
  order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,  -- 成交後轉出的工單
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '式',
  qty REAL NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

-- ============ 應收帳款（請款單／發票／收款） ============

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inv_no TEXT NOT NULL UNIQUE,                   -- 內部請款單號 IV-YYYYMM-0001
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL DEFAULT '',               -- 月結期別 YYYY-MM
  source_type TEXT NOT NULL DEFAULT 'work_order',-- work_order / sales_order / contract / manual
  source_ids TEXT NOT NULL DEFAULT '',           -- 併單來源 id（逗號分隔）
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','void')),
  tax_invoice_no TEXT NOT NULL DEFAULT '',       -- 統一發票號碼
  tax_invoice_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '式',
  price INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  pay_date TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT '現金',
  ref_no TEXT NOT NULL DEFAULT '',               -- 匯款末五碼／支票號碼
  user_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============ 技師抽成 ============

CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
  period TEXT NOT NULL DEFAULT '',               -- YYYY-MM
  base_amount INTEGER NOT NULL DEFAULT 0,        -- 計算基準（毛利或工資）
  rate REAL NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  basis TEXT NOT NULL DEFAULT 'profit' CHECK (basis IN ('profit','labor','revenue')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','void')),
  settled_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_comm_user ON commissions(user_id, period);

-- ============ 客戶端帳號（客戶專區） ============

CREATE TABLE IF NOT EXISTS customer_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone TEXT NOT NULL UNIQUE,                    -- 以手機號當帳號
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============ 公告、稽核、系統設定 ============

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  publish_date TEXT NOT NULL DEFAULT '',
  expire_date TEXT NOT NULL DEFAULT '',
  to_customer INTEGER NOT NULL DEFAULT 0,        -- 是否同步顯示於客戶專區
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL DEFAULT 'staff',
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- 單號流水（依前綴與年月各自遞增）
CREATE TABLE IF NOT EXISTS doc_counters (
  prefix TEXT NOT NULL,
  period TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, period)
);

-- ============================================================
-- 水電工程模組（台灣水電行實務）
-- 依據：營造業/水電承裝業慣例（工程合約、期中估驗計價、保留款、追加減帳、
-- 分包工班發包與計價扣款）、所得稅法第 88 條勞務報酬扣繳、二代健保補充保費，
-- 以及台電竣工報驗、自來水事業處配管報驗、消防查驗等報驗申報作業。
-- ============================================================

-- ---------- 工程專案（新建／裝修水電工程，以「案」為單位管理） ----------

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proj_no TEXT NOT NULL UNIQUE,                  -- PJ-YYYYMM-0001
  name TEXT NOT NULL,                            -- 工程名稱：例「中山路 12 號新建住宅水電工程」
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,   -- 由哪張報價成交
  trade TEXT NOT NULL DEFAULT 'mixed'
    CHECK (trade IN ('water','electric','hvac','fire','weak','mixed')),  -- 給水排水/電氣/空調/消防/弱電/綜合
  kind TEXT NOT NULL DEFAULT 'new'
    CHECK (kind IN ('new','renovate','repair','addition','maintain','other')), -- 新建/裝修/修繕/增設/維護
  address TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  contract_no TEXT NOT NULL DEFAULT '',          -- 甲乙方合約編號
  contract_date TEXT NOT NULL DEFAULT '',
  contract_amount INTEGER NOT NULL DEFAULT 0,    -- 原始承攬金額（未稅）
  change_amount INTEGER NOT NULL DEFAULT 0,      -- 追加減帳累計（已核准，未稅）
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive','free')),
  budget_cost INTEGER NOT NULL DEFAULT 0,        -- 預算成本（工料＋分包），用於毛利控管
  retention_rate REAL NOT NULL DEFAULT 0.05,     -- 保留款比例（業主每期扣留，驗收後退還）
  retention_released INTEGER NOT NULL DEFAULT 0, -- 已退還的保留款
  guarantee_amount INTEGER NOT NULL DEFAULT 0,   -- 履約／保固保證金
  guarantee_type TEXT NOT NULL DEFAULT '',       -- 現金／本票／銀行保證
  guarantee_return_date TEXT NOT NULL DEFAULT '',
  pm_id INTEGER REFERENCES users(id) ON DELETE SET NULL,       -- 工地主任／專案負責人
  start_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',             -- 契約完工日
  finish_date TEXT NOT NULL DEFAULT '',          -- 實際完工日
  accept_date TEXT NOT NULL DEFAULT '',          -- 驗收日
  warranty_months INTEGER NOT NULL DEFAULT 12,
  warranty_end TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,           -- 施工進度 %
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ongoing','paused','completed','accepted','settled','cancelled')),
  scope TEXT NOT NULL DEFAULT '',                -- 承攬範圍
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_proj_customer ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_proj_status ON projects(status);

-- 追加減帳（工程變更單）：業主追加項目或減項，核准後併入合約金額
CREATE TABLE IF NOT EXISTS project_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  change_no TEXT NOT NULL DEFAULT '',            -- 變更序號 CO-01
  change_date TEXT NOT NULL,
  title TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,             -- 追加為正、減帳為負（未稅）
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  approved_by TEXT NOT NULL DEFAULT '',          -- 業主簽認人
  approved_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pchg_project ON project_changes(project_id);

-- 估驗計價（期中請款）：每期依完成比例計價，扣保留款後開立請款單
CREATE TABLE IF NOT EXISTS project_billings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 1,                -- 第幾期
  kind TEXT NOT NULL DEFAULT 'progress'
    CHECK (kind IN ('deposit','progress','final','retention')),  -- 訂金/估驗/尾款/保留款退還
  bill_date TEXT NOT NULL,
  progress_pct INTEGER NOT NULL DEFAULT 0,       -- 本期累計完成 %
  gross_amount INTEGER NOT NULL DEFAULT 0,       -- 本期估驗金額（未稅）
  retention INTEGER NOT NULL DEFAULT 0,          -- 本期扣留保留款
  deduct INTEGER NOT NULL DEFAULT 0,             -- 其他扣款（代購材料、逾期罰款）
  deduct_note TEXT NOT NULL DEFAULT '',
  net_amount INTEGER NOT NULL DEFAULT 0,         -- 本期實際請款（未稅）＝ gross - retention - deduct
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','billed','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pbill_project ON project_billings(project_id);

-- ---------- 分包工班（協力廠商） ----------

CREATE TABLE IF NOT EXISTS subcontractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,                            -- 工班／協力廠商名稱
  trade TEXT NOT NULL DEFAULT 'mixed',           -- 專長工種：配管/配線/衛浴/泥作/開挖/鑽孔/吊車
  is_individual INTEGER NOT NULL DEFAULT 1,      -- 個人工班（給付需辦理扣繳）／公司行號（取具發票）
  tax_id TEXT NOT NULL DEFAULT '',               -- 統編或身分證字號（扣繳憑單用）
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '',              -- 證照：室內配線技術士／自來水管配管技術士
  license_no TEXT NOT NULL DEFAULT '',
  license_expiry TEXT NOT NULL DEFAULT '',
  labor_insurance INTEGER NOT NULL DEFAULT 0,    -- 是否已投保勞保／意外險（工地要求）
  insurance_end TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '月結30天',
  day_rate INTEGER NOT NULL DEFAULT 0,           -- 點工日薪參考價
  rating INTEGER NOT NULL DEFAULT 0,             -- 配合評等 1~5
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 發包單：把工程的一部分包給工班
CREATE TABLE IF NOT EXISTS subcontracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sc_no TEXT NOT NULL UNIQUE,                    -- SC-YYYYMM-0001
  subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,   -- 也可掛在單張工單下
  title TEXT NOT NULL DEFAULT '',
  trade TEXT NOT NULL DEFAULT '',
  pay_kind TEXT NOT NULL DEFAULT 'lump'
    CHECK (pay_kind IN ('lump','unit','daily')), -- 總價包/單價計量/點工
  scope TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,             -- 發包金額（未稅）
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive','free')),
  retention_rate REAL NOT NULL DEFAULT 0.05,     -- 對工班扣留的保留款
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  warranty_months INTEGER NOT NULL DEFAULT 12,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','signed','working','done','settled','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sc_project ON subcontracts(project_id);

-- 分包計價（付給工班的每一期）：含扣款、保留款、勞務扣繳與二代健保
CREATE TABLE IF NOT EXISTS subcontract_billings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcontract_id INTEGER NOT NULL REFERENCES subcontracts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 1,
  bill_date TEXT NOT NULL,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  gross_amount INTEGER NOT NULL DEFAULT 0,       -- 本期計價（未稅）
  material_deduct INTEGER NOT NULL DEFAULT 0,    -- 代購材料扣回
  penalty INTEGER NOT NULL DEFAULT 0,            -- 罰款／缺失扣款
  retention INTEGER NOT NULL DEFAULT 0,          -- 本期扣留保留款
  wht_tax INTEGER NOT NULL DEFAULT 0,            -- 所得稅扣繳（個人工班，預設 10%；未達起扣點免扣）
  nhi_fee INTEGER NOT NULL DEFAULT 0,            -- 二代健保補充保費
  net_pay INTEGER NOT NULL DEFAULT 0,            -- 實付金額
  paid INTEGER NOT NULL DEFAULT 0,
  pay_date TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '匯款',
  invoice_no TEXT NOT NULL DEFAULT '',           -- 工班開立的發票／收據號碼
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','paid','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_scb_sub ON subcontract_billings(subcontract_id);

-- ---------- 出工日報／點工計價 ----------

CREATE TABLE IF NOT EXISTS labor_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,             -- 自家技師
  subcontractor_id INTEGER REFERENCES subcontractors(id) ON DELETE SET NULL,  -- 外包點工
  worker_name TEXT NOT NULL DEFAULT '',          -- 非建檔人員直接填名字
  worker_type TEXT NOT NULL DEFAULT '技師',       -- 大工/小工/技師/學徒/臨時工
  days REAL NOT NULL DEFAULT 1,                  -- 工數（0.5 = 半天）
  hours REAL NOT NULL DEFAULT 0,                 -- 工時（加班或按時計價時填）
  rate INTEGER NOT NULL DEFAULT 0,               -- 日薪或時薪
  overtime_hours REAL NOT NULL DEFAULT 0,
  overtime_rate INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,             -- 該筆工資成本
  weather TEXT NOT NULL DEFAULT '',              -- 晴/陰/雨（雨天停工佐證）
  work_desc TEXT NOT NULL DEFAULT '',            -- 當日施工項目
  is_billed INTEGER NOT NULL DEFAULT 0,          -- 是否已計入客戶計價
  created_by INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_labor_date ON labor_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_labor_project ON labor_logs(project_id);

-- ---------- 工項單價分析庫（報價與估驗計價的快速帶入來源） ----------

CREATE TABLE IF NOT EXISTS unit_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',                 -- 工項編號 E-001 / W-012
  trade TEXT NOT NULL DEFAULT 'water',           -- water/electric/hvac/fire/weak/common
  category TEXT NOT NULL DEFAULT '',             -- 分類：給水配管/排水配管/衛生設備/電氣配線/開關插座/照明/配電盤
  name TEXT NOT NULL,                            -- 工項名稱：例「PVC 給水管 4 分 明管配管」
  spec TEXT NOT NULL DEFAULT '',                 -- 規格：4分(15A) / 2.0mm² / CD管16mm
  unit TEXT NOT NULL DEFAULT '式',               -- 米/處/口/組/式/樘
  labor_price INTEGER NOT NULL DEFAULT 0,        -- 工資單價
  material_price INTEGER NOT NULL DEFAULT 0,     -- 材料單價
  price INTEGER NOT NULL DEFAULT 0,              -- 對客戶報價單價（工＋料＋管銷利潤）
  cost INTEGER NOT NULL DEFAULT 0,               -- 內部成本單價
  sub_price INTEGER NOT NULL DEFAULT 0,          -- 發包給工班的單價
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_up_trade ON unit_prices(trade, category);

-- ---------- 報驗／申報作業（主管機關往來） ----------

CREATE TABLE IF NOT EXISTS filings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filing_no TEXT NOT NULL DEFAULT '',            -- 內部編號
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT '',                 -- 台電竣工報驗/自來水配管報驗/用電設備檢驗維護申報/消防查驗/建管室內裝修/F-gas 冷媒申報
  authority TEXT NOT NULL DEFAULT '',            -- 受理機關：台灣電力公司○○區處／自來水處第○區
  apply_no TEXT NOT NULL DEFAULT '',             -- 案號／受理號碼
  apply_date TEXT NOT NULL DEFAULT '',           -- 送件日
  inspect_date TEXT NOT NULL DEFAULT '',         -- 會驗／查驗日
  result TEXT NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending','applied','inspecting','passed','failed','fixed','cancelled')),
  fail_reason TEXT NOT NULL DEFAULT '',          -- 不合格原因（複驗依據）
  recheck_date TEXT NOT NULL DEFAULT '',         -- 複驗日
  pass_date TEXT NOT NULL DEFAULT '',
  next_due_date TEXT NOT NULL DEFAULT '',        -- 下次應申報日（定期檢驗維護申報用）
  fee INTEGER NOT NULL DEFAULT 0,                -- 規費
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- 承辦人
  doc_path TEXT NOT NULL DEFAULT '',             -- 掃描件
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_filing_project ON filings(project_id);

-- ---------- 公司證照／承裝業登記 ----------

CREATE TABLE IF NOT EXISTS company_licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                            -- 電器承裝業登記／自來水管承裝商甲級／消防設備師事務所
  reg_no TEXT NOT NULL DEFAULT '',               -- 登記證號
  grade TEXT NOT NULL DEFAULT '',                -- 甲/乙/丙級
  authority TEXT NOT NULL DEFAULT '',            -- 核發機關
  holder TEXT NOT NULL DEFAULT '',               -- 專任技術員姓名
  holder_license TEXT NOT NULL DEFAULT '',       -- 該技術員之證照字號
  issue_date TEXT NOT NULL DEFAULT '',
  expire_date TEXT NOT NULL DEFAULT '',          -- 到期日（需辦理換證）
  doc_path TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- 公司官網（對外形象網站）＋線上估價
-- 內容一律由後台 CMS 維護，官網只讀；線上估價送出後落入 enquiries 待客服處理。
-- ============================================================

-- 服務項目（官網「服務項目」區塊）
CREATE TABLE IF NOT EXISTS web_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                            -- 例：家用空調安裝、室內配線、衛浴設備更新
  trade TEXT NOT NULL DEFAULT 'water',           -- 歸類（水/電/空調/消防/弱電/綜合）
  summary TEXT NOT NULL DEFAULT '',              -- 一句話說明（卡片用）
  body TEXT NOT NULL DEFAULT '',                 -- 詳細說明（可多行）
  icon TEXT NOT NULL DEFAULT '',                 -- emoji 或短代碼
  photo TEXT NOT NULL DEFAULT '',
  price_hint TEXT NOT NULL DEFAULT '',           -- 例：「到府檢測 500 元起，施工可折抵」
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 工程實績（官網「工程實績」相簿）
CREATE TABLE IF NOT EXISTS web_showcases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  trade TEXT NOT NULL DEFAULT 'water',
  category TEXT NOT NULL DEFAULT '',             -- 住宅/商辦/廠房/店面/公共工程
  customer_name TEXT NOT NULL DEFAULT '',        -- 對外顯示名稱（可寫「台北市 王先生」）
  area TEXT NOT NULL DEFAULT '',                 -- 施工地區（不放完整地址）
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,  -- 由內部工程專案轉出
  finish_date TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',                 -- 施工說明／使用材料／工期
  cover TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS web_showcase_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  showcase_id INTEGER NOT NULL REFERENCES web_showcases(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

-- 商品資訊（官網「商品資訊」；可連結內部料件，型錄式呈現）
CREATE TABLE IF NOT EXISTS web_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  brand TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  spec TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  price_note TEXT NOT NULL DEFAULT '',           -- 官網不放實價：例「歡迎來電洽詢」
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 最新消息／衛教文章
CREATE TABLE IF NOT EXISTS web_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '最新消息',      -- 最新消息/優惠活動/施工知識/公告
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  publish_date TEXT NOT NULL DEFAULT '',
  expire_date TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 服務流程（官網「服務流程」步驟圖）
CREATE TABLE IF NOT EXISTS web_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_no INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1
);

-- 常見問題
CREATE TABLE IF NOT EXISTS web_faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1
);

-- 線上估價／聯絡表單（官網送出 → 後台待處理 → 可一鍵轉客戶與工單）
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enq_no TEXT NOT NULL DEFAULT '',               -- EQ-YYYYMM-0001
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  line_id TEXT NOT NULL DEFAULT '',
  trade TEXT NOT NULL DEFAULT '',                -- 需求類別
  service TEXT NOT NULL DEFAULT '',              -- 服務項目：安裝/維修/保養/管路阻塞/漏水/報價
  area TEXT NOT NULL DEFAULT '',                 -- 施工地區
  address TEXT NOT NULL DEFAULT '',
  building_type TEXT NOT NULL DEFAULT '',        -- 住家/店面/辦公室/廠房
  budget TEXT NOT NULL DEFAULT '',
  expect_date TEXT NOT NULL DEFAULT '',          -- 希望到場時間
  contact_time TEXT NOT NULL DEFAULT '',         -- 方便聯絡時段
  content TEXT NOT NULL DEFAULT '',              -- 需求描述
  photo TEXT NOT NULL DEFAULT '',                -- 現場照片（估價更準）
  source TEXT NOT NULL DEFAULT 'website',        -- website/line/phone/facebook
  ip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','quoted','converted','closed','spam')),
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at TEXT NOT NULL DEFAULT '',
  reply_note TEXT NOT NULL DEFAULT '',           -- 客服回覆紀錄
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_enq_status ON enquiries(status);

-- 官網瀏覽計數（每日一列，供後台看流量與人氣頁）
CREATE TABLE IF NOT EXISTS web_visits (
  day TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '/',
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
