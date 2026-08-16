// 客戶管理、服務地點、設備履歷、保養合約

// ================= 客戶 =================

App.page('customers', {
  title: '客戶',
  sub: '客戶基本資料、服務地點、設備與往來紀錄',
  module: 'customers',
  async render(el, id) {
    if (id) return Cust.renderDetail(el, id);
    const f = App._custFilter || (App._custFilter = { q: '', status: 'active' });
    const rows = await GET(`/customers?q=${encodeURIComponent(f.q)}&status=${f.status}`);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋名稱／電話／統編／地址" value="${UI.esc(f.q)}" style="min-width:240px">
        <select id="f-status">
          <option value="active"${f.status === 'active' ? ' selected' : ''}>使用中</option>
          <option value="inactive"${f.status === 'inactive' ? ' selected' : ''}>已停用</option>
          <option value=""${f.status === '' ? ' selected' : ''}>全部</option>
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 筆</span>
        <button class="btn" id="new-cust">＋ 新增客戶</button>`)}

      ${UI.table(['客編／名稱', '聯絡', '地址', '地點／設備', '工單', '合約', '未收款', '最近服務'], rows.map(c => `
        <tr style="cursor:pointer" onclick="location.hash='customers/${c.id}'">
          <td><strong>${UI.esc(c.name)}</strong>${c.active ? '' : ' ' + UI.tag('停用', 'danger')}
            <br><span style="color:var(--muted);font-size:12px">${UI.esc(c.code)}
            ${c.kind === 'company' ? '／' + UI.esc(c.tax_id || '公司') : ''}</span></td>
          <td class="wrap">${UI.esc(c.contact || '')}<br>
            <span style="color:var(--muted);font-size:12.5px">${UI.esc(c.phone || '')}</span></td>
          <td class="wrap">${UI.esc(c.address || '')}</td>
          <td class="num">${c.site_count} ／ ${c.equip_count}</td>
          <td class="num">${c.order_count}</td>
          <td class="num">${c.contract_count ? UI.tag('合約 ' + c.contract_count, 'primary') : '－'}</td>
          <td class="num">${c.ar ? `<strong style="color:var(--danger)">${UI.money(c.ar)}</strong>` : '－'}</td>
          <td>${UI.esc(c.last_service || '－')}</td>
        </tr>`), '沒有符合條件的客戶')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.customers.render(el); }, 350);
    });
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.customers.render(el); };
    el.querySelector('#new-cust').onclick = () => Cust.editDialog();
  }
});

const Cust = {
  // ---- 新增／修改客戶 ----
  editDialog(c) {
    const isNew = !c;
    UI.modal({
      title: isNew ? '新增客戶' : `修改客戶：${c.name}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (isNew) {
          const r = await POST('/customers', b);
          UI.toast('客戶已建立');
          location.hash = 'customers/' + r.id;
        } else {
          await PUT('/customers/' + c.id, b);
          UI.toast('已儲存');
          App.reload();
        }
      },
      body: `<div class="form-grid">
        ${UI.input('name', '客戶名稱', { value: c?.name, required: true, full: true })}
        ${UI.select('kind', '客戶類型', [['person', '個人'], ['company', '公司行號'], ['gov', '機關學校'], ['agent', '同業／代工']], { value: c?.kind || 'person' })}
        ${UI.input('code', '客戶編號', { value: c?.code, placeholder: '留空自動編號' })}
        ${UI.input('tax_id', '統一編號', { value: c?.tax_id, placeholder: '公司戶必填，8 碼' })}
        ${UI.input('contact', '主要聯絡人', { value: c?.contact })}
        ${UI.input('phone', '電話／手機', { value: c?.phone })}
        ${UI.input('phone2', '備用電話', { value: c?.phone2 })}
        ${UI.input('email', 'Email', { value: c?.email })}
        ${UI.input('address', '主要地址', { value: c?.address, full: true })}
        ${UI.input('invoice_title', '發票抬頭', { value: c?.invoice_title, placeholder: '留空則用客戶名稱' })}
        ${UI.select('invoice_type', '發票類型', [['none', '不開發票'], ['duplicate', '二聯式'], ['triplicate', '三聯式'], ['receipt', '收據']], { value: c?.invoice_type || 'none' })}
        ${UI.inputList('payment_terms', '付款條件', App.meta.payment_terms || [], { value: c?.payment_terms, placeholder: '例：月結 30 天' })}
        ${UI.select('price_level', '適用價別', App.mapOpts(TW.price_level), { value: c?.price_level || 'retail' })}
        ${UI.input('credit_limit', '信用額度', { type: 'number', value: c?.credit_limit || 0 })}
        ${UI.input('source', '客戶來源', { value: c?.source, placeholder: '例：介紹、網路、舊客' })}
        ${UI.textarea('note', '備註', { value: c?.note, placeholder: '例：大樓管理室需先登記、停車位置、狗會叫' })}
        ${isNew ? '' : UI.checkbox('active', '啟用中（取消勾選＝停用）', c.active)}
      </div>`
    });
  },

  // ---- 客戶明細 ----
  async renderDetail(el, id) {
    const c = await GET('/customers/' + id);
    const sites = c.sites, equips = c.equipments;

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#customers">← 回列表</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="new-site">＋ 服務地點</button>
        <button class="btn small secondary" id="new-equip">＋ 設備</button>
        <button class="btn small secondary" id="new-contract">＋ 保養合約</button>
        <button class="btn small secondary" id="edit-cust">修改資料</button>
        <button class="btn" id="new-order">＋ 開工單</button>`)}

      <div class="split">
        <div>
          <div class="card"><h3>基本資料</h3>
            <div class="detail-grid">
              <div><div class="dg-label">客戶編號</div>${UI.esc(c.code)}</div>
              <div><div class="dg-label">類型</div>${({ person: '個人', company: '公司行號', gov: '機關學校', agent: '同業／代工' })[c.kind] || c.kind}</div>
              <div><div class="dg-label">統一編號</div>${UI.esc(c.tax_id || '－')}</div>
              <div><div class="dg-label">聯絡人</div>${UI.esc(c.contact || '－')}</div>
              <div><div class="dg-label">電話</div>${UI.esc(c.phone || '－')}${c.phone2 ? '／' + UI.esc(c.phone2) : ''}</div>
              <div><div class="dg-label">Email</div>${UI.esc(c.email || '－')}</div>
              <div><div class="dg-label">地址</div>${UI.esc(c.address || '－')}</div>
              <div><div class="dg-label">付款條件</div>${UI.esc(c.payment_terms || '－')}</div>
              <div><div class="dg-label">適用價別</div>${UI.esc(TW.price_level[c.price_level] || c.price_level)}</div>
              <div><div class="dg-label">信用額度</div>${c.credit_limit ? UI.money(c.credit_limit) : '未設定'}</div>
            </div>
            ${c.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(c.note)}</div>` : ''}
          </div>

          <div class="card"><h3>服務地點（${sites.length}）</h3>
            ${UI.table(['地點', '地址', '聯絡人／電話', '樓層備註', ''], sites.map(s => `
              <tr>
                <td>${UI.esc(s.name)}${s.active ? '' : ' ' + UI.tag('停用', 'danger')}</td>
                <td class="wrap">${UI.esc(s.address || '')}</td>
                <td>${UI.esc(s.contact || '')}<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(s.phone || '')}</span></td>
                <td class="wrap">${UI.esc(s.floor_note || '')}</td>
                <td class="num"><button class="btn small secondary" data-site="${s.id}">編輯</button></td>
              </tr>`), '尚未建立服務地點，單一地址的客戶可以不建')}
          </div>

          <div class="card"><h3>設備清單（${equips.length}）</h3>
            ${UI.table(['機號／位置', '品牌型號', '冷媒／噸數', '安裝日', '保固到期', '下次保養', '狀態'], equips.map(e => `
              <tr style="cursor:pointer" onclick="location.hash='equipments/${e.id}'">
                <td>${UI.esc(e.asset_no)}<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(e.location || e.site_name || '')}</span></td>
                <td class="wrap"><strong>${UI.esc(e.brand)}</strong> ${UI.esc(e.model)}
                  <br><span style="color:var(--muted);font-size:12px">${UI.esc(e.category || '')}</span></td>
                <td>${UI.esc(e.refrigerant || '－')}${e.tonnage ? `<br><span style="color:var(--muted);font-size:12.5px">${e.tonnage} RT</span>` : ''}</td>
                <td>${UI.esc(e.install_date || '－')}</td>
                <td>${Cust.dateTag(e.warranty_end)}</td>
                <td>${Cust.dateTag(e.next_service_date, true)}</td>
                <td>${UI.tag(TW.equip_status[e.status], e.status === 'active' ? 'ok' : e.status === 'repair' ? 'warn' : '')}</td>
              </tr>`), '尚未建立設備履歷')}
          </div>

          <div class="card"><h3>工單紀錄</h3>
            ${UI.table(['工單號', '類別', '日期', '案由', '金額', '狀態'], c.orders.map(o => `
              <tr style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
                <td>${UI.esc(o.order_no)}</td>
                <td>${UI.tag(TW.order_type[o.type] || o.type)}</td>
                <td>${UI.esc(o.appoint_date || '')}</td>
                <td class="wrap">${UI.esc(o.title || '')}</td>
                <td class="num">${UI.money(o.total)}</td>
                <td>${UI.tag(TW.order_status[o.status], TW.status_cls[o.status])}</td>
              </tr>`), '尚無工單紀錄')}
          </div>
        </div>

        <div>
          <div class="card"><h3>保養合約</h3>
            ${c.contracts.length ? `<ul class="mini-list">${c.contracts.map(sc => `
              <li style="cursor:pointer" onclick="location.hash='contracts/${sc.id}'">
                <div class="ml-main">${UI.esc(sc.title)}
                  <div class="ml-sub">${UI.esc(sc.contract_no)}　${UI.esc(sc.start_date)} ~ ${UI.esc(sc.end_date)}</div></div>
                <div style="text-align:right">${UI.tag(TW.contract_status[sc.status], sc.status === 'active' ? 'ok' : '')}
                  <div class="ml-sub">下次 ${UI.esc(sc.next_visit_date || '－')}</div></div>
              </li>`).join('')}</ul>` : '<div style="color:var(--muted);font-size:13.5px">尚未簽訂保養合約</div>'}
          </div>

          <div class="card"><h3>帳務</h3>
            ${UI.table(['單號', '日期', '金額', '未收', '狀態'], c.invoices.map(i => `
              <tr style="cursor:pointer" onclick="location.hash='invoices/${i.id}'">
                <td>${UI.esc(i.inv_no)}</td>
                <td>${UI.esc(i.issue_date)}<br><span style="color:var(--muted);font-size:12px">到期 ${UI.esc(i.due_date || '－')}</span></td>
                <td class="num">${UI.money(i.total)}</td>
                <td class="num">${i.total - i.paid > 0 ? `<strong style="color:var(--danger)">${UI.money(i.total - i.paid)}</strong>` : '－'}</td>
                <td>${UI.tag(TW.inv_status[i.status], TW.inv_cls[i.status])}</td>
              </tr>`), '尚無請款單')}
          </div>

          <div class="card"><h3>客戶專區帳號</h3>
            ${c.portal_users.length ? `<ul class="mini-list">${c.portal_users.map(u => `
              <li><div class="ml-main">${UI.esc(u.name || '未命名')}
                  <div class="ml-sub">${UI.esc(u.phone)}　${u.last_login ? '最近登入 ' + UI.esc(u.last_login.slice(0, 16)) : '尚未登入'}</div></div>
                <div style="text-align:right">${u.active ? UI.tag('啟用', 'ok') : UI.tag('停用', 'danger')}
                  <div style="margin-top:5px"><button class="btn small secondary" data-pu="${u.id}" data-name="${UI.esc(u.name || '')}">管理</button></div></div>
              </li>`).join('')}</ul>` : '<div style="color:var(--muted);font-size:13.5px">尚未開通客戶專區</div>'}
            <button class="btn small" id="new-pu" style="margin-top:10px">＋ 開通帳號</button>
          </div>
        </div>
      </div>`;

    el.querySelector('#edit-cust').onclick = () => Cust.editDialog(c);
    el.querySelector('#new-order').onclick = async () => {
      const m = await Orders.newOrderDialog();
      // 直接帶入這位客戶，省去再搜尋一次
      const input = m.body.querySelector('#wo-customer');
      input.value = c.name;
      input.dispatchEvent(new Event('input'));
    };
    el.querySelector('#new-site').onclick = () => Cust.siteDialog(c.id);
    el.querySelector('#new-equip').onclick = () => Equip.editDialog(null, c);
    el.querySelector('#new-contract').onclick = () => Contract.editDialog(null, c);
    el.querySelectorAll('[data-site]').forEach(b => {
      b.onclick = () => Cust.siteDialog(c.id, sites.find(s => s.id === Number(b.dataset.site)));
    });
    el.querySelector('#new-pu').onclick = () => Cust.portalUserDialog(c);
    el.querySelectorAll('[data-pu]').forEach(b => {
      b.onclick = () => Cust.portalUserEditDialog(Number(b.dataset.pu), b.dataset.name);
    });
  },

  // 到期日標籤：過期紅、30 天內黃
  dateTag(d, isService) {
    if (!d) return '－';
    const today = UI.today();
    if (d < today) return UI.tag(d + (isService ? '（已到期）' : '（已過保）'), 'danger');
    if (d <= UI.addDays(today, 30)) return UI.tag(d, 'warn');
    return UI.esc(d);
  },

  siteDialog(customerId, s) {
    UI.modal({
      title: s ? '修改服務地點' : '新增服務地點',
      body: `<div class="form-grid">
        ${UI.input('name', '地點名稱', { value: s?.name, required: true, full: true, placeholder: '例：忠孝店、B1 機房' })}
        ${UI.input('address', '地址', { value: s?.address, full: true })}
        ${UI.input('contact', '現場聯絡人', { value: s?.contact })}
        ${UI.input('phone', '電話', { value: s?.phone })}
        ${UI.textarea('floor_note', '到場提醒', { value: s?.floor_note, placeholder: '例：貨梯限重、機房鑰匙在管理室、假日需事先報備' })}
        ${s ? UI.checkbox('active', '啟用中', s.active) : ''}
      </div>`,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.name) throw new Error('請填寫地點名稱');
        if (s) await PUT('/sites/' + s.id, b);
        else await POST('/sites', { ...b, customer_id: customerId });
        UI.toast('已儲存');
        App.reload();
      }
    });
  },

  portalUserDialog(c) {
    UI.modal({
      title: '開通客戶專區帳號',
      body: `<div class="form-grid">
        ${UI.input('phone', '手機號碼（即為帳號）', { value: c.phone, full: true, placeholder: '09xxxxxxxx' })}
        ${UI.input('name', '姓名', { value: c.contact, full: true })}
      </div>
      <div style="margin-top:10px;font-size:13px;color:var(--muted)">預設密碼為手機末 6 碼，客戶首次登入時會強制更換。</div>`,
      onSubmit: async el => {
        const r = await POST(`/customers/${c.id}/portal-user`, UI.formData(el));
        UI.toast(`已開通，預設密碼 ${r.init_password}`);
        App.reload();
      }
    });
  },

  portalUserEditDialog(id, name) {
    UI.modal({
      title: '管理客戶帳號',
      body: `<div class="form-grid">
        ${UI.input('name', '姓名', { value: name, full: true })}
        ${UI.checkbox('active', '啟用中', true, { full: true })}
        ${UI.checkbox('reset_password', '重設密碼為手機末 6 碼', false, { full: true })}
      </div>`,
      onSubmit: async el => {
        const r = await PUT('/portal-users/' + id, UI.formData(el));
        UI.toast(r.init_password ? `密碼已重設為 ${r.init_password}` : '已儲存');
        App.reload();
      }
    });
  }
};

// ================= 設備履歷 =================

App.page('equipments', {
  title: '設備履歷',
  sub: '每一台機器的身分證：規格、保固、保養與維修紀錄',
  module: 'equipments',
  async render(el, id) {
    if (id) return Equip.renderDetail(el, id);
    const f = App._equipFilter || (App._equipFilter = { q: '', category: '', status: 'active', due: '' });
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rows = await GET('/equipments?' + qs);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋機號／品牌／型號／機身號碼／客戶" value="${UI.esc(f.q)}" style="min-width:250px">
        <select id="f-category"><option value="">全部機種</option>
          ${(App.meta.equipment_categories || []).map(c =>
      `<option value="${UI.esc(c)}"${f.category === c ? ' selected' : ''}>${UI.esc(c)}</option>`).join('')}
        </select>
        <select id="f-status">
          ${Object.entries(TW.equip_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
          <option value=""${f.status === '' ? ' selected' : ''}>全部狀態</option>
        </select>
        <label style="display:flex;align-items:center;gap:5px;font-size:13.5px">
          <input type="checkbox" id="f-due"${f.due ? ' checked' : ''} style="width:auto">只看保養已到期</label>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 台</span>
        <button class="btn" id="new-equip">＋ 新增設備</button>`)}

      ${UI.table(['機號', '客戶／位置', '品牌型號', '機種', '冷媒', '安裝日', '保固到期', '下次保養', '維修次數', '狀態'], rows.map(e => `
        <tr style="cursor:pointer" onclick="location.hash='equipments/${e.id}'">
          <td>${UI.esc(e.asset_no)}</td>
          <td class="wrap"><strong>${UI.esc(e.customer_name)}</strong>
            <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(e.site_name || '')} ${UI.esc(e.location || '')}</span></td>
          <td class="wrap"><strong>${UI.esc(e.brand)}</strong> ${UI.esc(e.model)}</td>
          <td>${UI.esc(e.category || '')}</td>
          <td>${UI.esc(e.refrigerant || '－')}${e.refrigerant_kg ? `<br><span style="color:var(--muted);font-size:12px">${e.refrigerant_kg} kg</span>` : ''}</td>
          <td>${UI.esc(e.install_date || '－')}</td>
          <td>${Cust.dateTag(e.warranty_end)}</td>
          <td>${Cust.dateTag(e.next_service_date, true)}</td>
          <td class="num">${e.service_count}</td>
          <td>${UI.tag(TW.equip_status[e.status], e.status === 'active' ? 'ok' : e.status === 'repair' ? 'warn' : '')}</td>
        </tr>`), '沒有符合條件的設備')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.equipments.render(el); }, 350);
    });
    el.querySelector('#f-category').onchange = e => { f.category = e.target.value; App.pages.equipments.render(el); };
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.equipments.render(el); };
    el.querySelector('#f-due').onchange = e => { f.due = e.target.checked ? '1' : ''; App.pages.equipments.render(el); };
    el.querySelector('#new-equip').onclick = () => Equip.editDialog();
  }
});

const Equip = {
  // ---- 新增／修改設備；帶 customer 時鎖定客戶 ----
  async editDialog(e, customer) {
    let sites = [];
    if (customer) sites = (customer.sites || []).filter(s => s.active);
    else if (e) {
      const full = await GET('/customers/' + e.customer_id);
      sites = full.sites.filter(s => s.active);
    }
    const cid = e?.customer_id || customer?.id || '';
    const cname = e?.customer_name || customer?.name || '';

    UI.modal({
      title: e ? `修改設備：${e.asset_no}` : '新增設備',
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.customer_id) throw new Error('請先選擇客戶');
        if (!b.brand && !b.model) throw new Error('請至少填寫品牌或型號');
        if (e) await PUT('/equipments/' + e.id, b);
        else await POST('/equipments', b);
        UI.toast('已儲存');
        App.reload();
      },
      onOpen: el => {
        if (cid) return;
        UI.customerPicker(el.querySelector('#eq-customer'), async c => {
          el.querySelector('#eq-customer').value = c.name;
          el.querySelector('[name=customer_id]').value = c.id;
          const full = await GET('/customers/' + c.id);
          const sel = el.querySelector('[name=site_id]');
          sel.innerHTML = '<option value="">未指定</option>' +
            full.sites.filter(s => s.active).map(s => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('');
        });
      },
      body: `<div class="form-grid">
        <div class="form-row full"><label>客戶 *</label>
          <input id="eq-customer" value="${UI.esc(cname)}" placeholder="輸入客戶名稱／電話搜尋"
            autocomplete="off"${cid ? ' readonly' : ''}>
          <input type="hidden" name="customer_id" value="${cid}"></div>
        <div class="form-row full"><label>服務地點</label>
          <select name="site_id"><option value="">未指定</option>
            ${sites.map(s => `<option value="${s.id}"${String(e?.site_id) === String(s.id) ? ' selected' : ''}>${UI.esc(s.name)}</option>`).join('')}
          </select></div>
        ${UI.input('asset_no', '機號', { value: e?.asset_no, placeholder: '留空自動編號' })}
        ${UI.inputList('category', '機種', App.meta.equipment_categories || [], { value: e?.category, placeholder: '例：箱型機、分離式、冰水主機' })}
        ${UI.input('brand', '品牌', { value: e?.brand })}
        ${UI.input('model', '型號', { value: e?.model })}
        ${UI.input('serial_no', '機身號碼', { value: e?.serial_no })}
        ${UI.input('location', '安裝位置', { value: e?.location, placeholder: '例：3F 辦公室、頂樓' })}
        ${UI.input('capacity_kw', '能力（kW）', { type: 'number', step: '0.01', value: e?.capacity_kw ?? '' })}
        ${UI.input('tonnage', '噸數（RT）', { type: 'number', step: '0.1', value: e?.tonnage ?? '' })}
        ${UI.inputList('refrigerant', '冷媒種類', App.meta.refrigerants || [], { value: e?.refrigerant })}
        ${UI.input('refrigerant_kg', '冷媒填充量（kg）', { type: 'number', step: '0.01', value: e?.refrigerant_kg ?? '' })}
        ${UI.inputList('power_spec', '電源規格', App.meta.power_specs || [], { value: e?.power_spec })}
        ${UI.input('install_date', '安裝日', { type: 'date', value: e?.install_date })}
        ${UI.input('warranty_end', '整機保固到期', { type: 'date', value: e?.warranty_end, placeholder: '留空依安裝日自動推算' })}
        ${UI.input('compressor_warranty_end', '壓縮機保固到期', { type: 'date', value: e?.compressor_warranty_end })}
        ${UI.input('next_service_date', '下次保養日', { type: 'date', value: e?.next_service_date })}
        ${UI.select('status', '狀態', App.mapOpts(TW.equip_status), { value: e?.status || 'active' })}
        ${UI.textarea('note', '備註', { value: e?.note, placeholder: '例：室外機在鄰棟屋頂，需帶梯子' })}
      </div>`
    });
  },

  // ---- 設備明細（維修履歷） ----
  async renderDetail(el, id) {
    const e = await GET('/equipments/' + id);
    const age = e.install_date ? ((Date.now() - new Date(e.install_date)) / 31557600000).toFixed(1) : null;

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#equipments">← 回列表</a>
        <a class="btn small secondary" href="#customers/${e.customer_id}">客戶資料</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="edit-equip">修改設備</button>
        <button class="btn" id="new-order">＋ 為這台開工單</button>`)}

      <div class="split">
        <div>
          <div class="card"><h3>${UI.esc(e.brand)} ${UI.esc(e.model)}　${UI.tag(TW.equip_status[e.status], e.status === 'active' ? 'ok' : e.status === 'repair' ? 'warn' : '')}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">機號</div>${UI.esc(e.asset_no)}</div>
              <div><div class="dg-label">客戶</div>${UI.esc(e.customer_name)}</div>
              <div><div class="dg-label">位置</div>${UI.esc(e.site_name || '')} ${UI.esc(e.location || '')}</div>
              <div><div class="dg-label">機種</div>${UI.esc(e.category || '－')}</div>
              <div><div class="dg-label">機身號碼</div>${UI.esc(e.serial_no || '－')}</div>
              <div><div class="dg-label">能力／噸數</div>${e.capacity_kw ? e.capacity_kw + ' kW' : '－'}${e.tonnage ? `／${e.tonnage} RT` : ''}</div>
              <div><div class="dg-label">冷媒</div>${UI.esc(e.refrigerant || '－')}${e.refrigerant_kg ? `　${e.refrigerant_kg} kg` : ''}</div>
              <div><div class="dg-label">電源</div>${UI.esc(e.power_spec || '－')}</div>
              <div><div class="dg-label">安裝日</div>${UI.esc(e.install_date || '－')}${age ? `（機齡 ${age} 年）` : ''}</div>
              <div><div class="dg-label">整機保固</div>${Cust.dateTag(e.warranty_end)}</div>
              <div><div class="dg-label">壓縮機保固</div>${Cust.dateTag(e.compressor_warranty_end)}</div>
              <div><div class="dg-label">下次保養</div>${Cust.dateTag(e.next_service_date, true)}</div>
            </div>
            ${e.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(e.note)}</div>` : ''}
          </div>

          <div class="card"><h3>維修履歷（${e.history.length} 次）</h3>
            ${UI.table(['工單號', '類別', '日期', '故障原因／處理', '技師', '金額', '狀態'], e.history.map(h => `
              <tr style="cursor:pointer" onclick="location.hash='orders/${h.id}'">
                <td>${UI.esc(h.order_no)}</td>
                <td>${UI.tag(TW.order_type[h.type] || h.type)}</td>
                <td>${UI.esc((h.finished_at || h.appoint_date || '').slice(0, 10))}</td>
                <td class="wrap">${UI.esc(h.cause || h.title || '')}
                  ${h.action ? `<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(h.action)}</span>` : ''}</td>
                <td>${UI.esc(h.techs || '－')}</td>
                <td class="num">${UI.money(h.total)}</td>
                <td>${UI.tag(TW.order_status[h.status], TW.status_cls[h.status])}</td>
              </tr>`), '這台機器還沒有維修紀錄')}
          </div>

          <div class="card"><h3>檢查紀錄</h3>
            ${UI.table(['工單', '日期', '項目', '結果', '數值', '備註'], e.checks.map(ck => `
              <tr>
                <td>${UI.esc(ck.order_no)}</td>
                <td>${UI.esc((ck.finished_at || '').slice(0, 10))}</td>
                <td class="wrap">${UI.esc(ck.item)}</td>
                <td>${UI.tag(TW.check_result[ck.result] || ck.result || '－', TW.check_cls[ck.result] || '')}</td>
                <td>${UI.esc(ck.value || '')}</td>
                <td class="wrap">${UI.esc(ck.note || '')}</td>
              </tr>`), '尚無檢查紀錄')}
          </div>
        </div>

        <div>
          <div class="card"><h3>維修成本累計</h3>
            <div class="stat" style="cursor:default">
              <div class="num">${UI.money(e.total_spent)}</div>
              <div class="label">歷年維修／保養支出</div></div>
            ${age && Number(age) >= 10 ? App.noticeBox('機齡已超過 10 年\n若維修支出持續累積，可評估建議客戶汰換') : ''}
          </div>

          <div class="card"><h3>冷媒紀錄</h3>
            ${e.refrigerant_logs.length ? `<ul class="mini-list">${e.refrigerant_logs.map(r => `
              <li><div class="ml-main">${UI.esc(TW.ref_action[r.action] || r.action)}　${UI.esc(r.refrigerant || '')}
                  <div class="ml-sub">${UI.esc(r.log_date)}　${UI.esc(r.tech_name || '')}</div></div>
                <div style="text-align:right"><strong>${r.kg} kg</strong></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">尚無冷媒充填／回收紀錄</div>'}
          </div>
        </div>
      </div>`;

    el.querySelector('#edit-equip').onclick = () => Equip.editDialog(e);
    el.querySelector('#new-order').onclick = async () => {
      const m = await Orders.newOrderDialog();
      const input = m.body.querySelector('#wo-customer');
      input.value = e.customer_name;
      input.dispatchEvent(new Event('input'));
      UI.toast('請於視窗中勾選要處理的設備');
    };
  }
};

// ================= 保養合約 =================

App.page('contracts', {
  title: '保養合約',
  sub: '定期保養約的涵蓋設備、到場週期與自動開單',
  module: 'contracts',
  async render(el, id) {
    if (id) return Contract.renderDetail(el, id);
    const f = App._contractFilter || (App._contractFilter = { q: '', status: 'active' });
    const rows = await GET(`/service-contracts?q=${encodeURIComponent(f.q)}&status=${f.status}`);
    const today = UI.today();

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋合約號／名稱／客戶" value="${UI.esc(f.q)}" style="min-width:230px">
        <select id="f-status">
          ${Object.entries(TW.contract_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
          <option value=""${f.status === '' ? ' selected' : ''}>全部</option>
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 份</span>
        <button class="btn secondary" id="gen-due">一鍵產生到期保養工單</button>
        <button class="btn" id="new-contract">＋ 新增合約</button>`)}

      ${UI.table(['合約號', '客戶／地點', '合約名稱', '期間', '週期', '設備', '已保養', '下次到場', '合約金額', '狀態'], rows.map(sc => `
        <tr style="cursor:pointer" onclick="location.hash='contracts/${sc.id}'">
          <td>${UI.esc(sc.contract_no)}</td>
          <td class="wrap"><strong>${UI.esc(sc.customer_name)}</strong>
            ${sc.site_name ? `<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(sc.site_name)}</span>` : ''}</td>
          <td class="wrap">${UI.esc(sc.title)}</td>
          <td>${UI.esc(sc.start_date)}<br><span style="color:var(--muted);font-size:12.5px">~ ${UI.esc(sc.end_date)}
            ${sc.end_date < UI.addDays(today, 60) && sc.status === 'active' ? ' ⚠' : ''}</span></td>
          <td>每 ${sc.interval_months} 月<br><span style="color:var(--muted);font-size:12px">年 ${sc.times_per_year} 次</span></td>
          <td class="num">${sc.equip_count}</td>
          <td class="num">${sc.done_visits}</td>
          <td>${Cust.dateTag(sc.next_visit_date, true)}</td>
          <td class="num">${UI.money(sc.amount)}</td>
          <td>${UI.tag(TW.contract_status[sc.status], sc.status === 'active' ? 'ok' : '')}</td>
        </tr>`), '沒有符合條件的合約')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.contracts.render(el); }, 350);
    });
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.contracts.render(el); };
    el.querySelector('#new-contract').onclick = () => Contract.editDialog();
    el.querySelector('#gen-due').onclick = async () => {
      if (!await UI.confirm('將為所有已到期的保養合約各開立一張保養工單（已有未完成單者略過），確定嗎？')) return;
      try {
        const r = await POST('/service-contracts/generate-due', {});
        UI.toast(`已產生 ${r.created} 張保養工單`);
        App.reload();
      } catch (err) { UI.err(err); }
    };
  }
});

const Contract = {
  async editDialog(sc, customer) {
    // 合約要挑設備，先把該客戶的設備清單抓回來
    let cust = customer;
    if (!cust && sc) cust = await GET('/customers/' + sc.customer_id);
    const picked = sc ? (await GET('/service-contracts/' + sc.id)).equipments.map(e => e.id) : [];
    const equipList = el => (cust ? cust.equipments.filter(e => e.status !== 'scrapped') : []).map(e =>
      `<label style="display:flex;align-items:center;gap:5px;font-weight:400;font-size:13.5px">
        <input type="checkbox" class="sc-equip" value="${e.id}"${picked.includes(e.id) ? ' checked' : ''} style="width:auto">
        ${UI.esc(e.brand)} ${UI.esc(e.model)}<span style="color:var(--muted)">（${UI.esc(e.location || e.asset_no)}）</span></label>`).join('');

    UI.modal({
      title: sc ? `修改合約：${sc.contract_no}` : '新增保養合約',
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.customer_id) throw new Error('請先選擇客戶');
        if (!b.start_date || !b.end_date) throw new Error('請填寫合約起訖日');
        b.equipment_ids = [...el.querySelectorAll('.sc-equip:checked')].map(c => Number(c.value));
        if (sc) { await PUT('/service-contracts/' + sc.id, b); UI.toast('已儲存'); App.reload(); }
        else {
          const r = await POST('/service-contracts', b);
          UI.toast(`合約 ${r.contract_no} 已建立`);
          location.hash = 'contracts/' + r.id;
        }
      },
      onOpen: el => {
        if (cust) return;
        UI.customerPicker(el.querySelector('#sc-customer'), async c => {
          cust = await GET('/customers/' + c.id);
          el.querySelector('#sc-customer').value = c.name;
          el.querySelector('[name=customer_id]').value = c.id;
          el.querySelector('[name=site_id]').innerHTML = '<option value="">全部地點</option>' +
            cust.sites.filter(s => s.active).map(s => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('');
          el.querySelector('#sc-equips').innerHTML = equipList(el) || '<span style="color:var(--muted);font-size:13px">此客戶尚未建立設備</span>';
        });
      },
      body: `<div class="form-grid">
        <div class="form-row full"><label>客戶 *</label>
          <input id="sc-customer" value="${UI.esc(cust?.name || '')}" placeholder="輸入客戶名稱／電話搜尋"
            autocomplete="off"${sc ? ' readonly' : ''}>
          <input type="hidden" name="customer_id" value="${sc?.customer_id || cust?.id || ''}"></div>
        <div class="form-row full"><label>服務地點</label>
          <select name="site_id"><option value="">全部地點</option>
            ${(cust?.sites || []).filter(s => s.active).map(s =>
        `<option value="${s.id}"${String(sc?.site_id) === String(s.id) ? ' selected' : ''}>${UI.esc(s.name)}</option>`).join('')}
          </select></div>
        ${UI.input('title', '合約名稱', { value: sc?.title || '定期保養約', full: true })}
        ${UI.input('contract_no', '合約編號', { value: sc?.contract_no, placeholder: '留空自動編號' })}
        ${UI.input('start_date', '合約起日', { type: 'date', value: sc?.start_date || UI.today(), required: true })}
        ${UI.input('end_date', '合約迄日', { type: 'date', value: sc?.end_date || UI.addDays(UI.today(), 365), required: true })}
        ${UI.input('interval_months', '到場週期（月）', { type: 'number', value: sc?.interval_months ?? 3 })}
        ${UI.input('times_per_year', '每年次數', { type: 'number', value: sc?.times_per_year ?? 4 })}
        ${UI.input('amount', '合約金額', { type: 'number', value: sc?.amount ?? 0 })}
        ${UI.select('billing_cycle', '收款方式', [['yearly', '年繳'], ['half', '半年繳'], ['quarterly', '季繳'], ['monthly', '月繳'], ['per_visit', '每次收費']], { value: sc?.billing_cycle || 'yearly' })}
        ${UI.input('next_visit_date', '下次到場日', { type: 'date', value: sc?.next_visit_date || UI.today() })}
        ${sc ? UI.select('status', '合約狀態', App.mapOpts(TW.contract_status), { value: sc.status }) : ''}
        ${UI.checkbox('include_parts', '含零件更換（不另計料錢）', sc?.include_parts)}
        ${UI.textarea('scope', '保養範圍', { value: sc?.scope, placeholder: '例：濾網清洗、冷媒壓力檢測、排水管疏通、電流量測' })}
        ${UI.textarea('note', '備註', { value: sc?.note })}
        <div class="form-row full"><label>涵蓋設備</label>
          <div id="sc-equips" style="display:flex;flex-direction:column;gap:6px">
            ${equipList() || '<span style="color:var(--muted);font-size:13px">選擇客戶後顯示設備清單</span>'}</div></div>
      </div>`
    });
  },

  async renderDetail(el, id) {
    const sc = await GET('/service-contracts/' + id);
    const done = sc.visits.filter(v => ['done', 'confirmed', 'billed'].includes(v.status)).length;

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#contracts">← 回列表</a>
        <a class="btn small secondary" href="#customers/${sc.customer_id}">客戶資料</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="edit-sc">修改合約</button>
        <button class="btn" id="gen-order">＋ 產生保養工單</button>`)}

      <div class="split">
        <div>
          <div class="card"><h3>${UI.esc(sc.title)}　${UI.tag(TW.contract_status[sc.status], sc.status === 'active' ? 'ok' : '')}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">合約編號</div>${UI.esc(sc.contract_no)}</div>
              <div><div class="dg-label">客戶</div>${UI.esc(sc.customer_name)}</div>
              <div><div class="dg-label">服務地點</div>${UI.esc(sc.site_name || '全部地點')}</div>
              <div><div class="dg-label">合約期間</div>${UI.esc(sc.start_date)} ~ ${UI.esc(sc.end_date)}</div>
              <div><div class="dg-label">到場週期</div>每 ${sc.interval_months} 個月（年 ${sc.times_per_year} 次）</div>
              <div><div class="dg-label">下次到場</div>${Cust.dateTag(sc.next_visit_date, true)}</div>
              <div><div class="dg-label">合約金額</div>${UI.money(sc.amount)}</div>
              <div><div class="dg-label">收款方式</div>${({ yearly: '年繳', half: '半年繳', quarterly: '季繳', monthly: '月繳', per_visit: '每次收費' })[sc.billing_cycle] || sc.billing_cycle}</div>
              <div><div class="dg-label">零件</div>${sc.include_parts ? '含零件更換' : '零件另計'}</div>
              <div><div class="dg-label">已完成保養</div>${done} 次</div>
            </div>
            ${sc.scope ? `<div style="margin-top:10px"><div class="dg-label">保養範圍</div>
              <div style="white-space:pre-wrap;font-size:13.5px">${UI.esc(sc.scope)}</div></div>` : ''}
            ${sc.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(sc.note)}</div>` : ''}
          </div>

          <div class="card"><h3>保養紀錄</h3>
            ${UI.table(['工單號', '預約日', '完工時間', '內容', '狀態'], sc.visits.map(v => `
              <tr style="cursor:pointer" onclick="location.hash='orders/${v.id}'">
                <td>${UI.esc(v.order_no)}</td>
                <td>${UI.esc(v.appoint_date || '')}</td>
                <td>${UI.esc((v.finished_at || '').slice(0, 16) || '－')}</td>
                <td class="wrap">${UI.esc(v.title || '')}</td>
                <td>${UI.tag(TW.order_status[v.status], TW.status_cls[v.status])}</td>
              </tr>`), '尚未產生過保養工單')}
          </div>
        </div>

        <div>
          <div class="card"><h3>涵蓋設備（${sc.equipments.length}）</h3>
            ${sc.equipments.length ? `<ul class="mini-list">${sc.equipments.map(e => `
              <li style="cursor:pointer" onclick="location.hash='equipments/${e.id}'">
                <div class="ml-main">${UI.esc(e.brand)} ${UI.esc(e.model)}
                  <div class="ml-sub">${UI.esc(e.asset_no)}　${UI.esc(e.location || '')}</div></div>
                <div style="text-align:right"><span class="ml-sub">${UI.esc(e.refrigerant || '')}</span></div>
              </li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">尚未指定涵蓋設備，產生的保養工單不會自動帶入設備與檢查項目</div>'}
          </div>
        </div>
      </div>`;

    el.querySelector('#edit-sc').onclick = () => Contract.editDialog(sc);
    el.querySelector('#gen-order').onclick = () => {
      UI.modal({
        title: '產生保養工單',
        submitText: '產生工單',
        body: `<div class="form-grid">
          ${UI.input('appoint_date', '預約到場日', { type: 'date', value: sc.next_visit_date || UI.today(), full: true })}
        </div>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">
          工單會自動帶入合約涵蓋的 ${sc.equipments.length} 台設備與預設檢查項目，並把合約下次到場日往後推 ${sc.interval_months} 個月。</div>`,
        onSubmit: async elm => {
          const r = await POST(`/service-contracts/${sc.id}/generate-order`, UI.formData(elm));
          UI.toast(`工單 ${r.order_no} 已建立`);
          location.hash = 'orders/' + r.id;
        }
      });
    };
  }
};
