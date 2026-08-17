// 客戶專區：登入、線上報修、進度查詢、我的設備、帳單
// 共用 api.js / ui.js，但與員工端各自獨立（cookie 也不同）

const TWP = {
  order_type: { repair: '維修', install: '安裝', maintain: '保養', inspect: '檢測', move: '移機', dismantle: '拆機', other: '其他' },
  status_cls: {
    draft: 'warn', assigned: 'primary', departed: 'primary', working: 'primary',
    done: 'ok', confirmed: 'ok', billed: '', cancelled: 'danger'
  },
  inv_status: { unpaid: '未付款', partial: '部分付款', paid: '已付清', void: '已作廢' },
  inv_cls: { unpaid: 'warn', partial: 'warn', paid: 'ok', void: 'danger' },
  equip_status: { active: '使用中', repair: '維修中', scrapped: '已報廢' },
  check_result: { ok: '正常', fix: '已處理', ng: '異常', na: '不適用' },
  photo_stage: { before: '施工前', during: '施工中', after: '施工後', fault: '故障點', other: '其他' }
};

const Portal = {
  me: null,
  texts: {},
  tabs: [
    ['home', '首頁'], ['repair', '線上報修'], ['orders', '維修進度'],
    ['projects', '我的工程'], ['equipments', '我的設備'], ['invoices', '帳單']
  ],

  // api.js 在 401 時會呼叫 App.onUnauthorized
  onUnauthorized() { if (Portal.me) { Portal.me = null; Portal.renderLogin(); } },

  async boot() {
    Portal.texts = await GET('/public/ui-texts').catch(() => ({}));
    try {
      Portal.me = await GET('/portal/me');
      Portal.renderLayout();
      Portal.go(location.hash.slice(1) || 'home');
      if (Portal.me.must_change_password) Portal.passwordDialog(true);
    } catch {
      Portal.renderLogin();
    }
    window.addEventListener('hashchange', () => {
      if (Portal.me) Portal.go(location.hash.slice(1) || 'home');
    });
  },

  noticeBox(text) {
    if (!text) return '';
    const lines = String(text).split('\n').map(UI.esc);
    const first = lines.shift();
    return `<div style="margin-top:14px;padding:12px;background:var(--primary-light);border-radius:8px;font-size:13px;line-height:1.8">
      <strong>${first}</strong>${lines.length ? '<br>' + lines.join('<br>') : ''}</div>`;
  },

  renderLogin() {
    const t = Portal.texts;
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <h1>${UI.esc(t.ui_portal_title || 'CoolCare 客戶專區')}</h1>
          <div class="sub">${UI.esc(t.ui_portal_login_sub || '線上報修、進度查詢與設備清單')}</div>
          <div class="form-row"><label>手機號碼</label><input id="lg-phone" inputmode="numeric" autocomplete="username"></div>
          <div class="form-row"><label>密碼</label><input id="lg-pass" type="password" autocomplete="current-password"></div>
          <button class="btn" id="lg-btn">登入</button>
          <div class="login-err" id="lg-err"></div>
          ${t.ui_portal_login_hint ? `<div style="margin-top:12px;font-size:13px;color:var(--muted);line-height:1.7">${UI.esc(t.ui_portal_login_hint)}</div>` : ''}
          ${Portal.noticeBox(t.ui_demo_portal)}
          <div style="margin-top:12px;font-size:13px;text-align:center"><a href="/">員工登入</a></div>
        </div>
      </div>`;
    const doLogin = async () => {
      const err = document.getElementById('lg-err');
      err.textContent = '';
      try {
        await POST('/portal/login', {
          phone: document.getElementById('lg-phone').value.trim(),
          password: document.getElementById('lg-pass').value
        });
        location.reload();
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('lg-btn').onclick = doLogin;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  },

  renderLayout() {
    document.getElementById('app').innerHTML = `
      <div class="portal-top">
        <div class="pt-inner">
          <strong>${UI.esc(Portal.me.company_name || 'CoolCare')}</strong>
          <span class="spacer"></span>
          <span class="pt-user">${UI.esc(Portal.me.customer.name)}</span>
          <button class="btn small secondary" id="pw-btn">改密碼</button>
          <button class="btn small secondary" id="logout-btn">登出</button>
        </div>
        <nav class="pt-nav" id="pt-nav">
          ${Portal.tabs.map(([k, label]) => `<a href="#${k}" data-nav="${k}">${UI.esc(label)}</a>`).join('')}
        </nav>
      </div>
      <main class="portal-main" id="page"></main>
      ${Portal.me.company_phone ? `<a class="portal-call" href="tel:${UI.esc(Portal.me.company_phone)}">☎ 撥打 ${UI.esc(Portal.me.company_phone)}</a>` : ''}`;

    document.getElementById('logout-btn').onclick = async () => { await POST('/portal/logout'); location.reload(); };
    document.getElementById('pw-btn').onclick = () => Portal.passwordDialog(false);
  },

  async go(key) {
    const [k, arg] = String(key).split('/');
    const fn = Portal.pages[k] ? k : 'home';
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === fn));
    if (location.hash.slice(1) !== key) history.replaceState(null, '', '#' + key);
    const el = document.getElementById('page');
    el.innerHTML = '<div class="empty">載入中...</div>';
    try { await Portal.pages[fn](el, arg); }
    catch (e) { el.innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; }
  },

  reload() { Portal.go(location.hash.slice(1) || 'home'); },

  passwordDialog(forced) {
    UI.modal({
      title: forced ? '請先設定新密碼' : '修改密碼',
      body: `${forced ? '<div style="font-size:13.5px;color:var(--muted);margin-bottom:10px">首次登入請更換預設密碼，保護您的維修與帳務資料。</div>' : ''}
      <div class="form-grid">
        ${UI.input('old_password', forced ? '目前密碼（手機末 6 碼）' : '舊密碼', { type: 'password', full: true })}
        ${UI.input('new_password', '新密碼（至少 6 碼）', { type: 'password', full: true })}
      </div>`,
      onSubmit: async el => {
        await PUT('/portal/password', UI.formData(el));
        UI.toast('密碼已更新');
        Portal.me.must_change_password = 0;
      }
    });
  },

  pages: {
    // ---- 首頁 ----
    async home(el) {
      const d = await GET('/portal/overview');
      const unpaidTotal = d.unpaid.reduce((s, i) => s + i.balance, 0);

      el.innerHTML = `
        ${d.announcements.map(a => `<div class="card notice"><h3>${UI.esc(a.title)}</h3>
          <div style="white-space:pre-wrap;font-size:13.5px;line-height:1.8">${UI.esc(a.body || '')}</div>
          <div style="color:var(--muted);font-size:12.5px;margin-top:8px">${UI.esc(a.publish_date || '')}</div></div>`).join('')}

        <div class="stat-grid">
          <div class="stat clickable" onclick="location.hash='orders'">
            <div class="num ${d.open_orders.length ? 'warn' : ''}">${d.open_orders.length}</div>
            <div class="label">處理中案件</div></div>
          <div class="stat clickable" onclick="location.hash='equipments'">
            <div class="num">${d.equipment_count}</div><div class="label">我的設備</div></div>
          <div class="stat clickable" onclick="location.hash='equipments'">
            <div class="num ${d.due_services.length ? 'warn' : ''}">${d.due_services.length}</div>
            <div class="label">30 天內待保養</div></div>
          <div class="stat clickable" onclick="location.hash='invoices'">
            <div class="num ${unpaidTotal ? 'warn' : ''}">${UI.num(unpaidTotal)}</div>
            <div class="label">未付款金額</div></div>
          ${d.open_projects && d.open_projects.length ? `<div class="stat clickable" onclick="location.hash='projects'">
            <div class="num">${d.open_projects.length}</div><div class="label">進行中工程</div></div>` : ''}
        </div>

        ${d.open_projects && d.open_projects.length ? `<div class="card"><h3>進行中的工程</h3>
          <ul class="mini-list">${d.open_projects.map(p => `
            <li style="cursor:pointer" onclick="location.hash='projects/${p.id}'">
              <div class="ml-main">${UI.esc(p.name)}
                <div class="ml-sub">${UI.esc(p.proj_no)}${p.due_date ? '　預計完工 ' + UI.esc(p.due_date) : ''}</div></div>
              <div style="text-align:right">${UI.tag(p.status_text || '')}
                <div class="ml-sub">進度 ${p.progress}%</div></div></li>`).join('')}</ul></div>` : ''}

        <div class="card"><h3>處理中的案件</h3>
          ${d.open_orders.length ? `<ul class="mini-list">${d.open_orders.map(o => `
            <li style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
              <div class="ml-main">${UI.esc(o.title || TWP.order_type[o.type] || '')}
                <div class="ml-sub">${UI.esc(o.order_no)}　${UI.esc(o.appoint_date || '')} ${UI.esc(o.appoint_slot || '')}
                  <br>${UI.esc(o.address || '')}</div></div>
              <div>${UI.tag(o.status_text || '', TWP.status_cls[o.status] || '')}</div></li>`).join('')}</ul>`
        : `<div style="color:var(--muted);font-size:13.5px">目前沒有處理中的案件</div>
           <button class="btn" id="go-repair" style="margin-top:10px">我要報修</button>`}
        </div>

        ${d.due_services.length ? `<div class="card"><h3>即將到期的保養</h3>
          <ul class="mini-list">${d.due_services.map(e => `
            <li><div class="ml-main">${UI.esc(e.brand)} ${UI.esc(e.model)}
                <div class="ml-sub">${UI.esc(e.asset_no)}　${UI.esc(e.location || '')}</div></div>
              <div style="text-align:right">${UI.tag(e.next_service_date, 'warn')}</div></li>`).join('')}</ul>
          <button class="btn small" id="book-maintain" style="margin-top:10px">預約保養</button></div>` : ''}

        ${d.contracts.length ? `<div class="card"><h3>保養合約</h3>
          <ul class="mini-list">${d.contracts.map(c => `
            <li><div class="ml-main">${UI.esc(c.title)}
                <div class="ml-sub">${UI.esc(c.contract_no)}　${UI.esc(c.start_date)} ~ ${UI.esc(c.end_date)}</div></div>
              <div style="text-align:right"><span class="ml-sub">下次到場<br>${UI.esc(c.next_visit_date || '－')}</span></div></li>`).join('')}</ul></div>` : ''}

        ${d.unpaid.length ? `<div class="card"><h3>待付款帳單</h3>
          <ul class="mini-list">${d.unpaid.map(i => `
            <li style="cursor:pointer" onclick="location.hash='invoices/${i.id}'">
              <div class="ml-main">${UI.esc(i.inv_no)}
                <div class="ml-sub">開立 ${UI.esc(i.issue_date)}　付款期限 ${UI.esc(i.due_date || '－')}</div></div>
              <div style="text-align:right"><strong>${UI.money(i.balance)}</strong></div></li>`).join('')}</ul></div>` : ''}`;

      const go = el.querySelector('#go-repair');
      if (go) go.onclick = () => { location.hash = 'repair'; };
      const book = el.querySelector('#book-maintain');
      if (book) book.onclick = () => { location.hash = 'repair'; };
    },

    // ---- 我的工程 ----
    async projects(el, id) {
      if (id) return Portal.renderProject(el, id);
      const rows = await GET('/portal/projects');
      if (!rows.length) {
        el.innerHTML = '<div class="empty">目前沒有工程案件。單次到府維修請看「維修進度」。</div>';
        return;
      }
      el.innerHTML = rows.map(p => `
        <div class="card" style="cursor:pointer" onclick="location.hash='projects/${p.id}'">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div><h3 style="margin:0">${UI.esc(p.name)}</h3>
              <div style="color:var(--muted);font-size:12.5px">${UI.esc(p.proj_no)}　${UI.esc(p.address || '')}</div></div>
            ${UI.tag(p.status_text || '')}
          </div>
          <div style="margin-top:10px">
            <div class="progress-bar" style="max-width:100%;margin:0 0 4px">
              <span style="width:${Math.max(0, Math.min(100, p.progress))}%"></span></div>
            <span style="font-size:13px;color:var(--muted)">施工進度 ${p.progress}%</span>
          </div>
          <div class="detail-grid" style="margin-top:10px">
            <div><div class="dg-label">合約金額（未稅）</div>${UI.money(p.contract_total)}</div>
            <div><div class="dg-label">已計價</div>${UI.money(p.billed)}</div>
            <div><div class="dg-label">工期</div>${UI.esc(p.start_date || '－')} ~ ${UI.esc(p.due_date || '－')}</div>
            ${p.warranty_end ? `<div><div class="dg-label">保固到期</div>${UI.esc(p.warranty_end)}</div>` : ''}
          </div>
        </div>`).join('');
    },

    // ---- 線上報修 ----
    async repair(el) {
      const [sites, equips] = await Promise.all([
        GET('/portal/sites').catch(() => []),
        GET('/portal/equipments').catch(() => [])
      ]);

      el.innerHTML = `
        <div class="card"><h3>線上報修／預約保養</h3>
          <div class="form-grid">
            ${UI.select('type', '需求類型', [['repair', '設備故障維修'], ['maintain', '定期保養']], { full: true })}
            ${sites.length ? UI.select('site_id', '服務地點',
        [['', '主要地址'], ...sites.map(s => [s.id, `${s.name}（${s.address || ''}）`])], { full: true }) : ''}
            ${UI.input('title', '簡短標題', { full: true, placeholder: '例：3F 會議室冷氣不冷' })}
            ${UI.textarea('symptom', '故障狀況描述 *', { rows: 4, placeholder: '請說明症狀、何時開始、是否有異音或漏水，越詳細師傅越好準備。' })}
            ${UI.input('appoint_date', '希望到場日', { type: 'date', value: UI.today() })}
            ${UI.input('appoint_slot', '希望時段', { placeholder: '例：上午、下午 2 點後' })}
            ${UI.input('contact', '現場聯絡人', { value: Portal.me.name })}
            ${UI.input('phone', '聯絡電話', { value: Portal.me.phone })}
            ${UI.checkbox('urgent', '急件（完全不冷／漏水／異常聲響）', false, { full: true })}
            ${equips.length ? `<div class="form-row full"><label>要處理的設備（可複選）</label>
              <div style="display:flex;flex-direction:column;gap:6px">
                ${equips.map(e => `<label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13.5px">
                  <input type="checkbox" class="rq-equip" value="${e.id}" style="width:auto">
                  ${UI.esc(e.brand)} ${UI.esc(e.model)}
                  <span style="color:var(--muted)">（${UI.esc(e.location || e.asset_no)}）</span></label>`).join('')}
              </div></div>` : ''}
          </div>
          <button class="btn" id="send-req" style="margin-top:12px">送出報修</button>
          ${Portal.noticeBox(Portal.texts.ui_repair_note)}
        </div>`;

      el.querySelector('#send-req').onclick = async () => {
        const b = UI.formData(el);
        if (!b.symptom) return UI.err(new Error('請描述故障狀況'));
        b.priority = b.urgent ? 'urgent' : 'normal';
        b.equipment_ids = [...el.querySelectorAll('.rq-equip:checked')].map(c => Number(c.value));
        try {
          const r = await POST('/portal/repair-request', b);
          UI.toast(`已送出，案件編號 ${r.order_no}`);
          location.hash = 'orders/' + r.id;
        } catch (e) { UI.err(e); }
      };
    },

    // ---- 維修進度 ----
    async orders(el, id) {
      if (id) return Portal.orderDetail(el, id);
      const rows = await GET('/portal/orders');
      el.innerHTML = `
        <div class="card"><h3>我的案件（${rows.length}）</h3>
          ${rows.length ? `<ul class="mini-list">${rows.map(o => `
            <li style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
              <div class="ml-main">${UI.esc(o.title || TWP.order_type[o.type] || '')}
                <div class="ml-sub">${UI.esc(o.order_no)}　${UI.esc(o.appoint_date || '')} ${UI.esc(o.appoint_slot || '')}
                  ${o.finished_at ? `　完工 ${UI.esc(o.finished_at.slice(0, 16))}` : ''}</div></div>
              <div style="text-align:right">${UI.tag(o.status_text, TWP.status_cls[o.status] || '')}
                <div class="ml-sub">${o.is_warranty ? '保固內' : o.is_contract ? '合約內' : (o.total ? UI.money(o.total) : '')}</div></div>
            </li>`).join('')}</ul>` : '<div class="empty">尚無案件紀錄</div>'}
        </div>`;
    },

    // ---- 我的設備 ----
    async equipments(el, id) {
      if (id) {
        const e = await GET('/portal/equipments/' + id);
        el.innerHTML = `
          <div class="toolbar"><a class="btn small secondary" href="#equipments">← 回設備清單</a></div>
          <div class="card"><h3>${UI.esc(e.brand)} ${UI.esc(e.model)}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">機號</div>${UI.esc(e.asset_no)}</div>
              <div><div class="dg-label">位置</div>${UI.esc(e.location || '－')}</div>
              <div><div class="dg-label">機種</div>${UI.esc(e.category || '－')}</div>
              <div><div class="dg-label">冷媒</div>${UI.esc(e.refrigerant || '－')}</div>
              <div><div class="dg-label">安裝日</div>${UI.esc(e.install_date || '－')}</div>
              <div><div class="dg-label">保固到期</div>${UI.esc(e.warranty_end || '－')}</div>
              <div><div class="dg-label">上次保養</div>${UI.esc(e.last_service_date || '－')}</div>
              <div><div class="dg-label">下次保養</div>${UI.esc(e.next_service_date || '－')}</div>
            </div>
          </div>
          <div class="card"><h3>服務紀錄</h3>
            ${e.history.length ? `<ul class="mini-list">${e.history.map(h => `
              <li><div class="ml-main">${UI.esc(h.title || TWP.order_type[h.type] || '')}
                  <div class="ml-sub">${UI.esc(h.order_no)}　${UI.esc((h.finished_at || '').slice(0, 10))}
                    ${h.action ? `<br>處理：${UI.esc(h.action)}` : ''}</div></div>
                <div style="text-align:right">${h.total ? UI.money(h.total) : ''}</div></li>`).join('')}</ul>`
            : '<div style="color:var(--muted);font-size:13.5px">尚無服務紀錄</div>'}
          </div>`;
        return;
      }
      const rows = await GET('/portal/equipments');
      el.innerHTML = `
        <div class="card"><h3>我的設備（${rows.length}）</h3>
          ${rows.length ? `<ul class="mini-list">${rows.map(e => `
            <li style="cursor:pointer" onclick="location.hash='equipments/${e.id}'">
              <div class="ml-main">${UI.esc(e.brand)} ${UI.esc(e.model)}
                <div class="ml-sub">${UI.esc(e.asset_no)}　${UI.esc(e.site_name || '')} ${UI.esc(e.location || '')}
                  ${e.next_service_date ? `<br>下次保養 ${UI.esc(e.next_service_date)}` : ''}</div></div>
              <div style="text-align:right">${UI.tag(TWP.equip_status[e.status] || e.status, e.status === 'active' ? 'ok' : 'warn')}
                ${e.warranty_end && e.warranty_end >= UI.today() ? '<div class="ml-sub">保固中</div>' : ''}</div>
            </li>`).join('')}</ul>` : '<div class="empty">尚未登錄設備</div>'}
        </div>`;
    },

    // ---- 帳單 ----
    async invoices(el, id) {
      if (id) {
        const inv = await GET('/portal/invoices/' + id);
        el.innerHTML = `
          <div class="toolbar"><a class="btn small secondary" href="#invoices">← 回帳單列表</a></div>
          <div class="card"><h3>${UI.esc(inv.inv_no)}　${UI.tag(TWP.inv_status[inv.status], TWP.inv_cls[inv.status])}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">開立日</div>${UI.esc(inv.issue_date)}</div>
              <div><div class="dg-label">付款期限</div>${UI.esc(inv.due_date || '－')}</div>
              <div><div class="dg-label">應付金額</div><strong>${UI.money(inv.total)}</strong></div>
              <div><div class="dg-label">未付餘額</div>${inv.total - inv.paid > 0
            ? `<strong style="color:var(--danger)">${UI.money(inv.total - inv.paid)}</strong>` : '已付清'}</div>
              <div><div class="dg-label">發票號碼</div>${UI.esc(inv.tax_invoice_no || '－')}</div>
            </div>
          </div>
          <div class="card"><h3>明細</h3>
            ${UI.table(['項目', '數量', '單位', '單價', '金額'], inv.items.map(i => `
              <tr><td class="wrap">${UI.esc(i.name)}</td><td class="num">${i.qty}</td>
                <td>${UI.esc(i.unit)}</td><td class="num">${UI.num(i.price)}</td>
                <td class="num">${UI.num(i.amount)}</td></tr>`))}
          </div>
          ${inv.payments.length ? `<div class="card"><h3>付款紀錄</h3>
            <ul class="mini-list">${inv.payments.map(p => `
              <li><div class="ml-main">${UI.money(p.amount)}
                  <div class="ml-sub">${UI.esc(p.pay_date)}　${UI.esc(p.method)}</div></div></li>`).join('')}</ul></div>` : ''}
          ${inv.company.bank ? `<div class="card"><h3>匯款資訊</h3>
            <div style="font-size:13.5px;white-space:pre-wrap">${UI.esc(inv.company.bank)}</div></div>` : ''}`;
        return;
      }
      const rows = await GET('/portal/invoices');
      el.innerHTML = `
        <div class="card"><h3>我的帳單</h3>
          ${rows.length ? `<ul class="mini-list">${rows.map(i => `
            <li style="cursor:pointer" onclick="location.hash='invoices/${i.id}'">
              <div class="ml-main">${UI.esc(i.inv_no)}
                <div class="ml-sub">開立 ${UI.esc(i.issue_date)}　付款期限 ${UI.esc(i.due_date || '－')}</div></div>
              <div style="text-align:right"><strong>${UI.money(i.total)}</strong>
                <div>${UI.tag(TWP.inv_status[i.status], TWP.inv_cls[i.status])}</div></div>
            </li>`).join('')}</ul>` : '<div class="empty">尚無帳單</div>'}
        </div>`;
    }
  },

  // ---- 工程明細：進度、估驗計價、追加減帳、施工紀錄與照片 ----
  async renderProject(el, id) {
    const p = await GET('/portal/projects/' + id);
    // 待付款只算「已開立帳單」的部分——已估驗但還沒請款的期別不該讓業主以為現在就要付
    const invoiced = p.billings.filter(b => b.invoice_id);
    const unpaid = invoiced.reduce((s, b) => s + (b.invoice_total - b.invoice_paid), 0);
    const pendingBill = p.billings.filter(b => !b.invoice_id).reduce((s, b) => s + b.net_amount, 0);

    el.innerHTML = `
      <div class="toolbar"><a class="btn small secondary" href="#projects">← 回工程列表</a></div>

      <div class="card">
        <h3 style="margin:0">${UI.esc(p.name)}　${UI.tag(p.status_text)}</h3>
        <div style="color:var(--muted);font-size:12.5px">${UI.esc(p.proj_no)}
          ${p.contract_no ? '　合約 ' + UI.esc(p.contract_no) : ''}</div>
        <div style="margin-top:12px">
          <div class="progress-bar" style="max-width:100%;margin:0 0 4px">
            <span style="width:${Math.max(0, Math.min(100, p.progress))}%"></span></div>
          <span style="font-size:13px;color:var(--muted)">施工進度 ${p.progress}%</span>
        </div>
        <div class="detail-grid" style="margin-top:12px">
          <div><div class="dg-label">施工地址</div>${UI.esc(p.address || '－')}</div>
          <div><div class="dg-label">合約金額（未稅）</div>${UI.money(p.contract_total)}</div>
          <div><div class="dg-label">工期</div>${UI.esc(p.start_date || '－')} ~ ${UI.esc(p.due_date || '－')}</div>
          <div><div class="dg-label">實際完工／驗收</div>${UI.esc(p.finish_date || '－')} ／ ${UI.esc(p.accept_date || '－')}</div>
          ${p.warranty_end ? `<div><div class="dg-label">保固到期</div>${UI.esc(p.warranty_end)}（${p.warranty_months} 個月）</div>` : ''}
        </div>
        ${p.scope ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(p.scope)}</div>` : ''}
      </div>

      <div class="stat-grid">
        <div class="stat"><div class="num">${UI.num(p.billed)}</div><div class="label">已估驗計價</div></div>
        <div class="stat"><div class="num">${UI.num(p.contract_total - p.billed)}</div><div class="label">尚未計價</div></div>
        <div class="stat"><div class="num">${UI.num(p.retention_held)}</div>
          <div class="label">保留款（驗收後退還）</div></div>
        <div class="stat"><div class="num ${unpaid > 0 ? 'warn' : ''}">${UI.num(unpaid)}</div>
          <div class="label">帳單待付款</div></div>
        ${pendingBill ? `<div class="stat"><div class="num">${UI.num(pendingBill)}</div>
          <div class="label">已估驗待開單</div></div>` : ''}
      </div>

      <div class="card"><h3>估驗計價紀錄</h3>
        ${p.billings.length ? UI.table(['期別', '日期', '累計完成', '估驗金額', '保留款', '扣款', '本期應付', '帳單'],
      p.billings.map(b => `
          <tr>
            <td>第 ${b.seq} 期<br><span style="font-size:12px;color:var(--muted)">${UI.esc(b.kind_text)}</span></td>
            <td>${UI.esc(b.bill_date)}</td>
            <td class="num">${b.kind === 'retention' ? '－' : b.progress_pct + '%'}</td>
            <td class="num">${UI.money(b.gross_amount)}</td>
            <td class="num">${b.retention ? '-' + UI.num(b.retention) : '－'}</td>
            <td class="num">${b.deduct ? `-${UI.num(b.deduct)}<br><span style="font-size:12px;color:var(--muted)">${UI.esc(b.deduct_note || '')}</span>` : '－'}</td>
            <td class="num"><strong>${UI.money(b.net_amount)}</strong></td>
            <td>${b.inv_no
        ? `<a href="#invoices/${b.invoice_id}">${UI.esc(b.inv_no)}</a><br>
                 <span style="font-size:12px;color:var(--muted)">已付 ${UI.num(b.invoice_paid)}／${UI.num(b.invoice_total)}</span>`
        : '<span style="color:var(--muted)">尚未開立</span>'}</td>
          </tr>`))
        : '<div style="color:var(--muted);font-size:13.5px">尚未辦理估驗計價</div>'}
        ${p.retention_held ? Portal.noticeBox(
          `保留款 ${UI.money(p.retention_held)}（合約 ${(p.retention_rate * 100).toFixed(1)}%）於工程驗收後退還，`
          + '屆時會另開一張請款單向您請領。') : ''}
      </div>

      ${p.changes.length ? `<div class="card"><h3>追加減帳（已簽認）</h3>
        ${UI.table(['變更序號', '日期', '項目', '金額', '簽認'], p.changes.map(c => `
          <tr><td>${UI.esc(c.change_no)}</td><td>${UI.esc(c.change_date)}</td>
            <td class="wrap">${UI.esc(c.title)}
              ${c.reason ? `<br><span style="font-size:12px;color:var(--muted)">${UI.esc(c.reason)}</span>` : ''}</td>
            <td class="num"><strong>${c.amount > 0 ? '+' : ''}${UI.money(c.amount)}</strong></td>
            <td>${UI.esc(c.approved_by || '')}<br>
              <span style="font-size:12px;color:var(--muted)">${UI.esc(c.approved_date || '')}</span></td>
          </tr>`))}
      </div>` : ''}

      ${p.orders.length ? `<div class="card"><h3>施工紀錄</h3>
        <ul class="mini-list">${p.orders.map(o => `
          <li style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
            <div class="ml-main">${UI.esc(o.title || TWP.order_type[o.type] || '施工')}
              <div class="ml-sub">${UI.esc(o.order_no)}　${UI.esc(o.appoint_date || '')}</div></div>
            <div>${UI.tag(o.status_text || '', TWP.status_cls[o.status] || '')}</div></li>`).join('')}</ul>
      </div>` : ''}

      ${p.photos.length ? `<div class="card"><h3>施工照片（${p.photos.length}）</h3>
        <div class="photo-grid">${p.photos.map(ph => `
          <a href="${UI.esc(ph.path)}" target="_blank">
            <img src="${UI.esc(ph.path)}" loading="lazy">
            <span>${UI.esc(TWP.photo_stage[ph.stage] || ph.stage)}　${UI.esc(ph.appoint_date || '')}</span>
          </a>`).join('')}</div>
      </div>` : ''}`;
  },

  // ---- 案件明細（含評分） ----
  async orderDetail(el, id) {
    const o = await GET('/portal/orders/' + id);
    const done = ['done', 'confirmed', 'billed'].includes(o.status);
    const steps = [['受理', true], ['已排定', o.status !== 'draft'],
    ['師傅出發', !!o.departed_at], ['施工中', !!o.arrived_at], ['完工', done]];

    el.innerHTML = `
      <div class="toolbar"><a class="btn small secondary" href="#orders">← 回案件列表</a></div>

      <div class="card"><h3>${UI.esc(o.order_no)}　${UI.tag(o.status_text, TWP.status_cls[o.status] || '')}</h3>
        <div class="steps">${steps.map(([label, on]) =>
      `<div class="step ${on ? 'on' : ''}"><span class="dot"></span>${UI.esc(label)}</div>`).join('')}</div>
        <div class="detail-grid" style="margin-top:12px">
          <div><div class="dg-label">類型</div>${UI.esc(TWP.order_type[o.type] || o.type)}</div>
          <div><div class="dg-label">預約時間</div>${UI.esc(o.appoint_date || '')} ${UI.esc(o.appoint_slot || '')}</div>
          <div><div class="dg-label">地址</div>${UI.esc(o.address || '')}</div>
          <div><div class="dg-label">完工時間</div>${UI.esc((o.finished_at || '').slice(0, 16) || '－')}</div>
          <div><div class="dg-label">負責師傅</div>${o.techs.map(t => UI.esc(t.name) + (t.phone ? `（${UI.esc(t.phone)}）` : '')).join('、') || '安排中'}</div>
        </div>
        ${o.symptom ? `<div style="margin-top:10px"><div class="dg-label">報修內容</div>
          <div style="white-space:pre-wrap;font-size:13.5px">${UI.esc(o.symptom)}</div></div>` : ''}
      </div>

      ${o.equipments.length ? `<div class="card"><h3>處理設備</h3>
        <ul class="mini-list">${o.equipments.map(e => `
          <li><div class="ml-main">${UI.esc(e.brand)} ${UI.esc(e.model)}
              <div class="ml-sub">${UI.esc(e.asset_no)}　${UI.esc(e.location || '')}</div></div></li>`).join('')}</ul></div>` : ''}

      ${done ? `<div class="card"><h3>施工結果</h3>
        <div class="detail-grid">
          ${o.cause ? `<div><div class="dg-label">故障原因</div>${UI.esc(o.cause)}</div>` : ''}
          ${o.action ? `<div><div class="dg-label">處理方式</div>${UI.esc(o.action)}</div>` : ''}
          ${o.suggestion ? `<div><div class="dg-label">後續建議</div>${UI.esc(o.suggestion)}</div>` : ''}
        </div>
        ${o.checks.length ? `<div style="margin-top:12px">${UI.table(['檢查項目', '結果', '數值'], o.checks.map(c => `
          <tr><td class="wrap">${UI.esc(c.item)}</td>
            <td>${UI.tag(TWP.check_result[c.result] || c.result || '－', c.result === 'ng' ? 'danger' : c.result === 'ok' ? 'ok' : '')}</td>
            <td>${UI.esc(c.value || '')}</td></tr>`))}</div>` : ''}
      </div>

      ${o.items.length ? `<div class="card"><h3>使用材料與費用</h3>
        ${UI.table(['項目', '數量', '單位', '單價', '金額'], o.items.map(i => `
          <tr><td class="wrap">${UI.esc(i.name)} <span style="color:var(--muted)">${UI.esc(i.spec || '')}</span></td>
            <td class="num">${i.qty}</td><td>${UI.esc(i.unit)}</td>
            <td class="num">${UI.num(i.price)}</td>
            <td class="num">${UI.num(Math.round(i.qty * i.price))}</td></tr>`))}
        <div class="detail-grid" style="margin-top:12px">
          <div><div class="dg-label">工資</div>${UI.money(o.labor_fee)}</div>
          <div><div class="dg-label">車馬費</div>${UI.money(o.travel_fee)}</div>
          <div><div class="dg-label">材料費</div>${UI.money(o.parts_fee)}</div>
          ${o.discount ? `<div><div class="dg-label">折扣</div>-${UI.money(o.discount)}</div>` : ''}
          <div><div class="dg-label">總計</div><strong style="color:var(--primary-dark);font-size:17px">
            ${o.is_warranty ? '保固內免費' : o.is_contract ? '合約內免費' : UI.money(o.total)}</strong></div>
        </div></div>` : ''}

      ${o.photos.length ? `<div class="card"><h3>施工照片</h3>
        <div class="photo-grid">${o.photos.map(p => `
          <a href="${UI.esc(p.path)}" target="_blank"><img src="${UI.esc(p.path)}" alt="${UI.esc(p.caption || '')}">
            <span>${UI.esc({ before: '施工前', during: '施工中', after: '施工後', fault: '故障點', other: '其他' }[p.stage] || '')}</span></a>`).join('')}
        </div></div>` : ''}

      <div class="card"><h3>服務評分</h3>
        ${o.rating ? `<div style="font-size:20px;color:#f0a500">${'★'.repeat(o.rating)}${'☆'.repeat(5 - o.rating)}</div>
          <div style="color:var(--muted);font-size:13px;margin-top:6px">感謝您的評分</div>`
        : done ? `<div class="rate-row" id="rate-row">
            ${[1, 2, 3, 4, 5].map(n => `<button class="rate-star" data-rate="${n}" type="button">☆</button>`).join('')}
          </div>
          <textarea id="rate-comment" rows="2" placeholder="想給師傅的話（選填）" style="margin-top:8px"></textarea>
          <button class="btn small" id="rate-send" style="margin-top:8px">送出評分</button>`
        : '<div style="color:var(--muted);font-size:13.5px">案件完工後即可評分</div>'}
      </div>` : ''}`;

    let picked = 0;
    const row = el.querySelector('#rate-row');
    if (row) {
      row.querySelectorAll('[data-rate]').forEach(b => {
        b.onclick = () => {
          picked = Number(b.dataset.rate);
          row.querySelectorAll('[data-rate]').forEach(x => {
            x.textContent = Number(x.dataset.rate) <= picked ? '★' : '☆';
          });
        };
      });
      el.querySelector('#rate-send').onclick = async () => {
        if (!picked) return UI.err(new Error('請先點選星數'));
        try {
          await POST(`/portal/orders/${o.id}/rate`, { rating: picked, comment: el.querySelector('#rate-comment').value });
          UI.toast('感謝您的評分');
          Portal.reload();
        } catch (e) { UI.err(e); }
      };
    }
  }
};

// api.js 的 401 處理會找 window.App
window.App = { onUnauthorized: Portal.onUnauthorized };
