// 派工看板、工單列表、工單明細、工單月曆

// ================= 派工看板 =================

App.page('dispatch', {
  title: '派工看板',
  sub: '把待派工的案子拖給師傅，一天的行程一眼看完',
  module: 'orders',
  async render(el, arg) {
    const date = App._dispatchDate || UI.today();
    const d = await GET('/dispatch-board?date=' + date);
    App._dispatchDate = d.date;

    const card = o => `
      <div class="wo-card p-${o.priority}" data-order="${o.id}">
        <div class="wo-no">${UI.esc(o.order_no)}　${UI.tag(TW.order_type[o.type] || o.type)}
          ${o.priority === 'urgent' ? UI.tag('急件', 'danger') : ''}</div>
        <div class="wo-title">${UI.esc(o.title || o.customer_name)}</div>
        <div class="wo-meta">${UI.esc(o.customer_name)}<br>${UI.esc(o.address || '')}
          ${o.appoint_slot ? `<br>${UI.esc(o.appoint_slot)}` : ''}
          ${o.appoint_date && o.appoint_date !== d.date ? `<br>預約 ${UI.esc(o.appoint_date)}` : ''}</div>
        <div style="margin-top:5px">${UI.tag(TW.order_status[o.status], TW.status_cls[o.status])}</div>
      </div>`;

    el.innerHTML = `
      ${App.toolbar(`
        <button class="btn small secondary" id="prev-day">← 前一天</button>
        <input type="date" id="board-date" value="${d.date}">
        <button class="btn small secondary" id="next-day">後一天 →</button>
        <button class="btn small secondary" id="today-btn">今天</button>
        <span class="spacer"></span>
        <button class="btn" id="new-order">＋ 開新工單</button>`)}

      <div class="board">
        <div class="board-col unassigned">
          <h4>待派工 <span class="cnt">${d.unassigned.length}</span></h4>
          ${d.unassigned.map(card).join('') || '<div style="color:var(--muted);font-size:13px;padding:6px">沒有待派工的案子</div>'}
        </div>
        ${d.techs.map(t => `
          <div class="board-col">
            <h4>${UI.esc(t.name)}${t.tech_no ? `（${UI.esc(t.tech_no)}）` : ''} <span class="cnt">${t.orders.length} 件</span></h4>
            ${t.orders.map(card).join('') || '<div style="color:var(--muted);font-size:13px;padding:6px">當日無排程</div>'}
          </div>`).join('')}
      </div>`;

    el.querySelectorAll('[data-order]').forEach(c => {
      c.onclick = () => { location.hash = 'orders/' + c.dataset.order; };
    });
    const nav = n => {
      App._dispatchDate = UI.addDays(d.date, n);
      App.pages.dispatch.render(el);
    };
    el.querySelector('#prev-day').onclick = () => nav(-1);
    el.querySelector('#next-day').onclick = () => nav(1);
    el.querySelector('#today-btn').onclick = () => { App._dispatchDate = UI.today(); App.pages.dispatch.render(el); };
    el.querySelector('#board-date').onchange = e => { App._dispatchDate = e.target.value; App.pages.dispatch.render(el); };
    el.querySelector('#new-order').onclick = () => Orders.newOrderDialog(d.date);
  }
});

// ================= 工單列表／明細 =================

App.page('orders', {
  title: '派工單',
  sub: '從開單、派工、施工到完工結算的完整紀錄',
  module: 'orders',
  async render(el, id) {
    if (id) return Orders.renderDetail(el, id);
    const f = App._orderFilter || (App._orderFilter = { status: 'open', type: '', q: '', tech: '', from: '', to: '' });
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rows = await GET('/work-orders?' + qs);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋工單號／客戶／地址／電話" value="${UI.esc(f.q)}" style="min-width:230px">
        <select id="f-status">
          <option value="">全部狀態</option>
          <option value="open"${f.status === 'open' ? ' selected' : ''}>進行中（未完工）</option>
          ${Object.entries(TW.order_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="f-type"><option value="">全部類別</option>
          ${Object.entries(TW.order_type).map(([k, v]) =>
      `<option value="${k}"${f.type === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="f-tech"><option value="">全部技師</option>
          ${(App.meta.techs || []).map(t => `<option value="${t.id}"${String(f.tech) === String(t.id) ? ' selected' : ''}>${UI.esc(t.name)}</option>`).join('')}
        </select>
        <input type="date" id="f-from" value="${f.from}"> ~ <input type="date" id="f-to" value="${f.to}">
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 筆</span>
        <button class="btn" id="new-order">＋ 開新工單</button>`)}

      ${UI.table(['工單號', '類別', '預約日', '客戶／地址', '案由', '技師', '金額', '狀態'], rows.map(o => `
        <tr style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
          <td>${UI.esc(o.order_no)}${o.priority === 'urgent' ? '<br>' + UI.tag('急件', 'danger') : ''}</td>
          <td>${UI.tag(TW.order_type[o.type] || o.type)}</td>
          <td>${UI.esc(o.appoint_date)}<br><span style="color:var(--muted);font-size:12px">${UI.esc(o.appoint_slot || '')}</span></td>
          <td class="wrap"><strong>${UI.esc(o.customer_name)}</strong>
            ${o.site_name ? `<span style="color:var(--muted)">／${UI.esc(o.site_name)}</span>` : ''}
            <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(o.address || '')}</span></td>
          <td class="wrap">${UI.esc(o.title || o.symptom || '')}</td>
          <td>${UI.esc(o.techs || '－')}</td>
          <td class="num">${o.is_warranty ? UI.tag('保固內', 'ok') : o.is_contract ? UI.tag('合約內', 'primary') : UI.money(o.total)}</td>
          <td>${UI.tag(TW.order_status[o.status], TW.status_cls[o.status])}</td>
        </tr>`), '沒有符合條件的工單')}`;

    const bind = (sel, key, ev = 'change') => {
      const e = el.querySelector(sel);
      e.addEventListener(ev, () => { f[key] = e.value; App.pages.orders.render(el); });
    };
    bind('#f-status', 'status'); bind('#f-type', 'type'); bind('#f-tech', 'tech');
    bind('#f-from', 'from'); bind('#f-to', 'to');
    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.orders.render(el); }, 350);
    });
    el.querySelector('#new-order').onclick = () => Orders.newOrderDialog();
  }
});

const Orders = {
  // ---- 開新工單 ----
  async newOrderDialog(defaultDate) {
    let customer = null, sites = [], equipments = [];
    const m = UI.modal({
      title: '開立工單', wide: true, submitText: '建立工單',
      body: `<div class="form-grid">
        <div class="form-row full"><label>客戶 *</label>
          <input name="_customer" id="wo-customer" placeholder="輸入客戶名稱／電話搜尋" autocomplete="off">
          <input type="hidden" name="customer_id"></div>
        <div class="form-row full" id="wo-site-row" style="display:none"><label>服務地點</label>
          <select name="site_id"><option value="">未指定</option></select></div>
        ${UI.select('type', '工單類別', App.mapOpts(TW.order_type))}
        ${UI.inputList('sub_type', '細分案由', App.meta.order_sub_types || [], { placeholder: '例：漏水抓漏、跳電檢修' })}
        ${UI.select('source', '來源', App.opts(App.meta.order_sources || ['電話']))}
        ${UI.select('project_id', '所屬工程專案', [['', '不掛工程（單次派工）'],
        ...(App.meta.open_projects || []).map(p => [p.id, `${p.proj_no} ${p.name}`])], { full: true })}
        ${UI.select('priority', '優先度', App.mapOpts(TW.priority), { value: 'normal' })}
        ${UI.input('appoint_date', '預約到場日', { type: 'date', value: defaultDate || UI.today() })}
        ${UI.select('appoint_slot', '時段', [['', '未指定'], ...App.opts(App.meta.appoint_slots || [])])}
        ${UI.input('travel_fee', '車馬費', { type: 'number', value: App.meta.travel_fee_default || 0 })}
        ${UI.input('contact', '現場聯絡人')}
        ${UI.input('phone', '聯絡電話')}
        ${UI.input('address', '施工地址', { full: true })}
        ${UI.input('title', '案由摘要', { full: true, placeholder: '例：3F 箱型機不冷' })}
        ${UI.textarea('symptom', '客戶描述的故障狀況', { placeholder: '越詳細，師傅出門前越好準備料件' })}
        <div class="form-row full" id="wo-equip-row" style="display:none"><label>本次要處理的設備</label>
          <div id="wo-equips" style="display:flex;flex-wrap:wrap;gap:8px"></div></div>
        <div class="form-row full"><label>指派技師（可複選，第一位為主責）</label>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${(App.meta.techs || []).map(t =>
        `<label style="display:flex;align-items:center;gap:5px;font-weight:400">
                <input type="checkbox" class="wo-tech" value="${t.id}" style="width:auto">${UI.esc(t.name)}</label>`).join('')}
          </div></div>
        ${UI.checkbox('is_warranty', '保固內免費（不計價，但材料成本照算）')}
        ${UI.checkbox('is_contract', '保養合約內（不另計價）')}
      </div>`,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.customer_id) throw new Error('請先選擇客戶');
        b.customer_id = Number(b.customer_id);
        b.site_id = b.site_id || null;
        b.tech_ids = [...el.querySelectorAll('.wo-tech:checked')].map(c => Number(c.value));
        b.equipment_ids = [...el.querySelectorAll('.wo-equip:checked')].map(c => Number(c.value));
        const r = await POST('/work-orders', b);
        UI.toast(`工單 ${r.order_no} 已建立`);
        location.hash = 'orders/' + r.id;
      },
      onOpen: el => {
        UI.customerPicker(el.querySelector('#wo-customer'), async c => {
          customer = c;
          el.querySelector('#wo-customer').value = c.name;
          el.querySelector('[name=customer_id]').value = c.id;
          el.querySelector('[name=contact]').value = c.contact || '';
          el.querySelector('[name=phone]').value = c.phone || '';
          el.querySelector('[name=address]').value = c.address || '';
          const full = await GET('/customers/' + c.id);
          sites = full.sites.filter(s => s.active);
          equipments = full.equipments.filter(e => e.status !== 'scrapped');
          const sel = el.querySelector('[name=site_id]');
          sel.innerHTML = '<option value="">未指定</option>' +
            sites.map(s => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('');
          el.querySelector('#wo-site-row').style.display = sites.length ? '' : 'none';
          sel.onchange = () => {
            const s = sites.find(x => x.id === Number(sel.value));
            if (s) {
              el.querySelector('[name=address]').value = s.address || '';
              el.querySelector('[name=contact]').value = s.contact || c.contact || '';
              el.querySelector('[name=phone]').value = s.phone || c.phone || '';
            }
          };
          el.querySelector('#wo-equip-row').style.display = equipments.length ? '' : 'none';
          el.querySelector('#wo-equips').innerHTML = equipments.map(e =>
            `<label style="display:flex;align-items:center;gap:5px;font-weight:400;font-size:13.5px">
              <input type="checkbox" class="wo-equip" value="${e.id}" style="width:auto">
              ${UI.esc(e.brand)} ${UI.esc(e.model)}<span style="color:var(--muted)">（${UI.esc(e.location || e.asset_no)}）</span></label>`).join('');
        });
      }
    });
    return m;
  },

  // ---- 工單明細 ----
  async renderDetail(el, id) {
    const w = await GET('/work-orders/' + id);
    const money = UI.money;
    const netFee = Math.max(0, w.labor_fee + w.travel_fee + w.parts_fee + w.other_fee - w.discount);
    const profit = w.total - w.parts_cost;
    const flowSteps = ['draft', 'assigned', 'departed', 'working', 'done', 'confirmed', 'billed'];
    const curIdx = flowSteps.indexOf(w.status);

    document.querySelector('.page-title').textContent = `${w.order_no}　${w.title || TW.order_type[w.type]}`;
    document.querySelector('.page-sub').textContent =
      `${w.customer_name}${w.site_name ? ' / ' + w.site_name : ''}　${w.address || ''}`;

    el.innerHTML = `
      ${App.toolbar(`
        <button class="btn small secondary" onclick="location.hash='orders'">← 回列表</button>
        ${w.next_status.map(s => `<button class="btn small" data-to="${s}">${UI.esc(TW.order_status[s])}</button>`).join('')}
        <span class="spacer"></span>
        <button class="btn small secondary" id="btn-print">列印工單</button>
        ${['billed', 'cancelled'].includes(w.status) ? '' : '<button class="btn small secondary" id="btn-edit">編輯內容</button>'}
        ${['done', 'confirmed'].includes(w.status) && !w.is_warranty && !w.is_contract && !w.invoice
        ? '<button class="btn small" id="btn-invoice">開請款單</button>' : ''}`)}

      <div class="card">
        <div class="flow">
          ${flowSteps.map((s, i) => `<span class="step ${w.status === s ? 'now' : (curIdx > i ? 'done' : '')}">${TW.order_status[s]}</span>`)
        .join('<span class="arrow">›</span>')}
          ${w.status === 'cancelled' ? UI.tag('已取消', 'danger') : ''}
        </div>
        <div class="detail-grid" style="margin-top:12px">
          <div><div class="dg-label">類別／來源</div>${TW.order_type[w.type]}${w.sub_type ? '（' + UI.esc(w.sub_type) + '）' : ''}　${UI.esc(w.source)}</div>
          ${w.project_id ? `<div><div class="dg-label">所屬工程</div>
            <a href="#projects/${w.project_id}">${UI.esc(w.proj_no)} ${UI.esc(w.project_name)}</a></div>` : ''}
          <div><div class="dg-label">優先度</div>${UI.tag(TW.priority[w.priority], TW.priority_cls[w.priority])}</div>
          <div><div class="dg-label">預約到場</div>${UI.esc(w.appoint_date)} ${UI.esc(w.appoint_slot || '')}</div>
          <div><div class="dg-label">聯絡人</div>${UI.esc(w.contact || '-')}　${UI.esc(w.phone || '')}</div>
          <div><div class="dg-label">出發／到場／完工</div>${UI.esc(w.departed_at || '-')} ／ ${UI.esc(w.arrived_at || '-')} ／ ${UI.esc(w.finished_at || '-')}</div>
          <div><div class="dg-label">技師</div>${w.techs.map(t => UI.esc(t.name) + (t.is_lead ? '（主責）' : '')).join('、') || '未指派'}
            <button class="btn tiny secondary" id="btn-techs" style="margin-left:6px">指派</button></div>
          <div><div class="dg-label">工時 × 人數</div>${w.work_hours} 人時 × ${w.headcount} 人</div>
          <div><div class="dg-label">計價方式</div>${w.is_warranty ? UI.tag('保固內免費', 'ok') : w.is_contract ? UI.tag('合約內', 'primary') : TW.tax_mode[w.tax_mode]}</div>
          ${w.contract_no ? `<div><div class="dg-label">保養合約</div>${UI.esc(w.contract_no)}</div>` : ''}
          ${w.invoice ? `<div><div class="dg-label">請款單</div><a href="#invoices/${w.invoice.id}">${UI.esc(w.invoice.inv_no)}</a>
            ${UI.tag(TW.inv_status[w.invoice.status], TW.inv_cls[w.invoice.status])}</div>` : ''}
        </div>
      </div>

      <div class="split">
        <div>
          <div class="card"><h3>施工內容</h3>
            <div style="font-size:14px;line-height:1.8">
              <div><span style="color:var(--muted)">客戶描述：</span>${UI.esc(w.symptom || '－')}</div>
              <div><span style="color:var(--muted)">故障原因：</span>${UI.esc(w.cause || '－')}</div>
              <div><span style="color:var(--muted)">處理方式：</span>${UI.esc(w.action || '－')}</div>
              <div><span style="color:var(--muted)">後續建議：</span>${UI.esc(w.suggestion || '－')}</div>
            </div>
          </div>

          <div class="card"><h3>用料明細
            ${['billed', 'cancelled'].includes(w.status) ? '' : '<button class="btn tiny" id="btn-add-item" style="margin-left:8px">＋ 領料</button>'}</h3>
            ${UI.table(['品名／規格', '倉別', '數量', '售價', '小計', '成本', ''], w.items.map(i => `
              <tr><td class="wrap">${UI.esc(i.name)}<br><span style="color:var(--muted);font-size:12px">${UI.esc(i.spec || '')}${i.sku ? '　' + UI.esc(i.sku) : ''}</span></td>
                <td>${UI.esc(i.warehouse_name || '－')}</td>
                <td class="num">${i.qty} ${UI.esc(i.unit)}</td>
                <td class="num">${money(i.price)}</td>
                <td class="num">${money(i.qty * i.price)}</td>
                <td class="num" style="color:var(--muted)">${money(i.qty * i.cost)}</td>
                <td>${['billed', 'cancelled'].includes(w.status) ? '' :
        `<button class="btn tiny danger" data-del-item="${i.id}">退料</button>`}</td></tr>`),
      '尚未領料')}
          </div>

          ${w.checks.length ? `<div class="card"><h3>保養／檢修檢查表
            <button class="btn tiny secondary" id="btn-save-checks" style="margin-left:8px">儲存檢查結果</button></h3>
            ${UI.table(['設備', '檢查項目', '結果', '量測值', '備註'], w.checks.map(c => `
              <tr data-check="${c.id}">
                <td>${UI.esc(c.asset_no ? `${c.brand} ${c.model}` : '－')}</td>
                <td class="wrap">${UI.esc(c.item)}</td>
                <td><select class="ck-result" style="padding:3px 6px;border:1px solid var(--border);border-radius:6px">
                  ${Object.entries(TW.check_result).map(([k, v]) =>
        `<option value="${k}"${c.result === k ? ' selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><input class="ck-value" value="${UI.esc(c.value)}" placeholder="例 高壓 18kg" style="padding:3px 6px;border:1px solid var(--border);border-radius:6px;width:120px"></td>
                <td><input class="ck-note" value="${UI.esc(c.note)}" style="padding:3px 6px;border:1px solid var(--border);border-radius:6px;width:150px"></td>
              </tr>`))}
          </div>` : ''}

          <div class="card"><h3>施工照片
            <button class="btn tiny secondary" id="btn-photo" style="margin-left:8px">＋ 上傳</button></h3>
            ${w.photos.length ? `<div class="shot-grid">${w.photos.map(p => `
              <div class="shot"><img src="${UI.esc(p.path)}" onclick="window.open('${UI.esc(p.path)}')">
                <span class="stage">${TW.photo_stage[p.stage] || p.stage}</span>
                <button class="del" data-del-photo="${p.id}">×</button></div>`).join('')}</div>`
        : '<div style="color:var(--muted);font-size:13.5px">尚未上傳照片。施工前後照片是日後爭議時最有力的證明。</div>'}
          </div>
        </div>

        <div>
          <div class="card"><h3>費用結算</h3>
            <table class="doc-lines">
              <tr><td>工資</td><td class="num">${money(w.labor_fee)}</td></tr>
              <tr><td>車馬費</td><td class="num">${money(w.travel_fee)}</td></tr>
              <tr><td>材料費</td><td class="num">${money(w.parts_fee)}</td></tr>
              ${w.other_fee ? `<tr><td>${UI.esc(w.other_fee_name || '其他')}</td><td class="num">${money(w.other_fee)}</td></tr>` : ''}
              ${w.discount ? `<tr><td>折扣</td><td class="num">-${money(w.discount)}</td></tr>` : ''}
              <tr><td>未稅小計</td><td class="num">${money(netFee)}</td></tr>
            </table>
            <div class="doc-total">
              <div class="dt-item"><div class="dt-label">應收（含稅）</div>
                <div class="dt-big">${w.is_warranty || w.is_contract ? '免費' : money(w.total)}</div></div>
            </div>
            <div class="detail-grid" style="margin-top:8px">
              <div><div class="dg-label">材料成本</div>${money(w.parts_cost)}</div>
              <div><div class="dg-label">毛利</div><strong style="color:${profit >= 0 ? 'var(--primary-dark)' : 'var(--danger)'}">${money(profit)}</strong></div>
            </div>
            <button class="btn small secondary" id="btn-recalc" style="margin-top:10px">重算金額與抽成</button>
          </div>

          ${w.commissions.length ? `<div class="card"><h3>技師抽成</h3>
            <ul class="mini-list">${w.commissions.map(c => `<li>
              <div class="ml-main">${UI.esc(c.name)}<div class="ml-sub">基準 ${money(c.base_amount)} × ${(c.rate * 100).toFixed(1)}%</div></div>
              <div style="text-align:right"><strong>${money(c.amount)}</strong>
                <div class="ml-sub">${TW.comm_status[c.status]}</div></div></li>`).join('')}</ul>
          </div>` : ''}

          <div class="card"><h3>本次設備</h3>
            ${w.equipments.length ? `<ul class="mini-list">${w.equipments.map(e => `<li>
              <div class="ml-main"><a href="#equipments/${e.id}">${UI.esc(e.brand)} ${UI.esc(e.model)}</a>
                <div class="ml-sub">${UI.esc(e.category)}　${UI.esc(e.location || '')}　${UI.esc(e.refrigerant || '')}</div></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">未關聯設備</div>'}
          </div>

          <div class="card"><h3>冷媒紀錄
            <button class="btn tiny secondary" id="btn-ref" style="margin-left:8px">＋ 登錄</button></h3>
            ${w.refrigerant_logs.length ? `<ul class="mini-list">${w.refrigerant_logs.map(r => `<li>
              <div class="ml-main">${TW.ref_action[r.action]}　${UI.esc(r.refrigerant)} ${r.kg} kg
                <div class="ml-sub">${UI.esc(r.log_date)}　${UI.esc(r.tech_name || '')}　${UI.esc(r.cylinder_no || '')}</div></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">本次無冷媒作業</div>'}
          </div>

          <div class="card"><h3>客戶簽收</h3>
            ${w.signature
        ? `<img src="${UI.esc(w.signature)}" style="max-width:200px;border:1px solid var(--border);border-radius:8px">
                 <div style="font-size:13px;margin-top:6px">${UI.esc(w.signer_name)}　${UI.esc(w.confirmed_at)}</div>
                 ${w.rating ? `<div style="font-size:13px">滿意度：${'★'.repeat(w.rating)}${w.rating_comment ? '　' + UI.esc(w.rating_comment) : ''}</div>` : ''}`
        : `<button class="btn small" id="btn-sign">請客戶簽名確認</button>`}
          </div>
        </div>
      </div>`;

    // ---- 事件綁定 ----
    const reload = () => Orders.renderDetail(el, id);

    el.querySelectorAll('[data-to]').forEach(b => {
      b.onclick = async () => {
        const to = b.dataset.to;
        if (to === 'done' && !w.action) return UI.err(new Error('請先「編輯內容」填寫處理方式再完工'));
        if (to === 'cancelled' && !await UI.confirm('取消工單會把已領的料全部退回庫存，確定嗎？')) return;
        try { await POST(`/work-orders/${id}/status`, { status: to }); UI.toast('狀態已更新'); reload(); }
        catch (e) { UI.err(e); }
      };
    });

    el.querySelector('#btn-techs').onclick = () => {
      UI.modal({
        title: '指派技師（第一位勾選者為主責）',
        body: `<div style="display:flex;flex-direction:column;gap:8px">
          ${(App.meta.techs || []).map(t => `<label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" class="as-tech" value="${t.id}" style="width:auto"
              ${w.techs.some(x => x.user_id === t.id) ? 'checked' : ''}>${UI.esc(t.name)}
            ${t.tech_no ? `<span style="color:var(--muted)">${UI.esc(t.tech_no)}</span>` : ''}</label>`).join('')}
        </div>`,
        onSubmit: async body => {
          const ids = [...body.querySelectorAll('.as-tech:checked')].map(c => Number(c.value));
          await PUT(`/work-orders/${id}/techs`, { tech_ids: ids });
          UI.toast('已更新派工');
          reload();
        }
      });
    };

    const edit = el.querySelector('#btn-edit');
    if (edit) edit.onclick = () => Orders.editDialog(w, reload);

    el.querySelector('#btn-recalc').onclick = async () => {
      await POST(`/work-orders/${id}/recalc`, {});
      UI.toast('已重算');
      reload();
    };

    const addItem = el.querySelector('#btn-add-item');
    if (addItem) addItem.onclick = () => Orders.addItemDialog(w, reload);

    el.querySelectorAll('[data-del-item]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('退料會把數量加回庫存，確定嗎？')) return;
        try { await DEL('/work-order-items/' + b.dataset.delItem); UI.toast('已退料'); reload(); }
        catch (e) { UI.err(e); }
      };
    });

    const saveChecks = el.querySelector('#btn-save-checks');
    if (saveChecks) saveChecks.onclick = async () => {
      const checks = [...el.querySelectorAll('[data-check]')].map(tr => ({
        id: Number(tr.dataset.check),
        result: tr.querySelector('.ck-result').value,
        value: tr.querySelector('.ck-value').value,
        note: tr.querySelector('.ck-note').value
      }));
      await PUT(`/work-orders/${id}/checks`, { checks });
      UI.toast('檢查結果已儲存');
    };

    el.querySelector('#btn-photo').onclick = () => Orders.photoDialog(id, reload);
    el.querySelectorAll('[data-del-photo]').forEach(b => {
      b.onclick = async e => {
        e.stopPropagation();
        if (!await UI.confirm('刪除這張照片？')) return;
        await DEL('/work-order-photos/' + b.dataset.delPhoto);
        reload();
      };
    });

    el.querySelector('#btn-ref').onclick = () => Orders.refrigerantDialog(w, reload);

    const sign = el.querySelector('#btn-sign');
    if (sign) sign.onclick = () => Orders.signDialog(w, reload);

    const inv = el.querySelector('#btn-invoice');
    if (inv) inv.onclick = async () => {
      if (!await UI.confirm(`為工單 ${w.order_no} 開立請款單？`)) return;
      try {
        const r = await POST('/invoices/from-orders', { order_ids: [Number(id)] });
        UI.toast(`請款單 ${r.inv_no} 已開立`);
        location.hash = 'invoices/' + r.id;
      } catch (e) { UI.err(e); }
    };

    el.querySelector('#btn-print').onclick = () => Orders.print(w);
  },

  // ---- 編輯工單 ----
  editDialog(w, reload) {
    UI.modal({
      title: `編輯工單 ${w.order_no}`, wide: true,
      body: `<div class="form-grid">
        ${UI.select('type', '類別', App.mapOpts(TW.order_type), { value: w.type })}
        ${UI.inputList('sub_type', '細分案由', App.meta.order_sub_types || [], { value: w.sub_type })}
        ${UI.select('priority', '優先度', App.mapOpts(TW.priority), { value: w.priority })}
        ${UI.select('project_id', '所屬工程專案', [['', '不掛工程（單次派工）'],
        ...(App.meta.open_projects || []).map(p => [p.id, `${p.proj_no} ${p.name}`])],
        { value: w.project_id || '', full: true })}
        ${UI.input('appoint_date', '預約到場日', { type: 'date', value: w.appoint_date })}
        ${UI.select('appoint_slot', '時段', [['', '未指定'], ...App.opts(App.meta.appoint_slots || [])], { value: w.appoint_slot })}
        ${UI.input('contact', '現場聯絡人', { value: w.contact })}
        ${UI.input('phone', '聯絡電話', { value: w.phone })}
        ${UI.input('address', '施工地址', { value: w.address, full: true })}
        ${UI.input('title', '案由摘要', { value: w.title, full: true })}
        ${UI.textarea('symptom', '客戶描述', { value: w.symptom })}
        ${UI.textarea('cause', '故障原因判定', { value: w.cause })}
        ${UI.textarea('action', '處理方式／施工內容（完工前必填）', { value: w.action })}
        ${UI.textarea('suggestion', '後續建議', { value: w.suggestion, placeholder: '例：壓縮機電流偏高，建議一年內評估更換' })}
        ${UI.input('work_hours', '實際工時（人時）', { type: 'number', step: '0.5', value: w.work_hours })}
        ${UI.input('headcount', '出工人數', { type: 'number', value: w.headcount })}
        ${UI.input('labor_fee', '工資', { type: 'number', value: w.labor_fee })}
        ${UI.input('travel_fee', '車馬費', { type: 'number', value: w.travel_fee })}
        ${UI.input('other_fee', '其他費用', { type: 'number', value: w.other_fee })}
        ${UI.input('other_fee_name', '其他費用名稱', { value: w.other_fee_name, placeholder: '例：吊車費／假日加成' })}
        ${UI.input('discount', '折扣', { type: 'number', value: w.discount })}
        ${UI.select('tax_mode', '稅別', App.mapOpts(TW.tax_mode), { value: w.tax_mode })}
        ${UI.checkbox('is_warranty', '保固內免費', w.is_warranty)}
        ${UI.checkbox('is_contract', '合約內不另計價', w.is_contract)}
        ${UI.textarea('note', '內部備註', { value: w.note })}
      </div>`,
      onSubmit: async el => {
        await PUT('/work-orders/' + w.id, UI.formData(el));
        UI.toast('已儲存');
        reload();
      }
    });
  },

  // ---- 領料 ----
  addItemDialog(w, reload) {
    UI.modal({
      title: '工單領料',
      body: `<div class="form-grid">
        <div class="form-row full"><label>料件（輸入料號或品名搜尋）</label>
          <input id="it-search" placeholder="例：電容 / EL-CAP" autocomplete="off">
          <input type="hidden" name="product_id"></div>
        ${UI.input('name', '品名（無料號的臨時採購品可直接填）', { full: true })}
        ${UI.input('spec', '規格')}
        ${UI.input('unit', '單位', { value: '個' })}
        ${UI.input('qty', '數量', { type: 'number', step: '0.01', value: 1 })}
        ${UI.input('price', '售價（未稅，留空自動帶客戶價格等級）', { type: 'number' })}
        ${UI.select('warehouse_id', '領料倉別', App.warehouseOptions('（服務項目免選）'))}
        ${UI.input('note', '備註', { full: true })}
      </div>
      <div id="it-info" style="font-size:13px;color:var(--muted);margin-top:8px"></div>`,
      onSubmit: async el => {
        const b = UI.formData(el);
        await POST(`/work-orders/${w.id}/items`, b);
        UI.toast('已領料並扣庫存');
        reload();
      },
      onOpen: el => {
        UI.productPicker(el.querySelector('#it-search'), p => {
          el.querySelector('#it-search').value = `${p.sku} ${p.name}`;
          el.querySelector('[name=product_id]').value = p.id;
          el.querySelector('[name=name]').value = p.name;
          el.querySelector('[name=spec]').value = p.spec || '';
          el.querySelector('[name=unit]').value = p.unit;
          el.querySelector('[name=price]').value = '';
          el.querySelector('#it-info').textContent =
            `全倉庫存 ${p.qty} ${p.unit}　平均成本 ${UI.money(p.cost)}　零售價 ${UI.money(p.price_retail)}`;
        });
      }
    });
  },

  // ---- 上傳照片 ----
  photoDialog(orderId, reload) {
    UI.modal({
      title: '上傳施工照片', submitText: '上傳',
      body: `<div class="form-grid">
        ${UI.select('stage', '階段', App.mapOpts(TW.photo_stage))}
        ${UI.input('caption', '說明', { full: true })}
        <div class="form-row full"><label>選擇照片（可多選，單張上限 12MB）</label>
          <input type="file" id="ph-files" accept="image/*" multiple></div>
      </div>`,
      onSubmit: async el => {
        const files = el.querySelector('#ph-files').files;
        if (!files.length) throw new Error('請選擇照片');
        const fd = new FormData();
        fd.append('stage', el.querySelector('[name=stage]').value);
        fd.append('caption', el.querySelector('[name=caption]').value);
        for (const f of files) fd.append('photos', f);
        await api(`/work-orders/${orderId}/photos`, { method: 'POST', body: fd });
        UI.toast('照片已上傳');
        reload();
      }
    });
  },

  // ---- 冷媒登錄 ----
  refrigerantDialog(w, reload) {
    UI.modal({
      title: '冷媒充填／回收登錄',
      body: `<div class="form-grid">
        ${UI.select('action', '作業別', App.mapOpts(TW.ref_action))}
        ${UI.select('refrigerant', '冷媒種類', App.opts(App.meta.refrigerants || []))}
        ${UI.input('kg', '重量（公斤）', { type: 'number', step: '0.1', required: true })}
        ${UI.input('log_date', '日期', { type: 'date', value: UI.today() })}
        ${UI.input('cylinder_no', '鋼瓶編號')}
        ${UI.select('tech_id', '施作技師', App.techOptions('未指定'))}
        ${UI.select('equipment_id', '對應設備',
        [['', '未指定'], ...w.equipments.map(e => [e.id, `${e.brand} ${e.model}（${e.location || e.asset_no}）`])])}
        ${UI.input('leak_point', '洩漏點', { full: true, placeholder: '例：室外機四通閥焊點' })}
        ${UI.textarea('note', '備註')}
      </div>
      <div style="font-size:12.5px;color:var(--muted);margin-top:8px">
        逐筆留存充填與回收量，是環境部 F-gas 申報與冷媒盤查的依據；報表頁可匯出全年底稿。</div>`,
      onSubmit: async el => {
        const b = UI.formData(el);
        b.order_id = w.id;
        await POST('/refrigerant-logs', b);
        UI.toast('已登錄');
        reload();
      }
    });
  },

  // ---- 客戶簽收 ----
  signDialog(w, reload) {
    let pad;
    UI.modal({
      title: '客戶簽收確認', submitText: '確認簽收',
      body: `<div style="font-size:13.5px;margin-bottom:10px">
        本次施工：${UI.esc(w.action || '－')}<br>
        應收金額：<strong>${w.is_warranty || w.is_contract ? '免費' : UI.money(w.total)}</strong></div>
      <div class="form-grid">
        ${UI.input('signer_name', '簽收人姓名', { value: w.contact })}
        ${UI.select('rating', '滿意度', [['', '未評分'], [5, '★★★★★'], [4, '★★★★'], [3, '★★★'], [2, '★★'], [1, '★']])}
        ${UI.input('rating_comment', '客戶意見', { full: true })}
      </div>
      <div style="margin-top:12px"><label style="font-size:12.5px;color:var(--muted)">請於下方簽名</label>
        <canvas id="sig" style="width:100%;height:170px;border:1px dashed var(--border);border-radius:8px;background:#fff;touch-action:none"></canvas>
        <button class="btn tiny secondary" id="sig-clear" type="button" style="margin-top:6px">清除重簽</button></div>`,
      onOpen: el => {
        pad = UI.signaturePad(el.querySelector('#sig'));
        el.querySelector('#sig-clear').onclick = () => pad.clear();
      },
      onSubmit: async el => {
        if (!pad.drawn()) throw new Error('請先簽名');
        const b = UI.formData(el);
        b.signature = pad.dataUrl();
        await POST(`/work-orders/${w.id}/sign`, b);
        UI.toast('已完成簽收');
        reload();
      }
    });
  },

  // ---- 列印工單 ----
  print(w) {
    const rows = w.items.map(i => `<tr><td>${UI.esc(i.name)}</td><td>${UI.esc(i.spec || '')}</td>
      <td style="text-align:right">${i.qty} ${UI.esc(i.unit)}</td>
      <td style="text-align:right">${UI.money(i.price)}</td>
      <td style="text-align:right">${UI.money(i.qty * i.price)}</td></tr>`).join('');
    const html = `
      <div class="doc-print">
        <h2>${UI.esc(App.me.company_name)}　服務工作單</h2>
        <div class="dp-sub">工單號 ${UI.esc(w.order_no)}　${TW.order_type[w.type]}</div>
        <div class="dp-head">
          <div><strong>客戶：</strong>${UI.esc(w.customer_name)}<br>
            <strong>地點：</strong>${UI.esc(w.site_name || '')} ${UI.esc(w.address || '')}<br>
            <strong>聯絡人：</strong>${UI.esc(w.contact || '')}　${UI.esc(w.phone || '')}</div>
          <div><strong>到場日：</strong>${UI.esc(w.appoint_date)} ${UI.esc(w.appoint_slot || '')}<br>
            <strong>完工：</strong>${UI.esc(w.finished_at || '')}<br>
            <strong>技師：</strong>${w.techs.map(t => UI.esc(t.name)).join('、')}</div>
        </div>
        <table>
          <tr><th style="width:90px">客戶描述</th><td>${UI.esc(w.symptom || '')}</td></tr>
          <tr><th>故障原因</th><td>${UI.esc(w.cause || '')}</td></tr>
          <tr><th>處理方式</th><td>${UI.esc(w.action || '')}</td></tr>
          <tr><th>後續建議</th><td>${UI.esc(w.suggestion || '')}</td></tr>
        </table>
        ${w.items.length ? `<table><thead><tr><th>品名</th><th>規格</th><th style="text-align:right">數量</th>
          <th style="text-align:right">單價</th><th style="text-align:right">小計</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        <table>
          <tr><th style="width:110px">工資</th><td style="text-align:right">${UI.money(w.labor_fee)}</td>
              <th style="width:110px">車馬費</th><td style="text-align:right">${UI.money(w.travel_fee)}</td></tr>
          <tr><th>材料費</th><td style="text-align:right">${UI.money(w.parts_fee)}</td>
              <th>折扣</th><td style="text-align:right">-${UI.money(w.discount)}</td></tr>
          <tr><th>應收合計（含稅）</th><td colspan="3" style="text-align:right;font-size:15px;font-weight:700">
            ${w.is_warranty ? '保固內免費' : w.is_contract ? '保養合約內' : UI.money(w.total)}</td></tr>
        </table>
        <div class="dp-sign">
          <div>${w.signature ? `<img src="${UI.esc(w.signature)}">` : '<div style="height:60px"></div>'}
            客戶簽收：${UI.esc(w.signer_name || '')}</div>
          <div><div style="height:60px"></div>服務技師：${w.techs.map(t => UI.esc(t.name)).join('、')}</div>
        </div>
      </div>`;
    const win = window.open('', '_blank');
    win.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
      <title>${UI.esc(w.order_no)}</title><link rel="stylesheet" href="/css/style.css"></head>
      <body style="padding:20px;background:#fff">${html}</body></html>`);
    win.document.close();
    win.onload = () => win.print();
  }
};

// ================= 工單月曆 =================

App.page('calendar', {
  title: '工單月曆',
  sub: '整月排程一次看完，方便排師傅與跟客戶喬時間',
  module: 'orders',
  async render(el) {
    const month = App._calMonth || UI.thisMonth();
    const d = await GET('/order-calendar?month=' + month);
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const todayStr = UI.today();

    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push('<div class="cal-cell cal-out"></div>');
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${month}-${String(day).padStart(2, '0')}`;
      const list = d.days[ds] || [];
      cells.push(`<div class="cal-cell${ds === todayStr ? ' cal-today' : ''}">
        <div class="cal-day">${day}${list.length ? `　<span style="color:var(--primary-dark)">${list.length}</span>` : ''}</div>
        ${list.slice(0, 4).map(o => `<div class="cal-ev" data-go="${o.id}"
          title="${UI.esc(o.customer_name)}　${UI.esc(o.title || '')}　${UI.esc(o.techs || '未指派')}">
          ${o.priority === 'urgent' ? '🔴' : ''}${UI.esc(TW.order_type[o.type])}·${UI.esc(o.customer_name)}</div>`).join('')}
        ${list.length > 4 ? `<div class="cal-more" data-day="${ds}">還有 ${list.length - 4} 件…</div>` : ''}
      </div>`);
    }

    el.innerHTML = `
      ${App.toolbar(`
        <button class="btn small secondary" id="prev-m">← 上個月</button>
        <input type="month" id="cal-month" value="${month}">
        <button class="btn small secondary" id="next-m">下個月 →</button>
        <span class="spacer"></span>
        <button class="btn" id="new-order">＋ 開新工單</button>`)}
      <div class="cal-grid cal-head">${['日', '一', '二', '三', '四', '五', '六'].map(x => `<div>${x}</div>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>`;

    el.querySelectorAll('[data-go]').forEach(x => { x.onclick = () => { location.hash = 'orders/' + x.dataset.go; }; });
    el.querySelectorAll('[data-day]').forEach(x => {
      x.onclick = () => {
        const list = d.days[x.dataset.day] || [];
        UI.modal({
          title: `${x.dataset.day} 的工單（${list.length} 件）`, hideFooter: true,
          body: UI.table(['工單', '類別', '客戶', '案由', '技師', '狀態'], list.map(o => `
            <tr style="cursor:pointer" onclick="location.hash='orders/${o.id}';document.querySelector('.modal-mask').remove()">
              <td>${UI.esc(o.order_no)}</td><td>${TW.order_type[o.type]}</td>
              <td>${UI.esc(o.customer_name)}</td><td class="wrap">${UI.esc(o.title || '')}</td>
              <td>${UI.esc(o.techs || '－')}</td>
              <td>${UI.tag(TW.order_status[o.status], TW.status_cls[o.status])}</td></tr>`))
        });
      };
    });
    const shift = n => {
      const dt = new Date(y, m - 1 + n, 1);
      App._calMonth = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      App.pages.calendar.render(el);
    };
    el.querySelector('#prev-m').onclick = () => shift(-1);
    el.querySelector('#next-m').onclick = () => shift(1);
    el.querySelector('#cal-month').onchange = e => { App._calMonth = e.target.value; App.pages.calendar.render(el); };
    el.querySelector('#new-order').onclick = () => Orders.newOrderDialog();
  }
});
