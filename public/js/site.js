// 公司官網前台：內容全部由後台 CMS 提供，本檔只負責取資料與渲染。
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 後台的多行文字直接以段落呈現，不解析 HTML，避免 CMS 內容變成注入點
  const para = s => String(s || '').split('\n').filter(l => l.trim())
    .map(l => `<p>${esc(l)}</p>`).join('');

  let DATA = null;

  async function boot() {
    try {
      DATA = await fetch('/api/site/content').then(r => {
        if (!r.ok) throw new Error('網站維護中');
        return r.json();
      });
    } catch {
      document.body.innerHTML = '<div class="site-down">網站維護中，請稍後再試，或直接來電洽詢。</div>';
      return;
    }
    render();
    fetch('/api/site/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' })
    }).catch(() => { });
  }

  function render() {
    const c = DATA.company, t = DATA.texts;

    document.title = `${c.name}｜配管配線・衛浴設備・冷氣安裝維修`;
    $('logo-name').textContent = c.name;
    $('logo-sub').textContent = c.service_area ? '服務地區：' + c.service_area.split('；')[0] : '';

    // ---- 主視覺 ----
    $('hero-title').textContent = t.hero_title || c.name;
    $('hero-sub').textContent = t.hero_sub || '';
    $('hero-note').textContent = t.hero_note || '';
    $('hero-actions').innerHTML = [
      c.phone ? `<a class="btn-primary" href="tel:${esc(c.phone)}">📞 立即來電 ${esc(c.phone)}</a>` : '',
      `<a class="btn-ghost" href="#quote">線上估價</a>`,
      c.line_url ? `<a class="btn-line" href="${esc(c.line_url)}" target="_blank" rel="noopener">加 LINE 好友</a>` : ''
    ].join('');
    $('hero-badges').innerHTML = [
      c.business_hours ? `營業時間 ${esc(c.business_hours)}` : '',
      c.emergency_phone && c.emergency_phone !== c.phone ? `24H 緊急叫修 ${esc(c.emergency_phone)}` : '',
      ...DATA.licenses.map(l => `${esc(l.name)}${l.grade ? ' ' + esc(l.grade) : ''}`)
    ].filter(Boolean).map(x => `<li>${x}</li>`).join('');

    // ---- 關於我們 ----
    $('about-title').textContent = t.about_title || '關於我們';
    $('about-body').innerHTML = para(t.about_body);
    $('info-grid').innerHTML = [
      ['營業時間', c.business_hours],
      ['服務地區', c.service_area],
      ['聯絡電話', c.phone],
      ['24H 緊急叫修', c.emergency_phone !== c.phone ? c.emergency_phone : ''],
      ['Email', c.email],
      ['地址', c.address]
    ].filter(([, v]) => v).map(([k, v]) =>
      `<div class="info-item"><span class="info-k">${esc(k)}</span><span>${esc(v)}</span></div>`).join('');

    // ---- 服務項目 ----
    hide('services', !DATA.services.length);
    $('services-list').innerHTML = DATA.services.map(s => `
      <article class="scard">
        ${s.photo ? `<img src="${esc(s.photo)}" alt="${esc(s.name)}" loading="lazy">` : ''}
        <div class="scard-body">
          <h3>${s.icon ? esc(s.icon) + ' ' : ''}${esc(s.name)}</h3>
          ${s.summary ? `<p class="scard-sum">${esc(s.summary)}</p>` : ''}
          ${s.body ? `<div class="scard-detail">${para(s.body)}</div>` : ''}
          ${s.price_hint ? `<div class="scard-price">${esc(s.price_hint)}</div>` : ''}
        </div>
      </article>`).join('');

    // ---- 服務流程 ----
    hide('process', !DATA.steps.length);
    $('steps-list').innerHTML = DATA.steps.map(s => `
      <li class="step">
        <div class="step-no">${s.icon ? esc(s.icon) : esc(s.step_no)}</div>
        <div><h3>${esc(s.title)}</h3>${s.body ? `<p>${esc(s.body)}</p>` : ''}</div>
      </li>`).join('');

    // ---- 工程實績 ----
    hide('showcases', !DATA.showcases.length);
    $('showcases-list').innerHTML = DATA.showcases.map(s => `
      <article class="show-card" data-showcase="${s.id}">
        <div class="show-img">${s.cover
        ? `<img src="${esc(s.cover)}" alt="${esc(s.title)}" loading="lazy">`
        : '<span class="show-noimg">施工實績</span>'}</div>
        <div class="show-body">
          <h3>${esc(s.title)}</h3>
          <div class="show-meta">
            ${s.category ? `<span>${esc(s.category)}</span>` : ''}
            ${s.area ? `<span>${esc(s.area)}</span>` : ''}
            ${s.finish_date ? `<span>${esc(s.finish_date)}</span>` : ''}
          </div>
          ${s.summary ? `<p>${esc(s.summary)}</p>` : ''}
        </div>
      </article>`).join('');

    // ---- 商品資訊 ----
    hide('products', !DATA.products.length && !c.brands.length);
    $('brands').innerHTML = c.brands.map(b => `<span class="brand-chip">${esc(b)}</span>`).join('');
    $('products-list').innerHTML = DATA.products.map(p => `
      <article class="pcard">
        ${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy">` : ''}
        <div class="pcard-body">
          ${p.brand ? `<span class="pcard-brand">${esc(p.brand)}</span>` : ''}
          <h3>${esc(p.name)}</h3>
          ${p.model ? `<div class="pcard-model">${esc(p.model)}</div>` : ''}
          ${p.spec ? `<div class="pcard-spec">${esc(p.spec)}</div>` : ''}
          ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
          ${p.price_note ? `<div class="pcard-price">${esc(p.price_note)}</div>` : ''}
        </div>
      </article>`).join('');

    // ---- 最新消息 ----
    hide('news', !DATA.news.length);
    $('news-list').innerHTML = DATA.news.map(n => `
      <article class="news-item" data-news="${n.id}">
        ${n.cover ? `<img src="${esc(n.cover)}" alt="" loading="lazy">` : ''}
        <div>
          <div class="news-meta">
            <span class="news-cat">${esc(n.category)}</span>
            <span>${esc(n.publish_date || '')}</span>
            ${n.pinned ? '<span class="news-pin">置頂</span>' : ''}
          </div>
          <h3>${esc(n.title)}</h3>
          ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
        </div>
      </article>`).join('');

    // ---- 常見問題 ----
    hide('faq', !DATA.faqs.length);
    $('faq-list').innerHTML = DATA.faqs.map(f => `
      <details class="faq">
        <summary>${esc(f.question)}</summary>
        <div>${para(f.answer)}</div>
      </details>`).join('');

    // ---- 線上估價表單 ----
    $('quote-note').textContent = DATA.texts.quote_note || '';
    const TRADE_TW = {
      water: '給水排水', electric: '電氣配線', hvac: '空調冷凍',
      fire: '消防', weak: '弱電', mixed: '綜合水電'
    };
    $('qf-trade').innerHTML = '<option value="">請選擇</option>'
      + DATA.enquiry_options.trades.map(t => `<option value="${esc(t)}">${esc(TRADE_TW[t] || t)}</option>`).join('');
    $('qf-building').innerHTML = '<option value="">請選擇</option>'
      + DATA.enquiry_options.building_types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    $('qf-services').innerHTML = DATA.enquiry_options.services
      .map(s => `<option value="${esc(s)}"></option>`).join('');

    // ---- 頁尾與浮動聯絡列 ----
    $('footer-info').innerHTML = `
      <div><h4>${esc(c.name)}</h4>
        ${c.tax_id ? `<p>統一編號 ${esc(c.tax_id)}</p>` : ''}
        ${c.address ? `<p>${esc(c.address)}</p>` : ''}
        ${t.footer_note ? para(t.footer_note) : ''}</div>
      <div><h4>聯絡我們</h4>
        ${c.phone ? `<p><a href="tel:${esc(c.phone)}">電話 ${esc(c.phone)}</a></p>` : ''}
        ${c.emergency_phone && c.emergency_phone !== c.phone
        ? `<p><a href="tel:${esc(c.emergency_phone)}">24H 緊急 ${esc(c.emergency_phone)}</a></p>` : ''}
        ${c.fax ? `<p>傳真 ${esc(c.fax)}</p>` : ''}
        ${c.email ? `<p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ''}
        ${c.line_id ? `<p>LINE：${esc(c.line_id)}</p>` : ''}
        ${c.map_url ? `<p><a href="${esc(c.map_url)}" target="_blank" rel="noopener">Google 地圖位置</a></p>` : ''}</div>
      <div><h4>營業資訊</h4>
        ${c.business_hours ? `<p>${esc(c.business_hours)}</p>` : ''}
        ${c.service_area ? `<p>服務地區：${esc(c.service_area)}</p>` : ''}
        ${DATA.licenses.length ? '<p>' + DATA.licenses.map(l => esc(l.name)).join('<br>') + '</p>' : ''}</div>`;
    $('footer-copy').textContent = `© ${new Date().getFullYear()} ${c.name}`;

    $('float-bar').innerHTML = [
      c.phone ? `<a href="tel:${esc(c.phone)}" class="fb fb-tel">📞 來電</a>` : '',
      c.line_url ? `<a href="${esc(c.line_url)}" target="_blank" rel="noopener" class="fb fb-line">LINE</a>` : '',
      `<a href="#quote" class="fb fb-quote">線上估價</a>`
    ].join('');

    bindEvents();
  }

  function hide(sectionId, yes) {
    const el = $(sectionId);
    if (el) el.style.display = yes ? 'none' : '';
  }

  function bindEvents() {
    // 手機選單
    $('nav-toggle').onclick = () => $('nav-links').classList.toggle('open');
    $('nav-links').addEventListener('click', e => {
      if (e.target.tagName === 'A') $('nav-links').classList.remove('open');
    });
    window.addEventListener('scroll', () => {
      $('nav').classList.toggle('solid', window.scrollY > 40);
    });

    document.querySelectorAll('[data-showcase]').forEach(el => {
      el.onclick = () => openShowcase(el.dataset.showcase);
    });
    document.querySelectorAll('[data-news]').forEach(el => {
      el.onclick = () => openNews(el.dataset.news);
    });

    const lb = $('lightbox');
    lb.querySelector('.lb-close').onclick = closeBox;
    lb.addEventListener('click', e => { if (e.target === lb) closeBox(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBox(); });

    $('quote-form').addEventListener('submit', submitQuote);
  }

  function openBox(html) {
    const lb = $('lightbox');
    lb.querySelector('.lb-body').innerHTML = html;
    lb.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeBox() {
    $('lightbox').classList.remove('show');
    document.body.style.overflow = '';
  }

  async function openShowcase(id) {
    try {
      const s = await fetch('/api/site/showcases/' + id).then(r => r.json());
      openBox(`
        <h2>${esc(s.title)}</h2>
        <div class="lb-meta">
          ${s.category ? `<span>${esc(s.category)}</span>` : ''}
          ${s.area ? `<span>${esc(s.area)}</span>` : ''}
          ${s.customer_name ? `<span>${esc(s.customer_name)}</span>` : ''}
          ${s.finish_date ? `<span>完工 ${esc(s.finish_date)}</span>` : ''}
        </div>
        ${s.summary ? `<p class="lb-sum">${esc(s.summary)}</p>` : ''}
        ${para(s.body)}
        <div class="lb-photos">${(s.photos || []).map(p => `
          <figure><img src="${esc(p.path)}" alt="${esc(p.caption)}" loading="lazy">
          ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div>
        <a class="btn-primary" href="#quote" onclick="document.getElementById('lightbox').classList.remove('show');document.body.style.overflow=''">
          我也要估價</a>`);
    } catch { /* 讀取失敗就不開視窗 */ }
  }

  async function openNews(id) {
    try {
      const n = await fetch('/api/site/news/' + id).then(r => r.json());
      openBox(`
        <div class="lb-meta"><span>${esc(n.category)}</span><span>${esc(n.publish_date || '')}</span></div>
        <h2>${esc(n.title)}</h2>
        ${n.cover ? `<img class="lb-cover" src="${esc(n.cover)}" alt="">` : ''}
        ${n.summary ? `<p class="lb-sum">${esc(n.summary)}</p>` : ''}
        ${para(n.body)}`);
    } catch { /* 同上 */ }
  }

  async function submitQuote(e) {
    e.preventDefault();
    const form = e.target;
    const btn = $('qf-submit'), msg = $('qf-msg');
    msg.className = 'qf-msg';
    msg.textContent = '';
    btn.disabled = true;
    btn.textContent = '送出中…';
    try {
      const res = await fetch('/api/site/enquiry', { method: 'POST', body: new FormData(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '送出失敗，請改用電話聯絡');
      form.reset();
      msg.className = 'qf-msg ok';
      msg.textContent = data.enq_no
        ? `已收到您的需求（編號 ${data.enq_no}），我們會盡快與您聯繫。`
        : '已收到您的需求，我們會盡快與您聯繫。';
    } catch (err) {
      msg.className = 'qf-msg err';
      msg.textContent = err.message;
    }
    btn.disabled = false;
    btn.textContent = '送出估價需求';
  }

  boot();
})();
