const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { db, audit, getSetting, UI_TEXT_KEYS } = require('./db');
const {
  STAFF_COOKIE, signToken, setAuthCookie, clearAuthCookie,
  requireStaff, requireAnyUser, parsePermissions, MODULE_KEYS,
  loginLockedMinutes, loginFailed, loginSucceeded, rateLimit
} = require('./auth');

// 未登入攻擊面的 IP 限流：帳號鎖定是針對單一帳號，這裡再擋跨帳號的分散式猜測
const loginRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, prefix: 'login:' });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));

// ---- 公開端點：前台文字（登入頁需要，不驗證） ----

app.get('/api/public/ui-texts', (req, res) => {
  const out = {
    company_name: getSetting('company_name', 'CoolCare 冷凍空調工程行'),
    company_phone: getSetting('company_phone'),
    company_address: getSetting('company_address')
  };
  for (const k of UI_TEXT_KEYS) out[k] = getSetting(k);
  res.json(out);
});

// ---- 員工登入 ----

app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const lockKey = `staff:${username || ''}`;
  const locked = loginLockedMinutes(lockKey);
  if (locked) return res.status(429).json({ error: `登入失敗次數過多，請 ${locked} 分鐘後再試` });
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    loginFailed(lockKey);
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  loginSucceeded(lockKey);
  setAuthCookie(res, STAFF_COOKIE, signToken({ t: 'staff', id: user.id }));
  audit('staff', user.id, user.name, '員工登入');
  res.json({ id: user.id, name: user.name, role: user.role });
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res, STAFF_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', requireStaff(), (req, res) => {
  res.json({
    id: req.user.id, username: req.user.username, name: req.user.name,
    role: req.user.role, title: req.user.title, is_tech: req.user.is_tech,
    modules: req.user.role === 'admin' ? MODULE_KEYS : parsePermissions(req.user.permissions),
    company_name: getSetting('company_name', 'CoolCare 冷凍空調工程行')
  });
});

app.put('/api/me/password', requireStaff(), (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!bcrypt.compareSync(old_password || '', req.user.password_hash)) {
    return res.status(400).json({ error: '舊密碼不正確' });
  }
  if (!new_password || String(new_password).length < 6) return res.status(400).json({ error: '新密碼至少 6 碼' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(new_password), 10), req.user.id);
  audit('staff', req.user.id, req.user.name, '修改自己的密碼');
  res.json({ ok: true });
});

// ---- 各模組路由 ----

app.use('/api/portal', require('./routes/portal'));
app.use('/api', require('./routes/site'));      // 官網公開內容需早於需登入的路由
app.use('/api', require('./routes/org'));
app.use('/api', require('./routes/customers'));
app.use('/api', require('./routes/orders'));
app.use('/api', require('./routes/inventory'));
app.use('/api', require('./routes/billing'));
app.use('/api', require('./routes/projects'));
app.use('/api', require('./routes/trade'));
app.use('/api', require('./routes/exports'));

// ---- 靜態檔案 ----

// 上傳檔（施工照片、報驗掃描件）僅限已登入的員工或客戶存取
app.use('/uploads', requireAnyUser, express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '7d' }));
// public/web-media 是官網素材，由下面的靜態中介直接公開（訪客要看得到實績照片）
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

app.use('/api', (req, res) => res.status(404).json({ error: '找不到此 API' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '檔案過大（單張上限 12MB）' });
  res.status(500).json({ error: '系統發生錯誤，請稍後再試' });
});

// ---- 每日維護：資料庫備份（保留 14 份）與稽核軌跡保留期清理 ----

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
// 異地鏡像：預設放在專案目錄外，專案目錄若被清空/誤刪仍保有一份
const BACKUP_MIRROR = process.env.COOLCARE_BACKUP_MIRROR !== undefined
  ? process.env.COOLCARE_BACKUP_MIRROR
  : '/root/backups/coolcare';
const BACKUP_KEEP = 14;

function unlinkBackup(dir, dbName) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(path.join(dir, dbName + suffix)); } catch { /* 不存在即略過 */ }
  }
}

function sweepBackupDir(dir) {
  if (!fs.existsSync(dir)) return;
  const all = fs.readdirSync(dir);
  const dbs = all.filter(f => /^coolcare-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  while (dbs.length > BACKUP_KEEP) unlinkBackup(dir, dbs.shift());
  const kept = new Set(dbs);
  for (const f of all) {
    const m = f.match(/^(coolcare-\d{4}-\d{2}-\d{2}\.db)-(wal|shm)$/);
    if (!m) continue;
    const p = path.join(dir, f);
    let drop = !kept.has(m[1]) || m[2] === 'shm';
    if (!drop && m[2] === 'wal') { try { drop = fs.statSync(p).size === 0; } catch { drop = true; } }
    if (drop) { try { fs.unlinkSync(p); } catch { /* 略過 */ } }
  }
}

async function dailyMaintenance() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date();
    const name = `coolcare-${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}.db`;
    const dest = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(dest)) {
      await db.backup(dest);
      console.log(`資料庫已備份：${dest}`);
      if (BACKUP_MIRROR) {
        try {
          fs.mkdirSync(BACKUP_MIRROR, { recursive: true });
          fs.copyFileSync(dest, path.join(BACKUP_MIRROR, name));
          sweepBackupDir(BACKUP_MIRROR);
        } catch (e) { console.error('異地備份失敗：', e.message); }
      }
    }
    sweepBackupDir(BACKUP_DIR);
    const retention = Number(getSetting('audit_retention_days', '730'));
    if (retention > 0) {
      db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now','localtime',?)").run(`-${retention} days`);
    }
    // 合約到期自動標記，免得清單一直掛著已失效的約
    db.prepare("UPDATE service_contracts SET status = 'expired' WHERE status = 'active' AND end_date != '' AND end_date < date('now','localtime')").run();
  } catch (e) { console.error('每日維護作業失敗：', e.message); }
}
dailyMaintenance();
setInterval(dailyMaintenance, 6 * 3600 * 1000);   // 每 6 小時檢查，一天只備份一次

const PORT = process.env.PORT || 3330;
app.listen(PORT, () => {
  console.log(`公司官網　　http://localhost:${PORT}/`);
  console.log(`員工管理系統 http://localhost:${PORT}/admin.html`);
  console.log(`客戶專區　　http://localhost:${PORT}/portal.html`);
});
