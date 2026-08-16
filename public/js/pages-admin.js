// 冷媒管制、報表匯出、公告、帳號權限、系統設定

// ================= 冷媒管制紀錄 =================

App.page('refrigerant', {
  title: '冷媒管制',
  sub: '充填、回收與洩漏紀錄，作為環保申報底稿',
  module: 'refrigerant',
  async render(el) {
    const f = App._refFilter || (App._refFilter = {
      from: UI.thisMonth() + '-01', to: UI.today(), refrigerant: '', action: ''
    });
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const d = await GET('/refrigerant-logs?' + qs);
    const alertKg = Number(App.meta.refrigerant_alert_kg || 3);

    el.innerHTML = `
      ${App.toolbar(`
        <input type="date" id="f-from" value="${f.from}"> ~ <input type="date" id="f-to" value="${f.to}">
        <select id="f-ref"><option value="">全部冷媒</option>
          ${(App.meta.refrigerants || []).map(r =>
      `<option value="${UI.esc(r)}"${f.refrigerant === r ? ' selected' : ''}>${UI.esc(r)}</option>`).join('')}
        </select>
        <select id="f-action"><option value="">全部項目</option>
          ${Object.entries(TW.ref_action).map(([k, v]) =>
      `<option value="${k}"${f.action === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <a class="btn small secondary" href="/api/export/refrigerant?from=${f.from}&to=${f.to}">匯出 CSV</a>
        <button class="btn" id="new-log">＋ 新增紀錄</button>`)}

      <div class="card"><h3>期間彙總（kg）</h3>
        ${Object.keys(d.summary).length
        ? UI.table(['冷媒', '充填', '回收', '洩漏', '銷毀', '淨用量'], Object.entries(d.summary).map(([k, s]) => `
          <tr><td><strong>${UI.esc(k)}</strong></td>
            <td class="num">${s.charge || 0}</td><td class="num">${s.recover || 0}</td>
            <td class="num">${s.leak ? `<strong style="color:var(--danger)">${s.leak}</strong>` : 0}</td>
            <td class="num">${s.dispose || 0}</td>
            <td class="num"><strong>${Number(((s.charge || 0) - (s.recover || 0)).toFixed(3))}</strong></td></tr>`))
        : '<div style="color:var(--muted);font-size:13.5px">此期間沒有冷媒紀錄</div>'}
      </div>

      ${UI.table(['日期', '項目', '冷媒', '重量', '客戶／設備', '工單', '鋼瓶號', '技師', '洩漏點／備註'], d.rows.map(r => `
        <tr>
          <td>${UI.esc(r.log_date)}</td>
          <td>${UI.tag(TW.ref_action[r.action] || r.action,
      r.action === 'leak' ? 'danger' : r.action === 'recover' ? 'ok' : '')}</td>
          <td>${UI.esc(r.refrigerant)}</td>
          <td class="num">${r.kg >= alertKg ? `<strong style="color:var(--danger)">${r.kg}</strong>` : r.kg} kg</td>
          <td class="wrap">${UI.esc(r.customer_name || '')}
            ${r.asset_no ? `<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(r.asset_no)} ${UI.esc(r.brand || '')} ${UI.esc(r.model || '')}</span>` : ''}</td>
          <td>${r.order_no ? `<a href="#orders/${r.order_id}">${UI.esc(r.order_no)}</a>` : '－'}</td>
          <td>${UI.esc(r.cylinder_no || '－')}</td>
          <td>${UI.esc(r.tech_name || '')}</td>
          <td class="wrap">${UI.esc(r.leak_point || '')} ${UI.esc(r.note || '')}</td>
        </tr>`), '此期間沒有冷媒紀錄')}

      ${App.noticeBox(`單次充填達 ${alertKg} kg 以上會標紅，請留意大量洩漏機組的追蹤與申報。`)}`;

    const bind = (sel, key) => { el.querySelector(sel).onchange = e => { f[key] = e.target.value; App.pages.refrigerant.render(el); }; };
    bind('#f-from', 'from'); bind('#f-to', 'to'); bind('#f-ref', 'refrigerant'); bind('#f-action', 'action');

    el.querySelector('#new-log').onclick = () => {
      UI.modal({
        title: '新增冷媒紀錄',
        body: `<div class="form-grid">
          ${UI.input('log_date', '日期', { type: 'date', value: UI.today() })}
          ${UI.select('action', '項目', App.mapOpts(TW.ref_action), { value: 'charge' })}
          ${UI.inputList('refrigerant', '冷媒種類 *', App.meta.refrigerants || [], { value: 'R32' })}
          ${UI.input('kg', '重量（kg）', { type: 'number', step: '0.01' })}
          ${UI.input('cylinder_no', '鋼瓶號碼')}
          ${UI.select('tech_id', '施作技師', App.techOptions('未指定'))}
          <div class="form-row full"><label>設備（可留空）</label>
            <input id="rl-equip" placeholder="輸入機號／品牌／客戶搜尋" autocomplete="off">
            <input type="hidden" name="equipment_id"></div>
          ${UI.input('leak_point', '洩漏點', { full: true, placeholder: '例：室外機冷媒管接頭' })}
          ${UI.textarea('note', '備註')}
        </div>`,
        onOpen: elm => {
          // 設備搜尋（沿用列表 API，輸入即查）
          const input = elm.querySelector('#rl-equip');
          const box = document.createElement('div');
          box.className = 'picker-box';
          input.parentNode.style.position = 'relative';
          input.parentNode.appendChild(box);
          let timer;
          const search = async () => {
            const q = input.value.trim();
            if (!q) { box.classList.remove('show'); return; }
            const rows = await GET('/equipments?status=&q=' + encodeURIComponent(q)).catch(() => []);
            box.innerHTML = rows.slice(0, 15).map(e => `
              <div class="picker-item" data-id="${e.id}"><strong>${UI.esc(e.brand)} ${UI.esc(e.model)}</strong>
                <div style="font-size:12px;color:var(--muted)">${UI.esc(e.asset_no)}　${UI.esc(e.customer_name)}　${UI.esc(e.location || '')}</div>
              </div>`).join('') || '<div class="picker-item">查無設備</div>';
            box.classList.add('show');
            box.querySelectorAll('[data-id]').forEach(x => {
              x.onclick = () => {
                const e = rows.find(r => r.id === Number(x.dataset.id));
                input.value = `${e.asset_no} ${e.brand} ${e.model}`;
                elm.querySelector('[name=equipment_id]').value = e.id;
                box.classList.remove('show');
              };
            });
          };
          input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
          input.addEventListener('blur', () => setTimeout(() => box.classList.remove('show'), 200));
        },
        onSubmit: async elm => {
          const b = UI.formData(elm);
          if (!b.refrigerant || !Number(b.kg)) throw new Error('請填寫冷媒種類與重量');
          await POST('/refrigerant-logs', b);
          UI.toast('已新增');
          App.reload();
        }
      });
    };
  }
});

// ================= 報表匯出 =================

App.page('reports', {
  title: '報表匯出',
  sub: '各式明細與統計，可下載 CSV／Excel 或直接列印成 PDF',
  module: 'reports',
  async render(el) {
    const month = UI.thisMonth();
    const year = month.slice(0, 4);
    const first = month + '-01';
    const today = UI.today();

    // [標題, 說明, 路徑, 參數型態]
    const reports = [
      ['工單明細', '期間內所有工單的收費、成本與毛利', 'work-orders', 'range'],
      ['技師產值', '各技師的完工單數、工時、營收與抽成', 'tech-performance', 'month'],
      ['客戶消費排行', '哪些客戶帶來最多營收', 'customer-ranking', 'range'],
      ['庫存清冊', '各倉現有數量與庫存價值', 'stock', 'none'],
      ['庫存異動明細', '進貨、領料、調撥與盤點調整', 'stock-moves', 'range'],
      ['採購明細', '期間內採購單與進貨金額', 'purchases', 'range'],
      ['銷貨明細', '期間內銷貨單與毛利', 'sales', 'range'],
      ['應收帳款', '未收清的請款單與帳齡', 'ar', 'none'],
      ['應付帳款', '已進貨未付清的採購單', 'ap', 'none'],
      ['設備清冊', '所有客戶設備、保固與保養日', 'equipments', 'none'],
      ['保養合約', '合約期間、週期與到期日', 'contracts', 'none'],
      ['冷媒紀錄', '充填回收明細，環保申報底稿', 'refrigerant', 'range'],
      ['技師抽成', '指定期別的抽成明細', 'commissions', 'month'],
      ['營運月報', '整年度逐月營收、成本、毛利與現金', 'monthly-summary', 'year'],
      ['工程專案彙總', '各承攬案的合約、計價、成本與毛利', 'projects', 'none'],
      ['估驗計價明細', '各期估驗金額、保留款與請款狀況', 'project-billings', 'range'],
      ['分包計價與扣繳', '付給工班的金額與代扣稅費，扣繳憑單底稿', 'subcontract-billings', 'range'],
      ['出工日報', '每日出工人員、工數與工資成本', 'labor-logs', 'range'],
      ['報驗申報清冊', '台電、自來水處等報驗案件辦理狀況', 'filings', 'none'],
      ['線上估價詢問', '官網詢價來源、成案率與客服紀錄', 'enquiries', 'range']
    ];

    const params = kind => kind === 'range' ? `from=${first}&to=${today}`
      : kind === 'month' ? `period=${month}&month=${month}`
        : kind === 'year' ? `year=${year}` : '';

    el.innerHTML = `
      ${App.toolbar(`
        <label style="font-size:13.5px">期間</label>
        <input type="date" id="r-from" value="${first}"> ~ <input type="date" id="r-to" value="${today}">
        <label style="font-size:13.5px">月份</label><input type="month" id="r-month" value="${month}">
        <label style="font-size:13.5px">年度</label><input type="number" id="r-year" value="${year}" style="width:90px">`)}

      ${UI.table(['報表', '說明', '期間依據', '下載'], reports.map(([name, desc, path, kind]) => `
        <tr data-path="${path}" data-kind="${kind}">
          <td><strong>${UI.esc(name)}</strong></td>
          <td class="wrap">${UI.esc(desc)}</td>
          <td>${({ range: '起訖日', month: '月份', year: '年度', none: '全部' })[kind]}</td>
          <td class="num" style="white-space:nowrap">
            <button class="btn small secondary" data-fmt="csv">CSV</button>
            <button class="btn small secondary" data-fmt="xlsx">Excel</button>
            <button class="btn small secondary" data-fmt="pdf">列印</button></td>
        </tr>`))}

      ${App.noticeBox('「列印」會另開分頁並跳出列印視窗，選擇「另存為 PDF」即可產生 PDF 檔。')}`;

    el.querySelectorAll('[data-fmt]').forEach(b => {
      b.onclick = () => {
        const tr = b.closest('tr');
        const kind = tr.dataset.kind;
        const from = el.querySelector('#r-from').value, to = el.querySelector('#r-to').value;
        const m = el.querySelector('#r-month').value, y = el.querySelector('#r-year').value;
        const p = kind === 'range' ? `from=${from}&to=${to}`
          : kind === 'month' ? `period=${m}&month=${m}`
            : kind === 'year' ? `year=${y}` : '';
        const url = `/api/export/${tr.dataset.path}?${p}&format=${b.dataset.fmt}`;
        if (b.dataset.fmt === 'pdf') window.open(url, '_blank');
        else location.href = url;
      };
    });
    // 預設參數字串保留給沒有動過篩選的情況
    void params;
  }
});

// ================= 公告 =================

App.page('announcements', {
  title: '公告',
  sub: '內部佈達與客戶專區公告',
  module: 'announcements',
  async render(el) {
    const rows = await GET('/announcements');
    const today = UI.today();

    el.innerHTML = `
      ${App.toolbar(`<span class="spacer"></span><button class="btn" id="new-ann">＋ 新增公告</button>`)}

      ${rows.length ? rows.map(a => {
      const expired = a.expire_date && a.expire_date < today;
      return `<div class="card">
        <h3>${UI.esc(a.title)}
          ${a.to_customer ? UI.tag('客戶可見', 'primary') : UI.tag('僅內部')}
          ${expired ? UI.tag('已過期', 'danger') : ''}</h3>
        <div style="white-space:pre-wrap;font-size:13.5px;line-height:1.8">${UI.esc(a.body || '')}</div>
        <div style="margin-top:10px;display:flex;align-items:center;gap:10px">
          <span style="color:var(--muted);font-size:12.5px">
            發布 ${UI.esc(a.publish_date || '')}${a.expire_date ? `　至 ${UI.esc(a.expire_date)}` : ''}
            ${a.creator ? `　${UI.esc(a.creator)}` : ''}</span>
          <span class="spacer"></span>
          <button class="btn small secondary" data-edit="${a.id}">編輯</button>
          <button class="btn small secondary" data-del="${a.id}">刪除</button>
        </div></div>`;
    }).join('') : '<div class="empty">尚無公告</div>'}`;

    const dialog = a => UI.modal({
      title: a ? '編輯公告' : '新增公告',
      wide: true,
      body: `<div class="form-grid">
        ${UI.input('title', '標題', { value: a?.title, required: true, full: true })}
        ${UI.textarea('body', '內容', { value: a?.body, rows: 6 })}
        ${UI.input('publish_date', '發布日', { type: 'date', value: a?.publish_date || UI.today() })}
        ${UI.input('expire_date', '下架日', { type: 'date', value: a?.expire_date })}
        ${UI.checkbox('to_customer', '同時顯示於客戶專區', a?.to_customer, { full: true })}
      </div>`,
      onSubmit: async elm => {
        const b = UI.formData(elm);
        if (!b.title) throw new Error('請填寫標題');
        if (a) await PUT('/announcements/' + a.id, b);
        else await POST('/announcements', b);
        UI.toast('已儲存');
        App.reload();
      }
    });

    el.querySelector('#new-ann').onclick = () => dialog();
    el.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => dialog(rows.find(a => a.id === Number(b.dataset.edit)));
    });
    el.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('確定刪除這則公告嗎？')) return;
        try { await DEL('/announcements/' + b.dataset.del); UI.toast('已刪除'); App.reload(); }
        catch (e) { UI.err(e); }
      };
    });
  }
});

// ================= 帳號權限 =================

App.page('users', {
  title: '帳號權限',
  sub: '員工帳號、技師資料、證照與模組權限',
  module: 'users',
  async render(el) {
    const rows = await GET('/users');
    const modules = App.meta.modules || [];

    el.innerHTML = `
      ${App.toolbar(`
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.filter(u => u.active).length} 個啟用帳號</span>
        ${App.me.role === 'admin' ? '<button class="btn" id="new-user">＋ 新增帳號</button>' : ''}`)}

      ${UI.table(['帳號', '姓名／職稱', '角色', '電話', '技師編號', '證照／到期', '時薪', '抽成率', '權限模組', ''], rows.map(u => `
        <tr>
          <td>${UI.esc(u.username)}${u.active ? '' : '<br>' + UI.tag('停用', 'danger')}</td>
          <td><strong>${UI.esc(u.name)}</strong>
            <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(u.title || '')}</span></td>
          <td>${u.role === 'admin' ? UI.tag('管理員', 'primary') : UI.tag('員工')}
            ${u.is_tech ? UI.tag('技師', 'ok') : ''}</td>
          <td>${UI.esc(u.phone || '')}</td>
          <td>${UI.esc(u.tech_no || '－')}</td>
          <td class="wrap">${UI.esc(u.license || '－')}
            ${u.license_expiry ? `<br>${Cust.dateTag(u.license_expiry, true)}` : ''}</td>
          <td class="num">${u.hourly_rate || '－'}</td>
          <td class="num">${u.commission_rate ? (u.commission_rate * 100).toFixed(1) + '%' : '－'}</td>
          <td class="wrap" style="font-size:12.5px;color:var(--muted)">
            ${u.role === 'admin' ? '全部' : (u.modules.map(k => (modules.find(m => m.key === k) || {}).label || k).join('、') || '無')}</td>
          <td class="num">${App.me.role === 'admin' ? `<button class="btn small secondary" data-user="${u.id}">編輯</button>` : ''}</td>
        </tr>`))}`;

    const dialog = u => UI.modal({
      title: u ? `編輯帳號：${u.username}` : '新增帳號',
      wide: true,
      body: `<div class="form-grid">
        ${u ? '' : UI.input('username', '登入帳號', { required: true })}
        ${UI.input('name', '姓名', { value: u?.name, required: true })}
        ${UI.input('password', u ? '重設密碼（留空不變更）' : '密碼（至少 6 碼）', { type: 'password' })}
        ${UI.input('title', '職稱', { value: u?.title, placeholder: '例：工程部主任、客服' })}
        ${UI.select('role', '角色', [['staff', '員工'], ['admin', '管理員（全部權限）']], { value: u?.role || 'staff' })}
        ${UI.input('phone', '電話', { value: u?.phone })}
        ${UI.input('tech_no', '技師編號', { value: u?.tech_no })}
        ${UI.input('license', '證照', { value: u?.license, placeholder: '例：冷凍空調技術士乙級' })}
        ${UI.input('license_expiry', '證照到期日', { type: 'date', value: u?.license_expiry })}
        ${UI.input('hourly_rate', '時薪／工資單價', { type: 'number', value: u?.hourly_rate ?? 0 })}
        ${UI.input('commission_rate', '抽成率（0.15 = 15%）', { type: 'number', step: '0.01', value: u?.commission_rate ?? 0 })}
        ${UI.input('base_salary', '底薪', { type: 'number', value: u?.base_salary ?? 0 })}
        ${UI.checkbox('is_tech', '此帳號為技師（可被派工）', u?.is_tech)}
        ${u ? UI.checkbox('active', '啟用中', u.active) : ''}
        <div class="form-row full"><label>權限模組</label>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${modules.map(m => `<label style="display:flex;align-items:center;gap:5px;font-weight:400;font-size:13.5px">
              <input type="checkbox" class="u-mod" value="${m.key}"${u && u.modules.includes(m.key) ? ' checked' : ''}
                style="width:auto">${UI.esc(m.label)}</label>`).join('')}
          </div>
          <div style="font-size:12.5px;color:var(--muted);margin-top:6px">管理員角色不受此設定限制，一律擁有全部權限。</div></div>
      </div>`,
      onSubmit: async elm => {
        const b = UI.formData(elm);
        b.modules = [...elm.querySelectorAll('.u-mod:checked')].map(c => c.value);
        if (!b.password) delete b.password;
        if (u) await PUT('/users/' + u.id, b);
        else await POST('/users', b);
        UI.toast('已儲存');
        App.reload();
      }
    });

    const nu = el.querySelector('#new-user');
    if (nu) nu.onclick = () => dialog();
    el.querySelectorAll('[data-user]').forEach(b => {
      b.onclick = () => dialog(rows.find(u => u.id === Number(b.dataset.user)));
    });
  }
});

// ================= 系統設定 =================

App.page('settings', {
  title: '系統設定',
  sub: '公司抬頭、計價參數、選項清單與前台文字',
  module: 'settings',
  async render(el) {
    const s = await GET('/settings');

    // [區塊標題, [[key, label, 說明或型態]]]
    const groups = [
      ['公司抬頭（列印單據用）', [
        ['company_name', '公司名稱'], ['company_tax_id', '統一編號'],
        ['company_phone', '電話'], ['company_fax', '傳真'],
        ['company_email', 'Email'], ['company_address', '地址', 'wide'],
        ['company_bank', '匯款帳號（請款單列印）', 'wide']
      ]],
      ['計價參數', [
        ['tax_rate', '營業稅率（0.05 = 5%）'], ['labor_rate_hour', '標準工資（每人時）'],
        ['travel_fee_default', '預設車馬費'], ['min_labor_fee', '最低收費'],
        ['warranty_months_default', '施工保固月數'], ['invoice_due_days', '請款預設付款天數']
      ]],
      ['抽成', [
        ['commission_basis', '抽成基準（profit 毛利／labor 工資／revenue 營收）', 'wide'],
        ['commission_rate_default', '預設抽成率（0.15 = 15%）']
      ]],
      ['庫存', [
        ['stock_negative', '允許負庫存出庫（1 允許／0 擋下）'],
        ['low_stock_alert', '低庫存提醒（1 開／0 關）'],
        ['refrigerant_alert_kg', '冷媒單次充填提醒門檻（kg）']
      ]],
      ['選項清單（以逗號分隔）', [
        ['order_sources', '工單來源', 'wide'], ['appoint_slots', '預約時段', 'wide'],
        ['units', '單位', 'wide'], ['payment_terms', '付款條件', 'wide'],
        ['pay_methods', '收付款方式', 'wide'], ['refrigerants', '冷媒種類', 'wide'],
        ['equipment_categories', '設備機種', 'wide'], ['power_specs', '電源規格', 'wide']
      ]],
      ['保養檢查表預設項目（以分號 ; 分隔）', [
        ['check_items_default', '檢查項目', 'area']
      ]],
      ['前台文字（清空即隱藏該區塊）', [
        ['ui_staff_login_title', '員工登入頁標題', 'wide'],
        ['ui_staff_login_sub', '員工登入頁副標', 'wide'],
        ['ui_demo_staff', '員工登入頁提示（正式上線請清空）', 'area'],
        ['ui_portal_title', '客戶專區標題', 'wide'],
        ['ui_portal_login_sub', '客戶專區副標', 'wide'],
        ['ui_portal_login_hint', '客戶登入說明', 'area'],
        ['ui_demo_portal', '客戶登入頁提示（正式上線請清空）', 'area'],
        ['ui_repair_note', '線上報修送出說明', 'area']
      ]]
    ];

    el.innerHTML = groups.map(([title, fields]) => `
      <div class="card"><h3>${UI.esc(title)}</h3>
        <div class="form-grid">
          ${fields.map(([k, label, type]) => type === 'area'
      ? UI.textarea(k, label, { value: s[k] ?? '', rows: 3 })
      : UI.input(k, label, { value: s[k] ?? '', full: type === 'wide' })).join('')}
        </div></div>`).join('') + `
      <div class="toolbar"><span class="spacer"></span>
        <button class="btn" id="save-settings">儲存設定</button></div>

      <div class="card"><h3>稽核軌跡</h3>
        <div class="toolbar" style="margin-top:0">
          <input id="a-q" placeholder="搜尋操作人／動作／對象" style="min-width:230px">
          <input type="date" id="a-from"> ~ <input type="date" id="a-to">
          <button class="btn small secondary" id="a-go">查詢</button>
        </div>
        <div id="audit-box"><div class="empty">輸入條件後查詢</div></div>
      </div>`;

    el.querySelector('#save-settings').onclick = async () => {
      const body = {};
      el.querySelectorAll('.card input[name], .card textarea[name]').forEach(i => { body[i.name] = i.value; });
      try {
        await PUT('/settings', body);
        UI.toast('設定已儲存，重新整理後生效');
        App.meta = await GET('/meta');
      } catch (e) { UI.err(e); }
    };

    const loadAudit = async () => {
      const q = el.querySelector('#a-q').value, from = el.querySelector('#a-from').value, to = el.querySelector('#a-to').value;
      const rows = await GET(`/audit-logs?q=${encodeURIComponent(q)}&from=${from}&to=${to}`).catch(() => []);
      el.querySelector('#audit-box').innerHTML = UI.table(['時間', '身分', '操作人', '動作', '對象', '備註'], rows.map(a => `
        <tr><td>${UI.esc((a.created_at || '').slice(0, 16))}</td>
          <td>${a.actor_type === 'customer' ? UI.tag('客戶') : UI.tag('員工', 'primary')}</td>
          <td>${UI.esc(a.actor_name || '')}</td>
          <td>${UI.esc(a.action || '')}</td>
          <td class="wrap">${UI.esc(a.target || '')}</td>
          <td class="wrap">${UI.esc(a.detail || '')}</td></tr>`), '查無稽核紀錄');
    };
    el.querySelector('#a-go').onclick = loadAudit;
  }
});
