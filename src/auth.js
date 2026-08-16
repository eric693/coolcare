const jwt = require('jsonwebtoken');
const { db, SECRET } = require('./db');

const STAFF_COOKIE = 'cc_staff';
const PORTAL_COOKIE = 'cc_portal';
const TOKEN_TTL = '7d';

// 模組權限清單（staff 帳號逐一勾選；admin 全開）
const MODULES = [
  { key: 'orders', label: '派工單與行事曆' },
  { key: 'dispatch', label: '派工看板（指派技師）' },
  { key: 'customers', label: '客戶與服務地點' },
  { key: 'equipments', label: '設備履歷' },
  { key: 'contracts', label: '保養合約' },
  { key: 'quotes', label: '報價單' },
  { key: 'inventory', label: '庫存與料件' },
  { key: 'purchase', label: '採購進貨' },
  { key: 'sales', label: '銷貨出庫' },
  { key: 'stocktake', label: '盤點' },
  { key: 'billing', label: '請款與收付款' },
  { key: 'commission', label: '技師抽成' },
  { key: 'refrigerant', label: '冷媒管制紀錄' },
  { key: 'announcements', label: '公告' },
  { key: 'reports', label: '報表匯出' },
  { key: 'users', label: '帳號權限' },
  { key: 'settings', label: '系統設定' }
];
const MODULE_KEYS = MODULES.map(m => m.key);

// 技師預設權限：只給日常出工需要的模組
const TECH_DEFAULT_MODULES = ['orders', 'customers', 'equipments', 'inventory', 'refrigerant', 'announcements'];

// 登入暴力嘗試防護：同一帳號連續失敗 5 次鎖定 15 分鐘（重啟即重置）
const loginAttempts = new Map();
const LOGIN_MAX_FAILS = 5, LOGIN_LOCK_MS = 15 * 60 * 1000;
function loginLockedMinutes(key) {
  const a = loginAttempts.get(key);
  if (a && a.lockedUntil && a.lockedUntil > Date.now()) return Math.ceil((a.lockedUntil - Date.now()) / 60000);
  return 0;
}
function loginFailed(key) {
  if (loginAttempts.size > 10000) loginAttempts.clear();
  const a = loginAttempts.get(key) || { fails: 0 };
  a.fails++;
  if (a.fails >= LOGIN_MAX_FAILS) { a.lockedUntil = Date.now() + LOGIN_LOCK_MS; a.fails = 0; }
  loginAttempts.set(key, a);
}
function loginSucceeded(key) { loginAttempts.delete(key); }

// 真實客戶端 IP：服務跑在 nginx 後方，req.ip 一律是 127.0.0.1
function clientIp(req) {
  return (req.headers['x-real-ip'] || '').trim()
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

// 通用限流：僅用於未登入的攻擊面（登入），不套一般 API，避免整間公司共用對外 IP 被誤擋
function rateLimit({ windowMs, max, prefix = '' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = prefix + clientIp(req);
    if (hits.size > 20000) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }
    let e = hits.get(key);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
    }
    next();
  };
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function signToken(payload) { return jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL }); }

function setAuthCookie(res, name, token) {
  res.setHeader('Set-Cookie', `${name}=${token}; HttpOnly; Path=/; Max-Age=${7 * 86400}; SameSite=Lax`);
}
function clearAuthCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function parsePermissions(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(k => MODULE_KEYS.includes(k)) : [];
  } catch { return []; }
}

// 員工驗證：requireStaff() 任一登入員工；requireStaff('orders') 需具該模組權限（admin 一律通過）
function requireStaff(moduleKey) {
  return (req, res, next) => {
    const token = parseCookies(req)[STAFF_COOKIE];
    if (!token) return res.status(401).json({ error: '請先登入' });
    let payload;
    try { payload = jwt.verify(token, SECRET); } catch { return res.status(401).json({ error: '登入已過期，請重新登入' }); }
    if (payload.t !== 'staff') return res.status(401).json({ error: '請先登入' });
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.id);
    if (!user) return res.status(401).json({ error: '帳號不存在或已停用' });
    req.user = user;
    req.userModules = user.role === 'admin' ? MODULE_KEYS : parsePermissions(user.permissions);
    if (moduleKey && user.role !== 'admin' && !req.userModules.includes(moduleKey)) {
      return res.status(403).json({ error: '無此模組使用權限' });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  requireStaff()(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
    next();
  });
}

// 任一登入者（員工或客戶）：/uploads 檔案存取用
function requireAnyUser(req, res, next) {
  const cookies = parseCookies(req);
  for (const [name, type] of [[STAFF_COOKIE, 'staff'], [PORTAL_COOKIE, 'customer']]) {
    const token = cookies[name];
    if (!token) continue;
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload.t === type) return next();
    } catch { /* 換下一種 cookie */ }
  }
  res.status(403).json({ error: '請先登入' });
}

// 客戶端驗證
function requireCustomer(req, res, next) {
  const token = parseCookies(req)[PORTAL_COOKIE];
  if (!token) return res.status(401).json({ error: '請先登入' });
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch { return res.status(401).json({ error: '登入已過期，請重新登入' }); }
  if (payload.t !== 'customer') return res.status(401).json({ error: '請先登入' });
  const cu = db.prepare('SELECT * FROM customer_users WHERE id = ? AND active = 1').get(payload.id);
  if (!cu) return res.status(401).json({ error: '帳號不存在或已停用' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(cu.customer_id);
  if (!customer) return res.status(401).json({ error: '客戶資料已停用' });
  req.cu = cu;
  req.customer = customer;
  next();
}

module.exports = {
  MODULES, MODULE_KEYS, TECH_DEFAULT_MODULES, STAFF_COOKIE, PORTAL_COOKIE,
  signToken, setAuthCookie, clearAuthCookie, parsePermissions,
  requireStaff, requireAdmin, requireCustomer, requireAnyUser,
  loginLockedMinutes, loginFailed, loginSucceeded, rateLimit, clientIp
};
