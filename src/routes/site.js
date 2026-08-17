// 公司官網：對外公開的內容 API、線上估價表單，以及後台的官網內容管理（CMS）
//
// 路由分成三層權限：
//   /api/site/*        完全公開，未登入可讀；只吐已發布的內容，不含任何客戶隱私。
//   /api/web-*         需 website 模組權限，後台維護官網內容。
//   /api/enquiries/*   需 enquiries 模組權限，處理線上估價詢問並轉成客戶／工單。
const express = require('express');
const {
  db, audit, getSetting, listSetting, today, nowStamp, nextDocNo, deleteUpload
} = require('../db');
const { requireStaff, rateLimit, clientIp } = require('../auth');
const { webUpload, deleteWebMedia } = require('../upload');

const router = express.Router();
const num = v => Math.round(Number(v) || 0);

// ================= 公開：官網內容 =================

function siteEnabled(req, res, next) {
  if (getSetting('web_enabled', '1') !== '1') return res.status(404).json({ error: '網站尚未開放' });
  next();
}

// 官網共用的公司資訊與聯絡方式
function companyInfo() {
  return {
    name: getSetting('company_name'),
    phone: getSetting('company_phone'),
    emergency_phone: getSetting('web_emergency_phone') || getSetting('company_phone'),
    fax: getSetting('company_fax'),
    email: getSetting('company_email'),
    address: getSetting('company_address'),
    tax_id: getSetting('company_tax_id'),
    business_hours: getSetting('web_business_hours'),
    service_area: getSetting('web_service_area'),
    line_id: getSetting('web_line_id'),
    line_url: getSetting('web_line_url'),
    map_url: getSetting('web_map_url'),
    brands: listSetting('web_brands')
  };
}

router.get('/site/content', siteEnabled, (req, res) => {
  const d = today();
  res.json({
    company: companyInfo(),
    texts: {
      hero_title: getSetting('web_hero_title'),
      hero_sub: getSetting('web_hero_sub'),
      hero_note: getSetting('web_hero_note'),
      about_title: getSetting('web_about_title'),
      about_body: getSetting('web_about_body'),
      quote_note: getSetting('web_quote_note'),
      footer_note: getSetting('web_footer_note')
    },
    services: db.prepare('SELECT id, name, trade, summary, body, icon, photo, price_hint FROM web_services WHERE published = 1 ORDER BY sort, id').all(),
    steps: db.prepare('SELECT step_no, title, body, icon FROM web_steps WHERE published = 1 ORDER BY sort, step_no, id').all(),
    showcases: db.prepare(`SELECT id, title, trade, category, customer_name, area, finish_date, summary, cover
      FROM web_showcases WHERE published = 1 ORDER BY sort, finish_date DESC, id DESC LIMIT 24`).all(),
    products: db.prepare('SELECT id, brand, name, model, category, spec, summary, photo, price_note FROM web_products WHERE published = 1 ORDER BY sort, brand, id LIMIT 60').all(),
    news: db.prepare(`SELECT id, title, category, summary, cover, publish_date, pinned FROM web_news
      WHERE published = 1 AND (publish_date = '' OR publish_date <= ?) AND (expire_date = '' OR expire_date >= ?)
      ORDER BY pinned DESC, publish_date DESC, id DESC LIMIT 12`).all(d, d),
    faqs: db.prepare('SELECT question, answer FROM web_faqs WHERE published = 1 ORDER BY sort, id').all(),
    // 承裝業登記對外是信任狀，只露名稱與級別，不露證號
    licenses: db.prepare("SELECT name, grade FROM company_licenses WHERE active = 1 AND (expire_date = '' OR expire_date >= ?) ORDER BY id").all(d),
    enquiry_options: {
      trades: listSetting('trades'),
      services: listSetting('order_sub_types'),
      building_types: ['住家', '公寓大廈', '店面', '辦公室', '廠房', '公共工程', '其他']
    }
  });
});

router.get('/site/showcases/:id', siteEnabled, (req, res) => {
  const s = db.prepare('SELECT * FROM web_showcases WHERE id = ? AND published = 1').get(req.params.id);
  if (!s) return res.status(404).json({ error: '找不到此實績' });
  db.prepare('UPDATE web_showcases SET views = views + 1 WHERE id = ?').run(s.id);
  s.photos = db.prepare('SELECT path, caption FROM web_showcase_photos WHERE showcase_id = ? ORDER BY sort, id').all(s.id);
  delete s.project_id;   // 內部關聯不外流
  res.json(s);
});

router.get('/site/news/:id', siteEnabled, (req, res) => {
  const n = db.prepare('SELECT * FROM web_news WHERE id = ? AND published = 1').get(req.params.id);
  if (!n) return res.status(404).json({ error: '找不到此消息' });
  db.prepare('UPDATE web_news SET views = views + 1 WHERE id = ?').run(n.id);
  res.json(n);
});

// 瀏覽計數：官網每頁載入呼叫一次，後台看得到每日流量
router.post('/site/visit', siteEnabled, (req, res) => {
  const path = String(req.body?.path || '/').slice(0, 60);
  db.prepare(`INSERT INTO web_visits (day, path, hits) VALUES (?,?,1)
    ON CONFLICT(day, path) DO UPDATE SET hits = hits + 1`).run(today(), path);
  res.json({ ok: true });
});

// ---- 線上估價（公開表單） ----

// 同一 IP 每小時的送出上限，擋自動化洗版；正常客戶不會碰到
const enquiryLimit = rateLimit({
  windowMs: 3600 * 1000,
  max: Number(getSetting('web_enquiry_max_per_hour', '5')),
  prefix: 'enq:'
});

router.post('/site/enquiry', siteEnabled, enquiryLimit, webUpload.single('photo'), (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: '請填寫您的稱呼' });
  if (!b.phone || !/^[0-9+\-() ]{8,20}$/.test(String(b.phone).trim())) {
    return res.status(400).json({ error: '請填寫正確的聯絡電話' });
  }
  // 蜜罐欄位：真人看不到也不會填，填了就是機器人
  if (b.website) return res.json({ ok: true, enq_no: '' });

  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const no = nextDocNo('EQ', today());
  db.prepare(`INSERT INTO enquiries
      (enq_no, name, phone, email, line_id, trade, service, area, address, building_type, budget,
       expect_date, contact_time, content, photo, source, ip)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(no, clip(b.name, 40), clip(b.phone, 20), clip(b.email, 80), clip(b.line_id, 40),
      clip(b.trade, 20), clip(b.service, 40), clip(b.area, 40), clip(b.address, 120),
      clip(b.building_type, 20), clip(b.budget, 40), clip(b.expect_date, 20), clip(b.contact_time, 40),
      clip(b.content, 2000), req.file ? '/web-media/' + req.file.filename : '',
      clip(b.source, 20) || 'website', clientIp(req));
  res.json({ ok: true, enq_no: no });
});

// ================= 後台：線上估價詢問處理 =================

router.get('/enquiries', requireStaff('enquiries'), (req, res) => {
  const { status = 'open', q = '', from = '', to = '' } = req.query;
  const where = [], args = [];
  if (status === 'open') where.push("e.status IN ('new','contacted','quoted')");
  else if (status) { where.push('e.status = ?'); args.push(status); }
  if (from) { where.push('e.created_at >= ?'); args.push(from); }
  if (to) { where.push('e.created_at <= ?'); args.push(to + ' 23:59'); }
  if (q) { where.push('(e.name LIKE ? OR e.phone LIKE ? OR e.content LIKE ? OR e.enq_no LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(db.prepare(`
    SELECT e.*, u.name AS handler_name, c.name AS customer_name, w.order_no, qt.quote_no
    FROM enquiries e LEFT JOIN users u ON u.id = e.handled_by
    LEFT JOIN customers c ON c.id = e.customer_id LEFT JOIN work_orders w ON w.id = e.order_id
    LEFT JOIN quotes qt ON qt.id = e.quote_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.id DESC LIMIT 300`).all(...args));
});

router.put('/enquiries/:id', requireStaff('enquiries'), (req, res) => {
  const b = req.body || {};
  const e = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '詢價單不存在' });
  db.prepare(`UPDATE enquiries SET status = ?, reply_note = ?, handled_by = ?, handled_at = ? WHERE id = ?`)
    .run(b.status || e.status, b.reply_note ?? e.reply_note, req.user.id,
      e.handled_at || nowStamp(), e.id);
  audit('staff', req.user.id, req.user.name, '處理線上詢價', e.enq_no, b.status || '');
  res.json({ ok: true });
});

router.delete('/enquiries/:id', requireStaff('enquiries'), (req, res) => {
  const e = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
  if (e && e.photo) deleteWebMedia(e.photo);
  db.prepare('DELETE FROM enquiries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 詢價 → 建立客戶並開工單（電話確認完就直接派工，不用重打一次資料）
router.post('/enquiries/:id/convert', requireStaff('enquiries'), (req, res) => {
  const e = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: '詢價單不存在' });
  if (e.order_id) return res.status(400).json({ error: '此詢價已轉出工單' });

  const out = db.transaction(() => {
    // 電話相同者視為同一位客戶，避免重複建檔
    let customerId = e.customer_id;
    if (!customerId) {
      const exist = db.prepare('SELECT id FROM customers WHERE phone = ? AND phone != \'\'').get(e.phone);
      if (exist) customerId = exist.id;
      else {
        const info = db.prepare(`INSERT INTO customers (name, kind, contact, phone, email, address, source, note)
          VALUES (?,'personal',?,?,?,?,?,?)`)
          .run(e.name, e.name, e.phone, e.email || '', e.address || e.area || '',
            '官網線上估價', `官網詢價 ${e.enq_no}`);
        customerId = info.lastInsertRowid;
      }
    }
    const appointDate = req.body?.appoint_date || e.expect_date || today();
    const no = nextDocNo('WO', appointDate);
    const wo = db.prepare(`INSERT INTO work_orders
        (order_no, type, sub_type, source, customer_id, contact, phone, address, title, symptom,
         priority, status, appoint_date, note, created_by)
        VALUES (?,?,?,'官網線上估價',?,?,?,?,?,?,?,'draft',?,?,?)`)
      .run(no, req.body?.type || 'repair', e.service || '', customerId, e.name, e.phone,
        e.address || e.area || '', e.service || '官網詢價', e.content || '',
        req.body?.priority || 'normal', appointDate,
        `由官網詢價 ${e.enq_no} 轉入${e.budget ? `　預算：${e.budget}` : ''}${e.contact_time ? `　方便聯絡：${e.contact_time}` : ''}`,
        req.user.id);
    const orderId = wo.lastInsertRowid;
    db.prepare(`UPDATE enquiries SET status = 'converted', customer_id = ?, order_id = ?,
        handled_by = ?, handled_at = ? WHERE id = ?`)
      .run(customerId, orderId, req.user.id, nowStamp(), e.id);
    return { customer_id: customerId, order_id: orderId, order_no: no };
  })();
  audit('staff', req.user.id, req.user.name, '詢價轉工單', e.enq_no, out.order_no);
  res.json(out);
});

// ================= 後台：官網內容管理 =================

// 這幾張表結構一致（都是「一批可排序、可發布的內容」），用同一組泛型端點處理，
// 免得寫五套幾乎一樣的 CRUD。欄位白名單寫死，不接受前端塞任意欄位。
const CMS_TABLES = {
  services: {
    table: 'web_services',
    fields: ['name', 'trade', 'summary', 'body', 'icon', 'photo', 'price_hint', 'sort', 'published'],
    required: 'name', media: ['photo'], order: 'sort, id'
  },
  products: {
    table: 'web_products',
    fields: ['product_id', 'brand', 'name', 'model', 'category', 'spec', 'summary', 'photo', 'price_note', 'sort', 'published'],
    required: 'name', media: ['photo'], order: 'sort, brand, id'
  },
  news: {
    table: 'web_news',
    fields: ['title', 'category', 'summary', 'body', 'cover', 'publish_date', 'expire_date', 'pinned', 'published'],
    required: 'title', media: ['cover'], order: 'pinned DESC, publish_date DESC, id DESC'
  },
  steps: {
    table: 'web_steps',
    fields: ['step_no', 'title', 'body', 'icon', 'sort', 'published'],
    required: 'title', media: [], order: 'sort, step_no, id'
  },
  faqs: {
    table: 'web_faqs',
    fields: ['question', 'answer', 'sort', 'published'],
    required: 'question', media: [], order: 'sort, id'
  },
  showcases: {
    table: 'web_showcases',
    fields: ['title', 'trade', 'category', 'customer_name', 'area', 'project_id', 'finish_date',
      'summary', 'body', 'cover', 'sort', 'published'],
    required: 'title', media: ['cover'], order: 'sort, finish_date DESC, id DESC'
  }
};

const BOOL_FIELDS = new Set(['published', 'pinned']);
const NUM_FIELDS = new Set(['sort', 'step_no', 'product_id', 'project_id']);

function cmsDef(req, res) {
  const def = CMS_TABLES[req.params.type];
  if (!def) { res.status(404).json({ error: '不支援的內容類型' }); return null; }
  return def;
}

function cmsValues(def, b, old = {}) {
  const vals = [];
  for (const f of def.fields) {
    let v = b[f];
    if (v === undefined) v = old[f];
    if (BOOL_FIELDS.has(f)) v = (v ? 1 : 0);
    else if (NUM_FIELDS.has(f)) v = (v === '' || v === null || v === undefined) ? (f === 'product_id' || f === 'project_id' ? null : 0) : Number(v) || (f.endsWith('_id') ? null : 0);
    else v = v === undefined || v === null ? '' : String(v);
    vals.push(v);
  }
  return vals;
}

router.get('/web-content/:type', requireStaff('website'), (req, res) => {
  const def = cmsDef(req, res); if (!def) return;
  const rows = db.prepare(`SELECT * FROM ${def.table} ORDER BY ${def.order}`).all();
  if (req.params.type === 'showcases') {
    const ph = db.prepare('SELECT * FROM web_showcase_photos WHERE showcase_id = ? ORDER BY sort, id');
    for (const r of rows) r.photos = ph.all(r.id);
  }
  if (req.params.type === 'products') {
    // 帶出已連結料件的顯示名稱，編輯時搜尋框才看得到目前掛的是哪一筆
    const p = db.prepare('SELECT sku, name FROM products WHERE id = ?');
    for (const r of rows) {
      if (!r.product_id) continue;
      const hit = p.get(r.product_id);
      r.product_name = hit ? `${hit.sku} ${hit.name}` : '';
    }
  }
  res.json(rows);
});

router.post('/web-content/:type', requireStaff('website'), (req, res) => {
  const def = cmsDef(req, res); if (!def) return;
  const b = req.body || {};
  if (!b[def.required]) return res.status(400).json({ error: '必填欄位未填寫' });
  const vals = cmsValues(def, b);
  const info = db.prepare(`INSERT INTO ${def.table} (${def.fields.join(',')})
    VALUES (${def.fields.map(() => '?').join(',')})`).run(...vals);
  audit('staff', req.user.id, req.user.name, '新增官網內容', req.params.type, b[def.required]);
  res.json({ id: info.lastInsertRowid });
});

router.put('/web-content/:type/:id', requireStaff('website'), (req, res) => {
  const def = cmsDef(req, res); if (!def) return;
  const old = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(req.params.id);
  if (!old) return res.status(404).json({ error: '內容不存在' });
  const vals = cmsValues(def, req.body || {}, old);
  db.prepare(`UPDATE ${def.table} SET ${def.fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`)
    .run(...vals, old.id);
  res.json({ ok: true });
});

router.delete('/web-content/:type/:id', requireStaff('website'), (req, res) => {
  const def = cmsDef(req, res); if (!def) return;
  const old = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(req.params.id);
  if (!old) return res.status(404).json({ error: '內容不存在' });
  for (const m of def.media) deleteWebMedia(old[m]);
  if (req.params.type === 'showcases') {
    for (const p of db.prepare('SELECT path FROM web_showcase_photos WHERE showcase_id = ?').all(old.id)) {
      deleteWebMedia(p.path);
    }
  }
  db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(old.id);
  audit('staff', req.user.id, req.user.name, '刪除官網內容', req.params.type, String(old.id));
  res.json({ ok: true });
});

// 官網圖片上傳：回傳可直接寫進欄位的公開路徑
router.post('/web-media', requireStaff('website'), webUpload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請選擇圖片' });
  res.json({ path: '/web-media/' + req.file.filename });
});

// 實績相簿
router.post('/web-content/showcases/:id/photos', requireStaff('website'), webUpload.array('photos', 20), (req, res) => {
  const s = db.prepare('SELECT * FROM web_showcases WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '實績不存在' });
  const ins = db.prepare('INSERT INTO web_showcase_photos (showcase_id, path, caption, sort) VALUES (?,?,?,?)');
  const paths = [];
  for (const f of (req.files || [])) {
    const web = '/web-media/' + f.filename;
    ins.run(s.id, web, '', 0);
    paths.push(web);
  }
  // 沒有封面就拿第一張當封面
  if (!s.cover && paths.length) db.prepare('UPDATE web_showcases SET cover = ? WHERE id = ?').run(paths[0], s.id);
  res.json({ paths });
});

router.delete('/web-showcase-photos/:id', requireStaff('website'), (req, res) => {
  const p = db.prepare('SELECT * FROM web_showcase_photos WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '相片不存在' });
  db.prepare('DELETE FROM web_showcase_photos WHERE id = ?').run(p.id);
  db.prepare("UPDATE web_showcases SET cover = '' WHERE id = ? AND cover = ?").run(p.showcase_id, p.path);
  deleteWebMedia(p.path);
  res.json({ ok: true });
});

// 內部工程專案 → 一鍵建立官網實績（對外名稱預設去識別化）
router.post('/web-content/showcases/from-project/:projectId', requireStaff('website'), (req, res) => {
  const p = db.prepare(`SELECT p.*, c.name AS customer_name FROM projects p
    JOIN customers c ON c.id = p.customer_id WHERE p.id = ?`).get(req.params.projectId);
  if (!p) return res.status(404).json({ error: '工程專案不存在' });
  const exist = db.prepare('SELECT id FROM web_showcases WHERE project_id = ?').get(p.id);
  if (exist) return res.status(400).json({ error: '此工程已建立過官網實績' });
  // 客戶名稱只留姓氏，地址只留到區，避免把業主資料掛上網
  const surname = (p.customer_name || '').trim().charAt(0);
  const area = (p.address || '').match(/^(.{2,3}[市縣].{2,4}[區鄉鎮市])/);
  const info = db.prepare(`INSERT INTO web_showcases
      (title, trade, category, customer_name, area, project_id, finish_date, summary, published, sort)
      VALUES (?,?,?,?,?,?,?,?,0,0)`)
    .run(p.name, p.trade, '', surname ? `${surname}先生／小姐` : '', area ? area[1] : '',
      p.id, p.finish_date || '', p.scope || '');
  audit('staff', req.user.id, req.user.name, '工程轉官網實績', p.proj_no);
  // 預設不發布，讓人先確認過內容與照片再上架
  res.json({ id: info.lastInsertRowid, published: false });
});

// 官網流量統計（後台儀表板用）
router.get('/web-stats', requireStaff('website'), (req, res) => {
  const days = db.prepare(`SELECT day, SUM(hits) AS hits FROM web_visits
    GROUP BY day ORDER BY day DESC LIMIT 30`).all();
  const pages = db.prepare(`SELECT path, SUM(hits) AS hits FROM web_visits
    WHERE day >= date('now','localtime','-30 days') GROUP BY path ORDER BY hits DESC LIMIT 20`).all();
  res.json({
    total: db.prepare('SELECT COALESCE(SUM(hits),0) v FROM web_visits').get().v,
    today: db.prepare('SELECT COALESCE(SUM(hits),0) v FROM web_visits WHERE day = ?').get(today()).v,
    days, pages,
    enquiries: {
      total: db.prepare('SELECT COUNT(*) n FROM enquiries').get().n,
      open: db.prepare("SELECT COUNT(*) n FROM enquiries WHERE status IN ('new','contacted','quoted')").get().n,
      converted: db.prepare("SELECT COUNT(*) n FROM enquiries WHERE status = 'converted'").get().n
    },
    top_showcases: db.prepare('SELECT title, views FROM web_showcases ORDER BY views DESC LIMIT 10').all(),
    top_news: db.prepare('SELECT title, views FROM web_news ORDER BY views DESC LIMIT 10').all()
  });
});

module.exports = router;
