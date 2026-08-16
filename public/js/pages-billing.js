// 報價單、請款單、應付帳款、技師抽成
// 本檔另提供 Items：報價／請款／採購／銷貨共用的明細編輯器

// ================= 共用明細編輯器 =================

const Items = {
  // opts: { rows, productOnly, priceKey, priceLabel, level, onTotal }
  // productOnly = true 時每行都必須綁料件（採購／銷貨用），否則可自由打字（報價／請款用）
  mount(el, opts = {}) {
    const priceKey = opts.priceKey || 'price';
    const rows = [];

    el.innerHTML = `
      <div class="form-row full" style="position:relative">
        <label>加入料件</label>
        <input class="it-search" placeholder="輸入料號／品名搜尋，選定後自動加一行" autocomplete="off">
      </div>
      <div class="table-wrap"><table class="list it-table">
        <thead><tr>
          <th style="min-width:200px">品名／規格</th><th style="width:90px">數量</th>
          <th style="width:80px">單位</th><th style="width:110px">${UI.esc(opts.priceLabel || '單價')}</th>
          <th style="width:110px">金額</th><th style="width:60px"></th>
        </tr></thead>
        <tbody class="it-body"></tbody>
        <tfoot><tr><td colspan="4" style="text-align:right"><strong>小計</strong></td>
          <td class="num it-sum"><strong>0</strong></td><td></td></tr></tfoot>
      </table></div>
      ${opts.productOnly ? '' : '<button class="btn small secondary it-add" type="button" style="margin-top:8px">＋ 手動新增一行</button>'}`;

    const body = el.querySelector('.it-body');
    const recalc = () => {
      let sum = 0;
      body.querySelectorAll('tr').forEach(tr => {
        const qty = Number(tr.querySelector('.it-qty').value) || 0;
        const price = Number(tr.querySelector('.it-price').value) || 0;
        const amt = Math.round(qty * price);
        tr.querySelector('.it-amt').textContent = UI.num(amt);
        sum += amt;
      });
      el.querySelector('.it-sum').innerHTML = `<strong>${UI.num(sum)}</strong>`;
      if (opts.onTotal) opts.onTotal(sum);
    };

    const addRow = (r = {}) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="it-name" value="${UI.esc(r.name || '')}" placeholder="品名"${opts.productOnly ? ' readonly' : ''}>
          <input type="hidden" class="it-pid" value="${r.product_id || ''}">
          <input type="hidden" class="it-cost" value="${r.cost || 0}">
          <input class="it-spec" value="${UI.esc(r.spec || '')}" placeholder="規格"
            style="margin-top:4px;font-size:12.5px"${opts.productOnly ? ' readonly' : ''}></td>
        <td><input class="it-qty" type="number" step="0.01" value="${r.qty ?? 1}"></td>
        <td><input class="it-unit" value="${UI.esc(r.unit || '式')}"${opts.productOnly ? ' readonly' : ''}></td>
        <td><input class="it-price" type="number" value="${r[priceKey] ?? r.price ?? 0}"></td>
        <td class="num it-amt">0</td>
        <td class="num"><button class="btn small secondary it-del" type="button">刪</button></td>`;
      body.appendChild(tr);
      tr.querySelectorAll('.it-qty, .it-price').forEach(i => i.addEventListener('input', recalc));
      tr.querySelector('.it-del').onclick = () => { tr.remove(); recalc(); };
      recalc();
      return tr;
    };

    (opts.rows || []).forEach(addRow);
    if (!opts.rows || !opts.rows.length) if (!opts.productOnly) addRow();

    const addBtn = el.querySelector('.it-add');
    if (addBtn) addBtn.onclick = () => addRow();

    const search = el.querySelector('.it-search');
    UI.productPicker(search, async p => {
      search.value = '';
      let price = p[opts.priceKey === 'cost' ? 'cost' : 'price_retail'];
      if (opts.level && opts.priceKey !== 'cost') {
        try { price = (await GET(`/products/${p.id}/price?level=${opts.level}`)).price; } catch { /* 用預設零售價 */ }
      }
      addRow({ product_id: p.id, name: p.name, spec: p.spec, unit: p.unit, qty: 1, price, cost: p.cost });
    });

    return {
      rows() {
        return [...body.querySelectorAll('tr')].map(tr => ({
          product_id: Number(tr.querySelector('.it-pid').value) || null,
          name: tr.querySelector('.it-name').value.trim(),
          spec: tr.querySelector('.it-spec').value.trim(),
          unit: tr.querySelector('.it-unit').value.trim() || '式',
          qty: Number(tr.querySelector('.it-qty').value) || 0,
          [priceKey]: Math.round(Number(tr.querySelector('.it-price').value) || 0),
          cost: Number(tr.querySelector('.it-cost').value) || 0
        })).filter(r => (opts.productOnly ? r.product_id : r.name) && r.qty);
      },
      recalc
    };
  }
};

// ================= 報價單 =================

App.page('quotes', {
  title: '報價單',
  sub: '出去的每一張報價，成交就直接轉工單',
  module: 'quotes',
  async render(el, id) {
    if (id) return Quote.renderDetail(el, id);
    const f = App._quoteFilter || (App._quoteFilter = { q: '', status: '' });
    const rows = await GET(`/quotes?q=${encodeURIComponent(f.q)}&status=${f.status}`);
    const won = rows.filter(r => r.status === 'accepted');

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋報價單號／案名／客戶" value="${UI.esc(f.q)}" style="min-width:230px">
        <select id="f-status"><option value="">全部狀態</option>
          ${Object.entries(TW.quote_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 張，成交 ${won.length} 張</span>
        <button class="btn" id="new-quote">＋ 新增報價</button>`)}

      ${UI.table(['報價單號', '日期／有效', '客戶／地點', '案名', '項數', '金額（含稅）', '轉出工單', '製表', '狀態'], rows.map(q => `
        <tr style="cursor:pointer" onclick="location.hash='quotes/${q.id}'">
          <td>${UI.esc(q.quote_no)}</td>
          <td>${UI.esc(q.quote_date)}<br><span style="color:var(--muted);font-size:12px">有效 ${q.valid_days} 天</span></td>
          <td class="wrap"><strong>${UI.esc(q.customer_name)}</strong>
            ${q.site_name ? `<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(q.site_name)}</span>` : ''}</td>
          <td class="wrap">${UI.esc(q.title || '')}</td>
          <td class="num">${q.item_count}</td>
          <td class="num">${UI.money(q.total)}</td>
          <td>${q.order_no ? UI.esc(q.order_no) : '－'}</td>
          <td>${UI.esc(q.creator || '')}</td>
          <td>${UI.tag(TW.quote_status[q.status] || q.status,
      q.status === 'accepted' ? 'ok' : q.status === 'rejected' ? 'danger' : q.status === 'expired' ? 'warn' : '')}</td>
        </tr>`), '尚無報價單')}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.quotes.render(el); }, 350);
    });
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.quotes.render(el); };
    el.querySelector('#new-quote').onclick = () => Quote.editDialog();
  }
});

const Quote = {
  async editDialog(qt) {
    let cust = null;
    if (qt) cust = await GET('/customers/' + qt.customer_id);
    let items = null;

    UI.modal({
      title: qt ? `修改報價：${qt.quote_no}` : '新增報價單',
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.customer_id) throw new Error('請先選擇客戶');
        b.items = items.rows();
        if (!b.items.length) throw new Error('請至少填寫一筆報價明細');
        if (qt) { await PUT('/quotes/' + qt.id, b); UI.toast('已儲存'); App.reload(); }
        else {
          const r = await POST('/quotes', b);
          UI.toast(`報價單 ${r.quote_no} 已建立`);
          location.hash = 'quotes/' + r.id;
        }
      },
      onOpen: el => {
        items = Items.mount(el.querySelector('#qt-items'), {
          rows: qt?.items, level: cust?.price_level || 'retail', priceLabel: '報價單價'
        });
        if (qt) return;
        UI.customerPicker(el.querySelector('#qt-customer'), async c => {
          cust = await GET('/customers/' + c.id);
          el.querySelector('#qt-customer').value = c.name;
          el.querySelector('[name=customer_id]').value = c.id;
          el.querySelector('[name=site_id]').innerHTML = '<option value="">未指定</option>' +
            cust.sites.filter(s => s.active).map(s => `<option value="${s.id}">${UI.esc(s.name)}</option>`).join('');
        });
      },
      body: `<div class="form-grid">
        <div class="form-row full"><label>客戶 *</label>
          <input id="qt-customer" value="${UI.esc(qt?.customer_name || '')}" placeholder="輸入客戶名稱／電話搜尋"
            autocomplete="off"${qt ? ' readonly' : ''}>
          <input type="hidden" name="customer_id" value="${qt?.customer_id || ''}"></div>
        <div class="form-row full"><label>服務地點</label>
          <select name="site_id"><option value="">未指定</option>
            ${(cust?.sites || []).filter(s => s.active).map(s =>
        `<option value="${s.id}"${String(qt?.site_id) === String(s.id) ? ' selected' : ''}>${UI.esc(s.name)}</option>`).join('')}
          </select></div>
        ${UI.input('title', '案名', { value: qt?.title, full: true, placeholder: '例：3F 辦公室汰換新機三台' })}
        ${UI.input('quote_date', '報價日期', { type: 'date', value: qt?.quote_date || UI.today() })}
        ${UI.input('valid_days', '有效天數', { type: 'number', value: qt?.valid_days ?? 30 })}
        ${UI.select('tax_mode', '稅別', App.mapOpts(TW.tax_mode), { value: qt?.tax_mode || 'exclusive' })}
        ${UI.input('discount', '折讓金額', { type: 'number', value: qt?.discount ?? 0 })}
        ${qt ? UI.select('status', '狀態', App.mapOpts(TW.quote_status), { value: qt.status }) : ''}
        ${UI.textarea('terms', '報價條件', { value: qt?.terms, placeholder: '例：本報價含施工、吊掛與舊機清運；不含電源配線與泥作。付款：訂金 5 成、完工尾款。' })}
      </div>
      <div id="qt-items" style="margin-top:6px"></div>`
    });
  },

  async renderDetail(el, id) {
    const q = await GET('/quotes/' + id);

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#quotes">← 回列表</a>
        <a class="btn small secondary" href="#customers/${q.customer_id}">客戶資料</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="print-qt">列印／存 PDF</button>
        ${q.status === 'accepted' ? '' : '<button class="btn small secondary" id="edit-qt">修改</button>'}
        ${q.order_id ? `<a class="btn small secondary" href="#orders/${q.order_id}">查看工單</a>`
        : '<button class="btn" id="to-order">成交，轉開工單</button>'}`)}

      <div class="split">
        <div>
          <div class="card"><h3>${UI.esc(q.quote_no)}　${UI.tag(TW.quote_status[q.status] || q.status,
      q.status === 'accepted' ? 'ok' : q.status === 'rejected' ? 'danger' : '')}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">客戶</div>${UI.esc(q.customer_name)}</div>
              <div><div class="dg-label">統一編號</div>${UI.esc(q.tax_id || '－')}</div>
              <div><div class="dg-label">聯絡人／電話</div>${UI.esc(q.contact || '')} ${UI.esc(q.phone || '')}</div>
              <div><div class="dg-label">地點</div>${UI.esc(q.site_name || '')} ${UI.esc(q.site_address || q.address || '')}</div>
              <div><div class="dg-label">報價日</div>${UI.esc(q.quote_date)}</div>
              <div><div class="dg-label">有效至</div>${Cust.dateTag(q.valid_until)}</div>
              <div><div class="dg-label">案名</div>${UI.esc(q.title || '－')}</div>
              <div><div class="dg-label">製表</div>${UI.esc(q.creator || '')}</div>
            </div>
          </div>

          <div class="card"><h3>報價明細</h3>
            ${UI.table(['品名', '規格', '數量', '單位', '單價', '金額'], q.items.map(i => `
              <tr><td class="wrap">${UI.esc(i.name)}</td><td class="wrap">${UI.esc(i.spec || '')}</td>
                <td class="num">${i.qty}</td><td>${UI.esc(i.unit)}</td>
                <td class="num">${UI.num(i.price)}</td><td class="num">${UI.num(Math.round(i.qty * i.price))}</td></tr>`))}
            <div class="detail-grid" style="margin-top:12px">
              <div><div class="dg-label">未稅小計</div>${UI.money(q.subtotal)}</div>
              <div><div class="dg-label">折讓</div>${UI.money(q.discount)}</div>
              <div><div class="dg-label">稅額（${UI.esc(TW.tax_mode[q.tax_mode])}）</div>${UI.money(q.tax)}</div>
              <div><div class="dg-label">總計</div><strong style="color:var(--primary-dark);font-size:17px">${UI.money(q.total)}</strong></div>
            </div>
          </div>

          ${q.terms ? `<div class="card"><h3>報價條件</h3>
            <div style="white-space:pre-wrap;font-size:13.5px">${UI.esc(q.terms)}</div></div>` : ''}
        </div>

        <div>
          <div class="card"><h3>毛利試算</h3>
            <div class="stat" style="cursor:default">
              <div class="num">${UI.money(q.gross_profit)}</div>
              <div class="label">預估毛利${q.subtotal ? `（${(q.gross_profit / q.subtotal * 100).toFixed(1)}%）` : ''}</div></div>
            <div style="font-size:12.5px;color:var(--muted);margin-top:8px">
              以料件目前成本估算，實際毛利以完工後領料成本為準。</div>
          </div>
        </div>
      </div>`;

    const edit = el.querySelector('#edit-qt');
    if (edit) edit.onclick = () => Quote.editDialog(q);
    el.querySelector('#print-qt').onclick = () => Quote.print(q);
    const to = el.querySelector('#to-order');
    if (to) to.onclick = () => {
      UI.modal({
        title: '報價成交，轉開工單', submitText: '建立工單',
        body: `<div class="form-grid">
          ${UI.select('type', '工單類別', App.mapOpts(TW.order_type), { value: 'install' })}
          ${UI.input('appoint_date', '預約施工日', { type: 'date', value: UI.today() })}
        </div>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">報價單會標記為已成交，之後不可再修改。</div>`,
        onSubmit: async elm => {
          const r = await POST(`/quotes/${q.id}/to-order`, UI.formData(elm));
          UI.toast(`工單 ${r.order_no} 已建立`);
          location.hash = 'orders/' + r.id;
        }
      });
    };
  },

  // 報價單列印：另開視窗排版成 A4
  print(q) {
    const rows = q.items.map((i, n) => `<tr><td>${n + 1}</td><td>${UI.esc(i.name)}</td><td>${UI.esc(i.spec || '')}</td>
      <td class="r">${i.qty}</td><td>${UI.esc(i.unit)}</td><td class="r">${UI.num(i.price)}</td>
      <td class="r">${UI.num(Math.round(i.qty * i.price))}</td></tr>`).join('');
    Print.open(`報價單 ${q.quote_no}`, `
      <h1>${UI.esc(App.me.company_name)}　報價單</h1>
      <div class="meta">報價單號 ${UI.esc(q.quote_no)}　報價日期 ${UI.esc(q.quote_date)}　有效至 ${UI.esc(q.valid_until)}</div>
      <table class="head"><tr><td><strong>客戶：</strong>${UI.esc(q.customer_name)}　${UI.esc(q.tax_id ? '統編 ' + q.tax_id : '')}</td></tr>
        <tr><td><strong>地址：</strong>${UI.esc(q.site_address || q.address || '')}</td></tr>
        <tr><td><strong>案名：</strong>${UI.esc(q.title || '')}</td></tr></table>
      <table class="grid"><thead><tr><th>#</th><th>品名</th><th>規格</th><th>數量</th><th>單位</th><th>單價</th><th>金額</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <table class="sum">
        <tr><td>未稅小計</td><td class="r">${UI.num(q.subtotal)}</td></tr>
        ${q.discount ? `<tr><td>折讓</td><td class="r">-${UI.num(q.discount)}</td></tr>` : ''}
        <tr><td>稅額</td><td class="r">${UI.num(q.tax)}</td></tr>
        <tr class="total"><td>總計（新台幣）</td><td class="r">${UI.num(q.total)}</td></tr></table>
      ${q.terms ? `<div class="terms"><strong>報價條件</strong><br>${UI.esc(q.terms).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="sign"><div>客戶簽認：____________________</div><div>本公司：____________________</div></div>`);
  }
};

// 列印視窗共用（報價單、請款單）
const Print = {
  open(title, inner) {
    const w = window.open('', '_blank');
    if (!w) return UI.err(new Error('瀏覽器阻擋了新視窗，請允許彈出視窗後再列印'));
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${UI.esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif; color:#1f2d3d; margin:0; font-size:11pt; }
  h1 { font-size:16pt; margin:0 0 4px; }
  .meta { font-size:9.5pt; color:#6b7a8c; margin-bottom:12px; }
  table { border-collapse:collapse; width:100%; }
  table.head td { padding:2px 0; font-size:10pt; border:0; }
  table.grid { margin-top:8px; }
  table.grid th { background:#eef2f6; border:1px solid #cdd8e3; padding:5px 6px; font-size:9.5pt; text-align:left; }
  table.grid td { border:1px solid #dfe6ec; padding:5px 6px; font-size:9.5pt; }
  table.sum { width:auto; margin:10px 0 0 auto; }
  table.sum td { padding:3px 10px; font-size:10pt; }
  table.sum tr.total td { font-size:13pt; font-weight:700; border-top:2px solid #1f2d3d; }
  .r { text-align:right; }
  .terms { margin-top:14px; font-size:9.5pt; line-height:1.7; }
  .sign { margin-top:36px; display:flex; justify-content:space-between; font-size:10pt; }
</style></head><body>${inner}<script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }
};

// ================= 請款單（應收） =================

App.page('invoices', {
  title: '請款與收款',
  sub: '完工工單併單請款、收款登錄與帳齡追蹤',
  module: 'billing',
  async render(el, id) {
    if (id) return Inv.renderDetail(el, id);
    const f = App._invFilter || (App._invFilter = { status: 'open', from: '', to: '', overdue: '' });
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const [rows, aging] = await Promise.all([GET('/invoices?' + qs), GET('/ar-aging')]);
    const b = aging.buckets;

    el.innerHTML = `
      ${App.toolbar(`
        <select id="f-status">
          <option value="open"${f.status === 'open' ? ' selected' : ''}>未收清（未收＋部分）</option>
          ${Object.entries(TW.inv_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
          <option value=""${f.status === '' ? ' selected' : ''}>全部</option>
        </select>
        <input type="date" id="f-from" value="${f.from}"> ~ <input type="date" id="f-to" value="${f.to}">
        <label style="display:flex;align-items:center;gap:5px;font-size:13.5px">
          <input type="checkbox" id="f-overdue"${f.overdue ? ' checked' : ''} style="width:auto">只看逾期</label>
        <span class="spacer"></span>
        <button class="btn secondary" id="from-orders">完工工單併單請款</button>
        <button class="btn" id="new-inv">＋ 手動開單</button>`)}

      <div class="stat-grid">
        <div class="stat"><div class="num">${UI.num(b.current)}</div><div class="label">未到期</div></div>
        <div class="stat"><div class="num ${b.d30 ? 'warn' : ''}">${UI.num(b.d30)}</div><div class="label">逾期 1-30 天</div></div>
        <div class="stat"><div class="num ${b.d60 ? 'warn' : ''}">${UI.num(b.d60)}</div><div class="label">逾期 31-60 天</div></div>
        <div class="stat"><div class="num ${b.d90 ? 'danger' : ''}">${UI.num(b.d90)}</div><div class="label">逾期 61-90 天</div></div>
        <div class="stat"><div class="num ${b.over90 ? 'danger' : ''}">${UI.num(b.over90)}</div><div class="label">逾期 90 天以上</div></div>
      </div>

      ${UI.table(['請款單號', '客戶', '開立日', '到期日', '金額', '已收', '未收', '發票號碼', '狀態'], rows.map(i => `
        <tr style="cursor:pointer" onclick="location.hash='invoices/${i.id}'">
          <td>${UI.esc(i.inv_no)}</td>
          <td class="wrap"><strong>${UI.esc(i.customer_name)}</strong></td>
          <td>${UI.esc(i.issue_date)}</td>
          <td>${i.status === 'paid' || i.status === 'void' ? UI.esc(i.due_date || '－') : Cust.dateTag(i.due_date, true)}</td>
          <td class="num">${UI.money(i.total)}</td>
          <td class="num">${UI.num(i.paid)}</td>
          <td class="num">${i.balance > 0 ? `<strong style="color:var(--danger)">${UI.num(i.balance)}</strong>` : '－'}</td>
          <td>${UI.esc(i.tax_invoice_no || '－')}</td>
          <td>${UI.tag(TW.inv_status[i.status], TW.inv_cls[i.status])}</td>
        </tr>`), '沒有符合條件的請款單')}`;

    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.invoices.render(el); };
    el.querySelector('#f-from').onchange = e => { f.from = e.target.value; App.pages.invoices.render(el); };
    el.querySelector('#f-to').onchange = e => { f.to = e.target.value; App.pages.invoices.render(el); };
    el.querySelector('#f-overdue').onchange = e => { f.overdue = e.target.checked ? '1' : ''; App.pages.invoices.render(el); };
    el.querySelector('#new-inv').onclick = () => Inv.manualDialog();
    el.querySelector('#from-orders').onclick = () => Inv.fromOrdersDialog();
  }
});

const Inv = {
  // ---- 完工工單併單請款 ----
  fromOrdersDialog() {
    let orders = [];
    UI.modal({
      title: '完工工單併單請款',
      wide: true,
      submitText: '開立請款單',
      body: `<div class="form-row full"><label>客戶 *</label>
          <input id="iv-customer" placeholder="輸入客戶名稱／電話搜尋" autocomplete="off">
          <input type="hidden" name="customer_id"></div>
        <div id="iv-orders" style="margin-top:8px"><div class="empty">請先選擇客戶</div></div>
        <div class="form-grid" style="margin-top:8px">
          ${UI.input('issue_date', '開立日期', { type: 'date', value: UI.today() })}
          ${UI.input('due_date', '付款到期日', { type: 'date', placeholder: '留空依系統預設天數' })}
          ${UI.textarea('note', '備註')}
        </div>`,
      onOpen: el => {
        UI.customerPicker(el.querySelector('#iv-customer'), async c => {
          el.querySelector('#iv-customer').value = c.name;
          el.querySelector('[name=customer_id]').value = c.id;
          // 只列可請款的：已完工／客戶已確認，且非保固合約免費單
          const all = await GET('/work-orders?status=done') .catch(() => []);
          const conf = await GET('/work-orders?status=confirmed').catch(() => []);
          orders = [...all, ...conf].filter(o => o.customer_id === c.id && !o.is_warranty && !o.is_contract);
          el.querySelector('#iv-orders').innerHTML = orders.length
            ? UI.table(['', '工單號', '完工日', '案由', '金額'], orders.map(o => `
              <tr><td><input type="checkbox" class="iv-o" value="${o.id}" checked style="width:auto"></td>
                <td>${UI.esc(o.order_no)}</td>
                <td>${UI.esc((o.finished_at || o.appoint_date || '').slice(0, 10))}</td>
                <td class="wrap">${UI.esc(o.title || '')}</td>
                <td class="num">${UI.money(o.total)}</td></tr>`))
            : '<div class="empty">此客戶沒有待請款的完工工單</div>';
        });
      },
      onSubmit: async el => {
        const b = UI.formData(el);
        b.order_ids = [...el.querySelectorAll('.iv-o:checked')].map(c => Number(c.value));
        if (!b.order_ids.length) throw new Error('請至少勾選一張工單');
        const r = await POST('/invoices/from-orders', b);
        UI.toast(`請款單 ${r.inv_no} 已開立`);
        location.hash = 'invoices/' + r.id;
      }
    });
  },

  // ---- 手動開立（合約費、工程分期） ----
  manualDialog() {
    let items = null;
    UI.modal({
      title: '手動開立請款單',
      wide: true,
      submitText: '開立請款單',
      body: `<div class="form-grid">
        <div class="form-row full"><label>客戶 *</label>
          <input id="iv-customer" placeholder="輸入客戶名稱／電話搜尋" autocomplete="off">
          <input type="hidden" name="customer_id"></div>
        ${UI.input('issue_date', '開立日期', { type: 'date', value: UI.today() })}
        ${UI.input('due_date', '付款到期日', { type: 'date' })}
        ${UI.textarea('note', '備註', { placeholder: '例：114 年度保養合約第一期' })}
      </div>
      <div id="iv-items" style="margin-top:6px"></div>
      <div style="margin-top:8px;font-size:13px;color:var(--muted)">明細以未稅金額填寫，系統會自動加計 5% 營業稅。</div>`,
      onOpen: el => {
        items = Items.mount(el.querySelector('#iv-items'), { priceLabel: '未稅單價' });
        UI.customerPicker(el.querySelector('#iv-customer'), c => {
          el.querySelector('#iv-customer').value = c.name;
          el.querySelector('[name=customer_id]').value = c.id;
        });
      },
      onSubmit: async el => {
        const b = UI.formData(el);
        if (!b.customer_id) throw new Error('請先選擇客戶');
        b.items = items.rows();
        if (!b.items.length) throw new Error('請至少填寫一筆請款明細');
        const r = await POST('/invoices', b);
        UI.toast(`請款單 ${r.inv_no} 已開立`);
        location.hash = 'invoices/' + r.id;
      }
    });
  },

  async renderDetail(el, id) {
    const inv = await GET('/invoices/' + id);
    const balance = inv.total - inv.paid;

    el.innerHTML = `
      ${App.toolbar(`
        <a class="btn small secondary" href="#invoices">← 回列表</a>
        <a class="btn small secondary" href="#customers/${inv.customer_id}">客戶資料</a>
        <span class="spacer"></span>
        <button class="btn small secondary" id="print-inv">列印／存 PDF</button>
        <button class="btn small secondary" id="edit-inv">修改抬頭／發票號碼</button>
        ${inv.status === 'void' ? '' : `<button class="btn small secondary" id="void-inv">作廢</button>`}
        ${balance > 0 && inv.status !== 'void' ? '<button class="btn" id="pay">＋ 登錄收款</button>' : ''}`)}

      <div class="split">
        <div>
          <div class="card"><h3>${UI.esc(inv.inv_no)}　${UI.tag(TW.inv_status[inv.status], TW.inv_cls[inv.status])}</h3>
            <div class="detail-grid">
              <div><div class="dg-label">客戶</div>${UI.esc(inv.customer_name)}</div>
              <div><div class="dg-label">發票抬頭</div>${UI.esc(inv.invoice_title || inv.customer_name)}</div>
              <div><div class="dg-label">統一編號</div>${UI.esc(inv.tax_id || '－')}</div>
              <div><div class="dg-label">開立日</div>${UI.esc(inv.issue_date)}</div>
              <div><div class="dg-label">付款到期日</div>${inv.status === 'paid' ? UI.esc(inv.due_date || '－') : Cust.dateTag(inv.due_date, true)}</div>
              <div><div class="dg-label">統一發票號碼</div>${UI.esc(inv.tax_invoice_no || '未開立')}
                ${inv.tax_invoice_date ? `<br><span style="color:var(--muted);font-size:12px">${UI.esc(inv.tax_invoice_date)}</span>` : ''}</div>
            </div>
            ${inv.note ? `<div style="margin-top:10px;padding:10px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(inv.note)}</div>` : ''}
          </div>

          <div class="card"><h3>請款明細</h3>
            ${UI.table(['項目', '數量', '單位', '單價', '金額'], inv.items.map(i => `
              <tr><td class="wrap">${UI.esc(i.name)}${i.note ? `<br><span style="color:var(--muted);font-size:12.5px">${UI.esc(i.note)}</span>` : ''}</td>
                <td class="num">${i.qty}</td><td>${UI.esc(i.unit)}</td>
                <td class="num">${UI.num(i.price)}</td><td class="num">${UI.num(i.amount)}</td></tr>`))}
            <div class="detail-grid" style="margin-top:12px">
              <div><div class="dg-label">未稅小計</div>${UI.money(inv.subtotal)}</div>
              <div><div class="dg-label">營業稅</div>${UI.money(inv.tax)}</div>
              <div><div class="dg-label">應收總額</div><strong style="color:var(--primary-dark);font-size:17px">${UI.money(inv.total)}</strong></div>
              <div><div class="dg-label">尚未收款</div>${balance > 0
        ? `<strong style="color:var(--danger);font-size:17px">${UI.money(balance)}</strong>` : '已收清'}</div>
            </div>
          </div>
        </div>

        <div>
          <div class="card"><h3>收款紀錄</h3>
            ${inv.payments.length ? `<ul class="mini-list">${inv.payments.map(p => `
              <li><div class="ml-main">${UI.money(p.amount)}
                  <div class="ml-sub">${UI.esc(p.pay_date)}　${UI.esc(p.method)}${p.ref_no ? '　' + UI.esc(p.ref_no) : ''}
                    ${p.user_name ? '　經手 ' + UI.esc(p.user_name) : ''}</div></div>
                <div><button class="btn small secondary" data-del-pay="${p.id}">刪除</button></div></li>`).join('')}</ul>`
        : '<div style="color:var(--muted);font-size:13.5px">尚未收款</div>'}
          </div>
        </div>
      </div>`;

    const pay = el.querySelector('#pay');
    if (pay) pay.onclick = () => {
      UI.modal({
        title: '登錄收款', submitText: '確認收款',
        body: `<div class="form-grid">
          ${UI.input('amount', '收款金額', { type: 'number', value: balance, full: true })}
          ${UI.input('pay_date', '收款日期', { type: 'date', value: UI.today() })}
          ${UI.select('method', '收款方式', App.opts(App.meta.pay_methods || ['現金']))}
          ${UI.input('ref_no', '票號／帳號末五碼', { full: true })}
          ${UI.textarea('note', '備註')}
        </div>`,
        onSubmit: async elm => {
          await POST('/payments', { ...UI.formData(elm), invoice_id: inv.id });
          UI.toast('收款已登錄');
          App.reload();
        }
      });
    };
    el.querySelectorAll('[data-del-pay]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('確定刪除這筆收款紀錄嗎？')) return;
        try { await DEL('/payments/' + b.dataset.delPay); UI.toast('已刪除'); App.reload(); }
        catch (e) { UI.err(e); }
      };
    });
    const voidBtn = el.querySelector('#void-inv');
    if (voidBtn) voidBtn.onclick = async () => {
      if (!await UI.confirm('作廢後併入的工單會退回「客戶已確認」可重新請款，確定嗎？')) return;
      try { await POST(`/invoices/${inv.id}/void`, {}); UI.toast('已作廢'); App.reload(); }
      catch (e) { UI.err(e); }
    };
    el.querySelector('#edit-inv').onclick = () => {
      UI.modal({
        title: '修改請款單',
        body: `<div class="form-grid">
          ${UI.input('due_date', '付款到期日', { type: 'date', value: inv.due_date })}
          ${UI.input('tax_invoice_no', '統一發票號碼', { value: inv.tax_invoice_no })}
          ${UI.input('tax_invoice_date', '發票開立日', { type: 'date', value: inv.tax_invoice_date })}
          ${UI.textarea('note', '備註', { value: inv.note })}
        </div>`,
        onSubmit: async elm => { await PUT('/invoices/' + inv.id, UI.formData(elm)); UI.toast('已儲存'); App.reload(); }
      });
    };
    el.querySelector('#print-inv').onclick = () => {
      const rows = inv.items.map((i, n) => `<tr><td>${n + 1}</td><td>${UI.esc(i.name)}</td>
        <td class="r">${i.qty}</td><td>${UI.esc(i.unit)}</td><td class="r">${UI.num(i.price)}</td>
        <td class="r">${UI.num(i.amount)}</td></tr>`).join('');
      Print.open(`請款單 ${inv.inv_no}`, `
        <h1>${UI.esc(inv.company.name)}　請款單</h1>
        <div class="meta">${UI.esc(inv.company.tax_id ? '統編 ' + inv.company.tax_id + '　' : '')}
          ${UI.esc(inv.company.phone || '')}　${UI.esc(inv.company.address || '')}</div>
        <table class="head">
          <tr><td><strong>客戶：</strong>${UI.esc(inv.invoice_title || inv.customer_name)}
            ${UI.esc(inv.tax_id ? '（統編 ' + inv.tax_id + '）' : '')}</td></tr>
          <tr><td><strong>單號：</strong>${UI.esc(inv.inv_no)}　<strong>開立日：</strong>${UI.esc(inv.issue_date)}
            　<strong>付款期限：</strong>${UI.esc(inv.due_date || '－')}</td></tr></table>
        <table class="grid"><thead><tr><th>#</th><th>項目</th><th>數量</th><th>單位</th><th>單價</th><th>金額</th></tr></thead>
          <tbody>${rows}</tbody></table>
        <table class="sum">
          <tr><td>未稅小計</td><td class="r">${UI.num(inv.subtotal)}</td></tr>
          <tr><td>營業稅 5%</td><td class="r">${UI.num(inv.tax)}</td></tr>
          <tr class="total"><td>應收總額</td><td class="r">${UI.num(inv.total)}</td></tr>
          ${inv.paid ? `<tr><td>已收</td><td class="r">${UI.num(inv.paid)}</td></tr>
            <tr><td>未收餘額</td><td class="r">${UI.num(inv.total - inv.paid)}</td></tr>` : ''}</table>
        ${inv.company.bank ? `<div class="terms"><strong>匯款資訊</strong><br>${UI.esc(inv.company.bank)}</div>` : ''}
        <div class="sign"><div>客戶簽收：____________________</div><div>本公司：____________________</div></div>`);
    };
  }
};

// ================= 應付帳款 =================

App.page('payables', {
  title: '應付帳款',
  sub: '已進貨未付清的採購單，依到期日排序',
  module: 'billing',
  async render(el) {
    const d = await GET('/ap-list');
    const today = UI.today();

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="num ${d.total ? 'warn' : ''}">${UI.num(d.total)}</div><div class="label">應付總額</div></div>
        <div class="stat"><div class="num">${d.rows.length}</div><div class="label">未付清單數</div></div>
        <div class="stat"><div class="num ${d.rows.some(r => r.due_date && r.due_date < today) ? 'danger' : ''}">
          ${UI.num(d.rows.filter(r => r.due_date && r.due_date < today).reduce((s, r) => s + r.balance, 0))}</div>
          <div class="label">已逾期未付</div></div>
      </div>

      ${UI.table(['採購單號', '廠商', '進貨日', '付款到期', '發票號碼', '金額', '已付', '未付', ''], d.rows.map(r => `
        <tr>
          <td style="cursor:pointer" onclick="location.hash='purchases/${r.id}'">${UI.esc(r.po_no)}</td>
          <td class="wrap"><strong>${UI.esc(r.supplier_name)}</strong>
            <br><span style="color:var(--muted);font-size:12.5px">${UI.esc(r.phone || '')} ${UI.esc(r.payment_terms || '')}</span></td>
          <td>${UI.esc(r.arrive_date || '')}</td>
          <td>${Cust.dateTag(r.due_date, true)}</td>
          <td>${UI.esc(r.invoice_no || '－')}</td>
          <td class="num">${UI.money(r.total)}</td>
          <td class="num">${UI.num(r.paid)}</td>
          <td class="num"><strong style="color:var(--danger)">${UI.num(r.balance)}</strong></td>
          <td class="num"><button class="btn small" data-pay="${r.id}" data-bal="${r.balance}">付款</button></td>
        </tr>`), '目前沒有未付清的採購單')}`;

    el.querySelectorAll('[data-pay]').forEach(b => {
      b.onclick = () => {
        UI.modal({
          title: '登錄付款', submitText: '確認付款',
          body: `<div class="form-grid">
            ${UI.input('amount', '付款金額', { type: 'number', value: b.dataset.bal, full: true })}
            ${UI.input('pay_date', '付款日期', { type: 'date', value: UI.today() })}
            ${UI.select('method', '付款方式', App.opts(App.meta.pay_methods || ['匯款']))}
            ${UI.input('ref_no', '票號／帳號末五碼', { full: true })}
            ${UI.textarea('note', '備註')}
          </div>`,
          onSubmit: async elm => {
            await POST('/payments', { ...UI.formData(elm), po_id: Number(b.dataset.pay) });
            UI.toast('付款已登錄');
            App.reload();
          }
        });
      };
    });
  }
});

// ================= 技師抽成 =================

App.page('commissions', {
  title: '技師抽成',
  sub: '依完工單計算的抽成，逐月結算',
  module: 'commission',
  async render(el) {
    const f = App._commFilter || (App._commFilter = { period: UI.thisMonth(), user_id: '', status: '' });
    const d = await GET(`/commissions?period=${f.period}&user_id=${f.user_id}&status=${f.status}`);
    const basis = ({ profit: '毛利', labor: '工資', revenue: '營收' })[App.meta.commission_basis] || App.meta.commission_basis;
    const totalPending = d.summary.reduce((s, u) => s + u.pending, 0);

    el.innerHTML = `
      ${App.toolbar(`
        <input type="month" id="f-period" value="${f.period}">
        <select id="f-user"><option value="">全部技師</option>
          ${(App.meta.techs || []).map(t =>
      `<option value="${t.id}"${String(f.user_id) === String(t.id) ? ' selected' : ''}>${UI.esc(t.name)}</option>`).join('')}
        </select>
        <select id="f-status"><option value="">全部狀態</option>
          ${Object.entries(TW.comm_status).map(([k, v]) =>
      `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">抽成基準：${UI.esc(basis)}</span>
        <a class="btn small secondary" href="/api/export/commissions?period=${f.period}">匯出 CSV</a>
        ${totalPending ? `<button class="btn" id="settle">結算本期（${UI.money(totalPending)}）</button>` : ''}`)}

      <div class="card"><h3>${UI.esc(f.period)} 各技師彙總</h3>
        ${UI.table(['技師', '完工單數', '計算基準金額', '抽成合計', '未結', '已結'], d.summary.map(u => `
          <tr><td><strong>${UI.esc(u.name)}</strong>${u.tech_no ? `<br><span style="color:var(--muted);font-size:12px">${UI.esc(u.tech_no)}</span>` : ''}</td>
            <td class="num">${u.orders}</td>
            <td class="num">${UI.money(u.base)}</td>
            <td class="num"><strong>${UI.money(u.amount)}</strong></td>
            <td class="num">${u.pending ? `<span style="color:var(--danger)">${UI.num(u.pending)}</span>` : '－'}</td>
            <td class="num">${UI.num(u.settled)}</td></tr>`), '本期尚無抽成資料')}
      </div>

      <div class="card"><h3>明細</h3>
        ${UI.table(['技師', '工單號', '客戶／案由', '完工日', '工單金額', '計算基準', '抽成率', '抽成', '狀態', ''], d.rows.map(r => `
          <tr>
            <td>${UI.esc(r.user_name)}</td>
            <td style="cursor:pointer" onclick="location.hash='orders/${r.order_id}'">${UI.esc(r.order_no || '')}</td>
            <td class="wrap">${UI.esc(r.customer_name || '')}<br>
              <span style="color:var(--muted);font-size:12.5px">${UI.esc(r.title || '')}</span></td>
            <td>${UI.esc((r.finished_at || '').slice(0, 10))}</td>
            <td class="num">${UI.money(r.order_total)}</td>
            <td class="num">${UI.num(r.base_amount)}</td>
            <td class="num">${(r.rate * 100).toFixed(1)}%</td>
            <td class="num"><strong>${UI.money(r.amount)}</strong></td>
            <td>${UI.tag(TW.comm_status[r.status], r.status === 'settled' ? 'ok' : 'warn')}</td>
            <td class="num">${r.status === 'pending'
        ? `<button class="btn small secondary" data-edit="${r.id}" data-rate="${r.rate}" data-base="${r.base_amount}">調整</button>` : ''}</td>
          </tr>`), '本期尚無抽成明細')}
      </div>`;

    el.querySelector('#f-period').onchange = e => { f.period = e.target.value; App.pages.commissions.render(el); };
    el.querySelector('#f-user').onchange = e => { f.user_id = e.target.value; App.pages.commissions.render(el); };
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.commissions.render(el); };

    const settle = el.querySelector('#settle');
    if (settle) settle.onclick = async () => {
      if (!await UI.confirm(`將 ${f.period} 期所有未結抽成標記為已結算，結算後不可修改，確定嗎？`)) return;
      try {
        const r = await POST('/commissions/settle', { period: f.period, user_id: f.user_id || null });
        UI.toast(`已結算 ${r.settled} 筆`);
        App.reload();
      } catch (e) { UI.err(e); }
    };

    el.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => {
        UI.modal({
          title: '調整抽成',
          body: `<div class="form-grid">
            ${UI.input('base_amount', '計算基準金額', { type: 'number', value: b.dataset.base })}
            ${UI.input('rate', '抽成率（0.15 = 15%）', { type: 'number', step: '0.01', value: b.dataset.rate })}
            ${UI.textarea('note', '調整原因')}
          </div>`,
          onSubmit: async elm => {
            await PUT('/commissions/' + b.dataset.edit, UI.formData(elm));
            UI.toast('已調整');
            App.reload();
          }
        });
      };
    });
  }
});
