// 官網內容管理（CMS）與線上估價詢問處理

// ================= 線上估價詢問 =================

App.page('enquiries', {
  title: '線上估價',
  sub: '官網送出的詢價，聯絡後可一鍵轉成客戶與工單',
  module: 'enquiries',
  async render(el) {
    const f = App._enqFilter || (App._enqFilter = { q: '', status: 'open' });
    const rows = await GET(`/enquiries?q=${encodeURIComponent(f.q)}&status=${f.status}`);

    el.innerHTML = `
      ${App.toolbar(`
        <input id="f-q" placeholder="搜尋姓名／電話／需求內容" value="${UI.esc(f.q)}" style="min-width:220px">
        <select id="f-status">
          ${[['open', '待處理'], ['new', '新進'], ['contacted', '已聯絡'], ['quoted', '已報價'],
        ['converted', '已成案'], ['closed', '已結案'], ['spam', '無效'], ['', '全部']]
        .map(([v, t]) => `<option value="${v}"${f.status === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${rows.length} 筆</span>`)}

      ${rows.length ? `<div class="enq-grid">${rows.map(e => `
        <div class="card enq-card${e.status === 'new' ? ' enq-new' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <strong style="font-size:15px">${UI.esc(e.name)}</strong>
              <div style="font-size:13px;color:var(--muted)">${UI.esc(e.enq_no)}　${UI.esc(e.created_at.slice(0, 16))}</div>
            </div>
            ${UI.tag(TW.enq_status[e.status] || e.status, TW.enq_cls[e.status])}
          </div>
          <div class="detail-grid" style="margin-top:10px">
            <div><div class="dg-label">電話</div><a href="tel:${UI.esc(e.phone)}">${UI.esc(e.phone)}</a></div>
            <div><div class="dg-label">需求</div>${UI.esc(e.service || '－')}</div>
            <div><div class="dg-label">地區</div>${UI.esc(e.area || e.address || '－')}</div>
            <div><div class="dg-label">場所</div>${UI.esc(e.building_type || '－')}</div>
            <div><div class="dg-label">希望時間</div>${UI.esc(e.expect_date || '－')}</div>
            <div><div class="dg-label">方便聯絡</div>${UI.esc(e.contact_time || '－')}</div>
            ${e.budget ? `<div><div class="dg-label">預算</div>${UI.esc(e.budget)}</div>` : ''}
            ${e.line_id ? `<div><div class="dg-label">LINE</div>${UI.esc(e.line_id)}</div>` : ''}
          </div>
          ${e.content ? `<div style="margin-top:8px;padding:9px;background:var(--primary-light);border-radius:8px;font-size:13.5px;white-space:pre-wrap">${UI.esc(e.content)}</div>` : ''}
          ${e.photo ? `<a href="${UI.esc(e.photo)}" target="_blank"><img src="${UI.esc(e.photo)}" class="enq-photo"></a>` : ''}
          ${e.reply_note ? `<div style="margin-top:8px;font-size:13px;color:var(--muted)">客服紀錄：${UI.esc(e.reply_note)}</div>` : ''}
          ${e.order_no ? `<div style="margin-top:8px;font-size:13px">已轉工單 <a href="#orders/${e.order_id}">${UI.esc(e.order_no)}</a></div>` : ''}
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn small secondary" data-note="${e.id}">記錄／改狀態</button>
            ${e.order_id ? '' : `<button class="btn small" data-conv="${e.id}">轉客戶＋開工單</button>`}
            <button class="btn small secondary" data-del="${e.id}">刪除</button>
          </div>
        </div>`).join('')}</div>`
        : '<div class="empty">目前沒有待處理的線上估價</div>'}`;

    let t;
    el.querySelector('#f-q').addEventListener('input', e => {
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; App.pages.enquiries.render(el); }, 350);
    });
    el.querySelector('#f-status').onchange = e => { f.status = e.target.value; App.pages.enquiries.render(el); };

    el.querySelectorAll('[data-note]').forEach(b => {
      b.onclick = () => Web.enquiryDialog(rows.find(r => r.id === Number(b.dataset.note)));
    });
    el.querySelectorAll('[data-conv]').forEach(b => {
      b.onclick = () => Web.convertDialog(rows.find(r => r.id === Number(b.dataset.conv)));
    });
    el.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('確定刪除這筆詢價？')) return;
        try { await DEL('/enquiries/' + b.dataset.del); UI.toast('已刪除'); App.reload(); } catch (e) { UI.err(e); }
      };
    });
  }
});

// ================= 官網內容管理 =================

// 每個分頁對應一種內容，欄位定義集中在這裡，表格與表單都由它產生
const WEB_TABS = {
  services: {
    label: '服務項目',
    cols: ['名稱', '工種', '說明', '價格說明', '排序', '狀態'],
    row: r => [
      `<strong>${UI.esc(r.name)}</strong>`,
      UI.esc(TW.trade[r.trade] || r.trade),
      `<span class="wrap">${UI.esc(r.summary || '')}</span>`,
      UI.esc(r.price_hint || '－'), r.sort, ''
    ],
    form: r => `
      ${UI.input('name', '服務名稱', { value: r?.name, required: true, full: true, placeholder: '例：漏水抓漏與管路修繕' })}
      ${UI.select('trade', '工種', App.mapOpts(TW.trade), { value: r?.trade || 'water' })}
      ${UI.input('summary', '一句話說明', { value: r?.summary, full: true, placeholder: '卡片上顯示的短句' })}
      ${UI.textarea('body', '詳細說明', { value: r?.body })}
      ${UI.input('price_hint', '價格說明', { value: r?.price_hint, full: true, placeholder: '例：到府檢測 500 元起，施工可折抵' })}
      ${UI.input('sort', '排序', { type: 'number', value: r?.sort || 0 })}`,
    media: 'photo'
  },
  steps: {
    label: '服務流程',
    cols: ['步驟', '標題', '說明', '排序', '狀態'],
    row: r => [r.step_no, `<strong>${UI.esc(r.title)}</strong>`,
      `<span class="wrap">${UI.esc(r.body || '')}</span>`, r.sort, ''],
    form: r => `
      ${UI.input('step_no', '步驟編號', { type: 'number', value: r?.step_no || 1 })}
      ${UI.input('title', '步驟標題', { value: r?.title, required: true, full: true, placeholder: '例：來電或線上估價' })}
      ${UI.textarea('body', '說明', { value: r?.body })}
      ${UI.input('sort', '排序', { type: 'number', value: r?.sort || 0 })}`
  },
  showcases: {
    label: '工程實績',
    cols: ['標題', '類別', '客戶／地區', '完工日', '瀏覽', '相片', '狀態'],
    row: r => [
      `<strong>${UI.esc(r.title)}</strong>`,
      `${UI.esc(TW.trade[r.trade] || r.trade)}${r.category ? '／' + UI.esc(r.category) : ''}`,
      `${UI.esc(r.customer_name || '－')}<br><span style="font-size:12px;color:var(--muted)">${UI.esc(r.area || '')}</span>`,
      UI.esc(r.finish_date || '－'), r.views, (r.photos || []).length + ' 張', ''
    ],
    form: r => `
      ${UI.input('title', '實績標題', { value: r?.title, required: true, full: true, placeholder: '例：三房兩廳全戶水電更新' })}
      ${UI.select('trade', '工種', App.mapOpts(TW.trade), { value: r?.trade || 'water' })}
      ${UI.inputList('category', '案場類別', ['住宅', '公寓大廈', '店面', '辦公室', '廠房', '公共工程'], { value: r?.category })}
      ${UI.input('customer_name', '對外顯示客戶', { value: r?.customer_name, placeholder: '例：台北市 王先生（勿放全名）' })}
      ${UI.input('area', '施工地區', { value: r?.area, placeholder: '例：台北市大安區（勿放完整地址）' })}
      ${UI.input('finish_date', '完工日', { type: 'date', value: r?.finish_date })}
      ${UI.input('sort', '排序', { type: 'number', value: r?.sort || 0 })}
      ${UI.input('summary', '摘要', { value: r?.summary, full: true })}
      ${UI.textarea('body', '施工說明（用料、工期、施工重點）', { value: r?.body })}`,
    media: 'cover', gallery: true
  },
  products: {
    label: '商品資訊',
    cols: ['品牌／品名', '型號', '分類', '價格說明', '排序', '狀態'],
    row: r => [
      `<strong>${UI.esc(r.brand)} ${UI.esc(r.name)}</strong>`,
      UI.esc(r.model || '－'), UI.esc(r.category || '－'),
      UI.esc(r.price_note || '－'), r.sort, ''
    ],
    form: r => `
      <div class="form-row full"><label>連結內部料件（選填，帶入品名規格後仍可自行修改）</label>
        <input id="wp-product" placeholder="輸入料號或品名搜尋" autocomplete="off"
          value="${UI.esc(r?.product_name || '')}">
        <input type="hidden" name="product_id" value="${r?.product_id || ''}"></div>
      ${UI.input('name', '商品名稱', { value: r?.name, required: true, full: true })}
      ${UI.input('brand', '品牌', { value: r?.brand, placeholder: '例：電光牌、TOTO、大金' })}
      ${UI.input('model', '型號', { value: r?.model })}
      ${UI.inputList('category', '分類', ['開關插座', '照明燈具', '衛浴設備', '熱水器', '淨水設備', '加壓馬達', '配電器材', '冷氣空調', '其他'], { value: r?.category })}
      ${UI.input('spec', '規格', { value: r?.spec, full: true })}
      ${UI.textarea('summary', '商品說明', { value: r?.summary })}
      ${UI.input('price_note', '價格說明', { value: r?.price_note, full: true, placeholder: '例：歡迎來電洽詢（官網不建議放實價）' })}
      ${UI.input('sort', '排序', { type: 'number', value: r?.sort || 0 })}`,
    media: 'photo'
  },
  news: {
    label: '最新消息',
    cols: ['標題', '分類', '發布日', '下架日', '瀏覽', '置頂', '狀態'],
    row: r => [
      `<strong>${UI.esc(r.title)}</strong><br><span class="wrap" style="font-size:12px;color:var(--muted)">${UI.esc(r.summary || '')}</span>`,
      UI.esc(r.category), UI.esc(r.publish_date || '－'), UI.esc(r.expire_date || '－'),
      r.views, r.pinned ? '★' : '', ''
    ],
    form: r => `
      ${UI.input('title', '標題', { value: r?.title, required: true, full: true })}
      ${UI.inputList('category', '分類', ['最新消息', '優惠活動', '施工知識', '公告', '停業通知'], { value: r?.category || '最新消息' })}
      ${UI.input('publish_date', '發布日', { type: 'date', value: r?.publish_date || UI.today() })}
      ${UI.input('expire_date', '下架日', { type: 'date', value: r?.expire_date })}
      ${UI.input('summary', '摘要', { value: r?.summary, full: true })}
      ${UI.textarea('body', '內文', { value: r?.body, rows: 8 })}
      ${UI.checkbox('pinned', '置頂顯示', r?.pinned)}`,
    media: 'cover'
  },
  faqs: {
    label: '常見問題',
    cols: ['問題', '回答', '排序', '狀態'],
    row: r => [`<strong>${UI.esc(r.question)}</strong>`,
      `<span class="wrap">${UI.esc((r.answer || '').slice(0, 80))}</span>`, r.sort, ''],
    form: r => `
      ${UI.input('question', '問題', { value: r?.question, required: true, full: true, placeholder: '例：估價要收費嗎？' })}
      ${UI.textarea('answer', '回答', { value: r?.answer, rows: 5 })}
      ${UI.input('sort', '排序', { type: 'number', value: r?.sort || 0 })}`
  }
};

App.page('website', {
  title: '官網內容',
  sub: '服務項目、施工實績、商品與最新消息，改完立即反映在官網',
  module: 'website',
  async render(el, tab) {
    const type = WEB_TABS[tab] ? tab : 'services';
    const def = WEB_TABS[type];
    const [rows, stats] = await Promise.all([
      GET('/web-content/' + type),
      GET('/web-stats').catch(() => null)
    ]);

    el.innerHTML = `
      ${App.toolbar(`
        ${Object.entries(WEB_TABS).map(([k, d]) =>
      `<a class="btn small ${k === type ? '' : 'secondary'}" href="#website/${k}">${d.label}</a>`).join('')}
        <span class="spacer"></span>
        <a class="btn small secondary" href="/" target="_blank">預覽官網</a>
        <button class="btn" id="new-item">＋ 新增</button>`)}

      ${stats ? `<div class="stat-grid">
        <div class="stat"><div class="num">${UI.num(stats.today)}</div><div class="label">今日瀏覽</div></div>
        <div class="stat"><div class="num">${UI.num(stats.total)}</div><div class="label">累計瀏覽</div></div>
        <div class="stat clickable" onclick="location.hash='enquiries'">
          <div class="num ${stats.enquiries.open ? 'warn' : ''}">${stats.enquiries.open}</div><div class="label">待處理詢價</div></div>
        <div class="stat"><div class="num">${stats.enquiries.converted}</div><div class="label">詢價已成案</div></div>
      </div>` : ''}

      ${UI.table([...def.cols, ''], rows.map(r => {
        const cells = def.row(r);
        return `<tr>
          ${cells.slice(0, -1).map((c, i) => `<td${i === 0 ? ' class="wrap"' : ''}>${c}</td>`).join('')}
          <td>${r.published ? UI.tag('已發布', 'ok') : UI.tag('未發布', 'warn')}</td>
          <td class="num">
            <button class="btn small secondary" data-edit="${r.id}">編輯</button>
            <button class="btn small secondary" data-pub="${r.id}">${r.published ? '下架' : '發布'}</button>
            <button class="btn small secondary" data-del="${r.id}">刪</button>
          </td></tr>`;
      }), `尚未建立${def.label}內容`)}`;

    el.querySelector('#new-item').onclick = () => Web.contentDialog(type);
    el.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => Web.contentDialog(type, rows.find(r => r.id === Number(b.dataset.edit)));
    });
    el.querySelectorAll('[data-pub]').forEach(b => {
      b.onclick = async () => {
        const r = rows.find(x => x.id === Number(b.dataset.pub));
        try {
          await PUT(`/web-content/${type}/${r.id}`, { ...r, published: !r.published });
          UI.toast(r.published ? '已下架' : '已發布');
          App.reload();
        } catch (e) { UI.err(e); }
      };
    });
    el.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        if (!await UI.confirm('確定刪除？相關圖片也會一併刪除。')) return;
        try { await DEL(`/web-content/${type}/${b.dataset.del}`); UI.toast('已刪除'); App.reload(); }
        catch (e) { UI.err(e); }
      };
    });
  }
});

const Web = {
  contentDialog(type, r) {
    const def = WEB_TABS[type];
    const isNew = !r;
    UI.modal({
      title: `${isNew ? '新增' : '修改'}${def.label}`,
      wide: true,
      onSubmit: async el => {
        const b = UI.formData(el);
        // published 沒有在表單上時預設為發布；編輯時沿用原值
        b.published = isNew ? 1 : r.published;
        if (isNew) await POST('/web-content/' + type, b);
        else await PUT(`/web-content/${type}/${r.id}`, { ...r, ...b });
        UI.toast('已儲存');
        App.reload();
      },
      body: `<div class="form-grid">${def.form(r)}</div>
        ${def.media ? `<div class="form-row full" style="margin-top:10px">
          <label>${def.gallery ? '封面圖' : '圖片'}</label>
          <input type="file" id="web-img" accept="image/*">
          ${r && r[def.media] ? `<img src="${UI.esc(r[def.media])}" class="web-thumb">` : ''}
        </div>` : ''}
        ${def.gallery && r ? `<div class="form-row full">
          <label>實績相簿</label>
          <input type="file" id="web-gallery" accept="image/*" multiple>
          <div class="web-gallery">${(r.photos || []).map(p =>
        `<div class="wg-item"><img src="${UI.esc(p.path)}">
            <button type="button" class="wg-del" data-photo="${p.id}">×</button></div>`).join('')}</div>
        </div>` : ''}
        ${def.gallery && isNew ? App.noticeBox('先儲存後再回來編輯，即可上傳實績相簿。') : ''}`,
      onOpen: body => {
        // 商品資訊可掛內部料件：選定後帶入品名規格，但官網顯示文字仍可自行改寫
        const prod = body.querySelector('#wp-product');
        if (prod) {
          UI.productPicker(prod, p => {
            prod.value = `${p.sku} ${p.name}`;
            body.querySelector('[name=product_id]').value = p.id;
            const set = (sel, v) => {
              const f = body.querySelector(sel);
              if (f && !f.value) f.value = v || '';
            };
            set('[name=name]', p.name);
            set('[name=brand]', p.brand);
            set('[name=model]', p.model);
            set('[name=spec]', p.spec);
            UI.toast('已帶入料件資料');
          });
          // 清空搜尋框視為解除連結，避免改掛時留下錯誤的關聯
          prod.addEventListener('change', () => {
            if (!prod.value.trim()) body.querySelector('[name=product_id]').value = '';
          });
        }

        const img = body.querySelector('#web-img');
        if (img) img.onchange = async () => {
          if (!img.files[0]) return;
          const fd = new FormData();
          fd.append('photo', img.files[0]);
          try {
            const up = await api('/web-media', { method: 'POST', body: fd });
            // 圖片路徑用隱藏欄位帶進表單，儲存時一併寫入
            let hidden = body.querySelector(`input[name=${def.media}]`);
            if (!hidden) {
              hidden = document.createElement('input');
              hidden.type = 'hidden';
              hidden.name = def.media;
              body.appendChild(hidden);
            }
            hidden.value = up.path;
            UI.toast('圖片已上傳，記得按儲存');
          } catch (e) { UI.err(e); }
        };

        const gal = body.querySelector('#web-gallery');
        if (gal) gal.onchange = async () => {
          if (!gal.files.length) return;
          const fd = new FormData();
          for (const f of gal.files) fd.append('photos', f);
          try {
            await api(`/web-content/showcases/${r.id}/photos`, { method: 'POST', body: fd });
            UI.toast('相片已上傳');
            document.querySelector('.modal-mask')?.remove();
            App.reload();
          } catch (e) { UI.err(e); }
        };

        body.querySelectorAll('[data-photo]').forEach(b => {
          b.onclick = async () => {
            if (!await UI.confirm('刪除這張相片？')) return;
            try {
              await DEL('/web-showcase-photos/' + b.dataset.photo);
              b.parentElement.remove();
            } catch (e) { UI.err(e); }
          };
        });
      }
    });
  },

  enquiryDialog(e) {
    UI.modal({
      title: `詢價處理：${e.name}`,
      onSubmit: async el => {
        await PUT('/enquiries/' + e.id, UI.formData(el));
        UI.toast('已更新');
        App.reload();
      },
      body: `<div class="form-grid">
        ${UI.select('status', '狀態', App.mapOpts(TW.enq_status), { value: e.status, full: true })}
        ${UI.textarea('reply_note', '客服聯絡紀錄', { value: e.reply_note, rows: 5, placeholder: '例：8/16 已電聯，約 8/20 上午到場現勘' })}
      </div>`
    });
  },

  convertDialog(e) {
    UI.modal({
      title: `轉客戶並開工單：${e.name}`,
      onSubmit: async el => {
        const r = await POST(`/enquiries/${e.id}/convert`, UI.formData(el));
        UI.toast('已建立工單 ' + r.order_no);
        location.hash = 'orders/' + r.order_id;
      },
      body: `<div class="form-grid">
        ${UI.select('type', '工單類別', App.mapOpts(TW.order_type), { value: 'repair' })}
        ${UI.select('priority', '急迫性', App.mapOpts(TW.priority), { value: 'normal' })}
        ${UI.input('appoint_date', '預約到場日', { type: 'date', value: e.expect_date || UI.today(), full: true })}
      </div>
      ${App.noticeBox(`電話 ${e.phone} 若已有客戶資料，會自動沿用既有客戶，不會重複建檔。\n詢價內容會帶入工單的故障描述欄。`)}`
    });
  }
};
