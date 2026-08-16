// 工程專案、追加減帳、估驗計價、分包工班、出工日報

// ================= 工程專案 =================

App.page('projects', {
  title: '工程專案',
  sub: '承攬案的合約、追加減帳、施工進度、估驗計價與成本毛利',
  module: 'projects',
  async render(el, id) {
    if (id) return Proj.renderDetail(el, id);
    const f = App._projFilter || (App._projFilter = { q: '', status: 'open', trade: '' });
    const rows = await GET(`/projects?q=${encodeURIComponent(f.q)}&status=${f.status}&trade=${f.trade}`);

    const totals = rows.reduce((a, r) => ({
      contract: a.contract + r.contract_total,
      billed: a.billed + r.billed,
      receivable: a.receivable + r.receivable,
      retention: a.retention + r.retention_held
    }), { contract: 0, billed: 0, receivable: 0, retention: 0 });

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋工程名稱／案號／地址／業主" value="${UI.esc(f.q)}" style="min-width:240px">
        <select id="f-status">
          ${[['open', '進行中'], ['completed', '已完工'], ['accepted', '已驗收'], ['settled', '已結案'],
        ['cancelled', '已取消'], ['', '全部']].map(([v, t]) =>
          `<option value="${v}"${f.status === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <select id="f-trade">
          <option value="">全部工種</option>
          ${(App.meta.trades || []).map(t =>
        `<option value="${t}"${f.trade === t ? ' selected' : ''}>${UI.esc(TW.trade[t] || t)}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 案</span>
        <button class="btn" id="new-proj">＋ 新增工程</button>`)}

      <div class="stat-grid">
        <div class="stat"><div class="num">${UI.num(totals.contract)}</div><div class="label">合約總額（含追加減）</div></div>
        <div class="stat"><div class="num">${UI.num(totals.billed)}</div><div class="label">已估驗計價</div></div>
        <div class="stat"><div class="num ${totals.receivable ? 'warn' : ''}">${UI.num(totals.receivable)}</div><div class="label">未收工程款</div></div>
        <div class="stat"><div class="num">${UI.num(totals.retention)}</div><div class="label">業主保留款</div></div>
      </div>

      ${UI.table(['案號／工程名稱', '業主', '工種', '合約金額', '計價進度', '未收', '保留款', '工期', '狀態'], rows.map(p => `
        <tr style="cursor:pointer" onclick="location.hash='projects/${p.id}'">
          <td><strong>${UI.esc(p.name)}</strong><br>
            <span style="color:var(--muted);font-size:12px">${UI.esc(p.proj_no)}
            ${p.pm_name ? '／' + UI.esc(p.pm_name) : ''}</span></td>
          <td class="wrap">${UI.esc(p.customer_name)}</td>
          <td>${UI.tag(TW.trade[p.trade] || p.trade)}<br>
            <span style="color:var(--muted);font-size:12px">${UI.esc(TW.project_kind[p.kind] || p.kind)}</span></td>
          <td class="num">${UI.money(p.contract_total)}
            ${p.change_amount ? `<br><span style="font-size:12px;color:${p.change_amount > 0 ? 'var(--warn,#b26b00)' : 'var(--muted)'}">
              追加減 ${p.change_amount > 0 ? '+' : ''}${UI.num(p.change_amount)}</span>` : ''}</td>
          <td class="num">${Proj.bar(p.billed_pct)}<span style="font-size:12px">${p.billed_pct}%</span></td>
          <td class="num">${p.receivable > 0 ? `<strong style="color:var(--danger)">${UI.money(p.receivable)}</strong>` : '－'}</td>
          <td class="num">${p.retention_held ? UI.num(p.retention_held) : '－'}</td>
          <td>${UI.esc(p.start_date || '－')}<br>
            <span style="font-size:12px;color:${p.overdue ? 'var(--danger)' : 'var(--muted)'}">
              至 ${UI.esc(p.due_date || '－')}${p.overdue ? ' 逾期' : ''}</span></td>
          <td>${UI.tag(TW.project_status[p.status], TW.project_cls[p.status])}</td>
        </tr>`), '沒有符合條件的工程專案')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.projects.render(el); }, 350);
    });
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.projects.render(el); };
    el.querySelector('#f-trade').onchange = e => { f.trade = e.target.value; App.pages.projects.render(el); };
    el.querySelector('#new-proj').onclick = () => Proj.editDialog();
  }
});

const Proj = {
  bar(pct) {
    const p = Math.max(0, Math.min(100, pct || 0));
    return `<div class="progress-bar"><span style="width:${p}%"></span></div>`;
  },

  // ---- 新增／修改工程 ----
  editDialog(p) {
    const isNew = !p;
    const m = UI.modal({
      title: isNew ? '新增工程專案' : `修改工程：${p.name}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        b.customer_id = el.querySelector('#pj-customer-id').value;
        if (!b.customer_id) throw new Error('請選擇業主');
        if (isNew) {
          const r = await POST('/projects', b);
          UI.toast('工程專案已建立');
          location.hash = 'projects/' + r.id;
        } else {
          await PUT('/projects/' + p.id, b);
          UI.toast('已儲存');
          App.reload();
        }
      },
      body: `<div class="form-grid">
        ${UI.input('name', '工程名稱', { value: p?.name, required: true, full: true, placeholder: '例：中山路 12 號 3F 全戶水電更新工程' })}
        <div class="form-row full"><label>業主（客戶）*</label>
          <input id="pj-customer" placeholder="輸入名稱或電話搜尋" value="${UI.esc(p?.customer_name || '')}">
          <input type="hidden" id="pj-customer-id" value="${p?.customer_id || ''}"></div>
        ${UI.select('trade', '工種', App.mapOpts(TW.trade), { value: p?.trade || 'mixed' })}
        ${UI.select('kind', '工程性質', App.mapOpts(TW.project_kind), { value: p?.kind || 'new' })}
        ${UI.input('address', '施工地址', { value: p?.address, full: true })}
        ${UI.input('contact', '現場聯絡人', { value: p?.contact })}
        ${UI.input('phone', '聯絡電話', { value: p?.phone })}
        ${UI.input('contract_no', '合約編號', { value: p?.contract_no })}
        ${UI.input('contract_date', '簽約日', { type: 'date', value: p?.contract_date })}
        ${UI.input('contract_amount', '承攬金額（未稅）', { type: 'number', value: p?.contract_amount || 0 })}
        ${UI.select('tax_mode', '稅別', App.mapOpts(TW.tax_mode), { value: p?.tax_mode || 'exclusive' })}
        ${UI.input('budget_cost', '預算成本', { type: 'number', value: p?.budget_cost || 0, placeholder: '工料＋分包，用於毛利控管' })}
        ${UI.input('retention_rate', '保留款比例', { type: 'number', step: '0.01', value: p ? p.retention_rate : (App.meta.retention_rate_default ?? 0.05), placeholder: '0.05 = 5%' })}
        ${UI.select('pm_id', '工地主任', [['', '未指定'], ...App.techOptions()], { value: p?.pm_id || '' })}
        ${UI.input('start_date', '開工日', { type: 'date', value: p?.start_date })}
        ${UI.input('due_date', '契約完工日', { type: 'date', value: p?.due_date })}
        ${UI.input('finish_date', '實際完工日', { type: 'date', value: p?.finish_date })}
        ${UI.input('accept_date', '驗收日', { type: 'date', value: p?.accept_date })}
        ${UI.input('warranty_months', '保固月數', { type: 'number', value: p?.warranty_months ?? (App.meta.project_warranty_months ?? 12) })}
        ${UI.input('guarantee_amount', '履約／保固保證金', { type: 'number', value: p?.guarantee_amount || 0 })}
        ${UI.inputList('guarantee_type', '保證金形式', ['現金', '本票', '銀行保證', '無'], { value: p?.guarantee_type })}
        ${UI.input('guarantee_return_date', '保證金退還日', { type: 'date', value: p?.guarantee_return_date })}
        ${p ? UI.input('progress', '施工進度 %', { type: 'number', value: p.progress }) : ''}
        ${p ? UI.select('status', '狀態', App.mapOpts(TW.project_status), { value: p.status }) : ''}
        ${UI.textarea('scope', '承攬範圍', { value: p?.scope, placeholder: '例：全戶給排水管更新、配電盤更換、迴路增設 8 迴、衛浴設備安裝（設備由業主自備）' })}
        ${UI.textarea('note', '備註', { value: p?.note })}
      </div>`,
      onOpen: body => {
        UI.customerPicker(body.querySelector('#pj-customer'), c => {
          body.querySelector('#pj-customer').value = c.name;
          body.querySelector('#pj-customer-id').value = c.id;
          const addr = body.querySelector('[name=address]');
          if (!addr.value) addr.value = c.address || '';
          const contact = body.querySelector('[name=contact]');
          if (!contact.value) contact.value = c.contact || '';
          const phone = body.querySelector('[name=phone]');
          if (!phone.value) phone.value = c.phone || '';
        });
      }
    });
    return m;
  },

  // ---- 工程明細 ----
  async renderDetail(el, id) {
    const p = await GET('/projects/' + id);
    const f = p.finance;

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#projects">← 回列表</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="add-change">＋ 追加減帳</button>
        <button class="btn small secondary" id="add-sub">＋ 發包工班</button>
        <button class="btn small secondary" id="add-labor">＋ 出工日報</button>
        <button class="btn small secondary" id="add-filing">＋ 報驗案件</button>
        <button class="btn small secondary" id="edit-proj">修改工程</button>
        <button class="btn" id="add-billing">＋ 估驗計價</button>`)}

      <div class="stat-grid">
        <div class="stat"><div class="num">${UI.num(f.contract_total)}</div>
          <div class="label">合約總額${f.change_amount ? `（含追加減 ${f.change_amount > 0 ? '+' : ''}${UI.num(f.change_amount)}）` : ''}</div></div>
        <div class="stat"><div class="num">${f.billed_pct}%</div><div class="label">已計價 ${UI.num(f.billed)}</div></div>
        <div class="stat"><div class="num ${f.receivable ? 'warn' : ''}">${UI.num(f.receivable)}</div><div class="label">未收工程款</div></div>
        <div class="stat"><div class="num">${UI.num(f.retention_held)}</div><div class="label">保留款在業主手上</div></div>
        <div class="stat"><div class="num">${UI.num(f.cost)}</div><div class="label">已發生成本</div></div>
        <div class="stat"><div class="num ${f.profit < 0 ? 'danger' : ''}">${UI.num(f.profit)}</div>
          <div class="label">預估毛利 ${f.profit_pct}%</div></div>
      </div>

      <div class="split">
        <div>
          <div class="card"><h3>估驗計價（${p.billings.length} 期）</h3>
            ${UI.table(['期別', '日期', '累計完成', '估驗金額', '保留款', '其他扣款', '本期請款', '請款單', ''],
      p.billings.map(b => `
              <tr>
                <td>第 ${b.seq} 期<br><span style="font-size:12px;color:var(--muted)">${UI.esc(TW.billing_kind[b.kind] || b.kind)}</span></td>
                <td>${UI.esc(b.bill_date)}</td>
                <td class="num">${b.kind === 'retention' ? '－' : b.progress_pct + '%'}</td>
                <td class="num">${UI.money(b.gross_amount)}</td>
                <td class="num">${b.retention ? UI.num(b.retention) : '－'}</td>
                <td class="num">${b.deduct ? `${UI.num(b.deduct)}<br><span style="font-size:12px;color:var(--muted)">${UI.esc(b.deduct_note)}</span>` : '－'}</td>
                <td class="num"><strong>${UI.money(b.net_amount)}</strong></td>
                <td>${b.inv_no
        ? `<a href="#invoices/${b.invoice_id}">${UI.esc(b.inv_no)}</a><br>
                     <span style="font-size:12px;color:var(--muted)">已收 ${UI.num(b.invoice_paid)}／${UI.num(b.invoice_total)}</span>`
        : UI.tag(TW.pbill_status[b.status] || b.status, b.status === 'confirmed' ? 'warn' : '')}</td>
                <td class="num">${b.invoice_id ? ''
        : `<button class="btn small" data-bill="${b.id}">開請款單</button>
                     <button class="btn small secondary" data-delbill="${b.id}">刪</button>`}</td>
              </tr>`), '尚未辦理估驗計價')}
            ${f.retention_held > 0 && ['completed', 'accepted'].includes(p.status)
        ? `<button class="btn small secondary" id="release-retention" style="margin-top:10px">
             請領保留款 ${UI.money(f.retention_held)}</button>` : ''}
          </div>

          <div class="card"><h3>追加減帳（${p.changes.length}）</h3>
            ${UI.table(['變更序號', '日期', '項目', '金額', '業主簽認', '狀態', ''], p.changes.map(c => `
              <tr>
                <td>${UI.esc(c.change_no)}</td>
                <td>${UI.esc(c.change_date)}</td>
                <td class="wrap">${UI.esc(c.title)}
                  ${c.reason ? `<br><span style="font-size:12px;color:var(--muted)">${UI.esc(c.reason)}</span>` : ''}</td>
                <td class="num"><strong style="color:${c.amount < 0 ? 'var(--danger)' : 'inherit'}">
                  ${c.amount > 0 ? '+' : ''}${UI.money(c.amount)}</strong></td>
                <td>${UI.esc(c.approved_by || '－')}<br>
                  <span style="font-size:12px;color:var(--muted)">${UI.esc(c.approved_date || '')}</span></td>
                <td>${UI.tag(TW.change_status[c.status], c.status === 'approved' ? 'ok' : c.status === 'rejected' ? 'danger' : 'warn')}</td>
                <td class="num"><button class="btn small secondary" data-chg="${c.id}">編輯</button></td>
              </tr>`), '沒有追加減帳；工程變更務必先簽認再施工')}
          </div>

          <div class="card"><h3>分包工班（${p.subcontracts.length}）</h3>
            ${UI.table(['發包單', '工班', '工項', '發包金額', '已計價', '已付', '狀態'], p.subcontracts.map(s => `
              <tr style="cursor:pointer" onclick="location.hash='subcontracts/${s.id}'">
                <td>${UI.esc(s.sc_no)}</td>
                <td>${UI.esc(s.sub_name)}<br><span style="font-size:12px;color:var(--muted)">${UI.esc(s.sub_phone || '')}</span></td>
                <td class="wrap">${UI.esc(s.title || s.trade || '')}</td>
                <td class="num">${UI.money(s.amount)}</td>
                <td class="num">${UI.num(s.billed)}</td>
                <td class="num">${UI.num(s.paid)}</td>
                <td>${UI.tag(TW.sc_status[s.status], s.status === 'settled' ? 'ok' : 'primary')}</td>
              </tr>`), '此工程未發包，全由自家施作')}
          </div>

          <div class="card"><h3>相關工單（${p.orders.length}）</h3>
            ${UI.table(['工單號', '類別', '日期', '案由', '技師', '金額', '狀態'], p.orders.map(o => `
              <tr style="cursor:pointer" onclick="location.hash='orders/${o.id}'">
                <td>${UI.esc(o.order_no)}</td>
                <td>${UI.tag(TW.order_type[o.type] || o.type)}</td>
                <td>${UI.esc(o.appoint_date || '')}</td>
                <td class="wrap">${UI.esc(o.title || '')}</td>
                <td>${UI.esc(o.techs || '－')}</td>
                <td class="num">${UI.money(o.total)}</td>
                <td>${UI.tag(TW.order_status[o.status], TW.status_cls[o.status])}</td>
              </tr>`), '尚無掛在此工程下的工單')}
          </div>

          <div class="card"><h3>出工日報（近 200 筆）</h3>
            ${UI.table(['日期', '人員', '工別', '工數', '工資', '施工內容', '天氣'], p.labor.map(l => `
              <tr>
                <td>${UI.esc(l.log_date)}</td>
                <td>${UI.esc(l.user_name || l.sub_name || l.worker_name)}</td>
                <td>${UI.esc(l.worker_type)}</td>
                <td class="num">${l.days ? l.days + ' 工' : l.hours + ' 時'}
                  ${l.overtime_hours ? `<br><span style="font-size:12px;color:var(--muted)">加班 ${l.overtime_hours} 時</span>` : ''}</td>
                <td class="num">${UI.money(l.amount)}</td>
                <td class="wrap">${UI.esc(l.work_desc || '')}</td>
                <td>${UI.esc(l.weather || '')}</td>
              </tr>`), '尚無出工紀錄')}
          </div>
        </div>

        <div>
          <div class="card"><h3>工程資訊</h3>
            <div class="detail-grid">
              <div><div class="dg-label">案號</div>${UI.esc(p.proj_no)}</div>
              <div><div class="dg-label">狀態</div>${UI.tag(TW.project_status[p.status], TW.project_cls[p.status])}</div>
              <div><div class="dg-label">業主</div><a href="#customers/${p.customer_id}">${UI.esc(p.customer_name)}</a></div>
              <div><div class="dg-label">聯絡</div>${UI.esc(p.contact || '－')}　${UI.esc(p.phone || '')}</div>
              <div><div class="dg-label">施工地址</div>${UI.esc(p.address || '－')}</div>
              <div><div class="dg-label">工種／性質</div>${UI.esc(TW.trade[p.trade] || p.trade)}／${UI.esc(TW.project_kind[p.kind] || p.kind)}</div>
              <div><div class="dg-label">合約編號</div>${UI.esc(p.contract_no || '－')}</div>
              <div><div class="dg-label">簽約日</div>${UI.esc(p.contract_date || '－')}</div>
              <div><div class="dg-label">工期</div>${UI.esc(p.start_date || '－')} ~ ${UI.esc(p.due_date || '－')}</div>
              <div><div class="dg-label">實際完工／驗收</div>${UI.esc(p.finish_date || '－')}／${UI.esc(p.accept_date || '－')}</div>
              <div><div class="dg-label">保固到期</div>${UI.esc(p.warranty_end || '－')}（${p.warranty_months} 個月）</div>
              <div><div class="dg-label">工地主任</div>${UI.esc(p.pm_name || '未指定')}</div>
              <div><div class="dg-label">保留款比例</div>${(p.retention_rate * 100).toFixed(1)}%</div>
              <div><div class="dg-label">保證金</div>${p.guarantee_amount ? `${UI.money(p.guarantee_amount)}（${UI.esc(p.guarantee_type || '－')}）` : '無'}
                ${p.guarantee_return_date ? `<br><span style="font-size:12px;color:var(--muted)">應退還 ${UI.esc(p.guarantee_return_date)}</span>` : ''}</div>
            </div>
            <div style="margin-top:10px">
              <div class="dg-label">施工進度</div>${Proj.bar(p.progress)}
              <span style="font-size:13px">${p.progress}%</span>
            </div>
            ${p.scope ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(p.scope)}</div>` : ''}
          </div>

          <div class="card"><h3>成本結構</h3>
            <div class="detail-grid">
              <div><div class="dg-label">材料（工單領料）</div>${UI.money(f.material_cost)}</div>
              <div><div class="dg-label">分包已計價</div>${UI.money(f.sub_cost)}</div>
              <div><div class="dg-label">自家工資</div>${UI.money(f.labor_cost)}</div>
              <div><div class="dg-label">成本合計</div><strong>${UI.money(f.cost)}</strong></div>
              <div><div class="dg-label">已發包未計價</div>${UI.money(f.sub_committed - f.sub_cost)}</div>
              ${f.budget_left === null ? '' : `<div><div class="dg-label">預算餘額</div>
                <strong style="color:${f.budget_left < 0 ? 'var(--danger)' : 'var(--primary-dark)'}">${UI.money(f.budget_left)}</strong></div>`}
              <div><div class="dg-label">預估毛利</div>
                <strong style="color:${f.profit < 0 ? 'var(--danger)' : 'var(--primary-dark)'}">${UI.money(f.profit)}</strong>（${f.profit_pct}%）</div>
            </div>
          </div>

          <div class="card"><h3>報驗申報（${p.filings.length}）</h3>
            ${p.filings.length ? `<ul class="mini-list">${p.filings.map(x => `
              <li><div class="ml-main">${UI.esc(x.kind)}
                <div class="ml-sub">${UI.esc(x.authority || '')}　${UI.esc(x.apply_no || '')}</div></div>
                <div style="text-align:right">${UI.tag(TW.filing_result[x.result] || x.result, TW.filing_cls[x.result])}
                <div class="ml-sub">${UI.esc(x.apply_date || '')}</div></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">尚無報驗案件</div>'}
          </div>

          <div class="card"><h3>用料統計</h3>
            ${UI.table(['品名', '數量', '成本'], p.materials.slice(0, 30).map(m => `
              <tr><td class="wrap">${UI.esc(m.name)}<br><span style="font-size:12px;color:var(--muted)">${UI.esc(m.spec || '')}</span></td>
                <td class="num">${m.qty} ${UI.esc(m.unit)}</td>
                <td class="num">${UI.money(m.cost)}</td></tr>`), '尚未領料')}
          </div>
        </div>
      </div>`;

    el.querySelector('#edit-proj').onclick = () => Proj.editDialog(p);
    el.querySelector('#add-change').onclick = () => Proj.changeDialog(p);
    el.querySelector('#add-billing').onclick = () => Proj.billingDialog(p);
    el.querySelector('#add-sub').onclick = () => Sub.contractDialog(null, { project_id: p.id, project_name: p.name });
    el.querySelector('#add-labor').onclick = () => Labor.editDialog(null, { project_id: p.id });
    el.querySelector('#add-filing').onclick = () => Trade.filingDialog(null, { project_id: p.id, customer_id: p.customer_id });

    const rel = el.querySelector('#release-retention');
    if (rel) rel.onclick = () => Proj.billingDialog(p, 'retention');

    el.querySelectorAll('[data-chg]').forEach(b => {
      b.onclick = () => Proj.changeDialog(p, p.changes.find(c => c.id === Number(b.dataset.chg)));
    });
    el.querySelectorAll('[data-bill]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('將這期估驗計價開立為請款單？保留款與扣款會列在明細中。')) return;
        try {
          const r = await POST(`/project-billings/${b.dataset.bill}/to-invoice`, {});
          UI.toast('請款單 ' + r.inv_no + ' 已開立');
          App.reload();
        } catch (e) { UI.err(e); }
      };
    });
    el.querySelectorAll('[data-delbill]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('確定刪除這期估驗計價？')) return;
        try { await DEL('/project-billings/' + b.dataset.delbill); App.reload(); } catch (e) { UI.err(e); }
      };
    });
  },

  // ---- 追加減帳 ----
  changeDialog(p, c) {
    UI.modal({
      title: c ? '修改追加減帳' : `追加減帳：${p.name}`,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (c) await PUT('/project-changes/' + c.id, b);
        else await POST(`/projects/${p.id}/changes`, b);
        UI.toast('已儲存');
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.input('title', '變更項目', { value: c?.title, required: true, full: true, placeholder: '例：追加 3F 衛浴排風管配置' })}
        ${UI.input('change_no', '變更序號', { value: c?.change_no, placeholder: '留空自動編號' })}
        ${UI.input('change_date', '日期', { type: 'date', value: c?.change_date || UI.today() })}
        ${UI.input('amount', '金額（減帳填負數）', { type: 'number', value: c?.amount || 0, full: true })}
        ${UI.textarea('reason', '變更原因', { value: c?.reason, placeholder: '業主要求／現場條件不符／圖說修改' })}
        ${UI.select('status', '狀態', App.mapOpts(TW.change_status), { value: c?.status || 'draft' })}
        ${UI.input('approved_by', '業主簽認人', { value: c?.approved_by })}
        ${UI.input('approved_date', '簽認日', { type: 'date', value: c?.approved_date })}
        ${UI.textarea('note', '備註', { value: c?.note })}
      </div>${App.noticeBox('只有狀態為「已核准」的變更才會併入合約金額。\n未簽認就施工，事後追不到錢是水電行最常見的虧損來源。')}`,
      onOpen: body => {
        if (!c) return;
        const foot = document.createElement('div');
        foot.style.marginTop = '12px';
        foot.innerHTML = '<button class="btn small secondary" type="button">刪除此變更</button>';
        foot.querySelector('button').onclick = async () => {
          if (!await UI.confirm('確定刪除此變更單？')) return;
          try { await DEL('/project-changes/' + c.id); UI.toast('已刪除'); App.reload(); document.querySelector('.modal-mask')?.remove(); }
          catch (e) { UI.err(e); }
        };
        body.appendChild(foot);
      }
    });
  },

  // ---- 估驗計價 ----
  billingDialog(p, forceKind) {
    const f = p.finance;
    const kind = forceKind || 'progress';
    UI.modal({
      title: kind === 'retention' ? '請領保留款' : `估驗計價：${p.name}`,
      onSubmit: async el => {
        const b = UI.formData(el);
        const r = await POST(`/projects/${p.id}/billings`, b);
        UI.toast(`第 ${r.seq} 期已建立，本期請款 ${UI.money(r.net_amount)}`);
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.select('kind', '計價類別', App.mapOpts(TW.billing_kind), { value: kind })}
        ${UI.input('bill_date', '估驗日', { type: 'date', value: UI.today() })}
        ${kind === 'retention' ? '' : UI.input('progress_pct', '本期累計完成 %', { type: 'number', value: p.progress, full: true })}
        ${UI.input('gross_amount', kind === 'retention' ? '請領金額' : '本期估驗金額（未稅）',
        { type: 'number', value: kind === 'retention' ? f.retention_held : '', full: true, placeholder: kind === 'retention' ? '' : '留空則依完成度自動計算' })}
        ${kind === 'retention' ? '' : UI.input('retention', '本期扣留保留款', { type: 'number', placeholder: `留空依 ${(p.retention_rate * 100).toFixed(1)}% 自動計算` })}
        ${UI.input('deduct', '其他扣款', { type: 'number', value: 0 })}
        ${UI.input('deduct_note', '扣款說明', { placeholder: '例：業主代購材料扣回、逾期違約金', full: true })}
        ${UI.textarea('note', '備註', {})}
      </div>
      ${App.noticeBox(`合約總額 ${UI.money(f.contract_total)}　已計價 ${UI.money(f.billed)}　未計價餘額 ${UI.money(f.unbilled)}\n保留款目前累計 ${UI.money(f.retention_held)}`)}`
    });
  }
};

// ================= 分包工班 =================

App.page('subcontractors', {
  title: '分包工班',
  sub: '協力廠商建檔、證照保險、發包紀錄與年度給付彙總',
  module: 'subcontract',
  async render(el, id) {
    if (id) return Sub.renderDetail(el, id);
    const f = App._subFilter || (App._subFilter = { q: '', trade: '', status: 'active' });
    const rows = await GET(`/subcontractors?q=${encodeURIComponent(f.q)}&trade=${f.trade}&status=${f.status}`);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋工班名稱／電話／工種" value="${UI.esc(f.q)}" style="min-width:220px">
        <select id="f-status">
          <option value="active"${f.status === 'active' ? ' selected' : ''}>合作中</option>
          <option value="inactive"${f.status === 'inactive' ? ' selected' : ''}>已停用</option>
          <option value=""${f.status === '' ? ' selected' : ''}>全部</option>
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 家</span>
        <button class="btn" id="new-sub">＋ 新增工班</button>`)}

      ${UI.table(['工班名稱', '工種', '身分', '聯絡', '證照／保險', '發包件數', '累計發包', '待付', '評等'], rows.map(s => `
        <tr style="cursor:pointer" onclick="location.hash='subcontractors/${s.id}'">
          <td><strong>${UI.esc(s.name)}</strong>${s.active ? '' : ' ' + UI.tag('停用', 'danger')}
            <br><span style="font-size:12px;color:var(--muted)">${UI.esc(s.contact || '')}</span></td>
          <td>${UI.esc(s.trade)}</td>
          <td>${s.is_individual ? UI.tag('個人（需扣繳）', 'warn') : UI.tag('公司（開發票）')}</td>
          <td>${UI.esc(s.phone || '－')}</td>
          <td>${UI.esc(s.license || '－')}
            ${s.labor_insurance ? '<br>' + UI.tag('已投保', 'ok') : '<br>' + UI.tag('未確認保險', 'warn')}</td>
          <td class="num">${s.contract_count}</td>
          <td class="num">${UI.money(s.total_amount)}</td>
          <td class="num">${s.payable > 0 ? `<strong style="color:var(--danger)">${UI.money(s.payable)}</strong>` : '－'}</td>
          <td>${s.rating ? '★'.repeat(s.rating) : '－'}</td>
        </tr>`), '尚未建立分包工班')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.subcontractors.render(el); }, 350);
    });
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.subcontractors.render(el); };
    el.querySelector('#new-sub').onclick = () => Sub.editDialog();
  }
});

App.page('subcontracts', {
  title: '發包計價',
  sub: '發包單、分期計價、扣款扣繳與付款',
  module: 'subcontract',
  async render(el, id) {
    if (id) return Sub.renderContract(el, id);
    const f = App._scFilter || (App._scFilter = { q: '', status: 'open' });
    const [rows, payable] = await Promise.all([
      GET(`/subcontracts?q=${encodeURIComponent(f.q)}&status=${f.status}`),
      GET('/subcontract-payable')
    ]);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋發包單號／工項／工班" value="${UI.esc(f.q)}" style="min-width:220px">
        <select id="f-status">
          ${[['open', '進行中'], ['draft', '草稿'], ['settled', '已結案'], ['cancelled', '已取消'], ['', '全部']]
        .map(([v, t]) => `<option value="${v}"${f.status === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <button class="btn secondary small" id="tab-payable">應付工班總表</button>
        <button class="btn" id="new-sc">＋ 新增發包單</button>`)}

      <div class="stat-grid">
        <div class="stat"><div class="num ${payable.total ? 'warn' : ''}">${UI.num(payable.total)}</div><div class="label">待付工班款</div></div>
        <div class="stat"><div class="num">${UI.num(payable.retention.reduce((s, r) => s + r.retention, 0))}</div><div class="label">代扣工班保留款</div></div>
        <div class="stat"><div class="num">${UI.num(payable.wht_summary.reduce((s, r) => s + r.wht, 0))}</div>
          <div class="label">${payable.wht_year} 年度已扣繳稅額</div></div>
      </div>

      ${UI.table(['發包單', '工班', '工程／工單', '工項', '發包金額', '已計價', '已付', '保留款', '狀態'], rows.map(s => `
        <tr style="cursor:pointer" onclick="location.hash='subcontracts/${s.id}'">
          <td>${UI.esc(s.sc_no)}<br><span style="font-size:12px;color:var(--muted)">${UI.esc(TW.pay_kind[s.pay_kind] || '')}</span></td>
          <td>${UI.esc(s.sub_name)}${s.is_individual ? ' ' + UI.tag('個人', 'warn') : ''}</td>
          <td class="wrap">${UI.esc(s.project_name || s.order_no || '－')}</td>
          <td class="wrap">${UI.esc(s.title || s.trade || '')}</td>
          <td class="num">${UI.money(s.amount)}</td>
          <td class="num">${UI.num(s.billed)}</td>
          <td class="num">${UI.num(s.paid)}
            ${s.net_billed - s.paid > 0 ? `<br><span style="font-size:12px;color:var(--danger)">待付 ${UI.num(s.net_billed - s.paid)}</span>` : ''}</td>
          <td class="num">${s.retention_held ? UI.num(s.retention_held) : '－'}</td>
          <td>${UI.tag(TW.sc_status[s.status], s.status === 'settled' ? 'ok' : s.status === 'cancelled' ? 'danger' : 'primary')}</td>
        </tr>`), '沒有符合條件的發包單')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.subcontracts.render(el); }, 350);
    });
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.subcontracts.render(el); };
    el.querySelector('#new-sc').onclick = () => Sub.contractDialog();
    el.querySelector('#tab-payable').onclick = () => Sub.payableDialog(payable);
  }
});

const Sub = {
  editDialog(s) {
    const isNew = !s;
    UI.modal({
      title: isNew ? '新增分包工班' : `修改工班：${s.name}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (isNew) { const r = await POST('/subcontractors', b); UI.toast('已建立'); location.hash = 'subcontractors/' + r.id; }
        else { await PUT('/subcontractors/' + s.id, b); UI.toast('已儲存'); App.reload(); }
      },
      body: `<div class="form-grid">
        ${UI.input('name', '工班／廠商名稱', { value: s?.name, required: true, full: true })}
        ${UI.inputList('trade', '專長工種', ['配管', '配線', '衛浴安裝', '泥作修補', '開挖', '鑽孔', '吊車', '空調', '消防', '弱電', '綜合'], { value: s?.trade })}
        ${UI.input('code', '編號', { value: s?.code })}
        ${UI.checkbox('is_individual', '個人工班（給付需辦理扣繳，非公司發票）', s ? s.is_individual : true, { full: true })}
        ${UI.input('tax_id', '統編／身分證字號', { value: s?.tax_id, placeholder: '開立扣繳憑單用' })}
        ${UI.input('contact', '負責人／聯絡人', { value: s?.contact })}
        ${UI.input('phone', '電話', { value: s?.phone })}
        ${UI.input('bank_account', '匯款帳號', { value: s?.bank_account })}
        ${UI.input('address', '地址', { value: s?.address, full: true })}
        ${UI.input('license', '證照', { value: s?.license, placeholder: '室內配線技術士／自來水管配管技術士' })}
        ${UI.input('license_no', '證照字號', { value: s?.license_no })}
        ${UI.input('license_expiry', '證照有效期', { type: 'date', value: s?.license_expiry })}
        ${UI.checkbox('labor_insurance', '已投保勞保／營造綜合險', s?.labor_insurance)}
        ${UI.input('insurance_end', '保險到期日', { type: 'date', value: s?.insurance_end })}
        ${UI.inputList('payment_terms', '付款條件', App.meta.payment_terms || [], { value: s?.payment_terms })}
        ${UI.input('day_rate', '點工日薪參考', { type: 'number', value: s?.day_rate || App.meta.day_rate_default || 0 })}
        ${UI.select('rating', '配合評等', [[0, '未評'], [1, '★'], [2, '★★'], [3, '★★★'], [4, '★★★★'], [5, '★★★★★']], { value: s?.rating || 0 })}
        ${UI.textarea('note', '備註', { value: s?.note, placeholder: '例：只接大台北、需提前三天約、細節收尾好' })}
        ${isNew ? '' : UI.checkbox('active', '合作中（取消勾選＝停用）', s.active)}
      </div>`
    });
  },

  async renderDetail(el, id) {
    const s = await GET('/subcontractors/' + id);
    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#subcontractors">← 回列表</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="edit-sub">修改資料</button>
        <button class="btn" id="new-sc">＋ 對此工班發包</button>`)}

      <div class="split">
        <div>
          <div class="card"><h3>發包紀錄</h3>
            ${UI.table(['發包單', '工程', '工項', '金額', '已計價', '狀態'], s.subcontracts.map(c => `
              <tr style="cursor:pointer" onclick="location.hash='subcontracts/${c.id}'">
                <td>${UI.esc(c.sc_no)}<br><span style="font-size:12px;color:var(--muted)">${UI.esc(c.start_date || '')}</span></td>
                <td class="wrap">${UI.esc(c.project_name || '－')}</td>
                <td class="wrap">${UI.esc(c.title || '')}</td>
                <td class="num">${UI.money(c.amount)}</td>
                <td class="num">${UI.num(c.billed)}</td>
                <td>${UI.tag(TW.sc_status[c.status], c.status === 'settled' ? 'ok' : 'primary')}</td>
              </tr>`), '尚未發包給此工班')}
          </div>
          <div class="card"><h3>計價付款紀錄</h3>
            ${UI.table(['日期', '發包單', '期', '計價', '扣款', '扣繳', '實付', '已付', '狀態'], s.billings.map(b => `
              <tr>
                <td>${UI.esc(b.bill_date)}</td>
                <td>${UI.esc(b.sc_no)}</td>
                <td class="num">${b.seq}</td>
                <td class="num">${UI.money(b.gross_amount)}</td>
                <td class="num">${UI.num(b.material_deduct + b.penalty + b.retention)}</td>
                <td class="num">${UI.num(b.wht_tax + b.nhi_fee)}</td>
                <td class="num"><strong>${UI.money(b.net_pay)}</strong></td>
                <td class="num">${UI.num(b.paid)}</td>
                <td>${UI.tag(TW.scb_status[b.status] || b.status, b.status === 'paid' ? 'ok' : 'warn')}</td>
              </tr>`), '尚無計價紀錄')}
          </div>
        </div>
        <div>
          <div class="card"><h3>基本資料</h3>
            <div class="detail-grid">
              <div><div class="dg-label">工種</div>${UI.esc(s.trade || '－')}</div>
              <div><div class="dg-label">身分</div>${s.is_individual ? '個人工班（需扣繳）' : '公司行號（取具發票）'}</div>
              <div><div class="dg-label">統編／身分證</div>${UI.esc(s.tax_id || '－')}</div>
              <div><div class="dg-label">聯絡人</div>${UI.esc(s.contact || '－')}</div>
              <div><div class="dg-label">電話</div>${UI.esc(s.phone || '－')}</div>
              <div><div class="dg-label">匯款帳號</div>${UI.esc(s.bank_account || '－')}</div>
              <div><div class="dg-label">證照</div>${UI.esc(s.license || '－')} ${UI.esc(s.license_no || '')}</div>
              <div><div class="dg-label">證照有效期</div>${UI.esc(s.license_expiry || '－')}</div>
              <div><div class="dg-label">保險</div>${s.labor_insurance ? '已投保' : '未確認'}　${UI.esc(s.insurance_end || '')}</div>
              <div><div class="dg-label">付款條件</div>${UI.esc(s.payment_terms || '－')}</div>
              <div><div class="dg-label">點工日薪</div>${UI.money(s.day_rate)}</div>
              <div><div class="dg-label">評等</div>${s.rating ? '★'.repeat(s.rating) : '未評'}</div>
            </div>
            ${s.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(s.note)}</div>` : ''}
          </div>
          <div class="card"><h3>${s.year_summary.year} 年度給付彙總</h3>
            <div class="detail-grid">
              <div><div class="dg-label">給付總額</div>${UI.money(s.year_summary.gross)}</div>
              <div><div class="dg-label">已扣繳稅額</div>${UI.money(s.year_summary.wht)}</div>
              <div><div class="dg-label">二代健保補充保費</div>${UI.money(s.year_summary.nhi)}</div>
            </div>
            ${s.is_individual ? App.noticeBox('個人工班年度給付需於次年一月底前申報扣繳憑單。\n此處金額以「已付款」的計價單統計。') : ''}
          </div>
        </div>
      </div>`;
    el.querySelector('#edit-sub').onclick = () => Sub.editDialog(s);
    el.querySelector('#new-sc').onclick = () => Sub.contractDialog(null, { subcontractor_id: s.id });
  },

  contractDialog(sc, pre = {}) {
    const isNew = !sc;
    UI.modal({
      title: isNew ? '新增發包單' : `修改發包單：${sc.sc_no}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (isNew) { const r = await POST('/subcontracts', b); UI.toast('發包單 ' + r.sc_no + ' 已建立'); location.hash = 'subcontracts/' + r.id; }
        else { await PUT('/subcontracts/' + sc.id, b); UI.toast('已儲存'); App.reload(); }
      },
      body: `<div class="form-grid">
        ${UI.select('subcontractor_id', '分包工班', [['', '請選擇'],
        ...(App.meta.subcontractors || []).map(s => [s.id, s.name + (s.is_individual ? '（個人）' : '')])],
        { value: sc?.subcontractor_id || pre.subcontractor_id || '', full: true })}
        ${UI.select('project_id', '所屬工程專案', [['', '不掛工程（單張工單發包）'],
        ...(App.meta.open_projects || []).map(p => [p.id, `${p.proj_no} ${p.name}`])],
        { value: sc?.project_id || pre.project_id || '', full: true })}
        ${UI.input('title', '工項名稱', { value: sc?.title, full: true, placeholder: '例：全戶給排水管配管工資' })}
        ${UI.inputList('trade', '工種', ['配管', '配線', '衛浴安裝', '泥作修補', '開挖', '鑽孔', '空調', '消防', '弱電'], { value: sc?.trade })}
        ${UI.select('pay_kind', '計價方式', App.mapOpts(TW.pay_kind), { value: sc?.pay_kind || 'lump' })}
        ${UI.input('amount', '發包金額（未稅）', { type: 'number', value: sc?.amount || 0 })}
        ${UI.select('tax_mode', '稅別', App.mapOpts(TW.tax_mode), { value: sc?.tax_mode || 'exclusive' })}
        ${UI.input('retention_rate', '保留款比例', { type: 'number', step: '0.01', value: sc ? sc.retention_rate : (App.meta.sub_retention_rate ?? 0.05) })}
        ${UI.input('warranty_months', '工班保固月數', { type: 'number', value: sc?.warranty_months ?? 12 })}
        ${UI.input('start_date', '進場日', { type: 'date', value: sc?.start_date })}
        ${UI.input('end_date', '完工日', { type: 'date', value: sc?.end_date })}
        ${sc ? UI.select('status', '狀態', App.mapOpts(TW.sc_status), { value: sc.status }) : UI.select('status', '狀態', [['draft', '草稿'], ['signed', '已簽約']], { value: 'signed' })}
        ${UI.textarea('scope', '發包範圍', { value: sc?.scope, placeholder: '寫清楚含不含料、材料誰出、垃圾誰清、保固幾年——事後爭議都在這幾行' })}
        ${UI.textarea('note', '備註', { value: sc?.note })}
      </div>`
    });
  },

  async renderContract(el, id) {
    const sc = await GET('/subcontracts/' + id);
    const s = sc.summary;
    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#subcontracts">← 回列表</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="edit-sc">修改發包單</button>
        <button class="btn" id="add-bill">＋ 分包計價</button>`)}

      <div class="stat-grid">
        <div class="stat"><div class="num">${UI.num(sc.amount)}</div><div class="label">發包金額</div></div>
        <div class="stat"><div class="num">${UI.num(s.billed)}</div><div class="label">已計價（未計價 ${UI.num(s.unbilled)}）</div></div>
        <div class="stat"><div class="num">${UI.num(s.retention)}</div><div class="label">扣留保留款</div></div>
        <div class="stat"><div class="num">${UI.num(s.wht + s.nhi)}</div><div class="label">代扣稅費</div></div>
        <div class="stat"><div class="num ${s.unpaid ? 'warn' : ''}">${UI.num(s.unpaid)}</div><div class="label">待付金額</div></div>
      </div>

      <div class="card"><h3>發包內容</h3>
        <div class="detail-grid">
          <div><div class="dg-label">發包單號</div>${UI.esc(sc.sc_no)}</div>
          <div><div class="dg-label">工班</div><a href="#subcontractors/${sc.subcontractor_id}">${UI.esc(sc.sub_name)}</a>
            ${sc.is_individual ? ' ' + UI.tag('個人（需扣繳）', 'warn') : ' ' + UI.tag('公司')}</div>
          <div><div class="dg-label">電話</div>${UI.esc(sc.sub_phone || '－')}</div>
          <div><div class="dg-label">所屬工程</div>${sc.project_id ? `<a href="#projects/${sc.project_id}">${UI.esc(sc.project_name)}</a>` : UI.esc(sc.order_no || '－')}</div>
          <div><div class="dg-label">工項</div>${UI.esc(sc.title || '－')}</div>
          <div><div class="dg-label">計價方式</div>${UI.esc(TW.pay_kind[sc.pay_kind] || sc.pay_kind)}</div>
          <div><div class="dg-label">工期</div>${UI.esc(sc.start_date || '－')} ~ ${UI.esc(sc.end_date || '－')}</div>
          <div><div class="dg-label">保留款比例</div>${(sc.retention_rate * 100).toFixed(1)}%</div>
          <div><div class="dg-label">保固</div>${sc.warranty_months} 個月</div>
          <div><div class="dg-label">匯款帳號</div>${UI.esc(sc.bank_account || '－')}</div>
          <div><div class="dg-label">狀態</div>${UI.tag(TW.sc_status[sc.status], sc.status === 'settled' ? 'ok' : 'primary')}</div>
        </div>
        ${sc.scope ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(sc.scope)}</div>` : ''}
      </div>

      <div class="card"><h3>計價與付款（${sc.billings.length} 期）</h3>
        ${UI.table(['期', '日期', '完成', '計價金額', '材料扣回', '罰款', '保留款', '扣繳稅', '二代健保', '實付', '已付', '狀態', ''],
      sc.billings.map(b => `
          <tr>
            <td>${b.seq}</td>
            <td>${UI.esc(b.bill_date)}</td>
            <td class="num">${b.progress_pct}%</td>
            <td class="num">${UI.money(b.gross_amount)}</td>
            <td class="num">${b.material_deduct ? UI.num(b.material_deduct) : '－'}</td>
            <td class="num">${b.penalty ? UI.num(b.penalty) : '－'}</td>
            <td class="num">${b.retention ? UI.num(b.retention) : '－'}</td>
            <td class="num">${b.wht_tax ? UI.num(b.wht_tax) : '－'}</td>
            <td class="num">${b.nhi_fee ? UI.num(b.nhi_fee) : '－'}</td>
            <td class="num"><strong>${UI.money(b.net_pay)}</strong></td>
            <td class="num">${UI.num(b.paid)}${b.pay_date ? `<br><span style="font-size:12px;color:var(--muted)">${UI.esc(b.pay_date)}</span>` : ''}</td>
            <td>${UI.tag(TW.scb_status[b.status] || b.status, b.status === 'paid' ? 'ok' : b.status === 'cancelled' ? 'danger' : 'warn')}</td>
            <td class="num">${b.net_pay > b.paid && b.status !== 'cancelled'
        ? `<button class="btn small" data-pay="${b.id}" data-amt="${b.net_pay - b.paid}">付款</button>` : ''}</td>
          </tr>`), '尚未計價')}
      </div>`;

    el.querySelector('#edit-sc').onclick = () => Sub.contractDialog(sc);
    el.querySelector('#add-bill').onclick = () => Sub.billingDialog(sc);
    el.querySelectorAll('[data-pay]').forEach(b => {
      b.onclick = () => Sub.payDialog(b.dataset.pay, Number(b.dataset.amt));
    });
  },

  billingDialog(sc) {
    const s = sc.summary;
    UI.modal({
      title: `分包計價：${sc.sub_name}`,
      onSubmit: async el => {
        const b = UI.formData(el);
        const r = await POST(`/subcontracts/${sc.id}/billings`, b);
        UI.toast(`第 ${r.seq} 期已建立，實付 ${UI.money(r.net_pay)}`);
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.input('bill_date', '計價日', { type: 'date', value: UI.today() })}
        ${UI.input('progress_pct', '本期累計完成 %', { type: 'number', placeholder: '或直接填金額' })}
        ${UI.input('gross_amount', '本期計價金額（未稅）', { type: 'number', full: true, placeholder: '留空則依完成度自動計算' })}
        ${UI.input('material_deduct', '代購材料扣回', { type: 'number', value: 0 })}
        ${UI.input('penalty', '缺失／逾期扣款', { type: 'number', value: 0 })}
        ${UI.input('retention', '扣留保留款', { type: 'number', placeholder: `留空依 ${(sc.retention_rate * 100).toFixed(1)}% 計算` })}
        ${UI.input('invoice_no', '工班發票／收據號碼', {})}
        ${UI.textarea('note', '備註', {})}
      </div>
      <div id="sub-calc" style="margin-top:12px"></div>
      ${App.noticeBox(sc.is_individual
        ? `個人工班：單次給付達 ${UI.num(App.meta.wht_threshold)} 元將自動代扣 ${(App.meta.wht_rate * 100).toFixed(0)}% 所得稅；`
        + `達 ${UI.num(App.meta.nhi_threshold)} 元另計 ${(App.meta.nhi_rate * 100).toFixed(2)}% 二代健保補充保費。`
        : '公司行號：不辦理扣繳，請取具統一發票；發包若為未稅，付款時會加計 5% 營業稅。')}`,
      onOpen: body => {
        const box = body.querySelector('#sub-calc');
        const recalc = async () => {
          const b = UI.formData(body);
          if (!Number(b.gross_amount)) { box.innerHTML = ''; return; }
          try {
            const c = await POST(`/subcontracts/${sc.id}/calc`, b);
            box.innerHTML = `<div class="detail-grid" style="background:var(--primary-light);padding:10px;border-radius:8px">
              <div><div class="dg-label">計價</div>${UI.money(c.gross)}</div>
              ${c.tax ? `<div><div class="dg-label">營業稅</div>+${UI.money(c.tax)}</div>` : ''}
              <div><div class="dg-label">保留款</div>-${UI.money(c.retention)}</div>
              <div><div class="dg-label">扣款</div>-${UI.money(c.material_deduct + c.penalty)}</div>
              <div><div class="dg-label">代扣稅費</div>-${UI.money(c.wht_tax + c.nhi_fee)}</div>
              <div><div class="dg-label">實付</div><strong>${UI.money(c.net_pay)}</strong></div>
            </div>`;
          } catch { box.innerHTML = ''; }
        };
        body.querySelectorAll('input').forEach(i => i.addEventListener('change', recalc));
        box.innerHTML = `<div style="font-size:13px;color:var(--muted)">未計價餘額 ${UI.money(s.unbilled)}</div>`;
      }
    });
  },

  payDialog(billingId, balance) {
    UI.modal({
      title: '付款給工班',
      onSubmit: async el => {
        await POST(`/subcontract-billings/${billingId}/pay`, UI.formData(el));
        UI.toast('已登錄付款');
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.input('amount', '付款金額', { type: 'number', value: balance, full: true })}
        ${UI.input('pay_date', '付款日', { type: 'date', value: UI.today() })}
        ${UI.inputList('method', '付款方式', App.meta.pay_methods || [], { value: '匯款' })}
        ${UI.input('invoice_no', '發票／收據號碼', { full: true })}
      </div>${App.noticeBox(`未付餘額 ${UI.money(balance)}`)}`
    });
  },

  payableDialog(p) {
    UI.modal({
      title: '應付工班總表', wide: true, hideFooter: true,
      body: `
        <h3 style="margin:0 0 8px">待付款項（合計 ${UI.money(p.total)}）</h3>
        ${UI.table(['到期／計價日', '工班', '工程', '發包單', '實付', '已付', '待付'], p.rows.map(r => `
          <tr><td>${UI.esc(r.bill_date)}</td>
            <td>${UI.esc(r.sub_name)}${r.is_individual ? ' ' + UI.tag('個人', 'warn') : ''}<br>
              <span style="font-size:12px;color:var(--muted)">${UI.esc(r.payment_terms || '')}</span></td>
            <td class="wrap">${UI.esc(r.project_name || '－')}</td>
            <td>${UI.esc(r.sc_no)} 第 ${r.seq} 期</td>
            <td class="num">${UI.money(r.net_pay)}</td>
            <td class="num">${UI.num(r.paid)}</td>
            <td class="num"><strong style="color:var(--danger)">${UI.money(r.balance)}</strong></td>
          </tr>`), '目前沒有待付工班款')}

        <h3 style="margin:18px 0 8px">${p.wht_year} 年度個人工班給付與扣繳（開立扣繳憑單用）</h3>
        ${UI.table(['工班', '統編／身分證', '給付總額', '已扣繳稅額', '二代健保'], p.wht_summary.map(r => `
          <tr><td>${UI.esc(r.name)}</td><td>${UI.esc(r.tax_id || '未填')}</td>
            <td class="num">${UI.money(r.gross)}</td><td class="num">${UI.money(r.wht)}</td>
            <td class="num">${UI.money(r.nhi)}</td></tr>`), '本年度尚無個人工班給付')}

        <h3 style="margin:18px 0 8px">代扣工班保留款（工程結案後應退還）</h3>
        ${UI.table(['工班', '發包單', '工項', '保留款', '發包狀態'], p.retention.map(r => `
          <tr><td>${UI.esc(r.sub_name)}</td><td>${UI.esc(r.sc_no)}</td>
            <td class="wrap">${UI.esc(r.title || '')}</td>
            <td class="num">${UI.money(r.retention)}</td>
            <td>${UI.tag(TW.sc_status[r.status] || r.status)}</td></tr>`), '目前沒有代扣保留款')}`
    });
  }
};

// ================= 出工日報 =================

App.page('labor', {
  title: '出工日報',
  sub: '每日出工人數、點工計價與工資成本歸屬',
  module: 'labor',
  async render(el) {
    const f = App._laborFilter || (App._laborFilter = {
      from: UI.addDays(UI.today(), -30), to: UI.today(), project_id: ''
    });
    const d = await GET(`/labor-logs?from=${f.from}&to=${f.to}&project_id=${f.project_id}`);

    el.innerHTML = `
      ${App.toolbar(`
        <input type="date" id="f-from" value="${f.from}">
        <span>~</span>
        <input type="date" id="f-to" value="${f.to}">
        <select id="f-proj">
          <option value="">全部工程</option>
          ${(App.meta.open_projects || []).map(p =>
        `<option value="${p.id}"${String(f.project_id) === String(p.id) ? ' selected' : ''}>${UI.esc(p.name)}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <button class="btn" id="new-labor">＋ 登錄出工</button>`)}

      <div class="stat-grid">
        <div class="stat"><div class="num">${d.summary.days}</div><div class="label">總工數</div></div>
        <div class="stat"><div class="num">${d.summary.hours}</div><div class="label">總工時</div></div>
        <div class="stat"><div class="num">${UI.num(d.summary.amount)}</div><div class="label">工資成本</div></div>
        <div class="stat"><div class="num">${d.rows.length}</div><div class="label">出工筆數</div></div>
      </div>

      ${UI.table(['日期', '人員', '工別', '工程／工單', '工數', '單價', '加班', '工資', '施工內容', '天氣', ''],
      d.rows.map(l => `
        <tr>
          <td>${UI.esc(l.log_date)}</td>
          <td>${UI.esc(l.user_name || l.sub_name || l.worker_name)}
            ${l.sub_name ? '<br>' + UI.tag('外包', 'warn') : ''}</td>
          <td>${UI.esc(l.worker_type)}</td>
          <td class="wrap">${UI.esc(l.project_name || l.order_no || '－')}</td>
          <td class="num">${l.days ? l.days + ' 工' : l.hours + ' 時'}</td>
          <td class="num">${UI.num(l.rate)}</td>
          <td class="num">${l.overtime_hours ? `${l.overtime_hours} 時 × ${UI.num(l.overtime_rate)}` : '－'}</td>
          <td class="num"><strong>${UI.money(l.amount)}</strong></td>
          <td class="wrap">${UI.esc(l.work_desc || '')}</td>
          <td>${UI.esc(l.weather || '')}</td>
          <td class="num"><button class="btn small secondary" data-lab="${l.id}">編輯</button></td>
        </tr>`), '此期間沒有出工紀錄')}`;

    const reload = () => App.pages.labor.render(el);
    el.querySelector('#f-from').onchange = e => { f.from = e.target.value; reload(); };
    el.querySelector('#f-to').onchange = e => { f.to = e.target.value; reload(); };
    el.querySelector('#f-proj').onchange = e => { f.project_id = e.target.value; reload(); };
    el.querySelector('#new-labor').onclick = () => Labor.editDialog();
    el.querySelectorAll('[data-lab]').forEach(b => {
      b.onclick = () => Labor.editDialog(d.rows.find(x => x.id === Number(b.dataset.lab)));
    });
  }
});

const Labor = {
  editDialog(l, pre = {}) {
    const isNew = !l;
    UI.modal({
      title: isNew ? '登錄出工' : '修改出工紀錄',
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (isNew) await POST('/labor-logs', b);
        else await PUT('/labor-logs/' + l.id, b);
        UI.toast('已儲存');
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.input('log_date', '日期', { type: 'date', value: l?.log_date || UI.today() })}
        ${UI.inputList('weather', '天氣', ['晴', '陰', '雨', '大雨停工', '颱風停工'], { value: l?.weather })}
        ${UI.select('project_id', '工程專案', [['', '不指定'],
        ...(App.meta.open_projects || []).map(p => [p.id, `${p.proj_no} ${p.name}`])],
        { value: l?.project_id || pre.project_id || '', full: true })}
        ${UI.select('user_id', '自家技師', [['', '非自家人員'], ...App.techOptions()], { value: l?.user_id || '' })}
        ${UI.select('subcontractor_id', '外包工班', [['', '非外包'],
        ...(App.meta.subcontractors || []).map(s => [s.id, s.name])], { value: l?.subcontractor_id || '' })}
        ${UI.input('worker_name', '人員姓名（未建檔者）', { value: l?.worker_name, placeholder: '臨時工直接填名字' })}
        ${UI.inputList('worker_type', '工別', App.meta.worker_types || [], { value: l?.worker_type || '技師' })}
        ${UI.input('days', '工數（0.5＝半天）', { type: 'number', step: '0.5', value: l?.days ?? 1 })}
        ${UI.input('hours', '工時（按時計價才填）', { type: 'number', step: '0.5', value: l?.hours || 0 })}
        ${UI.input('rate', '單價（日薪或時薪）', { type: 'number', value: l?.rate || '', placeholder: '留空自動帶入' })}
        ${UI.input('overtime_hours', '加班時數', { type: 'number', step: '0.5', value: l?.overtime_hours || 0 })}
        ${UI.input('overtime_rate', '加班時薪', { type: 'number', value: l?.overtime_rate || 0 })}
        ${UI.input('amount', '工資金額', { type: 'number', value: l?.amount || '', placeholder: '留空自動計算' })}
        ${UI.textarea('work_desc', '當日施工內容', { value: l?.work_desc, placeholder: '例：3F 給水管配管完成、預埋管路 30 米' })}
        ${UI.textarea('note', '備註', { value: l?.note })}
      </div>`,
      onOpen: body => {
        if (isNew) return;
        const foot = document.createElement('div');
        foot.style.marginTop = '12px';
        foot.innerHTML = '<button class="btn small secondary" type="button">刪除此紀錄</button>';
        foot.querySelector('button').onclick = async () => {
          if (!await UI.confirm('確定刪除這筆出工紀錄？')) return;
          try {
            await DEL('/labor-logs/' + l.id);
            UI.toast('已刪除');
            document.querySelector('.modal-mask')?.remove();
            App.reload();
          } catch (e) { UI.err(e); }
        };
        body.appendChild(foot);
      }
    });
  }
};
