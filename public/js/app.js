// App 骨架：登入、側欄導覽、頁面路由、總覽儀表板
const App = {
  me: null,
  pages: {},          // key -> {title, sub, group, module, render}
  meta: {},           // 共用參數與主檔（系統設定頁可調整）

  page(key, def) { App.pages[key] = def; },

  async boot() {
    try {
      App.me = await GET('/me');
      App.meta = await GET('/meta').catch(() => ({}));
      App.renderLayout();
      App.go(location.hash.slice(1) || 'dashboard');
    } catch {
      App.renderLogin();
    }
    window.addEventListener('hashchange', () => App.go(location.hash.slice(1) || 'dashboard'));
  },

  onUnauthorized() {
    if (App.me) { App.me = null; App.renderLogin(); }
  },

  can(module) {
    return App.me && (App.me.role === 'admin' || App.me.modules.includes(module));
  },

  // 下拉選項小工具
  opts(list, withEmpty) {
    const arr = (list || []).map(v => [v, v]);
    return withEmpty ? [['', withEmpty]] : arr;
  },
  mapOpts(obj, withEmpty) {
    const arr = Object.entries(obj).map(([k, v]) => [k, v]);
    return withEmpty ? [['', withEmpty], ...arr] : arr;
  },
  warehouseOptions(withEmpty) {
    const arr = (App.meta.warehouses || []).map(w => [w.id, w.name]);
    return withEmpty ? [['', withEmpty], ...arr] : arr;
  },
  techOptions(withEmpty) {
    const arr = (App.meta.techs || []).map(t => [t.id, t.name + (t.tech_no ? `（${t.tech_no}）` : '')]);
    return withEmpty ? [['', withEmpty], ...arr] : arr;
  },

  noticeBox(text) {
    if (!text) return '';
    const lines = String(text).split('\n').map(UI.esc);
    const first = lines.shift();
    return `<div style="margin-top:14px;padding:12px;background:var(--primary-light);border-radius:8px;font-size:13px;line-height:1.8">
      <strong>${first}</strong>${lines.length ? '<br>' + lines.join('<br>') : ''}</div>`;
  },

  async renderLogin() {
    const t = await GET('/public/ui-texts').catch(() => ({}));
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <h1>${UI.esc(t.ui_staff_login_title || 'CoolCare 冷凍空調')}</h1>
          <div class="sub">${UI.esc(t.ui_staff_login_sub || '工程管理系統')}</div>
          <div class="form-row"><label>帳號</label><input id="lg-user" autocomplete="username"></div>
          <div class="form-row"><label>密碼</label><input id="lg-pass" type="password" autocomplete="current-password"></div>
          <button class="btn" id="lg-btn">登入</button>
          <div class="login-err" id="lg-err"></div>
          ${App.noticeBox(t.ui_demo_staff)}
          <div style="margin-top:12px;font-size:13px;text-align:center"><a href="/portal.html">客戶專區入口</a></div>
        </div>
      </div>`;
    const doLogin = async () => {
      const err = document.getElementById('lg-err');
      err.textContent = '';
      try {
        await POST('/login', {
          username: document.getElementById('lg-user').value.trim(),
          password: document.getElementById('lg-pass').value
        });
        location.reload();
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('lg-btn').onclick = doLogin;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  },

  navGroups: [
    { label: '每日作業', keys: ['dashboard', 'dispatch', 'orders', 'calendar', 'enquiries'] },
    { label: '工程專案', keys: ['projects', 'subcontracts', 'subcontractors', 'labor', 'unitprices'] },
    { label: '客戶與設備', keys: ['customers', 'equipments', 'contracts', 'quotes'] },
    { label: '進銷存', keys: ['stocks', 'products', 'purchases', 'sales', 'stocktakes', 'suppliers'] },
    { label: '帳務', keys: ['invoices', 'payables', 'commissions'] },
    { label: '法規與證照', keys: ['filings', 'licenses', 'refrigerant'] },
    { label: '管理', keys: ['website', 'reports', 'announcements', 'users', 'settings'] }
  ],

  renderLayout() {
    const navHtml = App.navGroups.map(g => {
      const items = g.keys.filter(k => App.pages[k] && (!App.pages[k].module || App.can(App.pages[k].module)));
      if (!items.length) return '';
      return `<div class="nav-group">${g.label}</div>` +
        items.map(k => `<a href="#${k}" data-nav="${k}">${UI.esc(App.pages[k].title)}</a>`).join('');
    }).join('');
    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <button class="menu-btn" id="menu-btn">選單</button>
        <strong>${UI.esc(App.me.company_name)}</strong>
      </div>
      <div class="backdrop" id="backdrop"></div>
      <div class="layout">
        <aside class="sidebar" id="sidebar">
          <div class="brand">${UI.esc(App.me.company_name)}<small>水電空調工程管理系統</small></div>
          <nav class="nav" id="nav">${navHtml}</nav>
          <div class="user-box">
            <div class="name">${UI.esc(App.me.name)}</div>
            <div>${UI.esc(App.me.title || (App.me.role === 'admin' ? '管理員' : '員工'))}</div>
            <button id="pw-btn" type="button">修改密碼</button>
            <button id="logout-btn" type="button">登出</button>
          </div>
        </aside>
        <main class="main" id="page"></main>
      </div>`;
    document.getElementById('logout-btn').onclick = async () => { await POST('/logout'); location.reload(); };
    document.getElementById('pw-btn').onclick = App.changePasswordDialog;
    const sidebar = document.getElementById('sidebar'), backdrop = document.getElementById('backdrop');
    document.getElementById('menu-btn').onclick = () => { sidebar.classList.add('open'); backdrop.classList.add('show'); };
    backdrop.onclick = () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); };
    document.getElementById('nav').addEventListener('click', () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); });
  },

  changePasswordDialog() {
    UI.modal({
      title: '修改密碼',
      body: `<div class="form-grid">
        ${UI.input('old_password', '舊密碼', { type: 'password', full: true })}
        ${UI.input('new_password', '新密碼（至少 6 碼）', { type: 'password', full: true })}
      </div>`,
      onSubmit: async el => {
        await PUT('/me/password', UI.formData(el));
        UI.toast('密碼已更新');
      }
    });
  },

  async go(key, params) {
    const [k, arg] = String(key).split('/');
    const def = App.pages[k];
    if (!def || (def.module && !App.can(def.module))) return App.go('dashboard');
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === k));
    if (location.hash.slice(1) !== key) history.replaceState(null, '', '#' + key);
    const el = document.getElementById('page');
    el.innerHTML = `<div class="page-title">${UI.esc(def.title)}</div>
      <div class="page-sub">${UI.esc(def.sub || '')}</div>
      <div id="page-body"><div class="empty">載入中...</div></div>`;
    try { await def.render(document.getElementById('page-body'), arg, params); }
    catch (e) { document.getElementById('page-body').innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; }
  },

  reload() { App.go(location.hash.slice(1) || 'dashboard'); },

  // 工具列骨架：所有列表頁共用
  toolbar(html) { return `<div class="toolbar">${html}</div>`; }
};

// ================= 總覽 =================

App.page('dashboard', {
  title: '總覽',
  sub: '今日派工、到期提醒與本月營運',
  async render(el) {
    const d = await GET('/dashboard');
    const s = d.stat, m = d.month;

    const alertRow = (list, fmt, hash) => list.length
      ? `<div class="alert-list">${list.map(x => {
        const [text, date] = fmt(x);
        return `<div class="alert-row" onclick="location.hash='${hash}'">
          <span>${UI.esc(text)}</span><span class="ar-date">${UI.esc(date)}</span></div>`;
      }).join('')}</div>`
      : '<div style="color:var(--muted);font-size:13.5px">目前沒有到期項目</div>';

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat clickable" onclick="location.hash='dispatch'">
          <div class="num ${s.pending ? 'warn' : ''}">${s.pending}</div><div class="label">待派工</div></div>
        <div class="stat clickable" onclick="location.hash='orders'">
          <div class="num">${s.assigned}</div><div class="label">進行中工單</div></div>
        <div class="stat clickable" onclick="location.hash='dispatch'">
          <div class="num">${s.today_orders}</div><div class="label">今日到場</div></div>
        <div class="stat clickable" onclick="location.hash='orders'">
          <div class="num ${s.urgent ? 'danger' : ''}">${s.urgent}</div><div class="label">急件未結</div></div>
        <div class="stat clickable" onclick="location.hash='orders'">
          <div class="num ${s.overdue ? 'danger' : ''}">${s.overdue}</div><div class="label">已逾預約日</div></div>
        <div class="stat clickable" onclick="location.hash='invoices'">
          <div class="num ${s.done_unbilled ? 'warn' : ''}">${s.done_unbilled}</div><div class="label">完工待請款</div></div>
        <div class="stat clickable" onclick="location.hash='invoices'">
          <div class="num ${s.unpaid_count ? 'warn' : ''}">${UI.num(s.unpaid_amount)}</div>
          <div class="label">未收款（${s.unpaid_count} 張${s.overdue_ar ? `，逾期 ${s.overdue_ar}` : ''}）</div></div>
        <div class="stat clickable" onclick="location.hash='payables'">
          <div class="num">${UI.num(s.payable_amount)}</div><div class="label">應付廠商</div></div>
        <div class="stat clickable" onclick="location.hash='stocks'">
          <div class="num">${UI.num(Math.round(s.stock_value))}</div><div class="label">庫存價值</div></div>
        ${App.can('enquiries') ? `<div class="stat clickable" onclick="location.hash='enquiries'">
          <div class="num ${s.enquiries_new ? 'danger' : ''}">${s.enquiries_new}</div><div class="label">官網待處理詢價</div></div>` : ''}
        ${App.can('projects') ? `
        <div class="stat clickable" onclick="location.hash='projects'">
          <div class="num">${s.projects_open}</div>
          <div class="label">進行中工程${s.projects_overdue ? `（逾期 ${s.projects_overdue}）` : ''}</div></div>
        <div class="stat clickable" onclick="location.hash='projects'">
          <div class="num">${UI.num(s.project_backlog)}</div><div class="label">工程未計價餘額</div></div>
        <div class="stat clickable" onclick="location.hash='projects'">
          <div class="num">${UI.num(s.retention_held)}</div><div class="label">業主保留款</div></div>` : ''}
        ${App.can('subcontract') ? `<div class="stat clickable" onclick="location.hash='subcontracts'">
          <div class="num ${s.sub_payable ? 'warn' : ''}">${UI.num(s.sub_payable)}</div><div class="label">待付工班款</div></div>` : ''}
      </div>

      ${d.enquiries.length ? `<div class="card" style="border-left:4px solid var(--danger)">
        <h3>官網新進詢價（${d.enquiries.length}）</h3>
        ${UI.table(['時間', '姓名', '電話', '需求', '地區', '內容'], d.enquiries.map(e => `
          <tr style="cursor:pointer" onclick="location.hash='enquiries'">
            <td>${UI.esc(e.created_at.slice(5, 16))}</td>
            <td><strong>${UI.esc(e.name)}</strong></td>
            <td>${UI.esc(e.phone)}</td>
            <td>${UI.esc(e.service || '－')}</td>
            <td>${UI.esc(e.area || '－')}</td>
            <td class="wrap">${UI.esc((e.content || '').slice(0, 60))}</td>
          </tr>`), '')}
      </div>` : ''}

      <div class="split">
        <div>
          <div class="card"><h3>本月營運（${UI.esc(m.key)}）</h3>
            <div class="detail-grid">
              <div><div class="dg-label">完工單數</div>${m.orders} 張</div>
              <div><div class="dg-label">總營收（含稅）</div>${UI.money(m.revenue)}</div>
              <div><div class="dg-label">材料成本</div>${UI.money(m.cost)}</div>
              <div><div class="dg-label">毛利</div><strong style="color:var(--primary-dark)">${UI.money(m.profit)}</strong>
                ${m.revenue ? `（${(m.profit / m.revenue * 100).toFixed(1)}%）` : ''}</div>
            </div>
          </div>

          <div class="card"><h3>今日行程（${d.today_orders.length} 件）</h3>
            ${UI.table(['工單', '時段', '客戶／地址', '案由', '技師', '狀態'], d.today_orders.map(o => `
              <tr style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
                <td>${UI.esc(o.order_no)}<br>${UI.tag(TW.order_type[o.type] || o.type)}</td>
                <td>${UI.esc(o.appoint_slot || '-')}</td>
                <td class="wrap"><strong>${UI.esc(o.customer_name)}</strong><br>
                  <span style="color:var(--muted);font-size:12.5px">${UI.esc(o.address || '')}</span></td>
                <td class="wrap">${UI.esc(o.title || '')}
                  ${o.priority === 'urgent' ? UI.tag('急件', 'danger') : ''}</td>
                <td>${UI.esc(o.techs || '未指派')}</td>
                <td>${UI.tag(TW.order_status[o.status], TW.status_cls[o.status])}</td>
              </tr>`), '今天沒有排定的工單')}
          </div>

          ${App.me.is_tech ? `<div class="card"><h3>我的待辦工單</h3>
            ${UI.table(['工單', '日期', '客戶', '地址', '狀態'], d.my_orders.map(o => `
              <tr style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
                <td>${UI.esc(o.order_no)}</td><td>${UI.esc(o.appoint_date)} ${UI.esc(o.appoint_slot || '')}</td>
                <td>${UI.esc(o.customer_name)}</td><td class="wrap">${UI.esc(o.address || '')}</td>
                <td>${UI.tag(TW.order_status[o.status], TW.status_cls[o.status])}</td>
              </tr>`), '目前沒有指派給你的工單')}
          </div>` : ''}
        </div>

        <div>
          <div class="card"><h3>保養到期提醒</h3>
            ${alertRow(d.alerts.services_due, x => [`${x.customer_name}　${x.title}`, x.next_visit_date], 'contracts')}
            ${d.alerts.services_due.length ? `<button class="btn small" id="gen-due" style="margin-top:10px">一鍵產生到期保養工單</button>` : ''}
          </div>
          <div class="card"><h3>合約即將到期</h3>
            ${alertRow(d.alerts.contracts, x => [`${x.customer_name}　${x.title}`, x.end_date], 'contracts')}
          </div>
          <div class="card"><h3>設備保固即將到期</h3>
            ${alertRow(d.alerts.warranties, x => [`${x.customer_name}　${x.brand} ${x.model}`, x.warranty_end], 'equipments')}
          </div>
          <div class="card"><h3>低於安全庫存</h3>
            ${d.low_stock.length
        ? `<ul class="mini-list">${d.low_stock.map(p => `<li><div class="ml-main">${UI.esc(p.name)}
              <div class="ml-sub">${UI.esc(p.spec || '')}　${UI.esc(p.supplier_name || '未設定廠商')}</div></div>
              <div style="text-align:right"><span class="qty-low">${p.qty}</span>
              <div class="ml-sub">安全 ${p.safety_qty}</div></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">庫存水位正常</div>'}
          </div>
          ${d.alerts.projects_overdue.length ? `<div class="card"><h3>工程逾期未完工</h3>
            ${alertRow(d.alerts.projects_overdue, x => [`${x.customer_name}　${x.name}（${x.progress}%）`, x.due_date], 'projects')}
          </div>` : ''}
          ${d.alerts.filings.length ? `<div class="card"><h3>報驗申報待辦</h3>
            ${alertRow(d.alerts.filings, x => [
        `${x.kind}${x.project_name ? '　' + x.project_name : ''}（${TW.filing_result[x.result] || x.result}）`,
        x.next_due_date || x.apply_date], 'filings')}
          </div>` : ''}
          ${d.alerts.company_licenses.length ? `<div class="card" style="border-left:4px solid var(--danger)">
            <h3>公司承裝業登記換證</h3>
            ${alertRow(d.alerts.company_licenses, x => [`${x.name}${x.grade ? '　' + x.grade : ''}`, x.expire_date], 'licenses')}
          </div>` : ''}
          ${d.alerts.licenses.length ? `<div class="card"><h3>技師證照到期</h3>
            ${alertRow(d.alerts.licenses, x => [`${x.name}　${x.license}`, x.license_expiry], 'users')}</div>` : ''}
        </div>
      </div>

      ${d.security && (d.security.default_admin_password || d.security.weak_staff_password
        || d.security.demo_hint_staff || d.security.demo_hint_portal)
        ? `<div class="card"><h3>上線安全檢查</h3>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
          ${d.security.default_admin_password ? UI.tag('管理員仍使用預設密碼 coolcare123，請立即至左下「修改密碼」更換', 'danger') : ''}
          ${d.security.weak_staff_password ? UI.tag('有員工帳號使用弱密碼 123456，請至帳號權限頁重設', 'danger') : ''}
          ${d.security.demo_hint_staff ? UI.tag('員工登入頁仍顯示測試帳號提示，正式上線請至系統設定清空', 'warn') : ''}
          ${d.security.demo_hint_portal ? UI.tag('客戶登入頁仍顯示測試帳號提示，請至系統設定清空', 'warn') : ''}
        </div></div>` : ''}`;

    const gen = el.querySelector('#gen-due');
    if (gen) gen.onclick = async () => {
      if (!await UI.confirm('將為所有已到期的保養合約各開立一張保養工單（已有未完成單者略過），確定嗎？')) return;
      try {
        const r = await POST('/service-contracts/generate-due', {});
        UI.toast(`已產生 ${r.created} 張保養工單`);
        App.reload();
      } catch (e) { UI.err(e); }
    };
  }
});
