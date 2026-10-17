/* Kanam CMS — the staff portal.
   Sign in, then the sections your role allows (see sql/02-cms.sql):
     admin  : everything, including Staff and Activity
     editor : Pages, News, Media, Products, Projects, Testimonials, FAQs, Team, Settings
     sales  : Inquiries, Products, Media
   Products, projects, news, testimonials, FAQs and team share one editor,
   described by RESOURCES below. Photos live in the media library (table
   "media", storage bucket "site"). */
(function(){
  const D = window.KANAM_DEFAULTS;
  const cfg = window.KANAM_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = n => n == null || n === '' ? 'Call for price' : 'KES ' + Number(n).toLocaleString('en-KE');
  const isPlaceholder = v => /\[[^\]]+\]/.test(String(v || ''));
  const when = iso => iso ? new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const day = iso => iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const localInput = d => { d = new Date(d); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  if (!cfg.supabaseUrl || /YOUR-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey) || !window.supabase){
    $('setup').hidden = false;
    return;
  }
  const db = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const BUCKET = 'site';
  const imgUrl = path => path ? db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : '';

  let toastTimer;
  function toast(msg){
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  // Delete buttons ask once: the first tap arms, the second deletes.
  function armed(btn){
    if (btn.classList.contains('armed')) return true;
    btn.classList.add('armed');
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = 'Tap again to delete';
    setTimeout(() => disarm(btn), 4000);
    return false;
  }
  const disarm = btn => { btn.classList.remove('armed'); if (btn.dataset.label) btn.textContent = btn.dataset.label; };
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });

  /* ================================ Sign in ================================ */
  let me = null;                     // { user_id, email, name, role }

  $('signin-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    $('signin-error').textContent = '';
    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) $('signin-error').textContent = /invalid login/i.test(error.message) ? 'That email and password don\'t match.' : error.message;
    else f.password.value = '';
  };
  $('sign-out').onclick = () => db.auth.signOut();

  let shown;
  db.auth.onAuthStateChange((_e, session) => {
    const user = session ? session.user : null;
    const id = user ? user.id : null;
    if (id === shown) return;
    shown = id;
    // Leave the auth callback before querying, so Supabase isn't waited on from inside it.
    setTimeout(() => enter(user), 0);
  });

  async function enter(user){
    if (!user){ me = null; $('app').hidden = true; $('signin').hidden = false; return; }
    const { data, error } = await db.from('staff').select('*').eq('user_id', user.id).maybeSingle();
    if (error && /staff/.test(error.message) && /(does not exist|schema cache)/.test(error.message)){
      $('signin').hidden = true;
      $('setup-title').textContent = 'One more step';
      $('setup-text').innerHTML = 'The CMS tables are missing. Run <code>sql/02-cms.sql</code> in the Supabase SQL editor, then reload this page.';
      $('setup').hidden = false;
      return;
    }
    if (error || !data || !data.active){
      await db.auth.signOut();
      $('signin-error').textContent = error ? error.message : 'This login is not a staff account (or has been switched off). Ask an admin to add you under Staff.';
      return;
    }
    me = data;
    $('me-name').textContent = me.name || me.email;
    $('me-role').textContent = me.role;
    $('signin').hidden = true;
    $('setup').hidden = true;
    $('app').hidden = false;
    buildNav();
    const want = (localStorage.getItem('kanam_tab') || 'dashboard');
    show(TABS.find(t => t.id === want && allowed(t)) ? want : 'dashboard');
  }

  /* ================================ Navigation ================================ */
  const TABS = [
    { id: 'dashboard', label: 'Dashboard', roles: ['admin', 'editor', 'sales'] },
    { id: 'inquiries', label: 'Inquiries', roles: ['admin', 'sales'] },
    { id: 'pages', label: 'Pages', roles: ['admin', 'editor'], group: 'Website' },
    { id: 'posts', label: 'News', roles: ['admin', 'editor'] },
    { id: 'media', label: 'Media library', roles: ['admin', 'editor', 'sales'] },
    { id: 'products', label: 'Products', roles: ['admin', 'editor', 'sales'] },
    { id: 'projects', label: 'Projects', roles: ['admin', 'editor'] },
    { id: 'testimonials', label: 'Testimonials', roles: ['admin', 'editor'] },
    { id: 'faqs', label: 'FAQs', roles: ['admin', 'editor'] },
    { id: 'team', label: 'Team', roles: ['admin', 'editor'] },
    { id: 'settings', label: 'Company details', roles: ['admin', 'editor'], group: 'Company' },
    { id: 'staff', label: 'Staff', roles: ['admin'] },
    { id: 'activity', label: 'Activity log', roles: ['admin'] }
  ];
  const allowed = t => me && t.roles.includes(me.role);
  let current = null;

  function buildNav(){
    $('tabs').innerHTML = TABS.filter(allowed).map(t =>
      `${t.group ? `<span class="p-group">${t.group}</span>` : ''}<button type="button" data-tab="${t.id}">${t.label}${t.id === 'inquiries' ? ' <span class="count" id="new-count" hidden></span>' : ''}</button>`).join('');
    $('tabs').querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => show(b.dataset.tab); });
    if (allowed(TABS[1])) refreshNewCount();
  }

  function show(tab){
    current = tab;
    $('tabs').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    try { localStorage.setItem('kanam_tab', tab); } catch (e) {}
    const main = $('main');
    main.innerHTML = '<p class="muted">Loading…</p>';
    window.scrollTo(0, 0);
    const view = VIEWS[tab] || (RESOURCES[tab] ? () => listView(tab) : null);
    Promise.resolve(view && view(main)).catch(err => { main.innerHTML = `<p class="empty">Could not load: ${esc(err.message || err)}</p>`; });
  }
  const refresh = () => show(current);

  /* ================================ Media library ================================ */
  async function uploadToLibrary(file){
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `library/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw up.error;
    const { data, error } = await db.from('media').insert([{ path, name: file.name, mime: file.type, size: file.size }]).select().single();
    if (error) throw error;
    return data;
  }

  async function loadMedia(){
    const { data, error } = await db.from('media').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  const mediaTile = m => `
    <button type="button" class="media-tile" data-path="${esc(m.path)}" data-id="${m.id}" title="${esc(m.name)}">
      <span class="media-thumb" style="background-image:url('${esc(imgUrl(m.path))}')"></span>
      <span class="media-name">${esc(m.alt || m.name || 'Photo')}</span>
    </button>`;

  // Open the picker; resolves with a media row, or null if cancelled.
  function pickMedia(){
    return new Promise(async resolve => {
      const dlg = $('picker');
      let media = [];
      let done = false;
      const finish = v => { if (done) return; done = true; dlg.close(); resolve(v); };
      const draw = () => {
        const q = $('picker-search').value.trim().toLowerCase();
        const list = media.filter(m => !q || (m.name + ' ' + m.alt + ' ' + m.caption).toLowerCase().includes(q));
        $('picker-grid').innerHTML = list.map(mediaTile).join('') || '<p class="empty">No photos yet. Upload one.</p>';
        $('picker-grid').querySelectorAll('.media-tile').forEach(b => { b.onclick = () => finish(media.find(m => m.id === b.dataset.id)); });
      };
      dlg.onclose = () => finish(null);
      $('picker-search').value = '';
      $('picker-search').oninput = draw;
      $('picker-upload').value = '';
      $('picker-upload').onchange = async () => {
        const f = $('picker-upload').files[0];
        if (!f) return;
        try { finish(await uploadToLibrary(f)); toast('Uploaded'); } catch (err){ toast('Upload failed: ' + err.message); }
      };
      $('picker-grid').innerHTML = '<p class="muted">Loading…</p>';
      dlg.showModal();
      try { media = await loadMedia(); draw(); } catch (err){ $('picker-grid').innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
    });
  }

  /* ================================ Generic lists & editor ================================ */
  // Field types: text, textarea, number, select, checkbox, image, markdown, datetime, slug, rating.
  const RESOURCES = {
    products: {
      table: 'products', single: 'product', order: [['sort'], ['size_kg']],
      title: r => r.name + (r.size_kg ? ` – ${Number(r.size_kg)} kg` : ''), sub: r => r.description,
      thumb: r => r.image_path, thumbText: r => r.size_kg ? Number(r.size_kg) + 'kg' : '',
      right: r => `<b>${esc(money(r.price))}</b>${r.in_stock ? '' : ' <span class="pill hidden">Out of stock</span>'}${r.published ? '' : ' <span class="pill hidden">Hidden</span>'}`,
      search: r => [r.name, r.description, r.size_kg].join(' '),
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Pishori rice' },
        { name: 'size_kg', label: 'Bag size (kg)', type: 'number', half: true, step: '0.5' },
        { name: 'price', label: 'Price (KES)', type: 'number', half: true, step: '1', placeholder: 'Blank = Call for price' },
        { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
        { name: 'image_path', label: 'Photo', type: 'image' },
        { name: 'in_stock', label: 'In stock', type: 'checkbox', inline: true },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: list => ({ name: 'Pishori rice', in_stock: true, published: true, sort: list.length + 1 })
    },
    projects: {
      table: 'projects', single: 'project', order: [['sort'], ['created_at', false]],
      title: r => r.title, sub: r => [r.category, r.client, r.location, r.year].filter(Boolean).join(' · '),
      thumb: r => r.image_path, right: r => r.published ? '' : '<span class="pill hidden">Hidden</span>',
      search: r => [r.title, r.category, r.client, r.location, r.description].join(' '),
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Rakwaro–Kanam road maintenance' },
        { name: 'category', label: 'Category', type: 'select', half: true, options: ['Road works', 'Supplies & delivery', 'Rice trading'] },
        { name: 'client', label: 'Client', type: 'text', half: true, placeholder: 'e.g. KERRA' },
        { name: 'location', label: 'Location', type: 'text', half: true },
        { name: 'year', label: 'Year', type: 'text', half: true },
        { name: 'description', label: 'Description', type: 'textarea', rows: 4 },
        { name: 'image_path', label: 'Photo', type: 'image' },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: () => ({ category: 'Road works', published: true, sort: 0, year: String(new Date().getFullYear()) })
    },
    posts: {
      table: 'posts', single: 'news post', order: [['created_at', false]],
      title: r => r.title, sub: r => r.excerpt,
      thumb: r => r.cover_path,
      right: r => r.status === 'published'
        ? (new Date(r.published_at) > new Date() ? `<span class="pill contacted">Scheduled</span><span>${esc(day(r.published_at))}</span>` : `<span class="pill done">Published</span><span>${esc(day(r.published_at))}</span>`)
        : '<span class="pill new">Draft</span>',
      search: r => [r.title, r.excerpt, r.body].join(' '),
      link: r => r.status === 'published' ? `../news.html?p=${encodeURIComponent(r.slug)}` : '',
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'slug', label: 'Web address', type: 'slug', from: 'title', help: 'news.html?p=…  Lowercase words and dashes.' },
        { name: 'excerpt', label: 'Summary (shown on the news list)', type: 'textarea', rows: 2 },
        { name: 'body', label: 'Story', type: 'markdown', rows: 12 },
        { name: 'cover_path', label: 'Cover photo', type: 'image' },
        { name: 'status', label: 'Status', type: 'select', half: true, options: [['draft', 'Draft (not on the website)'], ['published', 'Published']] },
        { name: 'published_at', label: 'Publish date', type: 'datetime', half: true, help: 'A future date schedules it.' },
        { name: 'author_name', label: 'Author', type: 'text' }
      ],
      defaults: () => ({ status: 'draft', author_name: me ? me.name || '' : '' }),
      beforeSave: row => {
        row.slug = slugify(row.slug || row.title);
        if (!row.slug) throw new Error('Give the post a title.');
        if (row.status === 'published' && !row.published_at) row.published_at = new Date().toISOString();
      }
    },
    testimonials: {
      table: 'testimonials', single: 'testimonial', order: [['sort'], ['created_at', false]],
      title: r => r.name + (r.org ? ' · ' + r.org : ''), sub: r => r.quote, thumb: r => r.photo_path,
      thumbText: r => (r.name || '?')[0], right: r => (r.rating ? '★'.repeat(r.rating) + ' ' : '') + (r.published ? '' : '<span class="pill hidden">Hidden</span>'),
      search: r => [r.name, r.org, r.quote].join(' '),
      intro: 'Only add real customer words, with their permission. The section stays hidden on the Home page until there is at least one.',
      fields: [
        { name: 'quote', label: 'What they said', type: 'textarea', rows: 4, required: true },
        { name: 'name', label: 'Name', type: 'text', half: true, required: true },
        { name: 'org', label: 'Organisation or town', type: 'text', half: true },
        { name: 'rating', label: 'Stars', type: 'rating', half: true },
        { name: 'photo_path', label: 'Photo (optional)', type: 'image' },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: () => ({ published: true, sort: 0 })
    },
    faqs: {
      table: 'faqs', single: 'question', order: [['sort'], ['created_at']],
      title: r => r.question, sub: r => r.answer, right: r => `<span class="pill">${esc(r.topic)}</span>${r.published ? '' : ' <span class="pill hidden">Hidden</span>'}`,
      search: r => [r.question, r.answer, r.topic].join(' '), noThumb: true,
      intro: 'Shown on the Contact page.',
      fields: [
        { name: 'question', label: 'Question', type: 'text', required: true },
        { name: 'answer', label: 'Answer', type: 'markdown', rows: 5 },
        { name: 'topic', label: 'Topic', type: 'select', half: true, options: ['General', 'Rice', 'Supplies', 'Road works'] },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: list => ({ topic: 'General', published: true, sort: list.length + 1 })
    },
    team: {
      table: 'team', single: 'team member', order: [['sort'], ['created_at']],
      title: r => r.name, sub: r => r.role, thumb: r => r.photo_path, thumbText: r => (r.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2),
      right: r => r.published ? '' : '<span class="pill hidden">Hidden</span>', search: r => [r.name, r.role, r.bio].join(' '),
      intro: 'Shown on the About page once there is at least one person.',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true, half: true },
        { name: 'role', label: 'Role', type: 'text', half: true, placeholder: 'e.g. Director' },
        { name: 'bio', label: 'Short bio', type: 'textarea', rows: 3 },
        { name: 'photo_path', label: 'Photo', type: 'image' },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: list => ({ published: true, sort: list.length + 1 })
    }
  };

  async function fetchRows(key){
    const R = RESOURCES[key];
    let q = db.from(R.table).select('*');
    R.order.forEach(([col, asc]) => { q = q.order(col, { ascending: asc !== false }); });
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function listView(key){
    const R = RESOURCES[key], tab = TABS.find(t => t.id === key);
    const rows = await fetchRows(key);
    const main = $('main');
    main.innerHTML = `
      <div class="p-head">
        <h1>${esc(tab.label)}</h1>
        <div class="p-tools">
          <input type="search" id="list-search" placeholder="Search" aria-label="Search ${esc(tab.label)}">
          <button class="btn btn-navy btn-sm" type="button" id="list-add">+ Add ${esc(R.single)}</button>
        </div>
      </div>
      ${R.intro ? `<p class="muted">${esc(R.intro)}</p>` : ''}
      <div id="list"></div>`;
    const draw = () => {
      const q = $('list-search').value.trim().toLowerCase();
      const list = rows.filter(r => !q || R.search(r).toLowerCase().includes(q));
      $('list').innerHTML = list.length ? `<ul class="rows${R.noThumb ? ' no-thumb' : ''}">${list.map(r => {
        const img = R.thumb ? imgUrl(R.thumb(r)) : '';
        return `<li><button type="button" class="row" data-id="${r.id}">
          ${R.noThumb ? '' : `<span class="thumb" ${img ? `style="background-image:url('${esc(img)}')"` : ''}>${img ? '' : esc(R.thumbText ? R.thumbText(r) : '')}</span>`}
          <span><span class="title">${esc(R.title(r))}</span><span class="sub">${esc(R.sub(r) || '')}</span></span>
          <span class="right">${R.right(r)}</span>
        </button></li>`; }).join('')}</ul>`
        : `<p class="empty">${rows.length ? 'Nothing matches.' : `No ${esc(tab.label.toLowerCase())} yet.`}</p>`;
      $('list').querySelectorAll('[data-id]').forEach(b => { b.onclick = () => openEditor(key, rows.find(r => r.id === b.dataset.id), rows); });
    };
    $('list-search').oninput = draw;
    $('list-add').onclick = () => openEditor(key, null, rows);
    draw();
  }

  function fieldHtml(f, v){
    const id = 'f-' + f.name;
    const help = f.help ? `<small class="help">${esc(f.help)}</small>` : '';
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    const req = f.required ? ' required' : '';
    const cls = f.half ? 'half' : f.inline ? 'inline-field' : 'full';
    switch (f.type){
      case 'checkbox':
        return `<label class="check ${cls}"><input type="checkbox" name="${f.name}"${v ? ' checked' : ''}> ${esc(f.label)}</label>`;
      case 'textarea':
        return `<label class="${cls}">${esc(f.label)}<textarea name="${f.name}" rows="${f.rows || 3}"${ph}${req}>${esc(v)}</textarea>${help}</label>`;
      case 'markdown':
        return `<div class="${cls} md-field"><div class="md-head"><span class="field-label">${esc(f.label)}</span>
            <span class="md-tools"><button type="button" class="btn-text" data-md="image">+ Photo</button><button type="button" class="btn-text" data-md="preview">Preview</button></span></div>
          <textarea name="${f.name}" rows="${f.rows || 8}"${req}>${esc(v)}</textarea>
          <div class="prose md-preview" hidden></div>
          <small class="help">**bold**, *italics*, ## heading, - list, [link text](https://...), a blank line between paragraphs.</small></div>`;
      case 'select':
        return `<label class="${cls}">${esc(f.label)}<select name="${f.name}">${f.options.map(o => {
          const [val, text] = Array.isArray(o) ? o : [o, o];
          return `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(text)}</option>`; }).join('')}</select>${help}</label>`;
      case 'rating':
        return `<label class="${cls}">${esc(f.label)}<select name="${f.name}"><option value="">No stars</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}"${Number(v) === n ? ' selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label>`;
      case 'datetime':
        return `<label class="${cls}">${esc(f.label)}<input type="datetime-local" name="${f.name}" value="${v ? localInput(v) : ''}">${help}</label>`;
      case 'image':
        return `<div class="${cls} image-field" data-image="${f.name}"><span class="field-label">${esc(f.label)}</span>
          <div class="image-row"><div class="image-preview" ${v ? `style="background-image:url('${esc(imgUrl(v))}')"` : ''}>${v ? '' : 'No photo'}</div>
          <input type="hidden" name="${f.name}" value="${esc(v || '')}">
          <button type="button" class="btn btn-sm btn-quiet" data-pick>Choose photo</button>
          <button type="button" class="btn-text" data-clear>Remove</button></div></div>`;
      case 'number':
        return `<label class="${cls}">${esc(f.label)}<input type="number" name="${f.name}" value="${v == null ? '' : esc(v)}" step="${f.step || 'any'}" min="0"${ph}${req}${f.inline ? ' class="short"' : ''}>${help}</label>`;
      default:
        return `<label class="${cls}">${esc(f.label)}<input name="${f.name}" value="${esc(v == null ? '' : v)}"${ph}${req}${f.type === 'slug' ? ' pattern="[a-z0-9]+(-[a-z0-9]+)*"' : ''}>${help}</label>`;
    }
  }

  let editing = null;               // { key, row, rows }

  function openEditor(key, row, rows){
    const R = RESOURCES[key];
    editing = { key, row, rows };
    const v = row || R.defaults(rows);
    $('edit-title').textContent = (row ? 'Edit ' : 'New ') + R.single;
    $('edit-fields').innerHTML = R.fields.map(f => fieldHtml(f, v[f.name])).join('') +
      (R.link && row && R.link(row) ? `<a class="full small" href="${esc(R.link(row))}" target="_blank" rel="noopener">View on the website ↗</a>` : '');
    const form = $('edit-form');

    // Photo fields: choose from the library (or upload there), or remove.
    form.querySelectorAll('[data-image]').forEach(box => {
      const input = box.querySelector('input[type=hidden]'), prev = box.querySelector('.image-preview');
      const set = path => { input.value = path || ''; prev.style.backgroundImage = path ? `url('${imgUrl(path)}')` : ''; prev.textContent = path ? '' : 'No photo'; };
      box.querySelector('[data-pick]').onclick = async () => { const m = await pickMedia(); if (m) set(m.path); };
      box.querySelector('[data-clear]').onclick = () => set('');
    });
    // Web address follows the title until it is typed in by hand.
    R.fields.filter(f => f.type === 'slug').forEach(f => {
      const slug = form[f.name], src = form[f.from];
      let auto = !slug.value;
      slug.oninput = () => { auto = !slug.value; };
      src.addEventListener('input', () => { if (auto) slug.value = slugify(src.value); });
    });
    // Markdown fields: preview and insert a photo from the library.
    form.querySelectorAll('.md-field').forEach(box => {
      const ta = box.querySelector('textarea'), pv = box.querySelector('.md-preview');
      box.querySelector('[data-md=preview]').onclick = e => {
        const on = pv.hidden;
        pv.hidden = !on; ta.hidden = on;
        pv.innerHTML = KanamMD.render(ta.value) || '<p class="muted">Nothing to preview yet.</p>';
        e.target.textContent = on ? 'Edit' : 'Preview';
      };
      box.querySelector('[data-md=image]').onclick = async () => {
        const m = await pickMedia();
        if (!m) return;
        const snippet = `\n\n![${m.alt || ''}](${imgUrl(m.path)})\n\n`;
        const at = ta.selectionStart || ta.value.length;
        ta.value = ta.value.slice(0, at) + snippet + ta.value.slice(at);
        ta.focus();
      };
    });

    $('edit-delete').hidden = !row;
    disarm($('edit-delete'));
    $('edit-error').textContent = '';
    $('edit-dialog').showModal();
  }

  function readForm(R, form){
    const row = {};
    R.fields.forEach(f => {
      const el = form[f.name];
      if (f.type === 'checkbox') row[f.name] = el.checked;
      else if (f.type === 'number') row[f.name] = el.value === '' ? null : Number(el.value);
      else if (f.type === 'rating') row[f.name] = el.value ? Number(el.value) : null;
      else if (f.type === 'datetime') row[f.name] = el.value ? new Date(el.value).toISOString() : null;
      else if (f.type === 'image') row[f.name] = el.value || null;
      else row[f.name] = el.value.trim();
    });
    if (row.price != null) row.price = Math.round(row.price);
    if (row.sort == null && R.fields.some(f => f.name === 'sort')) row.sort = 0;
    return row;
  }

  $('edit-form').onsubmit = async e => {
    e.preventDefault();
    const { key, row: existing } = editing, R = RESOURCES[key];
    const btn = $('edit-save');
    $('edit-error').textContent = '';
    try {
      const row = readForm(R, e.target);
      if (R.beforeSave) R.beforeSave(row);
      row.updated_at = new Date().toISOString();
      btn.disabled = true;
      const { error } = existing ? await db.from(R.table).update(row).eq('id', existing.id) : await db.from(R.table).insert([row]);
      if (error) throw error;
      $('edit-dialog').close();
      toast('Saved');
      refresh();
    } catch (err){
      $('edit-error').textContent = /duplicate key.*slug/i.test(err.message) ? 'Another post already uses that web address. Change it a little.' : err.message;
    } finally { btn.disabled = false; }
  };
  $('edit-delete').onclick = async () => {
    if (!armed($('edit-delete'))) return;
    const R = RESOURCES[editing.key];
    const { error } = await db.from(R.table).delete().eq('id', editing.row.id);
    if (error){ $('edit-error').textContent = error.message; return; }
    $('edit-dialog').close();
    toast('Deleted');
    refresh();
  };

  /* ================================ Views ================================ */
  const VIEWS = {};

  /* ---------------- Dashboard ---------------- */
  VIEWS.dashboard = async main => {
    const can = id => allowed(TABS.find(t => t.id === id));
    const [inq, posts, settings, products, activity] = await Promise.all([
      can('inquiries') ? db.from('inquiries').select('id,status,name,kind,created_at').order('created_at', { ascending: false }).limit(200) : { data: null },
      can('posts') ? db.from('posts').select('id,status,title') : { data: null },
      db.from('settings').select('key,value'),
      db.from('products').select('id,in_stock,published'),
      can('activity') ? db.from('activity').select('*').order('at', { ascending: false }).limit(6) : { data: null }
    ]);
    const saved = {};
    (settings.data || []).forEach(r => { saved[r.key] = r.value; });
    const placeholders = Object.keys(D.settings).filter(k => isPlaceholder(saved[k] || D.settings[k]));
    const card = (n, label, tab, tone) => `<button type="button" class="stat-card ${tone || ''}" ${tab ? `data-go="${tab}"` : ''}><b>${n}</b><span>${label}</span></button>`;
    const fresh = inq.data ? inq.data.filter(i => i.status === 'new') : [];
    main.innerHTML = `
      <div class="p-head"><h1>Hello${me.name ? ', ' + esc(me.name.split(' ')[0]) : ''}</h1><a class="btn btn-sm btn-quiet" href="../index.html" target="_blank" rel="noopener">View website ↗</a></div>
      <div class="stat-cards">
        ${inq.data ? card(fresh.length, 'New inquiries', 'inquiries', fresh.length ? 'hot' : '') : ''}
        ${card((products.data || []).filter(p => p.published && p.in_stock).length + ' / ' + (products.data || []).length, 'Products in stock', 'products')}
        ${posts.data ? card(posts.data.filter(p => p.status === 'published').length, 'News published', 'posts') : ''}
        ${posts.data ? card(posts.data.filter(p => p.status === 'draft').length, 'News drafts', 'posts') : ''}
        ${card(placeholders.length, 'Company details still to fill in', allowed(TABS.find(t => t.id === 'settings')) ? 'settings' : '', placeholders.length ? 'warn' : '')}
      </div>
      <div class="dash-grid">
        ${inq.data ? `<section class="panel-box"><h2>Latest inquiries</h2>${inq.data.slice(0, 5).map(i => `<p><span class="pill ${i.status}">${esc(i.status)}</span> <b>${esc(i.name)}</b> · ${esc(i.kind)} <span class="muted small">${esc(when(i.created_at))}</span></p>`).join('') || '<p class="muted">None yet.</p>'}</section>` : ''}
        ${activity.data ? `<section class="panel-box"><h2>Recent changes</h2>${activity.data.map(a => `<p>${esc(describe(a))} <span class="muted small">${esc(a.email || 'website')} · ${esc(when(a.at))}</span></p>`).join('') || '<p class="muted">No changes yet.</p>'}</section>` : ''}
        ${placeholders.length ? `<section class="panel-box"><h2>Still to fill in</h2><p class="muted">These show as yellow placeholders on the website:</p><p>${placeholders.map(k => `<span class="pill new">${esc(k.replace(/_/g, ' '))}</span>`).join(' ')}</p></section>` : ''}
      </div>`;
    main.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => show(b.dataset.go); });
  };

  /* ---------------- Inquiries ---------------- */
  let inquiries = [], editingInq = null;
  async function refreshNewCount(){
    const { count } = await db.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new');
    const el = $('new-count');
    if (el){ el.hidden = !count; el.textContent = count || ''; }
  }

  VIEWS.inquiries = async main => {
    const { data, error } = await db.from('inquiries').select('*').order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    inquiries = data || [];
    main.innerHTML = `
      <div class="p-head">
        <h1>Inquiries</h1>
        <div class="p-tools">
          <select id="inq-status" aria-label="Show">
            <option value="open">New & contacted</option><option value="new">New</option><option value="contacted">Contacted</option>
            <option value="done">Done</option><option value="all">All</option>
          </select>
          <input type="search" id="inq-search" placeholder="Search name, phone, message" aria-label="Search inquiries">
          <button class="btn btn-sm btn-quiet" type="button" id="inq-export">Download CSV</button>
        </div>
      </div>
      <div id="inq-list"></div>`;
    $('inq-status').onchange = drawInquiries;
    $('inq-search').oninput = drawInquiries;
    $('inq-export').onclick = exportInquiries;
    drawInquiries();
    refreshNewCount();
  };

  function filteredInquiries(){
    const status = $('inq-status').value, q = $('inq-search').value.trim().toLowerCase();
    return inquiries.filter(i =>
      (status === 'all' || (status === 'open' ? i.status !== 'done' : i.status === status)) &&
      (!q || [i.name, i.phone, i.email, i.message, i.product, i.kind, i.notes].join(' ').toLowerCase().includes(q)));
  }

  function drawInquiries(){
    const list = filteredInquiries();
    $('inq-list').innerHTML = list.length ? `<ul class="rows no-thumb">${list.map(i => `
      <li><button type="button" class="row" data-id="${i.id}">
        <span><span class="title">${esc(i.name)} · ${esc(i.kind)}</span>
          <span class="sub">${esc([i.kind === 'Rice order' ? [i.product, i.quantity && '× ' + i.quantity].filter(Boolean).join(' ') : '', i.message].filter(Boolean).join(' — '))}</span></span>
        <span class="right"><span class="pill ${i.status}">${esc(i.status)}</span>${esc(when(i.created_at))}</span>
      </button></li>`).join('')}</ul>`
      : `<p class="empty">${inquiries.length ? 'Nothing matches.' : 'No inquiries yet. Orders and quote requests from the website will appear here.'}</p>`;
    $('inq-list').querySelectorAll('[data-id]').forEach(b => { b.onclick = () => openInquiry(inquiries.find(i => i.id === b.dataset.id)); });
  }

  function exportInquiries(){
    const cols = ['created_at', 'status', 'kind', 'name', 'phone', 'email', 'product', 'quantity', 'message', 'notes'];
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...filteredInquiries().map(i => cols.map(c => cell(i[c])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `kanam-inquiries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openInquiry(i){
    editingInq = i;
    const f = $('inq-form');
    $('inq-title').textContent = `${i.kind} from ${i.name}`;
    const tel = i.phone.replace(/[^\d+]/g, ''), wa = i.phone.replace(/\D/g, '').replace(/^0/, '254');
    const rows = [
      ['Received', when(i.created_at)],
      ['Phone', `<a href="tel:${esc(tel)}">${esc(i.phone)}</a> · <a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`, true],
      i.email && ['Email', `<a href="mailto:${esc(i.email)}">${esc(i.email)}</a>`, true],
      i.product && ['Product', i.product],
      i.quantity && ['Quantity', i.quantity],
      i.message && ['Message', i.message]
    ].filter(Boolean);
    $('inq-details').innerHTML = rows.map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : esc(v)}</dd>`).join('');
    f.status.value = i.status;
    f.notes.value = i.notes || '';
    $('inq-error').textContent = '';
    disarm($('inq-delete'));
    $('inq-dialog').showModal();
  }
  $('inq-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const { data, error } = await db.from('inquiries').update({ status: f.status.value, notes: f.notes.value.trim() }).eq('id', editingInq.id).select().single();
    if (error){ $('inq-error').textContent = error.message; return; }
    Object.assign(editingInq, data);
    $('inq-dialog').close();
    drawInquiries(); refreshNewCount();
    toast('Saved');
  };
  $('inq-delete').onclick = async () => {
    if (!armed($('inq-delete'))) return;
    const { error } = await db.from('inquiries').delete().eq('id', editingInq.id);
    if (error){ $('inq-error').textContent = error.message; return; }
    inquiries = inquiries.filter(i => i !== editingInq);
    $('inq-dialog').close();
    drawInquiries(); refreshNewCount();
    toast('Deleted');
  };

  /* ---------------- Pages (all the website's text) ---------------- */
  const PAGES = [['index', 'Home'], ['about', 'About'], ['services', 'Services'], ['rice', 'Pishori Rice'], ['projects', 'Projects'], ['news', 'News'], ['contact', 'Contact']];
  const htmlToText = html => { const d = document.createElement('div'); d.innerHTML = html.replace(/<br\s*\/?>/gi, '\n'); return d.textContent.replace(/[ \t]+\n/g, '\n').replace(/\s+$/, '').replace(/^\s+/, ''); };

  VIEWS.pages = async main => {
    const page = localStorage.getItem('kanam_page') || 'index';
    main.innerHTML = `
      <div class="p-head">
        <h1>Pages</h1>
        <div class="p-tools">
          <select id="page-pick" aria-label="Page">${PAGES.map(([k, l]) => `<option value="${k}"${k === page ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <a class="btn btn-sm btn-quiet" id="page-view" target="_blank" rel="noopener">View page ↗</a>
          <button class="btn btn-sm btn-navy" type="submit" form="page-form">Save changes</button>
        </div>
      </div>
      <p class="muted">Change any text on the page. Empty a box (or press Reset) to go back to the original wording. Contact details come from <b>Company details</b>; products, projects, news and FAQs have their own sections.</p>
      <form id="page-form" class="page-form"><p class="muted">Loading…</p></form>`;
    $('page-pick').onchange = () => { try { localStorage.setItem('kanam_page', $('page-pick').value); } catch (e) {} refresh(); };
    $('page-view').href = `../${page}.html`;

    const [html, content] = await Promise.all([
      fetch(`../${page}.html`, { cache: 'no-store' }).then(r => r.text()),
      db.from('content').select('key,value').like('key', page + '.%')
    ]);
    if (content.error) throw content.error;
    const saved = {};
    (content.data || []).forEach(r => { saved[r.key] = r.value; });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = [
      { key: page + '.meta.title', section: 'Search & sharing', label: 'Page title (browser tab and Google)', def: doc.title },
      { key: page + '.meta.description', section: 'Search & sharing', label: 'Description (shown under the title on Google)', def: (doc.querySelector('meta[name=description]') || {}).content || '', long: true }
    ];
    const sectionName = el => {
      const sec = el.closest('main > *');
      const h = sec && sec.querySelector('h1, h2');
      return h ? htmlToText(h.innerHTML).replace(/\n/g, ' ') : 'Section';
    };
    const kinds = { h1: 'Main headline', h2: 'Heading', h3: 'Sub-heading', p: 'Paragraph', li: 'List item', eyebrow: 'Small label', btn: 'Button', link: 'Link' };
    doc.querySelectorAll('main [data-c]').forEach(el => {
      const key = el.dataset.c, kind = key.split('.').pop().replace(/-\d+$/, '');
      const def = htmlToText(el.innerHTML);
      items.push({ key, section: sectionName(el), label: kinds[kind] || kind, def, long: def.length > 70 || def.includes('\n') });
    });

    let lastSection = null;
    $('page-form').innerHTML = items.map(it => {
      const v = saved[it.key] != null && saved[it.key] !== '' ? saved[it.key] : it.def;
      const head = it.section !== lastSection ? `<h2 class="page-section">${esc(it.section)}</h2>` : '';
      lastSection = it.section;
      const changed = saved[it.key] != null && saved[it.key] !== '' && saved[it.key] !== it.def;
      return `${head}<div class="page-item${changed ? ' changed' : ''}" data-key="${esc(it.key)}">
        <div class="page-item-head"><span class="field-label">${esc(it.label)}</span>${changed ? '<span class="pill contacted">Edited</span>' : ''}<button type="button" class="btn-text" data-reset>Reset</button></div>
        ${it.long ? `<textarea rows="${Math.min(6, Math.max(2, Math.ceil(v.length / 90) + (v.split('\n').length - 1)))}">${esc(v)}</textarea>` : `<input value="${esc(v)}">`}
      </div>`;
    }).join('');
    const defs = Object.fromEntries(items.map(it => [it.key, it.def]));
    $('page-form').querySelectorAll('.page-item').forEach(box => {
      box.querySelector('[data-reset]').onclick = () => { box.querySelector('input,textarea').value = defs[box.dataset.key]; };
    });
    $('page-form').onsubmit = async e => {
      e.preventDefault();
      const upserts = [], removes = [];
      const now = new Date().toISOString();
      $('page-form').querySelectorAll('.page-item').forEach(box => {
        const key = box.dataset.key, v = box.querySelector('input,textarea').value.replace(/\s+$/, '');
        const isDefault = !v.trim() || v === defs[key];
        if (isDefault){ if (saved[key] != null) removes.push(key); }
        else if (saved[key] !== v) upserts.push({ key, value: v, updated_at: now });
      });
      if (!upserts.length && !removes.length){ toast('No changes to save'); return; }
      const results = await Promise.all([
        upserts.length ? db.from('content').upsert(upserts, { onConflict: 'key' }) : { error: null },
        removes.length ? db.from('content').delete().in('key', removes) : { error: null }
      ]);
      const err = results.find(r => r.error);
      if (err){ toast('Not saved: ' + err.error.message); return; }
      toast(`Saved ${upserts.length + removes.length} change${upserts.length + removes.length === 1 ? '' : 's'}. The website shows them now.`);
      refresh();
    };
  };

  /* ---------------- Media library ---------------- */
  let editingMedia = null;
  VIEWS.media = async main => {
    const media = await loadMedia();
    main.innerHTML = `
      <div class="p-head">
        <h1>Media library</h1>
        <div class="p-tools">
          <input type="search" id="media-search" placeholder="Search photos" aria-label="Search photos">
          <label class="btn btn-sm btn-navy file-btn">Upload photos <input type="file" id="media-upload" accept="image/*" multiple hidden></label>
        </div>
      </div>
      <p class="muted">Upload once, then use the photo for products, projects, news or the team. Tip: phone photos are fine; under 2 MB each keeps the site fast.</p>
      <div class="media-grid" id="media-grid"></div>`;
    const draw = () => {
      const q = $('media-search').value.trim().toLowerCase();
      const list = media.filter(m => !q || (m.name + ' ' + m.alt + ' ' + m.caption).toLowerCase().includes(q));
      $('media-grid').innerHTML = list.map(mediaTile).join('') || `<p class="empty">${media.length ? 'Nothing matches.' : 'No photos yet. Upload your first ones.'}</p>`;
      $('media-grid').querySelectorAll('.media-tile').forEach(b => { b.onclick = () => openMedia(media.find(m => m.id === b.dataset.id)); });
    };
    $('media-search').oninput = draw;
    $('media-upload').onchange = async () => {
      const files = [...$('media-upload').files];
      let ok = 0;
      for (const f of files){
        toast(`Uploading ${ok + 1} of ${files.length}…`);
        try { media.unshift(await uploadToLibrary(f)); ok++; draw(); } catch (err){ toast(`${f.name}: ${err.message}`); }
      }
      if (ok) toast(`Uploaded ${ok} photo${ok === 1 ? '' : 's'}`);
    };
    draw();
  };

  function openMedia(m){
    editingMedia = m;
    const f = $('media-form');
    $('media-big').src = imgUrl(m.path);
    $('media-info').textContent = [m.name, m.size ? Math.round(m.size / 1024) + ' KB' : '', day(m.created_at)].filter(Boolean).join(' · ');
    f.alt.value = m.alt || '';
    f.caption.value = m.caption || '';
    $('media-url').value = imgUrl(m.path);
    $('media-error').textContent = '';
    disarm($('media-delete'));
    $('media-dialog').showModal();
  }
  $('media-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('media-url').value); toast('Link copied'); }
    catch (e){ $('media-url').select(); toast('Press Ctrl+C to copy'); }
  };
  $('media-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const { error } = await db.from('media').update({ alt: f.alt.value.trim(), caption: f.caption.value.trim() }).eq('id', editingMedia.id);
    if (error){ $('media-error').textContent = error.message; return; }
    $('media-dialog').close();
    toast('Saved');
    refresh();
  };
  $('media-delete').onclick = async () => {
    const btn = $('media-delete');
    if (!btn.classList.contains('armed')){
      // Warn when the photo is still used somewhere on the site.
      const p = editingMedia.path;
      const uses = await Promise.all([
        db.from('products').select('id', { count: 'exact', head: true }).eq('image_path', p),
        db.from('projects').select('id', { count: 'exact', head: true }).eq('image_path', p),
        db.from('posts').select('id', { count: 'exact', head: true }).eq('cover_path', p),
        db.from('team').select('id', { count: 'exact', head: true }).eq('photo_path', p),
        db.from('testimonials').select('id', { count: 'exact', head: true }).eq('photo_path', p)
      ]);
      const n = uses.reduce((s, r) => s + (r.count || 0), 0);
      $('media-error').textContent = n ? `Used in ${n} place${n === 1 ? '' : 's'} on the site; those will show no photo.` : '';
    }
    if (!armed(btn)) return;
    const del = await db.from('media').delete().eq('id', editingMedia.id);
    if (del.error){ $('media-error').textContent = del.error.message; return; }
    await db.storage.from(BUCKET).remove([editingMedia.path]);
    $('media-dialog').close();
    toast('Deleted');
    refresh();
  };

  /* ---------------- Company details ---------------- */
  const FIELDS = [
    ['company', 'Company name'], ['tagline', 'Tagline (under the headline)', 'wide'],
    ['phone', 'Phone'], ['whatsapp', 'WhatsApp number, in full (2547…)'], ['email', 'Email'],
    ['location', 'Office location'], ['postal', 'Postal address'], ['hours', 'Opening hours'],
    ['delivery_areas', 'Delivery areas'], ['payment', 'Payment options'], ['year_registered', 'Year registered'],
    ['reg_no', 'Registration number'], ['kra_pin', 'KRA PIN'], ['directors', 'Directors'],
    ['roads_done', 'Road contracts done (shown on Home)'], ['years_supplying', 'Years supplying institutions'],
    ['about', 'About us (our story)', 'wide'], ['mission', 'Mission', 'wide']
  ];
  VIEWS.settings = async main => {
    const { data, error } = await db.from('settings').select('key,value');
    if (error) throw error;
    const saved = {};
    (data || []).forEach(r => { saved[r.key] = r.value; });
    main.innerHTML = `
      <div class="p-head"><h1>Company details</h1><button class="btn btn-navy btn-sm" type="submit" form="settings-form">Save changes</button></div>
      <p class="muted">Shown in the header, footer, contact pages and elsewhere. Anything left in [square brackets] appears highlighted on the site as a placeholder.</p>
      <form id="settings-form" class="settings">${FIELDS.map(([key, label, wide]) => {
        const v = saved[key] != null && saved[key] !== '' ? saved[key] : D.settings[key] || '';
        const long = wide === 'wide' && key !== 'tagline';
        return `<label class="${wide || ''}">${esc(label)}${long ? `<textarea name="${key}" rows="4">${esc(v)}</textarea>` : `<input name="${key}" value="${esc(v)}">`}</label>`;
      }).join('')}</form>`;
    const f = $('settings-form');
    const mark = el => el.classList.toggle('is-ph', isPlaceholder(el.value));
    f.querySelectorAll('input,textarea').forEach(el => { mark(el); el.oninput = () => mark(el); });
    f.onsubmit = async e => {
      e.preventDefault();
      const now = new Date().toISOString();
      const rows = FIELDS.map(([key]) => ({ key, value: f[key].value.trim(), updated_at: now }))
        .filter(r => r.value !== (saved[r.key] != null && saved[r.key] !== '' ? saved[r.key] : D.settings[r.key] || '') || saved[r.key] != null);
      if (!rows.length){ toast('No changes to save'); return; }
      const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
      if (error){ toast('Not saved: ' + error.message); return; }
      toast('Saved. The website now shows the new details.');
    };
  };

  /* ---------------- Staff ---------------- */
  const ROLE_TEXT = { admin: 'Admin: everything', editor: 'Editor: website content', sales: 'Sales: inquiries & stock' };
  VIEWS.staff = async main => {
    const { data, error } = await db.from('staff').select('*').order('created_at');
    if (error) throw error;
    const staff = data || [];
    main.innerHTML = `
      <div class="p-head"><h1>Staff</h1></div>
      <ul class="rows no-thumb staff-rows">${staff.map(s => `
        <li class="staff-row" data-id="${s.user_id}">
          <span><span class="title">${esc(s.name || s.email)}${s.user_id === me.user_id ? ' <span class="pill">you</span>' : ''}</span><span class="sub">${esc(s.email)}</span></span>
          <select data-role aria-label="Role">${Object.entries(ROLE_TEXT).map(([r, t]) => `<option value="${r}"${s.role === r ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" data-active${s.active ? ' checked' : ''}> Active</label>
        </li>`).join('')}</ul>
      <form id="staff-form" class="panel-box staff-add">
        <h2>Add a staff member</h2>
        <ol class="muted small steps-list">
          <li>In Supabase, go to <b>Authentication → Users → Add user</b>, enter their email and a password, and tick <b>Auto Confirm User</b>.</li>
          <li>Add them here with the same email, then give them the password.</li>
        </ol>
        <div class="staff-add-row">
          <label>Email <input name="email" type="email" required></label>
          <label>Name <input name="name"></label>
          <label>Role <select name="role">${Object.entries(ROLE_TEXT).map(([r, t]) => `<option value="${r}"${r === 'editor' ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          <button class="btn btn-sm btn-navy" type="submit">Add</button>
        </div>
        <p class="form-status err" id="staff-error" role="alert"></p>
      </form>`;
    main.querySelectorAll('.staff-row').forEach(row => {
      const id = row.dataset.id, s = staff.find(x => x.user_id === id);
      const save = async patch => {
        const { error } = await db.from('staff').update(patch).eq('user_id', id);
        if (error){ toast(error.message); refresh(); return; }
        Object.assign(s, patch);
        toast('Saved');
        if (id === me.user_id) location.reload();
      };
      row.querySelector('[data-role]').onchange = e => save({ role: e.target.value });
      row.querySelector('[data-active]').onchange = e => save({ active: e.target.checked });
    });
    $('staff-form').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      $('staff-error').textContent = '';
      const { error } = await db.rpc('add_staff', { p_email: f.email.value.trim(), p_name: f.name.value.trim(), p_role: f.role.value });
      if (error){ $('staff-error').textContent = error.message; return; }
      toast('Added. They can sign in now.');
      refresh();
    };
  };

  /* ---------------- Activity log ---------------- */
  const TABLE_TEXT = { content: 'page text', media: 'photo', posts: 'news post', testimonials: 'testimonial', faqs: 'FAQ', team: 'team member',
    projects: 'project', products: 'product', settings: 'company detail', staff: 'staff member', inquiries: 'inquiry' };
  function describe(a){
    const r = a.after || a.before || {};
    const name = r.title || r.name || r.question || r.key || r.email || r.path || '';
    const verb = { insert: 'Added', update: 'Changed', delete: 'Deleted' }[a.action] || a.action;
    return `${verb} ${TABLE_TEXT[a.table_name] || a.table_name}${name ? ` “${String(name).slice(0, 60)}”` : ''}`;
  }
  function diff(a){
    if (a.action !== 'update' || !a.before || !a.after) return '';
    const skip = new Set(['updated_at', 'created_at']);
    const rows = Object.keys(a.after).filter(k => !skip.has(k) && JSON.stringify(a.before[k]) !== JSON.stringify(a.after[k]));
    const show = v => v == null || v === '' ? '<span class="muted">(empty)</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 400);
    return rows.length ? `<table class="diff"><tr><th>Field</th><th>Before</th><th>After</th></tr>${rows.map(k => `<tr><td>${esc(k)}</td><td>${show(a.before[k])}</td><td>${show(a.after[k])}</td></tr>`).join('')}</table>` : '';
  }
  VIEWS.activity = async main => {
    const { data, error } = await db.from('activity').select('*').order('at', { ascending: false }).limit(300);
    if (error) throw error;
    const log = data || [];
    main.innerHTML = `
      <div class="p-head">
        <h1>Activity log</h1>
        <div class="p-tools"><select id="act-table" aria-label="Show"><option value="">Everything</option>${Object.entries(TABLE_TEXT).map(([k, v]) => `<option value="${k}">${v[0].toUpperCase() + v.slice(1)}s</option>`).join('')}</select></div>
      </div>
      <p class="muted">Every change made in the portal: who, when, and what it was before. The latest 300 are shown.</p>
      <div id="act-list"></div>`;
    const draw = () => {
      const t = $('act-table').value;
      const list = log.filter(a => !t || a.table_name === t);
      $('act-list').innerHTML = list.length ? `<ul class="rows no-thumb act-rows">${list.map(a => {
        const d = diff(a);
        return `<li><details${d ? '' : ' class="no-diff"'}><summary><span class="act-what">${esc(describe(a))}</span><span class="act-who">${esc(a.email || 'website visitor')} · ${esc(when(a.at))}</span></summary>${d}</details></li>`; }).join('')}</ul>`
        : '<p class="empty">No changes recorded yet.</p>';
    };
    $('act-table').onchange = draw;
    draw();
  };
})();
