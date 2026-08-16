// 工項單價庫、報驗申報作業、公司承裝業登記證照

// ================= 工項單價庫 =================

App.page('unitprices', {
  title: '工項單價庫',
  sub: '水電工項的工資與材料單價，報價時直接帶入',
  module: 'unitprice',
  async render(el) {
    const f = App._upFilter || (App._upFilter = { q: '', trade: '', category: '' });
    const rows = await GET(`/unit-prices?q=${encodeURIComponent(f.q)}&trade=${f.trade}&category=${encodeURIComponent(f.category)}`);

    // 依分類分組，翻起來像一本單價本
    const groups = {};
    for (const r of rows) (groups[r.category || '未分類'] ||= []).push(r);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋工項／規格／編號" value="${UI.esc(f.q)}" style="min-width:220px">
        <select id="f-trade">
          <option value="">全部工種</option>
          ${(App.meta.trades || []).map(t =>
        `<option value="${t}"${f.trade === t ? ' selected' : ''}>${UI.esc(TW.trade[t] || t)}</option>`).join('')}
        </select>
        <select id="f-cat">
          <option value="">全部分類</option>
          ${(App.meta.unit_price_categories || []).map(c =>
        `<option value="${UI.esc(c)}"${f.category === c ? ' selected' : ''}>${UI.esc(c)}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 項</span>
        <button class="btn secondary small" id="bulk">整批調價</button>
        <button class="btn" id="new-up">＋ 新增工項</button>`)}

      ${Object.keys(groups).length ? Object.entries(groups).map(([cat, list]) => `
        <div class="card"><h3>${UI.esc(cat)}（${list.length}）</h3>
          ${UI.table(['編號', '工項', '規格', '單位', '工資', '材料', '報價單價', '成本', '發包單價', ''], list.map(r => `
            <tr>
              <td>${UI.esc(r.code || '－')}</td>
              <td class="wrap"><strong>${UI.esc(r.name)}</strong>
                ${r.active ? '' : ' ' + UI.tag('停用', 'danger')}
                ${r.note ? `<br><span style="font-size:12px;color:var(--muted)">${UI.esc(r.note)}</span>` : ''}</td>
              <td class="wrap">${UI.esc(r.spec || '')}</td>
              <td>${UI.esc(r.unit)}</td>
              <td class="num">${UI.num(r.labor_price)}</td>
              <td class="num">${UI.num(r.material_price)}</td>
              <td class="num"><strong>${UI.money(r.price)}</strong></td>
              <td class="num">${UI.num(r.cost)}
                ${r.price > 0 ? `<br><span style="font-size:12px;color:var(--muted)">毛利 ${((1 - r.cost / r.price) * 100).toFixed(0)}%</span>` : ''}</td>
              <td class="num">${r.sub_price ? UI.num(r.sub_price) : '－'}</td>
              <td class="num"><button class="btn small secondary" data-up="${r.id}">編輯</button></td>
            </tr>`))}
        </div>`).join('')
        : '<div class="empty">單價庫還是空的。建立常用工項後，報價就不必每次重算工料。</div>'}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.unitprices.render(el); }, 350);
    });
    el.querySelector('#f-trade').onchange = e => { f.trade = e.target.value; App.pages.unitprices.render(el); };
    el.querySelector('#f-cat').onchange = e => { f.category = e.target.value; App.pages.unitprices.render(el); };
    el.querySelector('#new-up').onclick = () => Trade.unitPriceDialog();
    el.querySelector('#bulk').onclick = () => Trade.bulkAdjustDialog();
    el.querySelectorAll('[data-up]').forEach(b => {
      b.onclick = () => Trade.unitPriceDialog(rows.find(r => r.id === Number(b.dataset.up)));
    });
  }
});

// ================= 報驗申報 =================

App.page('filings', {
  title: '報驗申報',
  sub: '台電、自來水處、消防與建管的送件、會驗與定期申報追蹤',
  module: 'filings',
  async render(el) {
    const f = App._filFilter || (App._filFilter = { q: '', result: 'open', kind: '' });
    const rows = await GET(`/filings?q=${encodeURIComponent(f.q)}&result=${f.result}&kind=${encodeURIComponent(f.kind)}`);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋案號／類別／機關" value="${UI.esc(f.q)}" style="min-width:220px">
        <select id="f-result">
          ${[['open', '未結案'], ['passed', '已合格'], ['failed', '不合格'], ['', '全部']]
        .map(([v, t]) => `<option value="${v}"${f.result === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <select id="f-kind">
          <option value="">全部類別</option>
          ${(App.meta.filing_kinds || []).map(k =>
        `<option value="${UI.esc(k)}"${f.kind === k ? ' selected' : ''}>${UI.esc(k)}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 件</span>
        <button class="btn" id="new-filing">＋ 新增報驗案件</button>`)}

      ${UI.table(['類別／機關', '案號', '工程／客戶', '送件日', '會驗日', '結果', '下次應申報', '承辦', ''], rows.map(r => `
        <tr>
          <td class="wrap"><strong>${UI.esc(r.kind)}</strong><br>
            <span style="font-size:12px;color:var(--muted)">${UI.esc(r.authority || '')}</span></td>
          <td>${UI.esc(r.apply_no || '－')}</td>
          <td class="wrap">${UI.esc(r.project_name || r.customer_name || r.order_no || '－')}</td>
          <td>${UI.esc(r.apply_date || '－')}</td>
          <td>${UI.esc(r.inspect_date || '－')}
            ${r.result === 'failed' && r.recheck_date ? `<br><span style="font-size:12px;color:var(--danger)">複驗 ${UI.esc(r.recheck_date)}</span>` : ''}</td>
          <td>${UI.tag(TW.filing_result[r.result] || r.result, TW.filing_cls[r.result])}
            ${r.fail_reason ? `<br><span style="font-size:12px;color:var(--danger)">${UI.esc(r.fail_reason)}</span>` : ''}</td>
          <td>${r.next_due_date
        ? `<span style="color:${r.overdue ? 'var(--danger)' : 'inherit'}">${UI.esc(r.next_due_date)}${r.overdue ? ' 逾期' : ''}</span>`
        : '－'}</td>
          <td>${UI.esc(r.owner_name || '－')}</td>
          <td class="num">
            ${r.doc_path ? `<a class="btn small secondary" href="${UI.esc(r.doc_path)}" target="_blank">公文</a> ` : ''}
            <button class="btn small secondary" data-fil="${r.id}">編輯</button></td>
        </tr>`), '沒有符合條件的報驗案件')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.filings.render(el); }, 350);
    });
    el.querySelector('#f-result').onchange = e => { f.result = e.target.value; App.pages.filings.render(el); };
    el.querySelector('#f-kind').onchange = e => { f.kind = e.target.value; App.pages.filings.render(el); };
    el.querySelector('#new-filing').onclick = () => Trade.filingDialog();
    el.querySelectorAll('[data-fil]').forEach(b => {
      b.onclick = () => Trade.filingDialog(rows.find(r => r.id === Number(b.dataset.fil)));
    });
  }
});

// ================= 公司證照登記 =================

App.page('licenses', {
  title: '公司證照',
  sub: '電器承裝業、自來水管承裝商等登記與換證期限',
  module: 'licenses',
  async render(el) {
    const rows = await GET('/company-licenses');
    el.innerHTML = `
      ${App.toolbar(`
        <span style="color:var(--muted);font-size:13px">${rows.length} 張</span>
        <span class="spacer"></span>
        <button class="btn" id="new-lic">＋ 新增證照登記</button>`)}

      ${rows.some(r => r.expired || r.expiring)
        ? `<div class="card" style="border-left:4px solid var(--danger)"><h3>換證提醒</h3>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
          ${rows.filter(r => r.expired).map(r =>
          UI.tag(`${r.name} 已於 ${r.expire_date} 到期，逾期將無法承攬工程`, 'danger')).join('')}
          ${rows.filter(r => r.expiring).map(r =>
            UI.tag(`${r.name} 將於 ${r.expire_date} 到期，請提前辦理換證`, 'warn')).join('')}
        </div></div>` : ''}

      ${UI.table(['證照／登記名稱', '級別', '登記證號', '核發機關', '專任技術員', '發證日', '有效期限', '狀態', ''], rows.map(r => `
        <tr>
          <td class="wrap"><strong>${UI.esc(r.name)}</strong>
            ${r.note ? `<br><span style="font-size:12px;color:var(--muted)">${UI.esc(r.note)}</span>` : ''}</td>
          <td>${UI.esc(r.grade || '－')}</td>
          <td>${UI.esc(r.reg_no || '－')}</td>
          <td>${UI.esc(r.authority || '－')}</td>
          <td>${UI.esc(r.holder || '－')}<br>
            <span style="font-size:12px;color:var(--muted)">${UI.esc(r.holder_license || '')}</span></td>
          <td>${UI.esc(r.issue_date || '－')}</td>
          <td>${UI.esc(r.expire_date || '無期限')}</td>
          <td>${!r.active ? UI.tag('已停用')
        : r.expired ? UI.tag('已過期', 'danger')
          : r.expiring ? UI.tag('即將到期', 'warn') : UI.tag('有效', 'ok')}</td>
          <td class="num">
            ${r.doc_path ? `<a class="btn small secondary" href="${UI.esc(r.doc_path)}" target="_blank">證件</a> ` : ''}
            <button class="btn small secondary" data-lic="${r.id}">編輯</button></td>
        </tr>`), '尚未建立公司證照登記')}`;

    el.querySelector('#new-lic').onclick = () => Trade.licenseDialog();
    el.querySelectorAll('[data-lic]').forEach(b => {
      b.onclick = () => Trade.licenseDialog(rows.find(r => r.id === Number(b.dataset.lic)));
    });
  }
});

const Trade = {
  // ---- 單價工項 ----
  unitPriceDialog(r) {
    const isNew = !r;
    UI.modal({
      title: isNew ? '新增工項' : `修改工項：${r.name}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (isNew) await POST('/unit-prices', b);
        else await PUT('/unit-prices/' + r.id, b);
        UI.toast('已儲存');
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.input('name', '工項名稱', { value: r?.name, required: true, full: true, placeholder: '例：PVC 給水管 4分 明管配管（含配件）' })}
        ${UI.input('code', '工項編號', { value: r?.code, placeholder: 'W-001' })}
        ${UI.select('trade', '工種', App.mapOpts(TW.trade), { value: r?.trade || 'water' })}
        ${UI.inputList('category', '分類', App.meta.unit_price_categories || [], { value: r?.category })}
        ${UI.input('spec', '規格', { value: r?.spec, placeholder: '4分(15A) / 2.0mm² / CD管16mm' })}
        ${UI.inputList('unit', '單位', App.meta.unit_price_units || [], { value: r?.unit || '式' })}
        ${UI.input('labor_price', '工資單價', { type: 'number', value: r?.labor_price || 0 })}
        ${UI.input('material_price', '材料單價', { type: 'number', value: r?.material_price || 0 })}
        ${UI.input('price', '對客戶報價單價', { type: 'number', value: r?.price ?? '', placeholder: '留空＝工資＋材料' })}
        ${UI.input('cost', '內部成本單價', { type: 'number', value: r?.cost ?? '', placeholder: '留空＝工資＋材料' })}
        ${UI.input('sub_price', '發包工班單價', { type: 'number', value: r?.sub_price || 0 })}
        ${UI.input('sort', '排序', { type: 'number', value: r?.sort || 0 })}
        ${UI.textarea('note', '備註', { value: r?.note, placeholder: '例：不含牆面切割與泥作修補；管線超過 3 米另計' })}
        ${isNew ? '' : UI.checkbox('active', '啟用中', r.active)}
      </div>`,
      onOpen: body => {
        if (isNew) return;
        const foot = document.createElement('div');
        foot.style.marginTop = '12px';
        foot.innerHTML = '<button class="btn small secondary" type="button">刪除此工項</button>';
        foot.querySelector('button').onclick = async () => {
          if (!await UI.confirm('確定刪除此工項？')) return;
          try {
            await DEL('/unit-prices/' + r.id);
            UI.toast('已刪除');
            document.querySelector('.modal-mask')?.remove();
            App.reload();
          } catch (e) { UI.err(e); }
        };
        body.appendChild(foot);
      }
    });
  },

  bulkAdjustDialog() {
    UI.modal({
      title: '整批調價',
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!await UI.confirm(`確定將符合條件的工項「${TW.up_field[b.field] || b.field}」調整 ${b.percent}%？此動作無法復原。`)) return false;
        const r = await POST('/unit-prices/bulk-adjust', b);
        UI.toast(`已調整 ${r.changed} 項`);
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.select('field', '調整欄位', App.mapOpts(TW.up_field), { value: 'price', full: true })}
        ${UI.input('percent', '調整百分比（降價填負數）', { type: 'number', step: '0.1', value: 5, full: true })}
        ${UI.select('trade', '限定工種', [['', '全部'], ...App.mapOpts(TW.trade)], { value: '' })}
        ${UI.select('category', '限定分類', [['', '全部'], ...(App.meta.unit_price_categories || []).map(c => [c, c])], { value: '' })}
      </div>${App.noticeBox('材料漲價或基本工資調整時，用這個一次調完整批工項。\n只影響啟用中的工項，已開出的報價單不受影響。')}`
    });
  },

  // ---- 報驗案件 ----
  filingDialog(r, pre = {}) {
    const isNew = !r;
    UI.modal({
      title: isNew ? '新增報驗案件' : `修改報驗：${r.kind}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (isNew) await POST('/filings', b);
        else await PUT('/filings/' + r.id, b);
        UI.toast('已儲存');
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.inputList('kind', '報驗／申報類別', App.meta.filing_kinds || [], { value: r?.kind, required: true, full: true })}
        ${UI.inputList('authority', '受理機關', App.meta.filing_authorities || [], { value: r?.authority })}
        ${UI.input('apply_no', '案號／受理號碼', { value: r?.apply_no })}
        ${UI.select('project_id', '所屬工程', [['', '不指定'],
        ...(App.meta.open_projects || []).map(p => [p.id, `${p.proj_no} ${p.name}`])],
        { value: r?.project_id || pre.project_id || '', full: true })}
        ${UI.input('apply_date', '送件日', { type: 'date', value: r?.apply_date || UI.today() })}
        ${UI.input('inspect_date', '會驗／查驗日', { type: 'date', value: r?.inspect_date })}
        ${UI.select('result', '辦理結果', App.mapOpts(TW.filing_result), { value: r?.result || 'pending' })}
        ${UI.input('pass_date', '合格日', { type: 'date', value: r?.pass_date })}
        ${UI.input('fail_reason', '不合格原因', { value: r?.fail_reason, full: true })}
        ${UI.input('recheck_date', '複驗日', { type: 'date', value: r?.recheck_date })}
        ${UI.input('next_due_date', '下次應申報日', { type: 'date', value: r?.next_due_date })}
        ${UI.select('recur_months', '定期申報週期', [['', '非定期'], [12, '每年'], [24, '每兩年'], [36, '每三年'], [48, '每四年']], { value: '' })}
        ${UI.input('fee', '規費', { type: 'number', value: r?.fee || 0 })}
        ${UI.select('owner_id', '承辦人', [['', '未指定'], ...App.techOptions()], { value: r?.owner_id || '' })}
        ${UI.textarea('note', '備註', { value: r?.note })}
      </div>
      ${isNew ? '' : `<div class="form-row full" style="margin-top:10px">
        <label>公文／證件掃描（圖片或 PDF）</label><input type="file" id="fil-doc" accept="image/*,application/pdf"></div>`}
      ${App.noticeBox('用電設備檢驗維護屬定期申報：選填申報週期後，標記合格時會自動推算下次應申報日。')}`,
      onOpen: body => {
        const file = body.querySelector('#fil-doc');
        if (file) file.onchange = async () => {
          if (!file.files[0]) return;
          const fd = new FormData();
          fd.append('doc', file.files[0]);
          try {
            await api(`/filings/${r.id}/doc`, { method: 'POST', body: fd });
            UI.toast('公文已上傳');
          } catch (e) { UI.err(e); }
        };
      }
    });
  },

  // ---- 公司證照 ----
  licenseDialog(r) {
    const isNew = !r;
    UI.modal({
      title: isNew ? '新增證照登記' : `修改：${r.name}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (isNew) await POST('/company-licenses', b);
        else await PUT('/company-licenses/' + r.id, b);
        UI.toast('已儲存');
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.inputList('name', '證照／登記名稱',
        ['電器承裝業登記', '自來水管承裝商', '消防安全設備裝修業', '冷凍空調工程業', '室內裝修業登記',
          '營造業登記', '職業安全衛生管理', '其他'], { value: r?.name, required: true, full: true })}
        ${UI.inputList('grade', '級別', ['甲級', '乙級', '丙級', '不分級'], { value: r?.grade })}
        ${UI.input('reg_no', '登記證號', { value: r?.reg_no })}
        ${UI.inputList('authority', '核發機關',
        ['經濟部', '縣市政府建設局', '縣市政府經濟發展局', '自來水事業處', '消防局', '內政部'], { value: r?.authority })}
        ${UI.input('holder', '專任技術員', { value: r?.holder })}
        ${UI.input('holder_license', '技術員證照字號', { value: r?.holder_license })}
        ${UI.input('issue_date', '發證日', { type: 'date', value: r?.issue_date })}
        ${UI.input('expire_date', '有效期限', { type: 'date', value: r?.expire_date })}
        ${UI.textarea('note', '備註', { value: r?.note })}
        ${isNew ? '' : UI.checkbox('active', '有效中', r.active)}
      </div>
      ${isNew ? '' : `<div class="form-row full" style="margin-top:10px">
        <label>證件掃描（圖片或 PDF）</label><input type="file" id="lic-doc" accept="image/*,application/pdf"></div>`}
      ${App.noticeBox('承裝業登記過期即不得承攬該類工程，官網也會停止顯示該項資格。')}`,
      onOpen: body => {
        const file = body.querySelector('#lic-doc');
        if (file) file.onchange = async () => {
          if (!file.files[0]) return;
          const fd = new FormData();
          fd.append('doc', file.files[0]);
          try {
            await api(`/company-licenses/${r.id}/doc`, { method: 'POST', body: fd });
            UI.toast('證件已上傳');
          } catch (e) { UI.err(e); }
        };
      }
    });
  }
};
