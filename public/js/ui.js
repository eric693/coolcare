// UI 共用元件：跳出視窗、提示、表格、表單欄位
const UI = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  toast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, isError ? 3600 : 2200);
  },
  err(e) { UI.toast(e && e.message ? e.message : String(e), true); },

  // 開啟 Modal；onSubmit 回傳 false 可阻止關閉
  modal({ title, body, wide, submitText = '儲存', onSubmit, onOpen, hideFooter }) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal${wide ? ' wide' : ''}">
        <div class="modal-head"><h3>${UI.esc(title)}</h3><button class="close" type="button">&times;</button></div>
        <div class="modal-body"></div>
        ${hideFooter ? '' : `<div class="modal-foot">
          <button class="btn secondary" data-act="cancel" type="button">取消</button>
          <button class="btn" data-act="ok" type="button">${UI.esc(submitText)}</button>
        </div>`}
      </div>`;
    const bodyEl = mask.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const close = () => mask.remove();
    mask.querySelector('.close').onclick = close;
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
    if (!hideFooter) {
      mask.querySelector('[data-act="cancel"]').onclick = close;
      mask.querySelector('[data-act="ok"]').onclick = async () => {
        const btn = mask.querySelector('[data-act="ok"]');
        btn.disabled = true;
        try {
          const r = onSubmit ? await onSubmit(bodyEl, close) : true;
          if (r !== false) close();
        } catch (e) { UI.err(e); }
        btn.disabled = false;
      };
    }
    document.body.appendChild(mask);
    if (onOpen) onOpen(bodyEl, close);
    return { close, body: bodyEl };
  },

  confirm(msg) {
    return new Promise(resolve => {
      const m = UI.modal({
        title: '確認操作', hideFooter: true,
        body: `<p style="font-size:15px">${UI.esc(msg)}</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
            <button class="btn secondary" data-c="no" type="button">取消</button>
            <button class="btn" data-c="yes" type="button">確定</button>
          </div>`
      });
      m.body.querySelector('[data-c=no]').onclick = () => { m.close(); resolve(false); };
      m.body.querySelector('[data-c=yes]').onclick = () => { m.close(); resolve(true); };
    });
  },

  // ---- 表單欄位產生器 ----
  input(name, label, opts = {}) {
    const { type = 'text', value = '', placeholder = '', required = false, full = false, step, readonly } = opts;
    return `<div class="form-row${full ? ' full' : ''}">
      <label>${UI.esc(label)}${required ? ' *' : ''}</label>
      <input name="${name}" type="${type}" value="${UI.esc(value)}" placeholder="${UI.esc(placeholder)}"${step ? ` step="${step}"` : ''}${readonly ? ' readonly' : ''}>
    </div>`;
  },
  select(name, label, options, opts = {}) {
    const { value = '', full = false } = opts;
    const inner = options.map(o => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${UI.esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${UI.esc(t)}</option>`;
    }).join('');
    return `<div class="form-row${full ? ' full' : ''}"><label>${UI.esc(label)}</label><select name="${name}">${inner}</select></div>`;
  },
  inputList(name, label, options, opts = {}) {
    const { value = '', placeholder = '', required = false, full = false } = opts;
    const listId = `dl-${name}-${Math.random().toString(36).slice(2, 7)}`;
    return `<div class="form-row${full ? ' full' : ''}">
      <label>${UI.esc(label)}${required ? ' *' : ''}</label>
      <input name="${name}" list="${listId}" value="${UI.esc(value)}" placeholder="${UI.esc(placeholder)}">
      <datalist id="${listId}">${options.map(o => `<option value="${UI.esc(o)}"></option>`).join('')}</datalist>
    </div>`;
  },
  textarea(name, label, opts = {}) {
    const { value = '', full = true, placeholder = '', rows } = opts;
    return `<div class="form-row${full ? ' full' : ''}"><label>${UI.esc(label)}</label>
      <textarea name="${name}"${rows ? ` rows="${rows}"` : ''} placeholder="${UI.esc(placeholder)}">${UI.esc(value)}</textarea></div>`;
  },
  checkbox(name, label, checked, opts = {}) {
    return `<div class="form-row${opts.full ? ' full' : ''}"><label>&nbsp;</label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:400">
        <input type="checkbox" name="${name}"${checked ? ' checked' : ''} style="width:auto">${UI.esc(label)}</label></div>`;
  },
  formData(el) {
    const out = {};
    el.querySelectorAll('input[name], select[name], textarea[name]').forEach(i => {
      out[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
    });
    return out;
  },

  table(headers, rowsHtml, emptyMsg = '目前沒有資料') {
    if (!rowsHtml.length) return `<div class="empty">${UI.esc(emptyMsg)}</div>`;
    return `<div class="table-wrap"><table class="list">
      <thead><tr>${headers.map(h => `<th>${UI.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml.join('')}</tbody></table></div>`;
  },

  tag(text, cls = '') { return `<span class="tag ${cls}">${UI.esc(text)}</span>`; },

  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  thisMonth() { return UI.today().slice(0, 7); },
  addDays(dateStr, n) {
    const d = new Date(dateStr || UI.today());
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  money(n) { return 'NT$ ' + Math.round(Number(n) || 0).toLocaleString('zh-TW'); },
  num(n) { return Number(n || 0).toLocaleString('zh-TW'); },

  // 手寫簽名板（工單客戶簽收用）
  signaturePad(canvas) {
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = (canvas.offsetHeight || 160) * 2;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#123';
    let drawing = false, drawn = false;
    const pos = e => {
      const p = e.touches ? e.touches[0] : e;
      const r = canvas.getBoundingClientRect();
      return [(p.clientX - r.left) * (canvas.width / r.width), (p.clientY - r.top) * (canvas.height / r.height)];
    };
    const start = e => { drawing = true; drawn = true; ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); };
    const move = e => { if (drawing) { ctx.lineTo(...pos(e)); ctx.stroke(); e.preventDefault(); } };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', () => { drawing = false; });
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', () => { drawing = false; });
    return {
      drawn: () => drawn,
      clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; },
      dataUrl: () => (drawn ? canvas.toDataURL('image/png') : '')
    };
  },

  // 料件搜尋選擇器：輸入關鍵字即時查料號/品名，選定後回呼
  async productPicker(inputEl, onPick, opts = {}) {
    const box = document.createElement('div');
    box.className = 'picker-box';
    inputEl.parentNode.style.position = 'relative';
    inputEl.parentNode.appendChild(box);
    let timer;
    const search = async () => {
      const q = inputEl.value.trim();
      if (q.length < 1) { box.innerHTML = ''; box.classList.remove('show'); return; }
      try {
        const rows = await GET('/products?q=' + encodeURIComponent(q) + (opts.kind ? '&kind=' + opts.kind : ''));
        box.innerHTML = rows.slice(0, 20).map(p => `
          <div class="picker-item" data-id="${p.id}">
            <strong>${UI.esc(p.name)}</strong> <span style="color:var(--muted)">${UI.esc(p.spec)}</span>
            <div style="font-size:12px;color:var(--muted)">${UI.esc(p.sku)}　庫存 ${p.qty} ${UI.esc(p.unit)}　售價 ${UI.money(p.price_retail)}</div>
          </div>`).join('') || '<div class="picker-item">查無料件</div>';
        box.classList.add('show');
        box.querySelectorAll('[data-id]').forEach(el => {
          el.onclick = () => {
            const p = rows.find(r => r.id === Number(el.dataset.id));
            box.innerHTML = ''; box.classList.remove('show');
            onPick(p);
          };
        });
      } catch { /* 忽略搜尋錯誤 */ }
    };
    inputEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    inputEl.addEventListener('blur', () => setTimeout(() => box.classList.remove('show'), 200));
    inputEl.addEventListener('focus', search);
  },

  // 客戶搜尋選擇器
  async customerPicker(inputEl, onPick) {
    const box = document.createElement('div');
    box.className = 'picker-box';
    inputEl.parentNode.style.position = 'relative';
    inputEl.parentNode.appendChild(box);
    let timer;
    const search = async () => {
      const q = inputEl.value.trim();
      try {
        const rows = await GET('/customers?q=' + encodeURIComponent(q));
        box.innerHTML = rows.slice(0, 20).map(c => `
          <div class="picker-item" data-id="${c.id}">
            <strong>${UI.esc(c.name)}</strong>
            <div style="font-size:12px;color:var(--muted)">${UI.esc(c.phone || '')}　${UI.esc(c.address || '')}</div>
          </div>`).join('') || '<div class="picker-item">查無客戶</div>';
        box.classList.add('show');
        box.querySelectorAll('[data-id]').forEach(el => {
          el.onclick = () => {
            const c = rows.find(r => r.id === Number(el.dataset.id));
            box.innerHTML = ''; box.classList.remove('show');
            onPick(c);
          };
        });
      } catch { /* 忽略 */ }
    };
    inputEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    inputEl.addEventListener('blur', () => setTimeout(() => box.classList.remove('show'), 200));
    inputEl.addEventListener('focus', search);
  }
};

// 常用中文對照
const TW = {
  order_type: { repair: '維修', install: '安裝', maintain: '保養', inspect: '檢測', move: '移機', dismantle: '拆機', other: '其他' },
  order_status: {
    draft: '待派工', assigned: '已派工', departed: '已出發', working: '施工中',
    done: '已完工', confirmed: '客戶已確認', billed: '已請款', cancelled: '已取消'
  },
  status_cls: {
    draft: 'warn', assigned: 'primary', departed: 'primary', working: 'primary',
    done: 'ok', confirmed: 'ok', billed: '', cancelled: 'danger'
  },
  priority: { urgent: '急件', high: '優先', normal: '一般', low: '低' },
  priority_cls: { urgent: 'danger', high: 'warn', normal: '', low: '' },
  equip_status: { active: '使用中', repair: '維修中', scrapped: '已報廢' },
  contract_status: { active: '生效中', expired: '已到期', terminated: '已終止' },
  product_kind: { machine: '主機', part: '零件', consumable: '耗材', tool: '工具', service: '服務項目' },
  warehouse_kind: { main: '公司倉', vehicle: '工程車', site: '工地暫存' },
  po_status: { draft: '草稿', ordered: '已訂購', received: '已進貨', cancelled: '已取消' },
  so_status: { draft: '草稿', shipped: '已出貨', cancelled: '已取消' },
  quote_status: { draft: '草稿', sent: '已送出', accepted: '已成交', rejected: '未成交', expired: '已過期' },
  inv_status: { unpaid: '未收款', partial: '部分收款', paid: '已收款', void: '已作廢' },
  inv_cls: { unpaid: 'warn', partial: 'warn', paid: 'ok', void: 'danger' },
  move_kind: {
    purchase: '採購進貨', purchase_return: '採購退貨', sale: '銷貨出庫', sale_return: '銷貨退回',
    issue: '工單領料', issue_return: '工單退料', transfer_in: '調撥入庫', transfer_out: '調撥出庫', adjust: '盤點調整'
  },
  check_result: { ok: '正常', fix: '已處理', ng: '異常', na: '不適用' },
  check_cls: { ok: 'ok', fix: 'primary', ng: 'danger', na: '' },
  ref_action: { charge: '充填', recover: '回收', leak: '洩漏', dispose: '銷毀' },
  comm_status: { pending: '未結', settled: '已結算', void: '作廢' },
  tax_mode: { exclusive: '未稅另加 5%', inclusive: '金額已含稅', free: '免稅' },
  price_level: { retail: '零售價', contract: '合約價', wholesale: '同業價' },
  photo_stage: { before: '施工前', during: '施工中', after: '施工後', fault: '故障點', other: '其他' },
  stocktake_status: { open: '盤點中', closed: '已結案', cancelled: '已取消' },

  // ---- 水電工程 ----
  trade: { water: '給水排水', electric: '電氣配線', hvac: '空調冷凍', fire: '消防', weak: '弱電', mixed: '綜合水電' },
  project_kind: { new: '新建工程', renovate: '裝修翻新', repair: '修繕', addition: '增設', maintain: '維護', other: '其他' },
  project_status: {
    draft: '未開工', ongoing: '施工中', paused: '暫停', completed: '已完工',
    accepted: '已驗收', settled: '已結案', cancelled: '已取消'
  },
  project_cls: {
    draft: 'warn', ongoing: 'primary', paused: 'warn', completed: 'ok',
    accepted: 'ok', settled: '', cancelled: 'danger'
  },
  billing_kind: { deposit: '訂金', progress: '估驗計價', final: '尾款', retention: '保留款退還' },
  pbill_status: { draft: '草稿', confirmed: '已確認', billed: '已請款', cancelled: '已取消' },
  change_status: { draft: '待簽認', approved: '已核准', rejected: '未核准' },
  sc_status: { draft: '草稿', signed: '已簽約', working: '施工中', done: '已完工', settled: '已結案', cancelled: '已取消' },
  scb_status: { draft: '草稿', confirmed: '待付款', paid: '已付清', cancelled: '已取消' },
  pay_kind: { lump: '總價承包', unit: '單價計量', daily: '點工計酬' },
  filing_result: {
    pending: '待送件', applied: '已送件', inspecting: '審查中',
    passed: '合格', failed: '不合格', fixed: '已改善', cancelled: '已撤案'
  },
  filing_cls: {
    pending: 'warn', applied: 'primary', inspecting: 'primary',
    passed: 'ok', failed: 'danger', fixed: 'ok', cancelled: ''
  },
  up_field: {
    price: '報價單價', labor_price: '工資單價', material_price: '材料單價',
    cost: '成本單價', sub_price: '發包單價'
  },

  // ---- 官網 ----
  enq_status: {
    new: '新進', contacted: '已聯絡', quoted: '已報價',
    converted: '已成案', closed: '已結案', spam: '無效詢問'
  },
  enq_cls: { new: 'danger', contacted: 'warn', quoted: 'primary', converted: 'ok', closed: '', spam: '' }
};
