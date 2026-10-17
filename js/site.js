/* The public site: header, footer and WhatsApp button on every page, the
   company details ([data-s] elements), the rice products, the projects,
   and the order / quote form. Content comes from Supabase when it is
   connected (js/config.js), otherwise from the defaults in js/data.js. */
(function(){
  const D = window.KANAM_DEFAULTS;
  const cfg = window.KANAM_CONFIG || {};
  const connected = !!(cfg.supabaseUrl && !/YOUR-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey) && window.supabase);
  const db = connected ? supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isPlaceholder = v => /\[[^\]]+\]/.test(String(v || ''));
  const money = n => n == null || n === '' ? '' : 'KES ' + Number(n).toLocaleString('en-KE');
  // Placeholder text shows highlighted, so missing details are easy to spot.
  const show = v => isPlaceholder(v) ? `<span class="ph">${esc(v)}</span>` : esc(v);
  const digits = v => String(v || '').replace(/\D/g, '');

  let S = Object.assign({}, D.settings);
  let products = D.products.slice();
  let projects = D.projects.slice();

  const imgUrl = path => path && db ? db.storage.from('site').getPublicUrl(path).data.publicUrl : '';
  const productName = p => p.name + (p.size_kg ? ` – ${Number(p.size_kg)} kg` : '');

  function waLink(text){
    const n = digits(S.whatsapp);
    return n.length >= 9 && !isPlaceholder(S.whatsapp) ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : '';
  }

  /* ------------------------------ Layout ------------------------------ */
  const PAGES = [
    ['index.html', 'Home'], ['about.html', 'About'], ['services.html', 'Services'],
    ['rice.html', 'Pishori Rice'], ['projects.html', 'Projects'], ['contact.html', 'Contact']
  ];
  const here = document.body.dataset.page || 'index.html';

  function layout(){
    const nav = PAGES.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a>`).join('');
    document.body.insertAdjacentHTML('afterbegin', `
      <a class="skip" href="#main">Skip to content</a>
      <header class="site-header">
        <div class="wrap header-row">
          <a class="brand" href="index.html" aria-label="Kanam Logistics, home">
            <img src="img/logo.svg" alt="" width="40" height="40">
            <span><b>Kanam</b> Logistics<small>Limited</small></span>
          </a>
          <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
          <nav id="site-nav" class="site-nav" aria-label="Main">${nav}<a class="btn btn-sm" href="contact.html#quote">Get a quote</a></nav>
        </div>
      </header>`);
    document.body.insertAdjacentHTML('beforeend', `
      <footer class="site-footer">
        <div class="wrap footer-grid">
          <div>
            <a class="brand brand-light" href="index.html"><img src="img/logo.svg" alt="" width="36" height="36"><span><b>Kanam</b> Logistics<small>Limited</small></span></a>
            <p data-s="tagline"></p>
          </div>
          <div>
            <h3>Company</h3>
            <ul>${PAGES.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>
          </div>
          <div>
            <h3>Contact</h3>
            <ul>
              <li><a data-tel data-s="phone"></a></li>
              <li><a data-mail data-s="email"></a></li>
              <li data-s="location"></li>
              <li data-s="postal"></li>
              <li data-s="hours"></li>
            </ul>
          </div>
          <div>
            <h3>Registered</h3>
            <ul>
              <li>Reg. no. <span data-s="reg_no"></span></li>
              <li>KRA PIN <span data-s="kra_pin"></span></li>
              <li>Since <span data-s="year_registered"></span></li>
            </ul>
          </div>
        </div>
        <div class="wrap footer-bottom">
          <span>© ${new Date().getFullYear()} Kanam Logistics Limited</span>
          <a href="portal/">Staff portal</a>
        </div>
      </footer>
      <a class="wa-float" data-wa aria-label="Chat on WhatsApp" target="_blank" rel="noopener" hidden>
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.6c-2 0-4-.5-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.6 3.6 0 0 0-1.1 2.7 6.3 6.3 0 0 0 1.3 3.3 14.4 14.4 0 0 0 5.5 4.9c2 .9 2.8.9 3.8.8a3.3 3.3 0 0 0 2.2-1.5 2.7 2.7 0 0 0 .2-1.5c-.1-.2-.3-.3-.6-.4z"/></svg>
      </a>`);
    const btn = $('.menu-btn');
    btn.onclick = () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      $('#site-nav').classList.toggle('open', open);
    };
  }

  /* ------------------------------ Content ------------------------------ */
  async function load(){
    if (!db) return;
    const [s, p, j] = await Promise.all([
      db.from('settings').select('key,value'),
      db.from('products').select('*').eq('published', true).order('sort').order('size_kg'),
      db.from('projects').select('*').eq('published', true).order('sort').order('created_at', { ascending: false })
    ]);
    if (!s.error) (s.data || []).forEach(r => { if (r.value) S[r.key] = r.value; });
    if (!p.error && p.data && p.data.length) products = p.data;
    if (!j.error && j.data && j.data.length) projects = j.data;
    [s, p, j].forEach(r => { if (r.error) console.warn('Kanam: using default content –', r.error.message); });
  }

  function fill(){
    $$('[data-s]').forEach(el => { el.innerHTML = show(S[el.dataset.s]); });
    $$('[data-tel]').forEach(el => { if (!isPlaceholder(S.phone)) el.href = 'tel:' + S.phone.replace(/[^\d+]/g, ''); });
    $$('[data-mail]').forEach(el => { if (!isPlaceholder(S.email)) el.href = 'mailto:' + S.email; });
    const wa = waLink('Hello Kanam Logistics, ');
    $$('[data-wa]').forEach(el => { if (wa){ el.href = wa; el.hidden = false; } else if (!el.classList.contains('wa-float')) el.hidden = true; });
  }

  function productCard(p, compact){
    const img = imgUrl(p.image_path);
    return `
      <article class="product${p.in_stock === false ? ' out' : ''}">
        <div class="product-img">${img ? `<img src="${esc(img)}" alt="${esc(productName(p))}" loading="lazy">`
          : `<div class="bag" aria-hidden="true"><span>${Number(p.size_kg) || ''}<small>kg</small></span></div>`}</div>
        <div class="product-body">
          <h3>${esc(productName(p))}</h3>
          ${compact ? '' : `<p>${esc(p.description || '')}</p>`}
          <p class="price">${p.price ? money(p.price) : 'Call for price'}${p.size_kg && p.price ? `<small> · ${money(Math.round(p.price / p.size_kg))}/kg</small>` : ''}</p>
          ${p.in_stock === false ? '<p class="stock">Out of stock</p>'
            : `<a class="btn btn-sm" href="${compact ? 'rice.html?product=' + encodeURIComponent(productName(p)) : ''}#order" data-order="${esc(productName(p))}">Order</a>`}
        </div>
      </article>`;
  }

  function renderProducts(){
    $$('[data-products]').forEach(box => {
      const compact = box.dataset.products === 'compact';
      box.innerHTML = products.map(p => productCard(p, compact)).join('');
    });
    $$('[data-order]').forEach(a => a.addEventListener('click', () => {
      const sel = $('#quote-form [name=product]');
      if (sel){ sel.value = a.dataset.order; const k = $('#quote-form [name=kind]'); if (k) k.value = 'Rice order'; toggleKind(); }
    }));
  }

  function projectCard(p){
    const img = imgUrl(p.image_path);
    return `
      <article class="project" data-cat="${esc(p.category)}">
        <div class="project-img">${img ? `<img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy">`
          : `<div class="img-ph"><span>Photo: ${esc(p.title.replace(/\[|\]/g, ''))}</span></div>`}</div>
        <div class="project-body">
          <span class="tag">${esc(p.category)}</span>
          <h3>${show(p.title)}</h3>
          <p class="meta">${[p.client, p.location, p.year].filter(Boolean).map(show).join(' · ')}</p>
          <p>${show(p.description)}</p>
        </div>
      </article>`;
  }

  function renderProjects(){
    $$('[data-projects]').forEach(box => {
      const limit = Number(box.dataset.projects) || projects.length;
      box.innerHTML = projects.slice(0, limit).map(projectCard).join('') || '<p class="muted">Projects coming soon.</p>';
    });
    const chips = $('#project-filter');
    if (chips){
      chips.onclick = e => {
        const b = e.target.closest('button');
        if (!b) return;
        chips.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        $$('.project').forEach(card => { card.hidden = b.dataset.cat !== 'all' && card.dataset.cat !== b.dataset.cat; });
      };
    }
  }

  /* ------------------------------ Quote / order form ------------------------------ */
  function toggleKind(){
    const f = $('#quote-form');
    if (!f) return;
    const rice = f.kind.value === 'Rice order';
    f.querySelectorAll('.rice-only').forEach(el => { el.hidden = !rice; });
  }

  function form(){
    const f = $('#quote-form');
    if (!f) return;
    f.product.innerHTML = '<option value="">Choose a bag size</option>' +
      products.filter(p => p.in_stock !== false).map(p => `<option>${esc(productName(p))}</option>`).join('');
    const params = new URLSearchParams(location.search);
    const want = params.get('kind'), wantProduct = params.get('product');
    if (want && [...f.kind.options].some(o => o.value === want)) f.kind.value = want;
    if (wantProduct && [...f.product.options].some(o => o.value === wantProduct)){ f.kind.value = 'Rice order'; f.product.value = wantProduct; }
    f.kind.onchange = toggleKind;
    toggleKind();

    const note = $('#quote-status');
    const message = row => [
      `Hello Kanam Logistics, this is ${row.name} (${row.phone}${row.email ? ', ' + row.email : ''}).`,
      row.kind === 'Rice order' ? `I'd like to order: ${row.product || 'rice'}${row.quantity ? ' × ' + row.quantity : ''}.` : `Enquiry: ${row.kind}.`,
      row.message
    ].filter(Boolean).join('\n');

    f.onsubmit = async e => {
      e.preventDefault();
      if (f.website.value) return;          // a bot filled the hidden field
      const row = {
        kind: f.kind.value, name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(),
        product: f.kind.value === 'Rice order' ? f.product.value : '',
        quantity: f.kind.value === 'Rice order' ? f.quantity.value.trim() : '',
        message: f.message.value.trim()
      };
      const wa = waLink(message(row));
      const waBtn = wa ? ` <a class="btn btn-sm btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">Also send on WhatsApp</a>` : '';
      const button = f.querySelector('[type=submit]');
      note.className = 'form-status';
      if (db){
        button.disabled = true;
        const { error } = await db.from('inquiries').insert([row]);
        button.disabled = false;
        if (!error){
          f.reset(); toggleKind();
          note.classList.add('ok');
          note.innerHTML = `Thank you, ${esc(row.name)}. We have your ${row.kind === 'Rice order' ? 'order' : 'request'} and will call you on ${esc(row.phone)} soon.${waBtn}`;
          return;
        }
        console.warn('Kanam: inquiry not saved –', error.message);
      }
      if (wa){
        note.classList.add('ok');
        note.innerHTML = `Almost done: tap below to send your ${row.kind === 'Rice order' ? 'order' : 'request'} to us on WhatsApp.${waBtn}`;
      } else {
        note.classList.add('err');
        note.innerHTML = 'Sorry, the form could not be sent right now. Please call us on ' + show(S.phone) + '.';
      }
    };
  }

  /* ------------------------------ Start ------------------------------ */
  layout();
  fill(); renderProducts(); renderProjects(); form();
  load().then(() => { fill(); renderProducts(); renderProjects(); form(); })
        .catch(err => console.warn('Kanam: using default content –', err.message));
})();
