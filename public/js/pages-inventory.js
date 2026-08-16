// 進銷存：庫存查詢、料件主檔、採購進貨、銷貨出庫、盤點、廠商

// ================= 庫存查詢 =================

App.page('stocks', {
  title: '庫存查詢',
  sub: '各倉別（公司倉／工程車）現有數量與庫存價值',
  module: 'inventory',
  async render(el) {
    const f = App._stockFilter || (App._stockFilter = { q: '', warehouse_id: '', nonzero: '1' });
    const qs = `q=${encodeURIComponent(f.q)}&warehouse_id=${f.warehouse_id}&nonzero=${f.nonzero}`;
    const [rows, low] = await Promise.all([GET('/stocks?' + qs), GET('/low-stock')]);
    const value = rows.reduce((s, r) => s + r.value, 0);

    // 依倉別彙總，讓老闆一眼看出料都壓在哪
    const byWh = {};
    for (const r of rows) {
      const w = byWh[r.warehouse_id] || (byWh[r.warehouse_id] = { name: r.warehouse_name, kind: r.warehouse_kind, items: 0, value: 0 });
      w.items++; w.value += r.value;
    }

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋料號／品名／規格" value="${UI.esc(f.q)}" style="min-width:220px">
        <select id="f-wh"><option value="">全部倉別</option>
          ${(App.meta.warehouses || []).map(w =>
      `<option value="${w.id}"${String(f.warehouse_id) === String(w.id) ? ' selected' : ''}>${UI.esc(w.name)}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:5px;font-size:13.5px">
          <input type="checkbox" id="f-nonzero"${f.nonzero === '1' ? ' checked' : ''} style="width:auto">隱藏零庫存</label>
        <span class="spacer"></span>
        <button class="btn small secondary" id="transfer">倉別調撥</button>
        <button class="btn small secondary" id="adjust">庫存調整</button>
        <a class="btn small secondary" href="/api/export/stock">匯出 CSV</a>`)}

      <div class="stat-grid">
        <div class="stat"><div class="num">${UI.num(Math.round(value))}</div><div class="label">庫存總價值</div></div>
        <div class="stat"><div class="num">${rows.length}</div><div class="label">庫存筆數</div></div>
        <div class="stat clickable" onclick="location.hash='products'">
          <div class="num ${low.length ? 'warn' : ''}">${low.length}</div><div class="label">低於安全庫存</div></div>
        ${Object.values(byWh).map(w => `
          <div class="stat"><div class="num">${UI.num(Math.round(w.value))}</div>
            <div class="label">${UI.esc(w.name)}（${UI.esc(TW.warehouse_kind[w.kind] || '')}）${w.items} 項</div></div>`).join('')}
      </div>

      ${UI.table(['料號', '品名／規格', '倉別', '數量', '單位', '單位成本', '庫存價值', '安全量'], rows.map(r => `
        <tr style="cursor:pointer" onclick="location.hash='products/${r.product_id}'">
          <td>${UI.esc(r.sku)}</td>
          <td class="wrap"><strong>${UI.esc(r.name)}</strong>
            <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(r.spec || '')}</span></td>
          <td>${UI.esc(r.warehouse_name)}</td>
          <td class="num">${r.safety_qty > 0 && r.qty < r.safety_qty
        ? `<span class="qty-low">${r.qty}</span>` : r.qty}</td>
          <td>${UI.esc(r.unit)}</td>
          <td class="num">${UI.num(r.cost)}</td>
          <td class="num">${UI.num(Math.round(r.value))}</td>
          <td class="num">${r.safety_qty || '－'}</td>
        </tr>`), '沒有符合條件的庫存')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.stocks.render(el); }, 350);
    });
    el.querySelector('#f-wh').onchange = e => { f.warehouse_id = e.target.value; App.pages.stocks.render(el); };
    el.querySelector('#f-nonzero').onchange = e => { f.nonzero = e.target.checked ? '1' : '0'; App.pages.stocks.render(el); };
    el.querySelector('#adjust').onclick = () => Stock.adjustDialog();
    el.querySelector('#transfer').onclick = () => Stock.transferDialog();
  }
});

const Stock = {
  adjustDialog(product) {
    UI.modal({
      title: '庫存調整（盤盈／盤虧／報廢／期初）',
      body: `<div class="form-grid">
        <div class="form-row full"><label>料件 *</label>
          <input id="ad-product" value="${UI.esc(product ? product.name : '')}" placeholder="輸入料號／品名搜尋" autocomplete="off">
          <input type="hidden" name="product_id" value="${product?.id || ''}"></div>
        ${UI.select('warehouse_id', '倉別', App.warehouseOptions('請選擇'), { full: true })}
        ${UI.input('qty', '調整數量（正數為增加，負數為減少）', { type: 'number', step: '0.01', full: true })}
        ${UI.textarea('note', '調整原因 *', { placeholder: '例：年度盤點盤盈、破損報廢、期初建檔' })}
      </div>`,
      onOpen: el => {
        UI.productPicker(el.querySelector('#ad-product'), p => {
          el.querySelector('#ad-product').value = `${p.name} ${p.spec || ''}`;
          el.querySelector('[name=product_id]').value = p.id;
        });
      },
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.product_id) throw new Error('請先選擇料件');
        await POST('/stock-adjust', b);
        UI.toast('庫存已調整');
        App.reload();
      }
    });
  },

  transferDialog(product) {
    UI.modal({
      title: '倉別調撥（例：公司倉 → 工程車）',
      body: `<div class="form-grid">
        <div class="form-row full"><label>料件 *</label>
          <input id="tr-product" value="${UI.esc(product ? product.name : '')}" placeholder="輸入料號／品名搜尋" autocomplete="off">
          <input type="hidden" name="product_id" value="${product?.id || ''}"></div>
        ${UI.select('from_warehouse_id', '來源倉', App.warehouseOptions('請選擇'))}
        ${UI.select('to_warehouse_id', '目的倉', App.warehouseOptions('請選擇'))}
        ${UI.input('qty', '調撥數量', { type: 'number', step: '0.01', value: 1, full: true })}
        ${UI.textarea('note', '備註')}
      </div>`,
      onOpen: el => {
        UI.productPicker(el.querySelector('#tr-product'), p => {
          el.querySelector('#tr-product').value = `${p.name} ${p.spec || ''}`;
          el.querySelector('[name=product_id]').value = p.id;
        });
      },
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.product_id) throw new Error('請先選擇料件');
        await POST('/stock-transfer', b);
        UI.toast('已調撥');
        App.reload();
      }
    });
  }
};

// ================= 料件主檔 =================

App.page('products', {
  title: '料件主檔',
  sub: '零件、耗材、主機與服務項目的料號、價格與安全庫存',
  module: 'inventory',
  async render(el, id) {
    if (id) return Prod.renderDetail(el, id);
    const f = App._prodFilter || (App._prodFilter = { q: '', kind: '', category_id: '', low: '', active: '1' });
    const qs = Object.entries(f).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rows = await GET('/products?' + qs);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋料號／品名／規格／品牌" value="${UI.esc(f.q)}" style="min-width:230px">
        <select id="f-kind"><option value="">全部類型</option>
          ${Object.entries(TW.product_kind).map(([k, v]) =>
      `<option value="${k}"${f.kind === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="f-cat"><option value="">全部分類</option>
          ${(App.meta.categories || []).map(c =>
      `<option value="${c.id}"${String(f.category_id) === String(c.id) ? ' selected' : ''}>${UI.esc(c.name)}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:5px;font-size:13.5px">
          <input type="checkbox" id="f-low"${f.low ? ' checked' : ''} style="width:auto">只看低於安全量</label>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 項</span>
        <button class="btn" id="new-prod">＋ 新增料件</button>`)}

      ${UI.table(['料號', '品名／規格', '分類', '類型', '庫存', '單位', '成本', '零售價', '合約價', '安全量', '預設廠商'], rows.map(p => `
        <tr style="cursor:pointer" onclick="location.hash='products/${p.id}'">
          <td>${UI.esc(p.sku)}</td>
          <td class="wrap"><strong>${UI.esc(p.name)}</strong>${p.active ? '' : ' ' + UI.tag('停用', 'danger')}
            <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(p.spec || '')} ${UI.esc(p.brand || '')}</span></td>
          <td>${UI.esc(p.category_name || '－')}</td>
          <td>${UI.tag(TW.product_kind[p.kind] || p.kind)}</td>
          <td class="num">${p.kind === 'service' ? '－'
        : (p.safety_qty > 0 && p.qty < p.safety_qty ? `<span class="qty-low">${p.qty}</span>` : p.qty)}</td>
          <td>${UI.esc(p.unit)}</td>
          <td class="num">${UI.num(p.cost)}</td>
          <td class="num">${UI.num(p.price_retail)}</td>
          <td class="num">${UI.num(p.price_contract)}</td>
          <td class="num">${p.safety_qty || '－'}</td>
          <td class="wrap">${UI.esc(p.supplier_name || '－')}</td>
        </tr>`), '沒有符合條件的料件')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.products.render(el); }, 350);
    });
    el.querySelector('#f-kind').onchange = e => { f.kind = e.target.value; App.pages.products.render(el); };
    el.querySelector('#f-cat').onchange = e => { f.category_id = e.target.value; App.pages.products.render(el); };
    el.querySelector('#f-low').onchange = e => { f.low = e.target.checked ? '1' : ''; App.pages.products.render(el); };
    el.querySelector('#new-prod').onclick = () => Prod.editDialog();
  }
});

const Prod = {
  async editDialog(p) {
    const suppliers = await GET('/suppliers').catch(() => []);
    UI.modal({
      title: p ? `修改料件：${p.sku}` : '新增料件',
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.name) throw new Error('請填寫品名');
        if (p) { await PUT('/products/' + p.id, b); UI.toast('已儲存'); App.reload(); }
        else {
          const r = await POST('/products', b);
          UI.toast(`料件 ${r.sku} 已建立`);
          location.hash = 'products/' + r.id;
        }
      },
      body: `<div class="form-grid">
        ${UI.input('name', '品名', { value: p?.name, required: true, full: true })}
        ${UI.input('spec', '規格', { value: p?.spec, full: true, placeholder: '例：1/4" 銅管 3M、R32 10kg/罐' })}
        ${UI.input('sku', '料號', { value: p?.sku, placeholder: '留空自動編號' })}
        ${UI.select('kind', '類型', App.mapOpts(TW.product_kind), { value: p?.kind || 'part' })}
        ${UI.select('category_id', '分類', [['', '未分類'], ...(App.meta.categories || []).map(c => [c.id, c.name])], { value: p?.category_id })}
        ${UI.inputList('unit', '單位', App.meta.units || [], { value: p?.unit || '個' })}
        ${UI.input('brand', '品牌', { value: p?.brand })}
        ${UI.input('model', '型號', { value: p?.model })}
        ${UI.input('barcode', '條碼', { value: p?.barcode })}
        ${UI.input('cost', '成本單價', { type: 'number', value: p?.cost ?? 0, placeholder: '有進出紀錄後改由移動平均決定' })}
        ${UI.input('price_retail', '零售價', { type: 'number', value: p?.price_retail ?? 0 })}
        ${UI.input('price_contract', '合約價', { type: 'number', value: p?.price_contract ?? 0 })}
        ${UI.input('price_wholesale', '同業價', { type: 'number', value: p?.price_wholesale ?? 0 })}
        ${UI.input('safety_qty', '安全庫存量', { type: 'number', step: '0.01', value: p?.safety_qty ?? 0 })}
        ${UI.select('default_supplier_id', '預設廠商', [['', '未指定'], ...suppliers.map(s => [s.id, s.name])], { value: p?.default_supplier_id })}
        ${UI.input('warranty_months', '保固月數', { type: 'number', value: p?.warranty_months ?? 0 })}
        ${UI.checkbox('is_refrigerant', '此為冷媒（納入冷媒管制紀錄）', p?.is_refrigerant)}
        ${UI.checkbox('serial_tracked', '需登錄機身序號', p?.serial_tracked)}
        ${UI.textarea('note', '備註', { value: p?.note })}
        ${p ? UI.checkbox('active', '啟用中', p.active) : ''}
      </div>`
    });
  },

  async renderDetail(el, id) {
    const p = await GET('/products/' + id);

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#products">← 回列表</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="transfer">調撥</button>
        <button class="btn small secondary" id="adjust">庫存調整</button>
        <button class="btn" id="edit-prod">修改料件</button>`)}

      <div class="split">
        <div>
          <div class="card"><h3>${UI.esc(p.name)}　${UI.tag(TW.product_kind[p.kind] || p.kind)}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">料號</div>${UI.esc(p.sku)}</div>
              <div><div class="dg-label">規格</div>${UI.esc(p.spec || '－')}</div>
              <div><div class="dg-label">分類</div>${UI.esc(p.category_name || '未分類')}</div>
              <div><div class="dg-label">品牌／型號</div>${UI.esc(p.brand || '')} ${UI.esc(p.model || '')}</div>
              <div><div class="dg-label">單位</div>${UI.esc(p.unit)}</div>
              <div><div class="dg-label">移動平均成本</div>${UI.money(p.cost)}</div>
              <div><div class="dg-label">零售／合約／同業價</div>${UI.num(p.price_retail)} ／ ${UI.num(p.price_contract)} ／ ${UI.num(p.price_wholesale)}</div>
              <div><div class="dg-label">安全庫存</div>${p.safety_qty || '未設定'}</div>
              <div><div class="dg-label">預設廠商</div>${UI.esc(p.supplier_name || '－')}</div>
              <div><div class="dg-label">保固月數</div>${p.warranty_months || '－'}</div>
            </div>
            ${p.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(p.note)}</div>` : ''}
          </div>

          <div class="card"><h3>庫存異動</h3>
            ${UI.table(['日期', '類型', '倉別', '數量', '異動後', '單位成本', '單據', '經手', '備註'], p.moves.map(m => `
              <tr>
                <td>${UI.esc(m.move_date)}</td>
                <td>${UI.tag(TW.move_kind[m.kind] || m.kind, m.qty > 0 ? 'ok' : '')}</td>
                <td>${UI.esc(m.warehouse_name)}</td>
                <td class="num"><strong style="color:${m.qty > 0 ? 'var(--ok,#2a8)' : 'var(--danger)'}">${m.qty > 0 ? '+' : ''}${m.qty}</strong></td>
                <td class="num">${m.balance ?? ''}</td>
                <td class="num">${UI.num(m.cost)}</td>
                <td>${UI.esc(m.ref_no || '')}</td>
                <td>${UI.esc(m.user_name || '')}</td>
                <td class="wrap">${UI.esc(m.note || '')}</td>
              </tr>`), '尚無異動紀錄')}
          </div>
        </div>

        <div>
          <div class="card"><h3>各倉庫存</h3>
            <div class="stat" style="cursor:default">
              <div class="num ${p.safety_qty > 0 && p.qty < p.safety_qty ? 'warn' : ''}">${p.qty} ${UI.esc(p.unit)}</div>
              <div class="label">總庫存${p.safety_qty ? `（安全量 ${p.safety_qty}）` : ''}</div></div>
            ${p.stocks.length ? `<ul class="mini-list" style="margin-top:10px">${p.stocks.map(s => `
              <li><div class="ml-main">${UI.esc(s.warehouse_name)}
                  <div class="ml-sub">${UI.esc(TW.warehouse_kind[s.warehouse_kind] || '')}</div></div>
                <div style="text-align:right"><strong>${s.qty}</strong></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px;margin-top:10px">各倉皆無庫存</div>'}
          </div>
        </div>
      </div>`;

    el.querySelector('#edit-prod').onclick = () => Prod.editDialog(p);
    el.querySelector('#adjust').onclick = () => Stock.adjustDialog(p);
    el.querySelector('#transfer').onclick = () => Stock.transferDialog(p);
  }
};

// ================= 採購進貨 =================

App.page('purchases', {
  title: '採購進貨',
  sub: '向廠商叫料、進貨入庫與應付款',
  module: 'purchase',
  async render(el, id) {
    if (id) return PO.renderDetail(el, id);
    const f = App._poFilter || (App._poFilter = { status: '', from: '', to: '', unpaid: '' });
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rows = await GET('/purchase-orders?' + qs);

    el.innerHTML = `
      ${App.toolbar(`
        <select id="f-status"><option value="">全部狀態</option>
          ${Object.entries(TW.po_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <input type="date" id="f-from" value="${f.from}"> ~ <input type="date" id="f-to" value="${f.to}">
        <label style="display:flex;align-items:center;gap:5px;font-size:13.5px">
          <input type="checkbox" id="f-unpaid"${f.unpaid ? ' checked' : ''} style="width:auto">只看未付清</label>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 張</span>
        <button class="btn" id="new-po">＋ 新增採購單</button>`)}

      ${UI.table(['採購單號', '廠商', '訂購日', '進貨日', '入庫倉', '項數', '金額', '已付', '狀態'], rows.map(po => `
        <tr style="cursor:pointer" onclick="location.hash='purchases/${po.id}'">
          <td>${UI.esc(po.po_no)}</td>
          <td class="wrap"><strong>${UI.esc(po.supplier_name)}</strong></td>
          <td>${UI.esc(po.order_date)}</td>
          <td>${UI.esc(po.arrive_date || '－')}</td>
          <td>${UI.esc(po.warehouse_name)}</td>
          <td class="num">${po.item_count}</td>
          <td class="num">${UI.money(po.total)}</td>
          <td class="num">${po.status === 'received' && po.total > po.paid
        ? `<span style="color:var(--danger)">欠 ${UI.num(po.total - po.paid)}</span>` : UI.num(po.paid)}</td>
          <td>${UI.tag(TW.po_status[po.status], po.status === 'received' ? 'ok' : po.status === 'cancelled' ? 'danger' : 'warn')}</td>
        </tr>`), '尚無採購單')}`;

    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.purchases.render(el); };
    el.querySelector('#f-from').onchange = e => { f.from = e.target.value; App.pages.purchases.render(el); };
    el.querySelector('#f-to').onchange = e => { f.to = e.target.value; App.pages.purchases.render(el); };
    el.querySelector('#f-unpaid').onchange = e => { f.unpaid = e.target.checked ? '1' : ''; App.pages.purchases.render(el); };
    el.querySelector('#new-po').onclick = () => PO.editDialog();
  }
});

const PO = {
  async editDialog(po) {
    const suppliers = (await GET('/suppliers').catch(() => [])).filter(s => s.active);
    let items = null;
    UI.modal({
      title: po ? `修改採購單：${po.po_no}` : '新增採購單',
      wide: true,
      onOpen: el => {
        items = Items.mount(el.querySelector('#po-items'), {
          rows: po?.items, productOnly: true, priceKey: 'price', priceLabel: '進價'
        });
      },
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.supplier_id || !b.warehouse_id) throw new Error('請選擇廠商與入庫倉別');
        b.items = items.rows();
        if (!b.items.length) throw new Error('請至少加入一項料件');
        if (po) { await PUT('/purchase-orders/' + po.id, b); UI.toast('已儲存'); App.reload(); }
        else {
          const r = await POST('/purchase-orders', b);
          UI.toast(`採購單 ${r.po_no} 已建立`);
          location.hash = 'purchases/' + r.id;
        }
      },
      body: `<div class="form-grid">
        ${UI.select('supplier_id', '廠商 *', [['', '請選擇'], ...suppliers.map(s => [s.id, s.name])], { value: po?.supplier_id })}
        ${UI.select('warehouse_id', '入庫倉別 *', App.warehouseOptions('請選擇'), { value: po?.warehouse_id })}
        ${UI.input('order_date', '訂購日', { type: 'date', value: po?.order_date || UI.today() })}
        ${UI.input('due_date', '付款到期日', { type: 'date', value: po?.due_date })}
        ${UI.select('tax_mode', '稅別', App.mapOpts(TW.tax_mode), { value: po?.tax_mode || 'exclusive' })}
        ${UI.input('invoice_no', '廠商發票號碼', { value: po?.invoice_no })}
        ${UI.textarea('note', '備註', { value: po?.note })}
      </div>
      <div id="po-items" style="margin-top:6px"></div>`
    });
  },

  async renderDetail(el, id) {
    const po = await GET('/purchase-orders/' + id);
    const balance = po.total - po.paid;

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#purchases">← 回列表</a>
        <span class="spacer"></span>
        ${po.status === 'received'
        ? `<button class="btn small secondary" id="unreceive">取消進貨</button>
           ${balance > 0 ? '<button class="btn" id="pay">＋ 登錄付款</button>' : ''}`
        : `<button class="btn small secondary" id="edit-po">修改</button>
           <button class="btn" id="receive">進貨入庫</button>`}`)}

      <div class="split">
        <div>
          <div class="card"><h3>${UI.esc(po.po_no)}　${UI.tag(TW.po_status[po.status], po.status === 'received' ? 'ok' : 'warn')}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">廠商</div>${UI.esc(po.supplier_name)}
                ${po.supplier_phone ? `<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(po.supplier_phone)}</span>` : ''}</div>
              <div><div class="dg-label">入庫倉別</div>${UI.esc(po.warehouse_name)}</div>
              <div><div class="dg-label">訂購日</div>${UI.esc(po.order_date)}</div>
              <div><div class="dg-label">進貨日</div>${UI.esc(po.arrive_date || '尚未進貨')}</div>
              <div><div class="dg-label">付款到期</div>${balance > 0 ? Cust.dateTag(po.due_date, true) : UI.esc(po.due_date || '－')}</div>
              <div><div class="dg-label">廠商發票</div>${UI.esc(po.invoice_no || '－')}</div>
              <div><div class="dg-label">製表</div>${UI.esc(po.creator || '')}</div>
            </div>
            ${po.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(po.note)}</div>` : ''}
          </div>

          <div class="card"><h3>採購明細</h3>
            ${UI.table(['料號', '品名／規格', '數量', '已收', '單位', '進價', '金額'], po.items.map(i => `
              <tr><td>${UI.esc(i.sku)}</td>
                <td class="wrap"><strong>${UI.esc(i.name)}</strong>
                  <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(i.spec || '')}</span></td>
                <td class="num">${i.qty}</td><td class="num">${i.received_qty}</td>
                <td>${UI.esc(i.unit)}</td>
                <td class="num">${UI.num(i.price)}</td>
                <td class="num">${UI.num(Math.round(i.qty * i.price))}</td></tr>`))}
            <div class="detail-grid" style="margin-top:12px">
              <div><div class="dg-label">未稅小計</div>${UI.money(po.subtotal)}</div>
              <div><div class="dg-label">稅額（${UI.esc(TW.tax_mode[po.tax_mode])}）</div>${UI.money(po.tax)}</div>
              <div><div class="dg-label">總計</div><strong style="color:var(--primary-dark);font-size:17px">${UI.money(po.total)}</strong></div>
              <div><div class="dg-label">未付餘額</div>${balance > 0
        ? `<strong style="color:var(--danger)">${UI.money(balance)}</strong>` : '已付清'}</div>
            </div>
          </div>
        </div>

        <div>
          <div class="card"><h3>付款紀錄</h3>
            ${po.payments.length ? `<ul class="mini-list">${po.payments.map(p => `
              <li><div class="ml-main">${UI.money(p.amount)}
                  <div class="ml-sub">${UI.esc(p.pay_date)}　${UI.esc(p.method)}${p.ref_no ? '　' + UI.esc(p.ref_no) : ''}</div></div>
                <div><button class="btn small secondary" data-del-pay="${p.id}">刪除</button></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">尚未付款</div>'}
          </div>
          <div class="card"><h3>進貨說明</h3>
            <div style="font-size:13px;color:var(--muted);line-height:1.8">
              進貨後系統會以本單進價重算該料件的移動平均成本，並寫入庫存異動。<br>
              若打錯需修改，請先「取消進貨」回沖庫存（已付款者須先刪除付款紀錄）。</div>
          </div>
        </div>
      </div>`;

    const edit = el.querySelector('#edit-po');
    if (edit) edit.onclick = () => PO.editDialog(po);
    const recv = el.querySelector('#receive');
    if (recv) recv.onclick = () => {
      UI.modal({
        title: '進貨入庫', submitText: '確認進貨',
        body: `<div class="form-grid">${UI.input('arrive_date', '進貨日期', { type: 'date', value: UI.today(), full: true })}</div>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">
          ${po.items.length} 項料件將入庫至「${UI.esc(po.warehouse_name)}」，並以本單進價重算移動平均成本。</div>`,
        onSubmit: async elm => { await POST(`/purchase-orders/${po.id}/receive`, UI.formData(elm)); UI.toast('已進貨入庫'); App.reload(); }
      });
    };
    const unrecv = el.querySelector('#unreceive');
    if (unrecv) unrecv.onclick = async () => {
      if (!await UI.confirm('將回沖本單所有入庫數量，確定嗎？')) return;
      try { await POST(`/purchase-orders/${po.id}/unreceive`, {}); UI.toast('已取消進貨'); App.reload(); }
      catch (e) { UI.err(e); }
    };
    const pay = el.querySelector('#pay');
    if (pay) pay.onclick = () => {
      UI.modal({
        title: '登錄付款', submitText: '確認付款',
        body: `<div class="form-grid">
          ${UI.input('amount', '付款金額', { type: 'number', value: balance, full: true })}
          ${UI.input('pay_date', '付款日期', { type: 'date', value: UI.today() })}
          ${UI.select('method', '付款方式', App.opts(App.meta.pay_methods || ['匯款']))}
          ${UI.input('ref_no', '票號／帳號末五碼', { full: true })}
          ${UI.textarea('note', '備註')}
        </div>`,
        onSubmit: async elm => { await POST('/payments', { ...UI.formData(elm), po_id: po.id }); UI.toast('付款已登錄'); App.reload(); }
      });
    };
    el.querySelectorAll('[data-del-pay]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('確定刪除這筆付款紀錄嗎？')) return;
        try { await DEL('/payments/' + b.dataset.delPay); UI.toast('已刪除'); App.reload(); }
        catch (e) { UI.err(e); }
      };
    });
  }
};

// ================= 銷貨出庫 =================

App.page('sales', {
  title: '銷貨出庫',
  sub: '純賣料不含施工的單據（同業調料、客戶自購零件）',
  module: 'sales',
  async render(el, id) {
    if (id) return SO.renderDetail(el, id);
    const f = App._soFilter || (App._soFilter = { status: '', from: '', to: '' });
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rows = await GET('/sales-orders?' + qs);

    el.innerHTML = `
      ${App.toolbar(`
        <select id="f-status"><option value="">全部狀態</option>
          ${Object.entries(TW.so_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <input type="date" id="f-from" value="${f.from}"> ~ <input type="date" id="f-to" value="${f.to}">
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 張</span>
        <button class="btn" id="new-so">＋ 新增銷貨單</button>`)}

      ${UI.table(['銷貨單號', '客戶', '日期', '出貨倉', '項數', '金額', '成本', '毛利', '狀態'], rows.map(so => `
        <tr style="cursor:pointer" onclick="location.hash='sales/${so.id}'">
          <td>${UI.esc(so.so_no)}</td>
          <td class="wrap"><strong>${UI.esc(so.customer_name)}</strong></td>
          <td>${UI.esc(so.order_date)}</td>
          <td>${UI.esc(so.warehouse_name)}</td>
          <td class="num">${so.item_count}</td>
          <td class="num">${UI.money(so.total)}</td>
          <td class="num">${UI.num(so.cost_total)}</td>
          <td class="num">${UI.num(so.total - so.cost_total)}</td>
          <td>${UI.tag(TW.so_status[so.status], so.status === 'shipped' ? 'ok' : 'warn')}</td>
        </tr>`), '尚無銷貨單')}`;

    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.sales.render(el); };
    el.querySelector('#f-from').onchange = e => { f.from = e.target.value; App.pages.sales.render(el); };
    el.querySelector('#f-to').onchange = e => { f.to = e.target.value; App.pages.sales.render(el); };
    el.querySelector('#new-so').onclick = () => SO.editDialog();
  }
});

const SO = {
  async editDialog(so) {
    let items = null;
    UI.modal({
      title: so ? `修改銷貨單：${so.so_no}` : '新增銷貨單',
      wide: true,
      onOpen: el => {
        items = Items.mount(el.querySelector('#so-items'), {
          rows: so?.items, productOnly: true, priceLabel: '售價'
        });
        if (so) return;
        UI.customerPicker(el.querySelector('#so-customer'), c => {
          el.querySelector('#so-customer').value = c.name;
          el.querySelector('[name=customer_id]').value = c.id;
        });
      },
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.customer_id || !b.warehouse_id) throw new Error('請選擇客戶與出貨倉別');
        b.items = items.rows();
        if (!b.items.length) throw new Error('請至少加入一項料件');
        if (so) { await PUT('/sales-orders/' + so.id, b); UI.toast('已儲存'); App.reload(); }
        else {
          const r = await POST('/sales-orders', b);
          UI.toast(`銷貨單 ${r.so_no} 已建立`);
          location.hash = 'sales/' + r.id;
        }
      },
      body: `<div class="form-grid">
        <div class="form-row full"><label>客戶 *</label>
          <input id="so-customer" value="${UI.esc(so?.customer_name || '')}" placeholder="輸入客戶名稱／電話搜尋"
            autocomplete="off"${so ? ' readonly' : ''}>
          <input type="hidden" name="customer_id" value="${so?.customer_id || ''}"></div>
        ${UI.select('warehouse_id', '出貨倉別 *', App.warehouseOptions('請選擇'), { value: so?.warehouse_id })}
        ${UI.input('order_date', '銷貨日期', { type: 'date', value: so?.order_date || UI.today() })}
        ${UI.select('tax_mode', '稅別', App.mapOpts(TW.tax_mode), { value: so?.tax_mode || 'exclusive' })}
        ${UI.input('discount', '折讓金額', { type: 'number', value: so?.discount ?? 0 })}
        ${UI.textarea('note', '備註', { value: so?.note })}
      </div>
      <div id="so-items" style="margin-top:6px"></div>`
    });
  },

  async renderDetail(el, id) {
    const so = await GET('/sales-orders/' + id);

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#sales">← 回列表</a>
        <a class="btn small secondary" href="#customers/${so.customer_id}">客戶資料</a>
        <span class="spacer"></span>
        ${so.status === 'shipped'
        ? '<button class="btn small secondary" id="unship">取消出貨</button>'
        : `<button class="btn small secondary" id="edit-so">修改</button>
           <button class="btn" id="ship">出貨扣庫存</button>`}`)}

      <div class="card"><h3>${UI.esc(so.so_no)}　${UI.tag(TW.so_status[so.status], so.status === 'shipped' ? 'ok' : 'warn')}</h3>
        <div class="detail-grid">
          <div><div class="dg-label">客戶</div>${UI.esc(so.customer_name)}</div>
          <div><div class="dg-label">統一編號</div>${UI.esc(so.tax_id || '－')}</div>
          <div><div class="dg-label">出貨倉別</div>${UI.esc(so.warehouse_name)}</div>
          <div><div class="dg-label">銷貨日期</div>${UI.esc(so.order_date)}</div>
          <div><div class="dg-label">製表</div>${UI.esc(so.creator || '')}</div>
        </div>
        ${so.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(so.note)}</div>` : ''}
      </div>

      <div class="card"><h3>銷貨明細</h3>
        ${UI.table(['料號', '品名／規格', '數量', '單位', '售價', '金額', '成本'], so.items.map(i => `
          <tr><td>${UI.esc(i.sku)}</td>
            <td class="wrap"><strong>${UI.esc(i.name)}</strong>
              <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(i.spec || '')}</span></td>
            <td class="num">${i.qty}</td><td>${UI.esc(i.unit)}</td>
            <td class="num">${UI.num(i.price)}</td>
            <td class="num">${UI.num(Math.round(i.qty * i.price))}</td>
            <td class="num">${UI.num(Math.round(i.qty * i.cost))}</td></tr>`))}
        <div class="detail-grid" style="margin-top:12px">
          <div><div class="dg-label">未稅小計</div>${UI.money(so.subtotal)}</div>
          <div><div class="dg-label">折讓</div>${UI.money(so.discount)}</div>
          <div><div class="dg-label">稅額</div>${UI.money(so.tax)}</div>
          <div><div class="dg-label">總計</div><strong style="color:var(--primary-dark);font-size:17px">${UI.money(so.total)}</strong></div>
          <div><div class="dg-label">成本合計</div>${UI.money(so.cost_total)}</div>
          <div><div class="dg-label">毛利</div><strong>${UI.money(so.total - so.cost_total)}</strong></div>
        </div>
      </div>`;

    const edit = el.querySelector('#edit-so');
    if (edit) edit.onclick = () => SO.editDialog(so);
    const ship = el.querySelector('#ship');
    if (ship) ship.onclick = async () => {
      if (!await UI.confirm(`將由「${so.warehouse_name}」扣除本單數量，確定出貨嗎？`)) return;
      try { await POST(`/sales-orders/${so.id}/ship`, {}); UI.toast('已出貨'); App.reload(); }
      catch (e) { UI.err(e); }
    };
    const unship = el.querySelector('#unship');
    if (unship) unship.onclick = async () => {
      if (!await UI.confirm('將回沖本單出庫數量，確定嗎？')) return;
      try { await POST(`/sales-orders/${so.id}/unship`, {}); UI.toast('已取消出貨'); App.reload(); }
      catch (e) { UI.err(e); }
    };
  }
};

// ================= 盤點 =================

App.page('stocktakes', {
  title: '盤點',
  sub: '開單、逐項輸入實盤數，結案時自動寫入差額調整',
  module: 'stocktake',
  async render(el, id) {
    if (id) return Take.renderDetail(el, id);
    const rows = await GET('/stocktakes');

    el.innerHTML = `
      ${App.toolbar(`
        <span class="spacer"></span>
        <button class="btn" id="new-take">＋ 開立盤點單</button>`)}

      ${UI.table(['盤點單號', '倉別', '盤點日', '品項數', '已盤', '製表', '狀態'], rows.map(t => `
        <tr style="cursor:pointer" onclick="location.hash='stocktakes/${t.id}'">
          <td>${UI.esc(t.take_no)}</td>
          <td>${UI.esc(t.warehouse_name)}</td>
          <td>${UI.esc(t.take_date)}</td>
          <td class="num">${t.item_count}</td>
          <td class="num">${t.counted} / ${t.item_count}</td>
          <td>${UI.esc(t.creator || '')}</td>
          <td>${UI.tag(TW.stocktake_status[t.status], t.status === 'open' ? 'warn' : 'ok')}</td>
        </tr>`), '尚無盤點紀錄')}`;

    el.querySelector('#new-take').onclick = () => {
      UI.modal({
        title: '開立盤點單', submitText: '開單',
        body: `<div class="form-grid">
          ${UI.select('warehouse_id', '盤點倉別 *', App.warehouseOptions('請選擇'), { full: true })}
          ${UI.input('take_date', '盤點日', { type: 'date', value: UI.today(), full: true })}
          ${UI.textarea('note', '備註')}
        </div>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">
          開單時會把該倉所有啟用中的料件（含庫存為 0 者）列入，方便盤出「帳上沒有但現場有」的東西。</div>`,
        onSubmit: async elm => {
          const b = UI.formData(elm);
          if (!b.warehouse_id) throw new Error('請選擇盤點倉別');
          const r = await POST('/stocktakes', b);
          UI.toast(`盤點單 ${r.take_no} 已開立（${r.item_count} 項）`);
          location.hash = 'stocktakes/' + r.id;
        }
      });
    };
  }
});

const Take = {
  async renderDetail(el, id) {
    const st = await GET('/stocktakes/' + id);
    const open = st.status === 'open';
    const f = App._takeFilter || (App._takeFilter = { onlyDiff: false, q: '' });
    let items = st.items;
    if (f.q) items = items.filter(i => (i.sku + i.name + (i.spec || '')).toLowerCase().includes(f.q.toLowerCase()));
    if (f.onlyDiff) items = items.filter(i => i.counted_qty !== null && i.counted_qty !== i.system_qty);
    const counted = st.items.filter(i => i.counted_qty !== null);
    const diffs = counted.filter(i => i.counted_qty !== i.system_qty);
    const diffValue = diffs.reduce((s, i) => s + (i.counted_qty - i.system_qty) * i.cost, 0);

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#stocktakes">← 回列表</a>
        <input id="f-q" placeholder="搜尋料號／品名" value="${UI.esc(f.q)}" style="min-width:200px">
        <label style="display:flex;align-items:center;gap:5px;font-size:13.5px">
          <input type="checkbox" id="f-diff"${f.onlyDiff ? ' checked' : ''} style="width:auto">只看有差異</label>
        <span class="spacer"></span>
        ${open ? '<button class="btn" id="close-take">結案並產生調整</button>' : UI.tag('已結案', 'ok')}`)}

      <div class="stat-grid">
        <div class="stat"><div class="num">${st.items.length}</div><div class="label">品項數</div></div>
        <div class="stat"><div class="num">${counted.length}</div><div class="label">已輸入實盤</div></div>
        <div class="stat"><div class="num ${diffs.length ? 'warn' : ''}">${diffs.length}</div><div class="label">有差異項目</div></div>
        <div class="stat"><div class="num ${diffValue < 0 ? 'danger' : ''}">${UI.num(Math.round(diffValue))}</div>
          <div class="label">差異金額（成本計）</div></div>
      </div>

      <div class="card"><h3>${UI.esc(st.take_no)}　${UI.esc(st.warehouse_name)}　${UI.esc(st.take_date)}</h3>
        ${UI.table(['料號', '品名／規格', '單位', '帳面數', '實盤數', '差異', '備註'], items.map(i => `
          <tr>
            <td>${UI.esc(i.sku)}</td>
            <td class="wrap"><strong>${UI.esc(i.name)}</strong>
              <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(i.spec || '')}</span></td>
            <td>${UI.esc(i.unit)}</td>
            <td class="num">${i.system_qty}</td>
            <td class="num">${open
        ? `<input type="number" step="0.01" data-item="${i.id}" value="${i.counted_qty ?? ''}" style="width:90px;text-align:right">`
        : (i.counted_qty ?? '未盤')}</td>
            <td class="num">${i.counted_qty === null ? '－'
        : (i.counted_qty - i.system_qty === 0 ? '0'
          : `<strong style="color:${i.counted_qty > i.system_qty ? 'var(--primary-dark)' : 'var(--danger)'}">
             ${i.counted_qty > i.system_qty ? '+' : ''}${Number((i.counted_qty - i.system_qty).toFixed(4))}</strong>`)}</td>
            <td class="wrap">${open
        ? `<input data-note="${i.id}" value="${UI.esc(i.note || '')}" placeholder="差異原因">`
        : UI.esc(i.note || '')}</td>
          </tr>`), '沒有符合條件的品項')}
      </div>`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; Take.renderDetail(el, id); }, 350);
    });
    el.querySelector('#f-diff').onchange = e => { f.onlyDiff = e.target.checked; Take.renderDetail(el, id); };

    // 逐格儲存：師傅拿平板邊盤邊打，不必按整頁儲存
    const save = async (itemId, row) => {
      try { await PUT('/stocktake-items/' + itemId, row); }
      catch (e) { UI.err(e); }
    };
    el.querySelectorAll('[data-item]').forEach(i => {
      i.addEventListener('change', () => {
        const note = el.querySelector(`[data-note="${i.dataset.item}"]`);
        save(i.dataset.item, { counted_qty: i.value, note: note ? note.value : '' });
      });
    });
    el.querySelectorAll('[data-note]').forEach(i => {
      i.addEventListener('change', () => {
        const qty = el.querySelector(`[data-item="${i.dataset.note}"]`);
        save(i.dataset.note, { counted_qty: qty ? qty.value : '', note: i.value });
      });
    });

    const close = el.querySelector('#close-take');
    if (close) close.onclick = async () => {
      if (!await UI.confirm(`已輸入 ${counted.length} 項，其中 ${diffs.length} 項有差異。結案後會寫入庫存調整且不可復原，確定嗎？`)) return;
      try {
        const r = await POST(`/stocktakes/${st.id}/close`, {});
        UI.toast(`已結案，調整 ${r.adjusted} 項`);
        App.reload();
      } catch (e) { UI.err(e); }
    };
  }
};

// ================= 廠商 =================

App.page('suppliers', {
  title: '廠商',
  sub: '供料廠商的聯絡方式、付款條件與應付款',
  module: 'purchase',
  async render(el) {
    const f = App._supFilter || (App._supFilter = { q: '' });
    const rows = await GET('/suppliers?q=' + encodeURIComponent(f.q));

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋名稱／聯絡人／電話／統編" value="${UI.esc(f.q)}" style="min-width:230px">
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 家</span>
        <button class="btn" id="new-sup">＋ 新增廠商</button>`)}

      ${UI.table(['廠商', '統編', '聯絡人／電話', '地址', '付款條件', '採購次數', '未付款', ''], rows.map(s => `
        <tr>
          <td><strong>${UI.esc(s.name)}</strong>${s.active ? '' : ' ' + UI.tag('停用', 'danger')}
            ${s.code ? `<br><span style="color:var(--muted);font-size:12px">${UI.esc(s.code)}</span>` : ''}</td>
          <td>${UI.esc(s.tax_id || '－')}</td>
          <td>${UI.esc(s.contact || '')}<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(s.phone || '')}</span></td>
          <td class="wrap">${UI.esc(s.address || '')}</td>
          <td>${UI.esc(s.payment_terms || '－')}</td>
          <td class="num">${s.po_count}</td>
          <td class="num">${s.payable ? `<strong style="color:var(--danger)">${UI.num(s.payable)}</strong>` : '－'}</td>
          <td class="num"><button class="btn small secondary" data-sup="${s.id}">編輯</button></td>
        </tr>`), '尚未建立廠商')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.suppliers.render(el); }, 350);
    });
    el.querySelector('#new-sup').onclick = () => Sup.editDialog();
    el.querySelectorAll('[data-sup]').forEach(b => {
      b.onclick = () => Sup.editDialog(rows.find(s => s.id === Number(b.dataset.sup)));
    });
  }
});

const Sup = {
  editDialog(s) {
    UI.modal({
      title: s ? `修改廠商：${s.name}` : '新增廠商',
      wide: true,
      body: `<div class="form-grid">
        ${UI.input('name', '廠商名稱', { value: s?.name, required: true, full: true })}
        ${UI.input('code', '廠商編號', { value: s?.code })}
        ${UI.input('tax_id', '統一編號', { value: s?.tax_id })}
        ${UI.input('contact', '聯絡人', { value: s?.contact })}
        ${UI.input('phone', '電話', { value: s?.phone })}
        ${UI.input('email', 'Email', { value: s?.email })}
        ${UI.inputList('payment_terms', '付款條件', App.meta.payment_terms || [], { value: s?.payment_terms })}
        ${UI.input('address', '地址', { value: s?.address, full: true })}
        ${UI.input('bank_account', '匯款帳戶', { value: s?.bank_account, full: true })}
        ${UI.textarea('note', '備註', { value: s?.note })}
        ${s ? UI.checkbox('active', '啟用中', s.active) : ''}
      </div>`,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.name) throw new Error('請填寫廠商名稱');
        if (s) await PUT('/suppliers/' + s.id, b);
        else await POST('/suppliers', b);
        UI.toast('已儲存');
        App.reload();
      }
    });
  }
};
