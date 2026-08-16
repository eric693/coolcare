const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'coolcare.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');   // WAL 下安全，寫入不必每次 fsync，明顯更快
db.pragma('busy_timeout = 5000');    // 遇鎖（備份／並發寫入）先等 5 秒再報錯

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// 既有資料庫的欄位遷移（日後新增欄位時在此補上，新裝直接走 schema.sql）
function ensureColumns(table, cols) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  for (const [name, ddl] of Object.entries(cols)) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}
ensureColumns('customers', {});
// 工單：水電行的細分案由（漏水抓漏、通管、跳電檢修…），以及掛工程專案
ensureColumns('work_orders', {
  sub_type: "TEXT NOT NULL DEFAULT ''",
  project_id: 'INTEGER REFERENCES projects(id)'
});
// 設備履歷泛用化：原本只描述冷氣，補上水路與電路標的物需要的欄位
ensureColumns('equipments', {
  trade: "TEXT NOT NULL DEFAULT 'hvac'",       // water/electric/hvac/fire/weak
  pipe_material: "TEXT NOT NULL DEFAULT ''",   // 管材：PVC/不鏽鋼/PPR/銅管/鍍鋅鐵管
  pipe_size: "TEXT NOT NULL DEFAULT ''",       // 口徑：4分(15A)/6分(20A)/1吋(25A)
  breaker_spec: "TEXT NOT NULL DEFAULT ''",    // 無熔絲開關規格：2P 30A
  wire_spec: "TEXT NOT NULL DEFAULT ''",       // 線徑：2.0mm² / 5.5mm²
  meter_no: "TEXT NOT NULL DEFAULT ''"         // 電號／水號
});

// 前台可編輯文字（系統設定頁維護；清空即隱藏對應區塊）
const UI_TEXT_DEFAULTS = {
  ui_staff_login_title: 'CoolCare 冷凍空調',
  ui_staff_login_sub: '工程管理系統',
  ui_demo_staff: '展示用測試帳號\n管理員：admin / coolcare123\n技師：wang / 123456',
  ui_portal_title: 'CoolCare 客戶專區',
  ui_portal_login_sub: '線上報修、進度查詢與設備清單',
  ui_portal_login_hint: '首次登入密碼為手機末 6 碼，如無法登入請洽公司。',
  ui_demo_portal: '展示用測試帳號\n客戶：0912345678 / 345678',
  ui_repair_note: '送出後將由客服確認並回覆到場時間；如為冷房完全失效等急件，請另行來電。',
  // 官網文案（系統設定頁可改；清空即隱藏該區塊）
  web_hero_title: '水電空調一次到位',
  web_hero_sub: '給水排水、室內配線、冷氣空調　安裝｜維修｜保養',
  web_hero_note: '合格證照施工　施工保固一年　估價免費不收費',
  web_about_title: '關於我們',
  web_about_body: '在地經營多年的水電空調工程行，領有電器承裝業與自來水管承裝商登記，'
    + '承接住家、店面、辦公室與廠房的水電配管配線、衛浴設備更新、冷氣空調安裝保養。\n'
    + '所有施工由持證技師執行，用料開立明細、完工提供保固，價格事先報價、不做追加。',
  web_quote_note: '送出後我們會於營業時間內與您聯繫確認需求；急件請直接來電，我們有 24 小時緊急叫修服務。',
  web_footer_note: ''
};
const UI_TEXT_KEYS = Object.keys(UI_TEXT_DEFAULTS);

{
  // 系統參數與選項清單預設值（皆可於系統設定頁修改；清單類以逗號分隔）
  const SETTING_DEFAULTS = {
    ...UI_TEXT_DEFAULTS,
    company_name: 'CoolCare 冷凍空調工程行',
    company_tax_id: '',
    company_phone: '',
    company_fax: '',
    company_address: '',
    company_email: '',
    company_bank: '',                      // 匯款帳號（請款單列印用）
    tax_rate: '0.05',                      // 營業稅率
    // 工單
    order_types: 'repair,install,maintain,inspect,move,dismantle,other',
    order_sources: '電話,LINE,客戶專區,合約排程,現場加派,介紹',
    appoint_slots: '上午(09-12),下午(13-17),晚間(17-20),全天,指定時間',
    travel_fee_default: '500',             // 預設車馬費
    labor_rate_hour: '800',                // 標準工資（每人時）
    min_labor_fee: '800',                  // 最低收費（出勤即收）
    warranty_months_default: '12',         // 施工保固月數
    // 抽成
    commission_basis: 'profit',            // profit=毛利 / labor=工資 / revenue=營收
    commission_rate_default: '0.15',
    // 進銷存
    price_levels: 'retail,contract,wholesale',
    stock_negative: '0',                   // 是否允許負庫存出庫（0=擋下）
    low_stock_alert: '1',
    product_kinds: 'machine,part,consumable,tool,service',
    units: '台,組,個,支,米,公斤,罐,桶,式,小時',
    // 冷媒
    refrigerants: 'R32,R410A,R22,R134a,R404A,R407C,R290,R600a',
    refrigerant_alert_kg: '3',             // 單次充填超過此量列入重點申報提醒
    // 設備
    equipment_categories: '分離式冷氣,窗型冷氣,箱型冷氣,吊隱式冷氣,多聯式VRV,冰水主機,冷卻水塔,冷凍庫,冷藏庫,冷藏櫃,製冰機,風管/排風,空氣清淨,'
      + '電熱水器,瓦斯熱水器,加壓馬達,抽水馬達,水塔,淨水設備,軟水設備,污水泵浦,'
      + '配電盤,總開關箱,分電箱,電錶,發電機,不斷電系統UPS,照明設備,對講機,監視系統,消防幫浦,其他',
    power_specs: '110V 1φ,220V 1φ,220V 3φ,380V 3φ',
    // 保養檢查表預設項目（依機種，格式：機種|項目1;項目2）
    check_items_default: '室內機濾網清洗;室內機蒸發器清洗;排水管疏通測試;室外機冷凝器清洗;風扇馬達運轉;壓縮機電流量測;高低壓壓力量測;出風口溫度量測;電控箱端子鎖固;冷媒洩漏檢查;機體固定與避震;運轉異音檢查',
    // 帳務
    payment_terms: '現金,月結30天,月結60天,月結90天,工程分期,貨到付款',
    pay_methods: '現金,匯款,支票,信用卡,LINE Pay,街口支付,其他',
    invoice_due_days: '30',
    // 工程專案（水電承攬案）
    project_kinds: 'new,renovate,repair,addition,maintain,other',
    trades: 'water,electric,hvac,fire,weak,mixed',
    retention_rate_default: '0.05',         // 業主保留款比例（估驗計價每期扣留）
    project_warranty_months: '12',          // 工程保固月數（消保法定型化契約常見一年）
    // 分包工班與勞務給付
    worker_types: '大工,小工,技師,學徒,臨時工,監工',
    day_rate_default: '2800',               // 點工日薪預設（大工行情）
    sub_retention_rate: '0.05',             // 對工班扣留的保留款
    wht_rate: '0.10',                       // 個人執行業務／勞務報酬扣繳率
    wht_threshold: '20010',                 // 單次給付未達此額免扣繳（薪資所得扣繳起扣點）
    nhi_rate: '0.0211',                     // 二代健保補充保費費率
    nhi_threshold: '20000',                 // 單次給付達此額才計收補充保費
    // 工項單價庫
    unit_price_categories: '給水配管,排水配管,衛生設備,熱水設備,加壓馬達,水塔,電氣配線,開關插座,照明燈具,配電盤,弱電網路,對講門禁,空調配管,冷氣安裝,拆除復原,泥作修補',
    unit_price_units: '米,處,口,組,只,樘,台,式,坪,天',
    // 報驗申報
    filing_kinds: '台電竣工報驗,台電新設用電申請,用電設備檢驗維護申報,自來水配管報驗,自來水新設用水申請,消防安全設備查驗,建管室內裝修審查,冷媒 F-gas 申報,污水設備申報',
    filing_authorities: '台灣電力公司,自來水事業處,消防局,建管處,環保局',
    filing_alert_days: '30',                // 報驗到期／複驗提醒天數
    company_license_alert_days: '90',       // 公司承裝業登記換證提醒天數
    // 官網
    web_enabled: '1',                       // 是否對外開放官網
    web_business_hours: '09:00 - 21:00（例假日照常）',
    web_service_area: '全台北市、新北市；其他縣市請來電洽詢',
    web_line_id: '',                        // LINE 官方帳號 ID（加好友按鈕）
    web_line_url: '',                       // LINE 加好友連結
    web_map_url: '',                        // Google 地圖連結
    web_emergency_phone: '',                // 24 小時緊急叫修專線（留空則用公司電話）
    web_brands: '',                         // 代理／常用品牌，逗號分隔
    web_enquiry_max_per_hour: '5',          // 同一 IP 每小時可送出的估價單數（防洗版）
    // 其他
    priority_options: 'urgent,high,normal,low',
    order_sub_types: '漏水抓漏,管路阻塞疏通,馬桶更換,水龍頭更換,熱水器安裝,加壓馬達更換,水塔清洗,跳電檢修,電線更換,插座迴路增設,配電盤檢修,照明更換,電熱水器,冷氣安裝,冷氣保養,其他',
    audit_retention_days: '730',
    contract_alert_days: '60',             // 保養約到期前提醒天數
    warranty_alert_days: '30',             // 設備保固到期前提醒天數
    service_due_alert_days: '14',          // 下次保養到期前提醒天數
    license_alert_days: '60'               // 技師證照到期提醒天數
  };
  const has = db.prepare('SELECT 1 FROM settings WHERE key = ?');
  const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) {
    if (!has.get(k)) ins.run(k, v);
  }
}

// 系統簽章密鑰（首次啟動自動產生）
const secretFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, require('crypto').randomBytes(48).toString('hex'), { mode: 0o600 });
}
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
function listSetting(key, fallback = '') {
  return getSetting(key, fallback).split(',').map(s => s.trim()).filter(Boolean);
}

function deleteUpload(webPath) {
  if (!webPath || !String(webPath).startsWith('/uploads/')) return;
  const file = path.join(__dirname, '..', 'uploads', path.basename(webPath));
  fs.unlink(file, () => {});
}

function audit(actorType, actorId, actorName, action, target = '', detail = '') {
  db.prepare('INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, target, detail) VALUES (?,?,?,?,?,?)')
    .run(actorType, actorId, actorName, action, target, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function nowStamp() { return `${today()} ${nowTime()}`; }
function thisMonth() { return today().slice(0, 7); }

// 日期加減（回傳 YYYY-MM-DD）
function addDays(dateStr, days) {
  const d = new Date(dateStr || today());
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addMonths(dateStr, months) {
  const d = new Date(dateStr || today());
  if (isNaN(d)) return '';
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Number(months || 0));
  // 月底溢位處理：3/31 + 1 月 → 4/30
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  const d1 = new Date(a), d2 = new Date(b || today());
  if (isNaN(d1) || isNaN(d2)) return null;
  return Math.round((d1 - d2) / 86400000);
}

// 單號產生：PREFIX-YYYYMM-0001，同前綴同月份遞增
const nextDocNo = db.transaction((prefix, date) => {
  const period = (date || today()).slice(0, 7).replace('-', '');
  db.prepare('INSERT INTO doc_counters (prefix, period, seq) VALUES (?,?,0) ON CONFLICT(prefix, period) DO NOTHING')
    .run(prefix, period);
  db.prepare('UPDATE doc_counters SET seq = seq + 1 WHERE prefix = ? AND period = ?').run(prefix, period);
  const { seq } = db.prepare('SELECT seq FROM doc_counters WHERE prefix = ? AND period = ?').get(prefix, period);
  return `${prefix}-${period}-${String(seq).padStart(4, '0')}`;
});

// 稅額計算：exclusive=未稅另加、inclusive=含稅內含、free=免稅
function calcTax(amount, mode) {
  const rate = Number(getSetting('tax_rate', '0.05'));
  const amt = Math.round(Number(amount) || 0);
  if (mode === 'free') return { net: amt, tax: 0, total: amt };
  if (mode === 'inclusive') {
    const net = Math.round(amt / (1 + rate));
    return { net, tax: amt - net, total: amt };
  }
  const tax = Math.round(amt * rate);
  return { net: amt, tax, total: amt + tax };
}

module.exports = {
  db, SECRET, getSetting, setSetting, listSetting, audit, deleteUpload,
  today, nowTime, nowStamp, thisMonth, addDays, addMonths, daysBetween,
  nextDocNo, calcTax, UI_TEXT_KEYS
};
