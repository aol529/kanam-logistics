/* Kanam CMS — the staff portal.
   Sign in, then the sections your role allows (see sql/02-cms.sql):
     admin  : everything, including Staff and Activity
     editor : Pages, News, Media, Products, Projects, Testimonials, FAQs, Team, Settings
     sales  : Inquiries, Rice ledger, Road works ledger, Products, Media
   Products, projects, news, testimonials, FAQs and team share one editor,
   described by RESOURCES below. Photos live in the media library (table
   "media", storage bucket "site"). Tender documents (Company profile) are
   private: table "company_docs", storage bucket "profile", admins only.
   The group: the company switcher picks which company's details, tender
   documents, projects, inquiries and road works are shown (table
   "companies", sql/07-companies.sql). Everything else is shared. */
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

  /* ================================ Companies ================================ */
  let companies = [];                // the group, in order; empty until sql/07-companies.sql is run
  let co = 'kanam';                  // the company the switcher is on
  try { co = localStorage.getItem('kanam_co') || 'kanam'; } catch (e) {}
  const grouped = () => companies.length > 0;
  const coRow = (id = co) => companies.find(c => c.id === id) || null;
  const coName = (id = co) => { const c = coRow(id); return c ? c.short_name || c.name : 'Kanam Logistics'; };
  // " · Techpride Ventures" after a heading, once there is more than one company.
  const coLabel = () => companies.length > 1 ? ` <span class="co-tag">${esc(coName())}</span>` : '';
  // Add .eq('company', co) to a query when companies are set up.
  const byCo = q => grouped() ? q.eq('company', co) : q;

  async function loadCompanies(){
    const { data, error } = await db.from('companies').select('*').order('sort').order('name');
    companies = error ? [] : data || [];
    if (!coRow()) co = 'kanam';
    const sel = $('co-switch');
    sel.innerHTML = companies.map(c => `<option value="${esc(c.id)}"${c.id === co ? ' selected' : ''}>${esc(c.short_name || c.name)}</option>`).join('');
    $('co-wrap').hidden = companies.length < 2;
    $('co-note').textContent = coRow() && !coRow().published ? 'Hidden from the website' : '';
  }
  $('co-switch').onchange = () => {
    co = $('co-switch').value;
    try { localStorage.setItem('kanam_co', co); } catch (e) {}
    $('co-note').textContent = coRow() && !coRow().published ? 'Hidden from the website' : '';
    buildNav();
    show(TABS.find(t => t.id === current && allowed(t)) ? current : 'dashboard');
  };

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
    await loadCompanies();
    buildNav();
    const want = (localStorage.getItem('kanam_tab') || 'dashboard');
    show(TABS.find(t => t.id === want && allowed(t)) ? want : 'dashboard');
  }

  /* ================================ Navigation ================================ */
  const TABS = [
    { id: 'dashboard', label: 'Dashboard', roles: ['admin', 'editor', 'sales'] },
    { id: 'inquiries', label: 'Inquiries', roles: ['admin', 'sales'] },
    { id: 'ledger', label: 'Rice ledger', roles: ['admin', 'sales'], kanamOnly: true },
    { id: 'roads', label: 'Road works ledger', roles: ['admin', 'sales'] },
    { id: 'pages', label: 'Pages', roles: ['admin', 'editor'], group: 'Website' },
    { id: 'posts', label: 'News', roles: ['admin', 'editor'] },
    { id: 'media', label: 'Media library', roles: ['admin', 'editor', 'sales'] },
    { id: 'products', label: 'Products', roles: ['admin', 'editor', 'sales'] },
    { id: 'equipment', label: 'Machinery hire', roles: ['admin', 'editor', 'sales'] },
    { id: 'projects', label: 'Projects', roles: ['admin', 'editor'] },
    { id: 'testimonials', label: 'Testimonials', roles: ['admin', 'editor'] },
    { id: 'faqs', label: 'FAQs', roles: ['admin', 'editor'] },
    { id: 'team', label: 'Team', roles: ['admin', 'editor'] },
    { id: 'settings', label: 'Company details', roles: ['admin', 'editor'], group: 'Company' },
    { id: 'companies', label: 'Companies', roles: ['admin'] },
    { id: 'profile', label: 'Company profile', roles: ['admin'] },
    { id: 'staff', label: 'Staff', roles: ['admin'] },
    { id: 'activity', label: 'Activity log', roles: ['admin'] }
  ];
  // The rice ledger is Kanam's own; it shows only while the switcher is on Kanam.
  const allowed = t => me && t.roles.includes(me.role) && !(t.kanamOnly && co !== 'kanam');
  let current = null;

  function buildNav(){
    $('tabs').innerHTML = TABS.filter(allowed).map(t =>
      `${t.group ? `<span class="p-group">${t.group}</span>` : ''}<button type="button" data-tab="${t.id}">${t.label}${t.id === 'inquiries' ? ' <span class="count" id="new-count" hidden></span>' : ''}</button>`).join('');
    $('tabs').querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => show(b.dataset.tab); });
    if (allowed(TABS.find(t => t.id === 'inquiries'))) refreshNewCount();
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
  // The kinds of tender checklist a company can have (items: CHECKLISTS, under Company profile).
  const CHECKLIST_TYPES = { contractor: 'Contractor (roads & construction)', food: 'Food supplier (eggs & produce)', general: 'General supplier' };

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
    equipment: {
      table: 'equipment', single: 'machine', order: [['sort'], ['name']],
      title: r => r.name, sub: r => r.description,
      thumb: r => r.image_path, thumbText: () => '⛏',
      right: r => `<b>${r.rate ? esc(money(r.rate)) + ' ' + esc(r.rate_unit || '') : 'Call for rates'}</b>${{ available: ' <span class="pill done">Available</span>', on_hire: ' <span class="pill new">On hire</span>', coming_soon: ' <span class="pill contacted">Coming soon</span>' }[r.status] || ''}${r.published ? '' : ' <span class="pill hidden">Hidden</span>'}`,
      search: r => [r.name, r.description, r.terms].join(' '),
      fields: [
        { name: 'name', label: 'Machine', type: 'text', required: true, placeholder: 'e.g. Motor grader' },
        { name: 'rate', label: 'Hire rate (KES)', type: 'number', half: true, step: '1', placeholder: 'Blank = Call for rates' },
        { name: 'rate_unit', label: 'Charged', type: 'select', half: true, options: [['per hour', 'Per hour'], ['per day', 'Per day'], ['per week', 'Per week'], ['per month', 'Per month'], ['per km', 'Per km']] },
        { name: 'description', label: 'What it is used for', type: 'textarea', rows: 2 },
        { name: 'terms', label: 'Terms', type: 'textarea', rows: 2, help: 'e.g. With operator. Fuel by client. Minimum 8 hours. Transport to site charged separately.' },
        { name: 'status', label: 'Status', type: 'select', half: true, options: [['available', 'Available'], ['on_hire', 'On hire (book ahead)'], ['coming_soon', 'Coming soon']] },
        { name: 'image_path', label: 'Photo', type: 'image' },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: list => ({ rate_unit: 'per hour', status: 'available', published: true, sort: list.length + 1,
        terms: 'With operator. Fuel by client. Transport to site charged separately.' })
    },
    projects: {
      table: 'projects', single: 'project', order: [['sort'], ['created_at', false]], perCompany: true,
      title: r => r.title, sub: r => [r.category, r.client, r.location, r.year].filter(Boolean).join(' · '),
      thumb: r => r.image_path, right: r => r.published ? '' : '<span class="pill hidden">Hidden</span>',
      search: r => [r.title, r.category, r.client, r.location, r.description].join(' '),
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Rakwaro–Kanam road maintenance' },
        { name: 'category', label: 'Category', type: 'select', half: true, options: ['Road works', 'Supplies & delivery', 'Rice trading', 'Hardware & glass', 'Machinery hire'] },
        { name: 'client', label: 'Client', type: 'text', half: true, placeholder: 'e.g. KERRA' },
        { name: 'location', label: 'Location', type: 'text', half: true },
        { name: 'year', label: 'Year', type: 'text', half: true },
        { name: 'description', label: 'Description', type: 'textarea', rows: 4 },
        { name: 'image_path', label: 'Photo', type: 'image' },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: () => ({ category: co === 'glassmart' ? 'Hardware & glass' : 'Road works', published: true, sort: 0, year: String(new Date().getFullYear()) })
    },
    companies: {
      table: 'companies', single: 'company', order: [['sort'], ['name']],
      title: r => r.name, sub: r => r.what, thumb: r => r.logo_path, thumbText: r => (r.short_name || r.name || '?')[0],
      right: r => r.published ? '<span class="pill done">On the website</span>' : '<span class="pill hidden">Hidden</span>',
      search: r => [r.name, r.short_name, r.what].join(' '),
      intro: 'The companies in the group. A company stays off the website until “Show on the website” is ticked, so it can be set up before the handover. Each one’s contact details, registration and About text are under Company details (pick it in the switcher first); Kanam Logistics keeps its own details there as before.',
      fields: [
        { name: 'name', label: 'Registered name', type: 'text', required: true, placeholder: 'e.g. Techpride Ventures Ltd' },
        { name: 'id', label: 'Short code', type: 'slug', from: 'name', half: true, help: 'Used in web addresses: companies.html?c=… Lowercase words and dashes.' },
        { name: 'short_name', label: 'Short name', type: 'text', half: true, placeholder: 'e.g. Techpride Ventures' },
        { name: 'what', label: 'What it does (one line)', type: 'text' },
        { name: 'checklist', label: 'Tender checklist', type: 'select', options: Object.entries(CHECKLIST_TYPES), help: 'Which documents its Company profile asks for. You can add your own items there too.' },
        { name: 'logo_path', label: 'Logo or photo', type: 'image' },
        { name: 'published', label: 'Show on the website', type: 'checkbox', inline: true },
        { name: 'sort', label: 'Order', type: 'number', inline: true, step: '1' }
      ],
      defaults: list => ({ published: false, sort: list.length + 1, checklist: 'contractor' }),
      beforeSave: (row, existing) => {
        row.id = slugify(row.id || row.name);
        if (!row.id) throw new Error('Give the company a name.');
        if (existing && existing.id === 'kanam' && row.id !== 'kanam') throw new Error('Kanam Logistics keeps the short code “kanam”.');
        if (row.id === 'kanam') row.published = true;
      },
      afterSave: loadCompanies
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
    if (R.perCompany) q = byCo(q);
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
        <h1>${esc(tab.label)}${R.perCompany ? coLabel() : ''}</h1>
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
      if (R.beforeSave) R.beforeSave(row, existing);
      if (R.perCompany && grouped() && !existing) row.company = co;
      row.updated_at = new Date().toISOString();
      btn.disabled = true;
      const { error } = existing ? await db.from(R.table).update(row).eq('id', existing.id) : await db.from(R.table).insert([row]);
      if (error) throw error;
      if (R.afterSave) await R.afterSave();
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
    const [inq, posts, settings, products, activity, profile, rice, road] = await Promise.all([
      can('inquiries') ? byCo(db.from('inquiries').select('id,status,name,kind,created_at')).order('created_at', { ascending: false }).limit(200) : { data: null },
      can('posts') ? db.from('posts').select('id,status,title') : { data: null },
      db.from('settings').select('key,value'),
      db.from('products').select('id,in_stock,published'),
      can('activity') ? db.from('activity').select('*').order('at', { ascending: false }).limit(6) : { data: null },
      can('profile') ? profileStatus() : null,
      can('ledger') ? ledgerStatus() : null,
      can('roads') ? roadStatus() : null
    ]);
    const saved = {};
    (settings.data || []).forEach(r => { saved[r.key] = r.value; });
    const sister = grouped() && co !== 'kanam' ? coRow() : null;
    const placeholders = sister ? CO_FIELDS.map(([k]) => k).filter(k => isPlaceholder(sister[k]))
      : Object.keys(D.settings).filter(k => isPlaceholder(saved[k] || D.settings[k]));
    const card = (n, label, tab, tone) => `<button type="button" class="stat-card ${tone || ''}" ${tab ? `data-go="${tab}"` : ''}><b>${n}</b><span>${label}</span></button>`;
    const fresh = inq.data ? inq.data.filter(i => i.status === 'new') : [];
    main.innerHTML = `
      <div class="p-head"><h1>Hello${me.name ? ', ' + esc(me.name.split(' ')[0]) : ''}</h1><a class="btn btn-sm btn-quiet" href="../index.html" target="_blank" rel="noopener">View website ↗</a></div>
      ${grouped() && companies.length > 1 ? `<p class="muted">Showing <b>${esc(coName())}</b>: its details, tender documents, projects, inquiries and road works. Switch company in the menu.${coRow() && !coRow().published ? ` <span class="pill hidden">Hidden from the website</span>${me.role === 'admin' ? ' Switch it on under <b>Companies</b> when the handover is done.' : ''}` : ''}</p>` : ''}
      <div class="stat-cards">
        ${inq.data ? card(fresh.length, 'New inquiries', 'inquiries', fresh.length ? 'hot' : '') : ''}
        ${rice ? card(rice.c.profit >= 0 ? kes(rice.c.profit) : kes(rice.c.recover), `${rice.c.profit >= 0 ? 'Rice profit so far' : 'Rice: still to recover'} · ${esc(rice.b.name.replace(/\s*\(.*\)$/, ''))}`, 'ledger', rice.c.profit >= 0 ? '' : 'warn') : ''}
        ${road ? card(kes(road.c.contract ? road.c.expProfit : road.c.spent), `${road.c.contract ? 'Road works: expected profit' : 'Road works: spent so far'} · ${esc(road.p.name)}`, 'roads', road.c.contract && road.c.expProfit < 0 ? 'warn' : '') : ''}
        ${card((products.data || []).filter(p => p.published && p.in_stock).length + ' / ' + (products.data || []).length, 'Products in stock', 'products')}
        ${posts.data ? card(posts.data.filter(p => p.status === 'published').length, 'News published', 'posts') : ''}
        ${posts.data ? card(posts.data.filter(p => p.status === 'draft').length, 'News drafts', 'posts') : ''}
        ${profile ? card(profile.todo, 'Tender documents missing or expiring', 'profile', profile.todo ? 'warn' : '') : ''}
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
    const { count } = await byCo(db.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new'));
    const el = $('new-count');
    if (el){ el.hidden = !count; el.textContent = count || ''; }
  }

  VIEWS.inquiries = async main => {
    const { data, error } = await byCo(db.from('inquiries').select('*')).order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    inquiries = data || [];
    main.innerHTML = `
      <div class="p-head">
        <h1>Inquiries${coLabel()}</h1>
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
          <span class="sub">${esc([i.kind === 'Rice order' ? [i.product, i.quantity && '× ' + i.quantity].filter(Boolean).join(' ') : i.kind === 'Machinery hire' ? [i.product, i.quantity && 'for ' + i.quantity].filter(Boolean).join(' ') : '', i.message].filter(Boolean).join(' — '))}</span></span>
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
    a.download = `${co}-inquiries-${new Date().toISOString().slice(0, 10)}.csv`;
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
      i.product && [i.kind === 'Machinery hire' ? 'Machine' : 'Product', i.product],
      i.quantity && [i.kind === 'Machinery hire' ? 'Hire period' : 'Quantity', i.quantity],
      i.message && ['Message', i.message]
    ].filter(Boolean);
    $('inq-details').innerHTML = rows.map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : esc(v)}</dd>`).join('');
    f.status.value = i.status;
    f.notes.value = i.notes || '';
    $('inq-ledger').hidden = !(i.kind === 'Rice order' && allowed(TABS.find(t => t.id === 'ledger')));
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
  $('inq-ledger').onclick = () => inquiryToLedger(editingInq);
  $('inq-delete').onclick = async () => {
    if (!armed($('inq-delete'))) return;
    const { error } = await db.from('inquiries').delete().eq('id', editingInq.id);
    if (error){ $('inq-error').textContent = error.message; return; }
    inquiries = inquiries.filter(i => i !== editingInq);
    $('inq-dialog').close();
    drawInquiries(); refreshNewCount();
    toast('Deleted');
  };

  /* ---------------- Rice ledger (batches and sales) ---------------- */
  // The same sheets as Pishori_Trading_Ledger.xlsx: 1 Purchase, 2 Costs,
  // 3 Selling trips, 4 Pricing, the Sales log and 5 Sales progress.
  const num = v => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const kes = n => Math.round(num(n)).toLocaleString('en-KE');
  const kes2 = n => num(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sumOf = list => (list || []).reduce((t, x) => t + num(x.amount), 0);
  const today = () => localInput(new Date()).slice(0, 10);

  function ledgerCalc(b, sales){
    const sizes = (b.sizes || []).map(s => ({ size: num(s.size), bags: num(s.bags), price: num(s.price) }));
    const c = { sizes };
    c.totBags = sizes.reduce((t, s) => t + s.bags, 0);
    c.totKg = sizes.reduce((t, s) => t + s.size * s.bags, 0);
    c.rice = c.totKg * num(b.price_kg);
    c.bagsCost = c.totBags * num(b.price_bag);
    c.other = sumOf(b.costs);
    c.tripCost = sumOf(b.trip_costs);
    c.tripsTotal = num(b.trips) * c.tripCost;
    c.totalCost = c.rice + c.bagsCost + c.other + c.tripsTotal;
    c.beKg = c.totKg ? c.totalCost / c.totKg : 0;
    c.tgKg = c.totKg ? (c.totalCost + num(b.target)) / c.totKg : 0;
    c.expTotal = sizes.reduce((t, s) => t + s.price * s.bags, 0);
    c.expProfit = c.expTotal - c.totalCost;
    const priceFor = size => (sizes.find(s => s.size === num(size)) || {}).price || 0;
    c.priceFor = priceFor;
    c.rows = (sales || []).map(r => {
      const p = r.price_per_bag != null && r.price_per_bag !== '' ? num(r.price_per_bag) : priceFor(r.size_kg);
      return { kg: num(r.size_kg) * num(r.bags), amount: num(r.bags) * p };
    });
    c.bySize = sizes.map(s => {
      let sold = 0, amount = 0;
      (sales || []).forEach((r, i) => { if (num(r.size_kg) === s.size){ sold += num(r.bags); amount += c.rows[i].amount; } });
      return { size: s.size, sold, left: s.bags - sold, amount };
    });
    c.sales = c.rows.reduce((t, r) => t + r.amount, 0);
    c.soldKg = c.rows.reduce((t, r) => t + r.kg, 0);
    c.soldBags = (sales || []).reduce((t, r) => t + num(r.bags), 0);
    c.unpaid = (sales || []).reduce((t, r, i) => t + (r.paid ? 0 : c.rows[i].amount), 0);
    c.recover = Math.max(0, c.totalCost - c.sales);
    c.profit = c.sales - c.totalCost;
    c.needed = Math.max(0, c.totalCost + num(b.target) - c.sales);
    c.status = c.sales >= c.totalCost + num(b.target) ? 'Target reached!' : c.sales >= c.totalCost ? 'Money recovered – now in profit' : 'Still recovering costs';
    return c;
  }

  // For the dashboard: the newest active batch.
  async function ledgerStatus(){
    try {
      const { data: b, error } = await db.from('rice_batches').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error || !b) return null;
      const { data: sales } = await db.from('rice_sales').select('size_kg,bags,price_per_bag,paid').eq('batch_id', b.id);
      return { b, c: ledgerCalc(b, sales || []) };
    } catch (e){ return null; }
  }

  let L = { batches: [], batch: null, sales: [], sheet: 'sales', dirty: false };
  const missingTable = err => err && /(does not exist|schema cache)/.test(err.message);

  VIEWS.ledger = async main => {
    const { data, error } = await db.from('rice_batches').select('*').order('created_at', { ascending: false });
    if (error){
      if (!missingTable(error)) throw error;
      main.innerHTML = `<div class="p-head"><h1>Rice ledger</h1></div>
        <p class="empty">One more step: run <code>sql/04-ledger.sql</code> in the Supabase SQL editor, then reload this page.</p>`;
      return;
    }
    L.batches = data || [];
    let want = null;
    try { want = localStorage.getItem('kanam_batch'); } catch (e) {}
    L.batch = L.batches.find(b => b.id === want) || L.batches.find(b => b.status === 'active') || L.batches[0] || null;
    try { L.sheet = localStorage.getItem('kanam_sheet') || 'sales'; } catch (e) {}
    L.dirty = false;
    main.innerHTML = `
      <div class="p-head">
        <h1>Rice ledger</h1>
        <div class="p-tools">
          <select id="lg-batch" aria-label="Batch">${L.batches.map(b => `<option value="${b.id}"${L.batch && b.id === L.batch.id ? ' selected' : ''}>${esc(b.name)}${b.status === 'closed' ? ' (closed)' : ''}</option>`).join('')}</select>
          <button class="btn btn-sm btn-quiet" type="button" id="lg-new">New batch</button>
          <button class="btn btn-sm btn-quiet" type="button" id="lg-xlsx"${L.batch ? '' : ' disabled'}>Download Excel</button>
        </div>
      </div>
      <div id="lg-body"></div>`;
    $('lg-batch').onchange = () => {
      if (L.dirty && !confirmLeave()) { $('lg-batch').value = L.batch.id; return; }
      try { localStorage.setItem('kanam_batch', $('lg-batch').value); } catch (e) {}
      refresh();
    };
    $('lg-new').onclick = newBatch;
    $('lg-xlsx').onclick = downloadLedger;
    if (!L.batch){
      $('lg-body').innerHTML = '<p class="empty">No batches yet. Press <b>New batch</b> to start one.</p>';
      return;
    }
    const s = await db.from('rice_sales').select('*').eq('batch_id', L.batch.id).order('sold_on').order('created_at');
    if (s.error) throw s.error;
    L.sales = s.data || [];
    $('lg-body').innerHTML = `
      <div class="stat-cards lg-cards" id="lg-cards"></div>
      <div class="sheet-tabs" role="tablist">
        ${[['sales', 'Sales log'], ['summary', 'Batch summary'], ['progress', 'Sales progress']].map(([k, t]) =>
          `<button type="button" role="tab" data-sheet="${k}" aria-selected="${L.sheet === k}">${t}</button>`).join('')}
      </div>
      <div id="lg-sheet"></div>`;
    $('lg-body').querySelectorAll('[data-sheet]').forEach(b => { b.onclick = () => {
      if (L.dirty && !confirmLeave()) return;
      L.sheet = b.dataset.sheet;
      try { localStorage.setItem('kanam_sheet', L.sheet); } catch (e) {}
      $('lg-body').querySelectorAll('[data-sheet]').forEach(x => x.setAttribute('aria-selected', x === b));
      drawSheet();
    }; });
    drawCards();
    drawSheet();
  };
  const confirmLeave = () => window.confirm('You have unsaved changes to the batch summary. Leave without saving?');

  function drawCards(c){
    c = c || ledgerCalc(L.batch, L.sales);
    const tone = c.profit >= 0 ? 'good' : '';
    $('lg-cards').innerHTML = `
      <div class="stat-card static"><b>${kes(c.sales)}</b><span>Sales so far (KES)</span></div>
      <div class="stat-card static ${tone}"><b>${c.profit >= 0 ? kes(c.profit) : kes(c.recover)}</b><span>${c.profit >= 0 ? 'Profit so far' : 'Still to recover'}</span></div>
      <div class="stat-card static"><b>${kes(c.totBags - c.soldBags)} / ${kes(c.totBags)}</b><span>Bags left</span></div>
      <div class="stat-card static ${c.unpaid ? 'warn' : ''}"><b>${kes(c.unpaid)}</b><span>Not yet paid</span></div>
      <div class="stat-card static"><b class="lg-status">${esc(c.status)}</b><span>Target profit ${kes(L.batch.target)}</span></div>`;
  }
  function drawSheet(){
    ({ sales: drawSales, summary: drawSummary, progress: drawProgress })[L.sheet in { sales: 1, summary: 1, progress: 1 } ? L.sheet : 'sales']();
  }

  /* ----- Sales log: edit in place, each row saves itself ----- */
  function drawSales(){
    const b = L.batch, c = ledgerCalc(b, L.sales);
    const sizes = (b.sizes || []).map(s => num(s.size));
    const opts = v => `<option value=""></option>` + sizes.map(s => `<option value="${s}"${num(v) === s ? ' selected' : ''}>${s} kg</option>`).join('')
      + (v != null && v !== '' && !sizes.includes(num(v)) ? `<option value="${esc(v)}" selected>${esc(v)} kg</option>` : '');
    $('lg-sheet').innerHTML = `
      <div class="p-head lg-sub">
        <p class="muted small">Type straight into the table; each row saves itself. Leave the price empty to use the batch price for that bag size.</p>
        <div class="p-tools">
          <label class="check small"><input type="checkbox" id="lg-unpaid"> Unpaid only</label>
          <button class="btn btn-sm btn-navy" type="button" id="lg-add">Add sale</button>
        </div>
      </div>
      <div class="sheet-wrap"><table class="sheet sales-sheet">
        <thead><tr><th>#</th><th>Date</th><th>Buyer</th><th>Bag size</th><th class="r">Bags</th><th class="r">Price per bag</th><th class="r">Total kg</th><th class="r">Amount</th><th>Paid</th><th>Notes</th><th></th></tr></thead>
        <tbody>${L.sales.map((r, i) => `
          <tr data-id="${r.id}"${r.paid ? '' : ' class="unpaid"'}>
            <td class="muted">${i + 1}</td>
            <td><input type="date" data-f="sold_on" value="${esc(r.sold_on || '')}"></td>
            <td><input data-f="buyer" value="${esc(r.buyer)}" placeholder="Name"></td>
            <td><select data-f="size_kg">${opts(r.size_kg)}</select></td>
            <td><input data-f="bags" inputmode="numeric" class="r" value="${r.bags == null ? '' : esc(r.bags)}"></td>
            <td><input data-f="price_per_bag" inputmode="numeric" class="r" value="${r.price_per_bag == null ? '' : esc(r.price_per_bag)}" placeholder="${c.priceFor(r.size_kg) ? kes(c.priceFor(r.size_kg)) : ''}"></td>
            <td class="r calc" data-kg>${c.rows[i].kg ? kes(c.rows[i].kg) : ''}</td>
            <td class="r calc" data-amt>${c.rows[i].amount ? kes(c.rows[i].amount) : ''}</td>
            <td class="c"><input type="checkbox" data-f="paid"${r.paid ? ' checked' : ''} aria-label="Paid"></td>
            <td><input data-f="notes" value="${esc(r.notes)}"></td>
            <td><button type="button" class="btn-text danger" data-del title="Delete this sale">✕</button></td>
          </tr>`).join('') || `<tr><td colspan="11" class="empty-row">No sales yet. Press <b>Add sale</b>.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="4"><b>Total</b></td><td class="r" id="lg-t-bags">${kes(c.soldBags)}</td><td></td><td class="r" id="lg-t-kg">${kes(c.soldKg)}</td><td class="r" id="lg-t-amt"><b>${kes(c.sales)}</b></td><td colspan="3" class="muted small" id="lg-t-unpaid">${c.unpaid ? 'Not yet paid: ' + kes(c.unpaid) : ''}</td></tr></tfoot>
      </table></div>`;
    $('lg-add').onclick = addSale;
    $('lg-unpaid').onchange = e => $('lg-sheet').querySelector('tbody').classList.toggle('only-unpaid', e.target.checked);
    $('lg-sheet').querySelectorAll('tr[data-id]').forEach(tr => {
      const r = L.sales.find(x => x.id === tr.dataset.id);
      let timer;
      const save = async () => {
        const patch = {};
        tr.querySelectorAll('[data-f]').forEach(el => {
          const f = el.dataset.f;
          let v = el.type === 'checkbox' ? el.checked : el.value.trim();
          if (['size_kg', 'bags', 'price_per_bag'].includes(f)) v = v === '' ? null : num(v);
          if (f === 'sold_on' && !v) v = today();
          if (JSON.stringify(v) !== JSON.stringify(r[f])) patch[f] = v;
        });
        if (!Object.keys(patch).length) return;
        patch.updated_at = new Date().toISOString();
        tr.classList.add('saving');
        const { error } = await db.from('rice_sales').update(patch).eq('id', r.id);
        tr.classList.remove('saving');
        if (error){ tr.classList.add('save-err'); toast('Not saved: ' + error.message); return; }
        tr.classList.remove('save-err');
        Object.assign(r, patch);
      };
      const recalc = () => {
        // Update this row's kg and amount and the totals as you type, before saving.
        const tmp = Object.assign({}, r);
        tr.querySelectorAll('[data-f]').forEach(el => { tmp[el.dataset.f] = el.type === 'checkbox' ? el.checked : (['size_kg', 'bags', 'price_per_bag'].includes(el.dataset.f) && el.value.trim() === '' ? null : el.value); });
        const list = L.sales.map(x => x === r ? tmp : x), cc = ledgerCalc(L.batch, list), i = L.sales.indexOf(r);
        tr.querySelector('[data-kg]').textContent = cc.rows[i].kg ? kes(cc.rows[i].kg) : '';
        tr.querySelector('[data-amt]').textContent = cc.rows[i].amount ? kes(cc.rows[i].amount) : '';
        tr.querySelector('[data-f=price_per_bag]').placeholder = cc.priceFor(tmp.size_kg) ? kes(cc.priceFor(tmp.size_kg)) : '';
        tr.classList.toggle('unpaid', !tmp.paid);
        $('lg-t-bags').textContent = kes(cc.soldBags);
        $('lg-t-kg').textContent = kes(cc.soldKg);
        $('lg-t-amt').innerHTML = `<b>${kes(cc.sales)}</b>`;
        $('lg-t-unpaid').textContent = cc.unpaid ? 'Not yet paid: ' + kes(cc.unpaid) : '';
        drawCards(cc);
      };
      tr.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener('input', () => { recalc(); clearTimeout(timer); timer = setTimeout(save, 700); });
        el.addEventListener('change', () => { recalc(); clearTimeout(timer); save(); });
      });
      tr.querySelector('[data-del]').onclick = async e => {
        const btn = e.currentTarget;
        if (!btn.classList.contains('armed')){ btn.classList.add('armed'); btn.textContent = 'Delete?'; setTimeout(() => { btn.classList.remove('armed'); btn.textContent = '✕'; }, 3500); return; }
        const { error } = await db.from('rice_sales').delete().eq('id', r.id);
        if (error){ toast(error.message); return; }
        L.sales = L.sales.filter(x => x !== r);
        drawSales(); drawCards();
        toast('Sale deleted');
      };
    });
  }

  async function addSale(fields){
    const row = Object.assign({ batch_id: L.batch.id, sold_on: today(), buyer: '', paid: false, notes: '' }, fields && fields.batch_id ? fields : {});
    const { data, error } = await db.from('rice_sales').insert([row]).select().single();
    if (error){ toast('Not added: ' + error.message); return null; }
    L.sales.push(data);
    drawSales(); drawCards();
    const tr = $('lg-sheet').querySelector(`tr[data-id="${data.id}"]`);
    if (tr){ tr.scrollIntoView({ block: 'nearest' }); tr.querySelector('[data-f=buyer]').focus(); }
    return data;
  }

  /* ----- Batch summary: the inputs and everything worked out from them ----- */
  function drawSummary(){
    const b = JSON.parse(JSON.stringify(L.batch));
    const line = (list, i, it) => `<div class="cost-line" data-list="${list}" data-i="${i}">
        <input data-k="label" value="${esc(it.label)}" placeholder="What it was for" aria-label="Cost">
        <input data-k="amount" class="r" inputmode="numeric" value="${esc(it.amount)}" aria-label="Amount">
        <button type="button" class="btn-text danger" data-rm title="Remove">✕</button></div>`;
    $('lg-sheet').innerHTML = `
      <form id="lg-form" class="lg-summary">
        <section class="panel-box lg-box">
          <h2>Batch</h2>
          <div class="fields">
            <label class="full">Name <input name="name" value="${esc(b.name)}" required></label>
            <label class="half">Started on <input type="date" name="started_on" value="${esc(b.started_on || '')}"></label>
            <label class="half">Status <select name="status"><option value="active"${b.status === 'active' ? ' selected' : ''}>Active</option><option value="closed"${b.status === 'closed' ? ' selected' : ''}>Closed (sold out / finished)</option></select></label>
            <label class="full">Notes <textarea name="notes" rows="2">${esc(b.notes)}</textarea></label>
          </div>
        </section>
        <section class="panel-box lg-box">
          <h2>1. Purchase</h2>
          <table class="sheet mini"><thead><tr><th>Bag size (kg)</th><th class="r">No. of bags</th><th class="r">Total kg</th><th></th></tr></thead>
            <tbody id="lg-sizes"></tbody>
            <tfoot><tr><td><b>Total</b></td><td class="r" data-o="totBags"></td><td class="r" data-o="totKg"></td><td></td></tr></tfoot></table>
          <button type="button" class="btn-text" id="lg-add-size">+ Add a bag size</button>
          <div class="kv"><label>Price of rice per kg <input name="price_kg" class="r" inputmode="numeric" value="${esc(b.price_kg)}"></label>
            <label>Price per empty sack/bag <input name="price_bag" class="r" inputmode="numeric" value="${esc(b.price_bag)}"></label></div>
        </section>
        <section class="panel-box lg-box">
          <h2>2. Costs</h2>
          <div class="kv-out"><span>Rice (total kg × price per kg)</span><b data-o="rice"></b></div>
          <div class="kv-out"><span>Bags (no. of bags × price per bag)</span><b data-o="bagsCost"></b></div>
          <div id="lg-costs">${b.costs.map((it, i) => line('costs', i, it)).join('')}</div>
          <button type="button" class="btn-text" data-add-line="costs">+ Add a cost</button>
          <div class="kv-out"><span>Selling trips (section 3)</span><b data-o="tripsTotal"></b></div>
          <div class="kv-out total"><span>TOTAL COST</span><b data-o="totalCost"></b></div>
        </section>
        <section class="panel-box lg-box">
          <h2>3. Selling trips</h2>
          <div class="kv"><label>Number of trips <input name="trips" class="r" inputmode="numeric" value="${esc(b.trips)}"></label></div>
          <p class="muted small">Cost of one trip:</p>
          <div id="lg-trip-costs">${b.trip_costs.map((it, i) => line('trip_costs', i, it)).join('')}</div>
          <button type="button" class="btn-text" data-add-line="trip_costs">+ Add a trip cost</button>
          <div class="kv-out"><span>Cost per trip</span><b data-o="tripCost"></b></div>
          <div class="kv-out total"><span>Total cost of all trips</span><b data-o="tripsTotal"></b></div>
        </section>
        <section class="panel-box lg-box wide">
          <h2>4. Pricing</h2>
          <div class="kv three"><label>Profit target <input name="target" class="r" inputmode="numeric" value="${esc(b.target)}"></label>
            <div class="kv-out"><span>Break-even price per kg</span><b data-o="beKg"></b></div>
            <div class="kv-out"><span>Price per kg to hit target</span><b data-o="tgKg"></b></div></div>
          <div class="sheet-wrap"><table class="sheet mini"><thead><tr><th>Bag</th><th class="r">Break-even</th><th class="r">At target</th><th class="r">Your price</th><th class="r">No. of bags</th><th class="r">Expected sales</th></tr></thead>
            <tbody id="lg-pricing"></tbody>
            <tfoot><tr><td colspan="5"><b>If all bags sell at your price: expected sales</b></td><td class="r" data-o="expTotal"></td></tr>
              <tr><td colspan="5"><b>Expected profit</b></td><td class="r" data-o="expProfit"></td></tr></tfoot></table></div>
        </section>
        <div class="lg-save">
          <button type="button" class="btn-text danger" id="lg-del-batch">Delete batch</button>
          <span class="spacer"></span>
          <span class="muted small" id="lg-dirty"></span>
          <button type="submit" class="btn btn-sm btn-navy">Save batch</button>
        </div>
      </form>`;
    const f = $('lg-form');
    const read = () => {
      b.name = f.name.value.trim(); b.started_on = f.started_on.value || null; b.status = f.status.value; b.notes = f.notes.value.trim();
      b.price_kg = num(f.price_kg.value); b.price_bag = num(f.price_bag.value); b.trips = Math.round(num(f.trips.value)); b.target = num(f.target.value);
      b.sizes = [...f.querySelectorAll('#lg-sizes tr')].map((tr, i) => {
        const pr = f.querySelector(`#lg-pricing [data-price="${i}"]`);
        return { size: num(tr.querySelector('[data-s=size]').value), bags: num(tr.querySelector('[data-s=bags]').value), price: num(pr ? pr.value : 0) };
      });
      ['costs', 'trip_costs'].forEach(list => {
        b[list] = [...f.querySelectorAll(`.cost-line[data-list="${list}"]`)].map(el => ({ label: el.querySelector('[data-k=label]').value.trim(), amount: num(el.querySelector('[data-k=amount]').value) }));
      });
    };
    const out = () => {
      const c = ledgerCalc(b, L.sales);
      const set = (k, v) => f.querySelectorAll(`[data-o="${k}"]`).forEach(el => { el.textContent = v; });
      c.sizes.forEach((s, i) => set('kg' + i, kes(s.size * s.bags)));
      set('totBags', kes(c.totBags)); set('totKg', kes(c.totKg)); set('rice', kes(c.rice)); set('bagsCost', kes(c.bagsCost));
      set('tripCost', kes(c.tripCost)); set('tripsTotal', kes(c.tripsTotal)); set('totalCost', kes(c.totalCost));
      set('beKg', kes2(c.beKg)); set('tgKg', kes2(c.tgKg)); set('expTotal', kes(c.expTotal)); set('expProfit', kes(c.expProfit));
      c.sizes.forEach((s, i) => { set('lbl' + i, `${s.size} kg bag`); set('be' + i, kes(s.size * c.beKg)); set('tg' + i, kes(s.size * c.tgKg)); set('nb' + i, kes(s.bags)); set('ex' + i, kes(s.price * s.bags)); });
    };
    // Bag sizes appear twice: purchase (size, bags) and pricing (your price). Both are drawn from b.sizes.
    const renderSizes = () => {
      $('lg-sizes').innerHTML = b.sizes.map((s, i) => `<tr data-i="${i}"><td><input data-s="size" inputmode="numeric" value="${esc(s.size)}" aria-label="Bag size in kg"></td>
        <td><input data-s="bags" class="r" inputmode="numeric" value="${esc(s.bags)}" aria-label="Number of bags"></td><td class="r calc" data-o="kg${i}"></td>
        <td><button type="button" class="btn-text danger" data-rm-size title="Remove this bag size">✕</button></td></tr>`).join('');
      $('lg-pricing').innerHTML = b.sizes.map((s, i) => `<tr><td data-o="lbl${i}"></td><td class="r calc" data-o="be${i}"></td><td class="r calc" data-o="tg${i}"></td>
        <td><input data-price="${i}" class="r" inputmode="numeric" value="${esc(s.price)}" aria-label="Your price"></td><td class="r calc" data-o="nb${i}"></td><td class="r calc" data-o="ex${i}"></td></tr>`).join('');
      wire();
    };
    const changed = () => { read(); out(); L.dirty = true; $('lg-dirty').textContent = 'Unsaved changes'; };
    const wire = () => {
      f.querySelectorAll('input,select,textarea').forEach(el => { el.oninput = changed; });
      f.querySelectorAll('[data-rm]').forEach(btn => { btn.onclick = () => { btn.parentElement.remove(); changed(); }; });
      f.querySelectorAll('[data-rm-size]').forEach(btn => { btn.onclick = () => {
        read(); b.sizes.splice(+btn.closest('tr').dataset.i, 1); renderSizes(); changed();
      }; });
    };
    f.querySelectorAll('[data-add-line]').forEach(btn => { btn.onclick = () => {
      const list = btn.dataset.addLine, box = list === 'costs' ? $('lg-costs') : $('lg-trip-costs');
      box.insertAdjacentHTML('beforeend', line(list, box.children.length, { label: '', amount: '' }));
      wire(); box.lastElementChild.querySelector('input').focus(); changed();
    }; });
    $('lg-add-size').onclick = () => {
      read(); b.sizes.push({ size: '', bags: '', price: '' }); renderSizes(); changed();
      $('lg-sizes').lastElementChild.querySelector('input').focus();
    };
    f.onsubmit = async e => {
      e.preventDefault();
      read();
      if (!b.name){ toast('Give the batch a name'); return; }
      if (b.sizes.some(s => !s.size)){ toast('Every bag size needs a size in kg'); return; }
      const patch = { name: b.name, started_on: b.started_on, status: b.status, notes: b.notes, sizes: b.sizes, price_kg: b.price_kg,
        price_bag: b.price_bag, costs: b.costs.filter(x => x.label || x.amount), trips: b.trips,
        trip_costs: b.trip_costs.filter(x => x.label || x.amount), target: b.target, updated_at: new Date().toISOString() };
      const { data, error } = await db.from('rice_batches').update(patch).eq('id', L.batch.id).select().single();
      if (error){ toast('Not saved: ' + error.message); return; }
      L.dirty = false;
      toast('Batch saved');
      refresh();
    };
    $('lg-del-batch').onclick = async () => {
      const btn = $('lg-del-batch');
      if (!armed(btn)) return;
      const { error } = await db.from('rice_batches').delete().eq('id', L.batch.id);
      if (error){ toast(error.message); return; }
      try { localStorage.removeItem('kanam_batch'); } catch (e) {}
      L.dirty = false;
      toast('Batch deleted');
      refresh();
    };
    renderSizes(); out();
    L.dirty = false;
  }

  /* ----- Sales progress ----- */
  function drawProgress(){
    const b = L.batch, c = ledgerCalc(b, L.sales);
    $('lg-sheet').innerHTML = `
      <div class="lg-summary">
        <section class="panel-box lg-box wide">
          <h2>5. Sales progress</h2>
          <div class="sheet-wrap"><table class="sheet mini"><thead><tr><th>Bag size</th><th class="r">Bags bought</th><th class="r">Bags sold</th><th class="r">Bags left</th><th class="r">Sales so far</th></tr></thead>
            <tbody>${c.bySize.map(s => `<tr><td>${s.size} kg bags</td><td class="r">${kes(s.sold + s.left)}</td><td class="r">${kes(s.sold)}</td><td class="r${s.left < 0 ? ' neg' : ''}">${kes(s.left)}</td><td class="r">${kes(s.amount)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td><b>Total</b></td><td class="r">${kes(c.totBags)}</td><td class="r">${kes(c.soldBags)}</td><td class="r">${kes(c.totBags - c.soldBags)}</td><td class="r"><b>${kes(c.sales)}</b></td></tr></tfoot></table></div>
        </section>
        <section class="panel-box lg-box">
          <h2>Against costs and target</h2>
          <div class="kv-out"><span>Total cost</span><b>${kes(c.totalCost)}</b></div>
          <div class="kv-out"><span>Profit target</span><b>${kes(b.target)}</b></div>
          <div class="kv-out"><span>Money still to recover</span><b>${kes(c.recover)}</b></div>
          <div class="kv-out total"><span>Profit so far</span><b class="${c.profit < 0 ? 'neg' : 'pos'}">${kes(c.profit)}</b></div>
          <div class="kv-out"><span>Still needed to reach target</span><b>${kes(c.needed)}</b></div>
          <p class="lg-status-line">${esc(c.status)}</p>
        </section>
        <section class="panel-box lg-box">
          <h2>Other figures</h2>
          <div class="kv-out"><span>Total kg sold</span><b>${kes(c.soldKg)} of ${kes(c.totKg)}</b></div>
          <div class="kv-out"><span>Not yet paid</span><b>${kes(c.unpaid)}</b></div>
          <div class="kv-out"><span>Average price per kg so far</span><b>${c.soldKg ? kes2(c.sales / c.soldKg) : '–'}</b></div>
          <div class="kv-out"><span>Break-even price per kg</span><b>${kes2(c.beKg)}</b></div>
          <div class="kv-out"><span>Number of sales</span><b>${L.sales.length}</b></div>
        </section>
      </div>`;
  }

  async function newBatch(){
    if (L.dirty && !confirmLeave()) return;
    const from = L.batch;
    const row = from ? { name: `Batch ${L.batches.length + 1}`, started_on: today(), sizes: from.sizes, price_kg: from.price_kg, price_bag: from.price_bag,
        costs: from.costs, trips: from.trips, trip_costs: from.trip_costs, target: from.target }
      : { name: 'Batch 1', started_on: today(), sizes: [{ size: 5, bags: 0, price: 0 }, { size: 10, bags: 0, price: 0 }, { size: 25, bags: 0, price: 0 }] };
    const { data, error } = await db.from('rice_batches').insert([row]).select().single();
    if (error){ toast('Not created: ' + error.message); return; }
    try { localStorage.setItem('kanam_batch', data.id); localStorage.setItem('kanam_sheet', 'summary'); } catch (e) {}
    toast(from ? `${data.name} created with the same costs as ${from.name}. Change what's different.` : 'Batch created');
    refresh();
  }

  // The batch as an Excel workbook (values), laid out like the original.
  async function downloadLedger(){
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const b = L.batch, c = ledgerCalc(b, L.sales);
      const S = [[`Pishori Trading Ledger – ${b.name}`], ['All amounts in KES. Downloaded from the Kanam portal ' + day(new Date())], [],
        ['1. Purchase'], ['', 'Bag size (kg)', 'No. of bags', 'Total kg'],
        ...c.sizes.map(s => [`Bags of ${s.size} kg`, s.size, s.bags, s.size * s.bags]), ['Total', '', c.totBags, c.totKg],
        ['Price of rice per kg', num(b.price_kg)], ['Price per empty sack/bag', num(b.price_bag)], [],
        ['2. Costs', 'Amount'], ['Rice (total kg × price per kg)', c.rice], ['Bags (no. of bags × price per bag)', c.bagsCost],
        ...b.costs.map(x => [x.label, num(x.amount)]), ['Selling trips', c.tripsTotal], ['TOTAL COST', c.totalCost], [],
        ['3. Selling trips'], ['Number of trips', num(b.trips)], ...b.trip_costs.map(x => [x.label + ' per trip', num(x.amount)]),
        ['Cost per trip', c.tripCost], ['Total cost of all trips', c.tripsTotal], [],
        ['4. Pricing'], ['Profit target', num(b.target)], ['Break-even price per kg', +c.beKg.toFixed(2)], ['Price per kg to hit profit target', +c.tgKg.toFixed(2)], [],
        ['Bag', 'Break-even', 'At target', 'Your price', 'No. of bags', 'Expected sales'],
        ...c.sizes.map(s => [`${s.size} kg bag`, Math.round(s.size * c.beKg), Math.round(s.size * c.tgKg), s.price, s.bags, s.price * s.bags]),
        ['Expected total sales', c.expTotal], ['Expected profit', c.expProfit], [],
        ['5. Sales progress'], ['', 'Bags sold', 'Bags left', 'Sales so far'], ...c.bySize.map(s => [`${s.size} kg bags`, s.sold, s.left, s.amount]),
        ['Total', c.soldBags, c.totBags - c.soldBags, c.sales], [],
        ['Money still to recover before break-even', c.recover], ['Profit so far', c.profit], ['Still needed to reach profit target', c.needed], ['Status', c.status]];
      const G = [['Date', 'Buyer', 'Bag size (kg)', 'No. of bags', 'Price per bag', 'Total kg', 'Amount (KES)', 'Paid?', 'Notes'],
        ...L.sales.map((r, i) => [r.sold_on, r.buyer, r.size_kg, r.bags, r.price_per_bag != null ? num(r.price_per_bag) : c.priceFor(r.size_kg), c.rows[i].kg, c.rows[i].amount, r.paid ? 'Yes' : 'No', r.notes]),
        [], ['Total', '', '', c.soldBags, '', c.soldKg, c.sales]];
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet(S); ws1['!cols'] = [{ wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 15 }];
      const ws2 = XLSX.utils.aoa_to_sheet(G); ws2['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'Batch Summary');
      XLSX.utils.book_append_sheet(wb, ws2, 'Sales Log');
      XLSX.writeFile(wb, `Kanam rice ledger - ${fileSafe(b.name)}.xlsx`);
    } catch (err){ toast('Download failed: ' + err.message); }
  }

  // From an inquiry: put a rice order straight into the active batch's sales log.
  async function inquiryToLedger(i){
    const { data: b, error } = await db.from('rice_batches').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error && missingTable(error)){ toast('Run sql/04-ledger.sql first'); return; }
    if (error || !b){ toast('There is no active batch in the Rice ledger'); return; }
    const size = num((String(i.product || '').match(/(\d+)\s*kg/i) || [])[1]) || null;
    const bags = num(String(i.quantity || '').match(/\d+/)) || null;
    const { error: e2 } = await db.from('rice_sales').insert([{ batch_id: b.id, sold_on: today(), buyer: i.name + (i.phone ? ' (' + i.phone + ')' : ''),
      size_kg: size, bags, paid: false, notes: 'From website order' + (i.message ? ': ' + i.message.slice(0, 120) : '') }]);
    if (e2){ toast('Not added: ' + e2.message); return; }
    toast(`Added to ${b.name}. Check the price and tick Paid when you're paid.`);
  }

  /* ---------------- Road works ledger (projects and their daily costs) ---------------- */
  // A project is one road / contract. Every cost is a line in the daily log
  // (quantity × price). "Add a work day", "Add a murram day" and "Add bush
  // clearing" put in the project's standard lines, so only what's different
  // that day needs changing. Payments from the client lose withholding tax.
  const ROAD_CATS = ['Probox', 'Crew', 'Grader fuel', 'Grader upkeep', 'Security', 'Bush clearing', 'Murram pit', 'Lorries', 'Lorry fuel', 'Excavator', 'Excavator fuel', 'Other'];
  const ROAD_DAYS = [['day', 'Work day'], ['murram', 'Murram day'], ['clearing', 'Bush clearing']];
  const ROAD_TEMPLATES = {
    day: [
      { category: 'Probox', item: 'Fuel – Probox KCL 106K', unit: 'litres', qty: '', price: '', fuel: 'petrol' },
      { category: 'Crew', item: 'Operator allowance', unit: '', qty: 1, price: 5000, fuel: '' },
      { category: 'Crew', item: 'Turn boy allowance', unit: '', qty: 1, price: 5000, fuel: '' },
      { category: 'Crew', item: 'Coordinator allowance', unit: '', qty: 1, price: 2000, fuel: '' },
      { category: 'Crew', item: 'Driver / site boss allowance', unit: '', qty: 1, price: 2000, fuel: '' },
      { category: 'Crew', item: 'Guest allowance (set to 1 when someone comes)', unit: '', qty: 0, price: 2000, fuel: '' },
      { category: 'Crew', item: 'Lunch for the crew', unit: '', qty: 1, price: 1000, fuel: '' },
      { category: 'Grader fuel', item: 'Diesel for the grader (jerricans)', unit: 'litres', qty: '', price: '', fuel: 'diesel' },
      { category: 'Security', item: 'Night security for the grader', unit: '', qty: 1, price: '', fuel: '' }
    ],
    murram: [
      { category: 'Murram pit', item: 'Murram', unit: 'trips', qty: '', price: '', fuel: '' },
      { category: 'Lorries', item: 'Lorry hire', unit: 'lorries', qty: 10, price: '', fuel: '' },
      { category: 'Lorries', item: 'Lunch for lorry drivers and turn boys', unit: 'people', qty: 20, price: 100, fuel: '' },
      { category: 'Lorries', item: 'Extra lunch for the lead driver', unit: '', qty: 1, price: 100, fuel: '' },
      { category: 'Lorry fuel', item: 'Diesel for the lorries (all lorries)', unit: 'litres', qty: '', price: '', fuel: 'diesel' },
      { category: 'Excavator', item: 'Excavator hire', unit: 'hours', qty: '', price: '', fuel: '' },
      { category: 'Excavator', item: 'Lunch for the excavator operator', unit: '', qty: 1, price: 200, fuel: '' },
      { category: 'Excavator fuel', item: 'Diesel for the excavator', unit: 'litres', qty: '', price: '', fuel: 'diesel' }
    ],
    clearing: [
      { category: 'Bush clearing', item: 'Workers clearing bushes / waterways', unit: 'people', qty: '', price: '', fuel: '' }
    ]
  };
  const roadTemplates = p => {
    const t = p.templates || {}, o = {};
    ROAD_DAYS.forEach(([k]) => { o[k] = Array.isArray(t[k]) ? t[k] : ROAD_TEMPLATES[k]; });
    return o;
  };
  const numOrNull = v => v == null || String(v).trim() === '' ? null : num(v);
  const fuelPrice = (p, fuel) => fuel === 'diesel' ? num(p.diesel_price) : fuel === 'petrol' ? num(p.petrol_price) : 0;
  const longDay = iso => iso ? new Date(iso + 'T00:00').toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';

  function roadCalc(p, costs){
    const c = { byCat: {}, byDay: {} };
    costs = costs || [];
    c.rows = costs.map(r => num(r.qty) * num(r.price));
    c.spent = c.rows.reduce((t, a) => t + a, 0);
    costs.forEach((r, i) => {
      c.byCat[r.category] = (c.byCat[r.category] || 0) + c.rows[i];
      c.byDay[r.spent_on] = (c.byDay[r.spent_on] || 0) + c.rows[i];
    });
    c.days = Object.keys(c.byDay).length;
    c.trips = costs.filter(r => r.category === 'Murram pit').reduce((t, r) => t + num(r.qty), 0);
    c.pays = (p.payments || []).map(x => {
      const gross = num(x.gross), rate = x.rate == null || x.rate === '' ? num(p.wht_rate) : num(x.rate), wht = gross * rate / 100;
      return { gross, rate, wht, net: gross - wht };
    });
    c.gross = c.pays.reduce((t, x) => t + x.gross, 0);
    c.wht = c.pays.reduce((t, x) => t + x.wht, 0);
    c.net = c.gross - c.wht;
    c.contract = num(p.contract_amount);
    c.contractWht = c.contract * num(p.wht_rate) / 100;
    c.contractNet = c.contract - c.contractWht;
    c.owed = Math.max(0, c.contract - c.gross);
    c.expProfit = c.contractNet - c.spent;
    c.cash = c.net - c.spent;
    c.status = !c.contract ? 'Enter the contract amount under Project' : c.expProfit < 0 ? 'Costs are more than the contract pays'
      : c.owed ? 'Waiting for payment' : 'Paid in full';
    return c;
  }

  // For the dashboard: the newest active project.
  async function roadStatus(){
    try {
      const { data: p, error } = await byCo(db.from('road_projects').select('*').eq('status', 'active')).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error || !p) return null;
      const { data: costs } = await db.from('road_costs').select('spent_on,category,qty,price').eq('project_id', p.id);
      return { p, c: roadCalc(p, costs || []) };
    } catch (e){ return null; }
  }

  let R = { projects: [], project: null, costs: [], sheet: 'log', cat: '', date: '', dirty: false };
  const sortCosts = () => R.costs.sort((a, b) => String(a.spent_on).localeCompare(String(b.spent_on)) || String(a.created_at).localeCompare(String(b.created_at)));
  const confirmLeaveRoad = () => window.confirm('You have unsaved changes to the project. Leave without saving?');

  VIEWS.roads = async main => {
    const { data, error } = await byCo(db.from('road_projects').select('*')).order('created_at', { ascending: false });
    if (error){
      if (!missingTable(error)) throw error;
      main.innerHTML = `<div class="p-head"><h1>Road works ledger</h1></div>
        <p class="empty">One more step: run <code>sql/06-roads.sql</code> in the Supabase SQL editor, then reload this page.</p>`;
      return;
    }
    R.projects = data || [];
    let want = null;
    try { want = localStorage.getItem('kanam_road'); } catch (e) {}
    R.project = R.projects.find(p => p.id === want) || R.projects.find(p => p.status === 'active') || R.projects[0] || null;
    try { R.sheet = localStorage.getItem('kanam_road_sheet') || 'log'; } catch (e) {}
    R.dirty = false;
    main.innerHTML = `
      <div class="p-head">
        <h1>Road works ledger${coLabel()}</h1>
        <div class="p-tools">
          <select id="rd-project" aria-label="Project">${R.projects.map(p => `<option value="${p.id}"${R.project && p.id === R.project.id ? ' selected' : ''}>${esc(p.name)}${p.status === 'closed' ? ' (closed)' : ''}</option>`).join('')}</select>
          <button class="btn btn-sm btn-quiet" type="button" id="rd-new">New project</button>
          <button class="btn btn-sm btn-quiet" type="button" id="rd-xlsx"${R.project ? '' : ' disabled'}>Download Excel</button>
        </div>
      </div>
      <div id="rd-body"></div>`;
    $('rd-project').onchange = () => {
      if (R.dirty && !confirmLeaveRoad()) { $('rd-project').value = R.project.id; return; }
      try { localStorage.setItem('kanam_road', $('rd-project').value); } catch (e) {}
      refresh();
    };
    $('rd-new').onclick = newRoadProject;
    $('rd-xlsx').onclick = downloadRoads;
    if (!R.project){
      $('rd-body').innerHTML = '<p class="empty">No road projects yet. Press <b>New project</b> to start one.</p>';
      return;
    }
    const s = await db.from('road_costs').select('*').eq('project_id', R.project.id).order('spent_on').order('created_at');
    if (s.error) throw s.error;
    R.costs = s.data || [];
    $('rd-body').innerHTML = `
      <div class="stat-cards lg-cards" id="rd-cards"></div>
      <div class="sheet-tabs" role="tablist">
        ${[['log', 'Daily log'], ['summary', 'Project'], ['progress', 'Costs & money']].map(([k, t]) =>
          `<button type="button" role="tab" data-sheet="${k}" aria-selected="${R.sheet === k}">${t}</button>`).join('')}
      </div>
      <div id="rd-sheet"></div>`;
    $('rd-body').querySelectorAll('[data-sheet]').forEach(b => { b.onclick = () => {
      if (R.dirty && !confirmLeaveRoad()) return;
      R.sheet = b.dataset.sheet;
      R.dirty = false;
      try { localStorage.setItem('kanam_road_sheet', R.sheet); } catch (e) {}
      $('rd-body').querySelectorAll('[data-sheet]').forEach(x => x.setAttribute('aria-selected', x === b));
      drawRoadSheet();
    }; });
    drawRoadCards();
    drawRoadSheet();
  };

  function drawRoadCards(c){
    c = c || roadCalc(R.project, R.costs);
    $('rd-cards').innerHTML = `
      <div class="stat-card static"><b>${kes(c.spent)}</b><span>Spent so far (KES)</span></div>
      <div class="stat-card static"><b>${kes(c.net)}</b><span>Received, after WHT</span></div>
      <div class="stat-card static ${c.owed ? 'warn' : ''}"><b>${kes(c.owed)}</b><span>Still owed by ${esc(R.project.client || 'the client')}</span></div>
      <div class="stat-card static ${c.contract && c.expProfit >= 0 ? 'good' : ''}"><b class="${c.contract && c.expProfit < 0 ? 'neg' : ''}">${c.contract ? kes(c.expProfit) : '–'}</b><span>Expected profit</span></div>
      <div class="stat-card static"><b>${c.days}</b><span>Days worked${c.trips ? ` · ${kes(c.trips)} murram trips` : ''}</span></div>`;
  }
  function drawRoadSheet(){
    ({ log: drawRoadLog, summary: drawRoadSummary, progress: drawRoadProgress })[R.sheet in { log: 1, summary: 1, progress: 1 } ? R.sheet : 'log']();
  }
  const catOpts = v => ROAD_CATS.concat(v && !ROAD_CATS.includes(v) ? [v] : []).map(k => `<option${k === v ? ' selected' : ''}>${esc(k)}</option>`).join('');

  /* ----- Daily log: edit in place, each row saves itself ----- */
  function drawRoadLog(){
    const p = R.project;
    const list = R.costs.filter(r => !R.cat || r.category === R.cat), c = roadCalc(p, list);
    let lastDay = null, body = '';
    list.forEach((r, i) => {
      if (r.spent_on !== lastDay){
        lastDay = r.spent_on;
        body += `<tr class="day-row"><td colspan="6"><b>${esc(longDay(r.spent_on))}</b></td><td class="r" data-day="${esc(r.spent_on)}"><b>${kes(c.byDay[r.spent_on])}</b></td><td colspan="2"></td></tr>`;
      }
      body += `
        <tr data-id="${r.id}">
          <td><input type="date" data-f="spent_on" value="${esc(r.spent_on || '')}"></td>
          <td><select data-f="category">${catOpts(r.category)}</select></td>
          <td><input data-f="item" value="${esc(r.item)}" placeholder="What it was for"></td>
          <td><input data-f="qty" inputmode="decimal" class="r" value="${r.qty == null ? '' : esc(r.qty)}"></td>
          <td><input data-f="unit" value="${esc(r.unit)}"></td>
          <td><input data-f="price" inputmode="decimal" class="r" value="${r.price == null ? '' : esc(r.price)}"></td>
          <td class="r calc" data-amt>${c.rows[i] ? kes(c.rows[i]) : ''}</td>
          <td><input data-f="notes" value="${esc(r.notes)}"></td>
          <td><button type="button" class="btn-text danger" data-del title="Delete this line">✕</button></td>
        </tr>`;
    });
    $('rd-sheet').innerHTML = `
      <div class="p-head lg-sub">
        <p class="muted small">Pick the day, then add its standard lines and change what's different (fill in the yellow boxes left empty). Amount = quantity × price. Each row saves itself.</p>
        <div class="p-tools">
          <select id="rd-cat" aria-label="Show category"><option value="">All categories</option>${ROAD_CATS.map(k => `<option${k === R.cat ? ' selected' : ''}>${k}</option>`).join('')}</select>
        </div>
      </div>
      <div class="rd-add">
        <label class="small">Day <input type="date" id="rd-date" value="${R.date || today()}"></label>
        ${ROAD_DAYS.map(([k, t]) => `<button class="btn btn-sm btn-navy" type="button" data-add-day="${k}">Add ${t.toLowerCase()}</button>`).join('')}
        <button class="btn btn-sm btn-quiet" type="button" id="rd-add-one">Add one cost</button>
      </div>
      <div class="sheet-wrap"><table class="sheet road-sheet">
        <thead><tr><th>Date</th><th>Category</th><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Price</th><th class="r">Amount</th><th>Notes</th><th></th></tr></thead>
        <tbody>${body || `<tr><td colspan="9" class="empty-row">${R.costs.length ? 'Nothing in this category.' : 'No costs yet. Pick the day and press <b>Add work day</b>.'}</td></tr>`}</tbody>
        <tfoot><tr><td colspan="6"><b>Total${R.cat ? ' – ' + esc(R.cat) : ''}</b></td><td class="r" id="rd-t-amt"><b>${kes(c.spent)}</b></td><td colspan="2"></td></tr></tfoot>
      </table></div>`;
    $('rd-cat').onchange = e => { R.cat = e.target.value; drawRoadLog(); };
    $('rd-date').onchange = e => { R.date = e.target.value; };
    $('rd-sheet').querySelectorAll('[data-add-day]').forEach(b => { b.onclick = () => addRoadLines(b.dataset.addDay); });
    $('rd-add-one').onclick = () => addRoadLines(null);
    $('rd-sheet').querySelectorAll('tr[data-id]').forEach(tr => {
      const r = R.costs.find(x => x.id === tr.dataset.id);
      let timer;
      const value = el => ['qty', 'price'].includes(el.dataset.f) ? numOrNull(el.value) : el.value.trim();
      const save = async () => {
        const patch = {};
        tr.querySelectorAll('[data-f]').forEach(el => {
          let v = value(el);
          if (el.dataset.f === 'spent_on' && !v) v = today();
          if (JSON.stringify(v) !== JSON.stringify(r[el.dataset.f])) patch[el.dataset.f] = v;
        });
        if (!Object.keys(patch).length) return;
        patch.updated_at = new Date().toISOString();
        tr.classList.add('saving');
        const { error } = await db.from('road_costs').update(patch).eq('id', r.id);
        tr.classList.remove('saving');
        if (error){ tr.classList.add('save-err'); toast('Not saved: ' + error.message); return; }
        tr.classList.remove('save-err');
        Object.assign(r, patch);
        // A line moved to another day or category: put it in its place.
        if ('spent_on' in patch || ('category' in patch && R.cat)){ sortCosts(); drawRoadLog(); }
      };
      const recalc = () => {
        // Update this row's amount, the day and the totals as you type, before saving.
        const tmp = Object.assign({}, r);
        tr.querySelectorAll('[data-f]').forEach(el => { tmp[el.dataset.f] = value(el); });
        tmp.spent_on = r.spent_on;
        const all = R.costs.map(x => x === r ? tmp : x), cc = roadCalc(R.project, all.filter(x => !R.cat || x.category === R.cat));
        const amt = num(tmp.qty) * num(tmp.price);
        tr.querySelector('[data-amt]').textContent = amt ? kes(amt) : '';
        $('rd-sheet').querySelectorAll('[data-day]').forEach(td => { td.innerHTML = `<b>${kes(cc.byDay[td.dataset.day])}</b>`; });
        $('rd-t-amt').innerHTML = `<b>${kes(cc.spent)}</b>`;
        drawRoadCards(roadCalc(R.project, all));
      };
      tr.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener('input', () => { recalc(); clearTimeout(timer); timer = setTimeout(save, 700); });
        el.addEventListener('change', () => { recalc(); clearTimeout(timer); save(); });
      });
      tr.querySelector('[data-del]').onclick = async e => {
        const btn = e.currentTarget;
        if (!btn.classList.contains('armed')){ btn.classList.add('armed'); btn.textContent = 'Delete?'; setTimeout(() => { btn.classList.remove('armed'); btn.textContent = '✕'; }, 3500); return; }
        const { error } = await db.from('road_costs').delete().eq('id', r.id);
        if (error){ toast(error.message); return; }
        R.costs = R.costs.filter(x => x !== r);
        drawRoadLog(); drawRoadCards();
        toast('Line deleted');
      };
    });
  }

  async function addRoadLines(kind){
    const p = R.project, on = ($('rd-date') && $('rd-date').value) || today();
    const lines = kind ? roadTemplates(p)[kind] : [{ category: R.cat || 'Other', item: '', unit: '', qty: '', price: '', fuel: '' }];
    if (!lines.length){ toast('This standard day has no lines. Add them under Project.'); return; }
    const rows = lines.map(t => ({ project_id: p.id, spent_on: on, category: t.category || 'Other', item: t.item || '', unit: t.unit || '',
      qty: numOrNull(t.qty), price: t.fuel ? (fuelPrice(p, t.fuel) || null) : numOrNull(t.price), notes: '' }));
    const { data, error } = await db.from('road_costs').insert(rows).select();
    if (error){ toast('Not added: ' + error.message); return; }
    R.costs.push(...data);
    sortCosts();
    if (R.cat && data.some(r => r.category !== R.cat)) R.cat = '';
    drawRoadLog(); drawRoadCards();
    // Go to the first new line that still needs a number.
    const first = data.find(r => r.qty == null || r.price == null) || data[0];
    const tr = $('rd-sheet').querySelector(`tr[data-id="${first.id}"]`);
    if (tr){ tr.scrollIntoView({ block: 'center' }); tr.querySelector(first.qty == null ? '[data-f=qty]' : first.price == null ? '[data-f=price]' : '[data-f=item]').focus(); }
    const missingFuel = lines.some(t => t.fuel && !fuelPrice(p, t.fuel));
    toast(kind ? `${data.length} lines added for ${longDay(on)}${missingFuel ? '. Tip: set fuel prices under Project' : ''}` : 'Line added');
  }

  /* ----- Project: contract, payments, fuel prices and the standard days ----- */
  function drawRoadSummary(){
    const p = JSON.parse(JSON.stringify(R.project));
    p.templates = JSON.parse(JSON.stringify(roadTemplates(R.project)));
    p.payments = p.payments || [];
    const payRow = (x, i) => `<tr data-i="${i}">
        <td><input type="date" data-p="date" value="${esc(x.date || '')}" aria-label="Date paid"></td>
        <td><input data-p="label" value="${esc(x.label)}" placeholder="e.g. Certificate 1" aria-label="What it was"></td>
        <td><input data-p="gross" class="r" inputmode="decimal" value="${esc(x.gross)}" aria-label="Amount before WHT"></td>
        <td><input data-p="rate" class="r" inputmode="decimal" value="${esc(x.rate)}" aria-label="WHT %"></td>
        <td class="r calc" data-o="pw${i}"></td><td class="r calc" data-o="pn${i}"></td>
        <td><button type="button" class="btn-text danger" data-rm-pay title="Remove">✕</button></td></tr>`;
    const tRow = (kind, t, i) => `<tr data-kind="${kind}" data-i="${i}">
        <td><select data-t="category" aria-label="Category">${catOpts(t.category)}</select></td>
        <td><input data-t="item" value="${esc(t.item)}" placeholder="What it is for" aria-label="Item"></td>
        <td><input data-t="qty" class="r" inputmode="decimal" value="${esc(t.qty)}" aria-label="Quantity"></td>
        <td><input data-t="unit" value="${esc(t.unit)}" aria-label="Unit"></td>
        <td><select data-t="fuel" aria-label="Price"><option value="">Fixed price</option><option value="diesel"${t.fuel === 'diesel' ? ' selected' : ''}>Diesel price</option><option value="petrol"${t.fuel === 'petrol' ? ' selected' : ''}>Petrol price</option></select></td>
        <td><input data-t="price" class="r" inputmode="decimal" value="${t.fuel ? '' : esc(t.price)}"${t.fuel ? ' disabled' : ''} aria-label="Price"></td>
        <td><button type="button" class="btn-text danger" data-rm-t title="Remove">✕</button></td></tr>`;
    $('rd-sheet').innerHTML = `
      <form id="rd-form" class="lg-summary">
        <section class="panel-box lg-box">
          <h2>Project</h2>
          <div class="fields">
            <label class="full">Name <input name="name" value="${esc(p.name)}" required placeholder="e.g. Kanyamedha–Ombeyi road"></label>
            <label class="half">Client <input name="client" value="${esc(p.client)}"></label>
            <label class="half">Started on <input type="date" name="started_on" value="${esc(p.started_on || '')}"></label>
            <label class="half">Status <select name="status"><option value="active"${p.status === 'active' ? ' selected' : ''}>Active</option><option value="closed"${p.status === 'closed' ? ' selected' : ''}>Closed (finished and paid)</option></select></label>
            <label class="full">Notes <textarea name="notes" rows="2">${esc(p.notes)}</textarea></label>
          </div>
        </section>
        <section class="panel-box lg-box">
          <h2>Contract</h2>
          <div class="kv"><label>Contract amount <input name="contract_amount" class="r" inputmode="decimal" value="${esc(p.contract_amount)}"></label>
            <label>Withholding tax (%) <input name="wht_rate" class="r" inputmode="decimal" value="${esc(p.wht_rate)}"></label></div>
          <div class="kv-out"><span>Withholding tax on the whole contract</span><b data-o="contractWht"></b></div>
          <div class="kv-out total"><span>You will receive</span><b data-o="contractNet"></b></div>
          <p class="muted small">Withholding tax is held back by the client and paid to KRA for you; keep the WHT certificates, they count against the company's income tax.</p>
          <h2>Fuel prices (per litre)</h2>
          <div class="kv"><label>Diesel (grader, lorries, excavator) <input name="diesel_price" class="r" inputmode="decimal" value="${esc(p.diesel_price)}"></label>
            <label>Petrol (Probox) <input name="petrol_price" class="r" inputmode="decimal" value="${esc(p.petrol_price)}"></label></div>
          <p class="muted small">Used for fuel lines added from now on. Lines already in the log keep their price.</p>
        </section>
        <section class="panel-box lg-box wide">
          <h2>Payments from the client</h2>
          <div class="sheet-wrap"><table class="sheet mini"><thead><tr><th>Date</th><th>What</th><th class="r">Amount (before WHT)</th><th class="r">WHT %</th><th class="r">WHT</th><th class="r">Received</th><th></th></tr></thead>
            <tbody id="rd-pays"></tbody>
            <tfoot><tr><td colspan="2"><b>Total</b></td><td class="r" data-o="gross"></td><td></td><td class="r" data-o="wht"></td><td class="r" data-o="net"></td><td></td></tr>
              <tr><td colspan="5"><b>Still owed (contract − paid before WHT)</b></td><td class="r" data-o="owed"></td><td></td></tr></tfoot></table></div>
          <button type="button" class="btn-text" id="rd-add-pay">+ Add a payment</button>
        </section>
        ${ROAD_DAYS.map(([k, t]) => `
        <section class="panel-box lg-box wide">
          <h2>Standard ${t.toLowerCase()}</h2>
          <p class="muted small">What <b>Add ${t.toLowerCase()}</b> puts in the daily log. Leave a quantity or price empty to fill it in on the day.</p>
          <div class="sheet-wrap"><table class="sheet mini tpl-sheet"><thead><tr><th>Category</th><th>Item</th><th class="r">Qty</th><th>Unit</th><th>Price from</th><th class="r">Price</th><th></th></tr></thead>
            <tbody id="rd-t-${k}"></tbody>
            <tfoot><tr><td colspan="5"><b>One ${t.toLowerCase()} (lines filled in)</b></td><td class="r" data-o="tpl-${k}"></td><td></td></tr></tfoot></table></div>
          <button type="button" class="btn-text" data-add-t="${k}">+ Add a line</button>
        </section>`).join('')}
        <div class="lg-save">
          <button type="button" class="btn-text danger" id="rd-del">Delete project</button>
          <span class="spacer"></span>
          <span class="muted small" id="rd-dirty"></span>
          <button type="submit" class="btn btn-sm btn-navy">Save project</button>
        </div>
      </form>`;
    const f = $('rd-form');
    const read = () => {
      p.name = f.name.value.trim(); p.client = f.client.value.trim(); p.started_on = f.started_on.value || null; p.status = f.status.value; p.notes = f.notes.value.trim();
      p.contract_amount = num(f.contract_amount.value); p.wht_rate = num(f.wht_rate.value);
      p.diesel_price = num(f.diesel_price.value); p.petrol_price = num(f.petrol_price.value);
      p.payments = [...f.querySelectorAll('#rd-pays tr')].map(tr => {
        const g = k => tr.querySelector(`[data-p="${k}"]`).value.trim();
        return { date: g('date') || null, label: g('label'), gross: num(g('gross')), rate: g('rate') === '' ? p.wht_rate : num(g('rate')) };
      });
      ROAD_DAYS.forEach(([k]) => {
        p.templates[k] = [...f.querySelectorAll(`#rd-t-${k} tr`)].map(tr => {
          const g = n => tr.querySelector(`[data-t="${n}"]`).value.trim();
          const fuel = g('fuel'), qty = numOrNull(g('qty')), price = numOrNull(g('price'));
          return { category: g('category'), item: g('item'), unit: g('unit'), qty: qty == null ? '' : qty, price: fuel || price == null ? '' : price, fuel };
        });
      });
    };
    const out = () => {
      const c = roadCalc(p, R.costs);
      const set = (k, v) => f.querySelectorAll(`[data-o="${k}"]`).forEach(el => { el.textContent = v; });
      set('contractWht', kes(c.contractWht)); set('contractNet', kes(c.contractNet));
      c.pays.forEach((x, i) => { set('pw' + i, kes(x.wht)); set('pn' + i, kes(x.net)); });
      set('gross', kes(c.gross)); set('wht', kes(c.wht)); set('net', kes(c.net)); set('owed', kes(c.owed));
      ROAD_DAYS.forEach(([k]) => set('tpl-' + k, kes(p.templates[k].reduce((t, x) => t + num(x.qty) * (x.fuel ? fuelPrice(p, x.fuel) : num(x.price)), 0))));
    };
    const render = () => {
      $('rd-pays').innerHTML = p.payments.map(payRow).join('') || '<tr><td colspan="7" class="empty-row">No payments yet.</td></tr>';
      ROAD_DAYS.forEach(([k]) => { $('rd-t-' + k).innerHTML = p.templates[k].map((t, i) => tRow(k, t, i)).join(''); });
      wire(); out();
    };
    const changed = () => { read(); out(); R.dirty = true; $('rd-dirty').textContent = 'Unsaved changes'; };
    const wire = () => {
      f.querySelectorAll('input,select,textarea').forEach(el => { el.oninput = changed; });
      f.querySelectorAll('[data-t="fuel"]').forEach(sel => { sel.onchange = () => {
        const price = sel.closest('tr').querySelector('[data-t="price"]');
        price.disabled = !!sel.value; if (sel.value) price.value = '';
        changed();
      }; });
      f.querySelectorAll('[data-rm-pay]').forEach(btn => { btn.onclick = () => { read(); p.payments.splice(+btn.closest('tr').dataset.i, 1); render(); changed(); }; });
      f.querySelectorAll('[data-rm-t]').forEach(btn => { btn.onclick = () => {
        const tr = btn.closest('tr'); read(); p.templates[tr.dataset.kind].splice(+tr.dataset.i, 1); render(); changed();
      }; });
    };
    $('rd-add-pay').onclick = () => {
      read(); p.payments.push({ date: today(), label: '', gross: '', rate: p.wht_rate }); render(); changed();
      $('rd-pays').lastElementChild.querySelector('[data-p=label]').focus();
    };
    f.querySelectorAll('[data-add-t]').forEach(btn => { btn.onclick = () => {
      const k = btn.dataset.addT;
      read(); p.templates[k].push({ category: k === 'murram' ? 'Lorries' : k === 'clearing' ? 'Bush clearing' : 'Other', item: '', unit: '', qty: '', price: '', fuel: '' }); render(); changed();
      $('rd-t-' + k).lastElementChild.querySelector('[data-t=item]').focus();
    }; });
    f.onsubmit = async e => {
      e.preventDefault();
      read();
      if (!p.name){ toast('Give the project a name'); return; }
      const patch = { name: p.name, client: p.client, started_on: p.started_on, status: p.status, notes: p.notes, contract_amount: p.contract_amount,
        wht_rate: p.wht_rate, payments: p.payments.filter(x => x.label || x.gross), diesel_price: p.diesel_price, petrol_price: p.petrol_price,
        templates: p.templates, updated_at: new Date().toISOString() };
      ROAD_DAYS.forEach(([k]) => { patch.templates[k] = p.templates[k].filter(t => t.item || t.qty !== '' || t.price !== ''); });
      const { error } = await db.from('road_projects').update(patch).eq('id', R.project.id);
      if (error){ toast('Not saved: ' + error.message); return; }
      R.dirty = false;
      toast('Project saved');
      refresh();
    };
    $('rd-del').onclick = async () => {
      const btn = $('rd-del');
      if (!armed(btn)) return;
      const { error } = await db.from('road_projects').delete().eq('id', R.project.id);
      if (error){ toast(error.message); return; }
      try { localStorage.removeItem('kanam_road'); } catch (e) {}
      R.dirty = false;
      toast('Project deleted');
      refresh();
    };
    render();
    R.dirty = false;
  }

  /* ----- Costs & money ----- */
  function drawRoadProgress(){
    const p = R.project, c = roadCalc(p, R.costs);
    const cats = ROAD_CATS.concat(Object.keys(c.byCat).filter(k => !ROAD_CATS.includes(k))).filter(k => c.byCat[k]);
    const pct = v => c.spent ? Math.round(v / c.spent * 100) + '%' : '';
    $('rd-sheet').innerHTML = `
      <div class="lg-summary">
        <section class="panel-box lg-box wide">
          <h2>Costs by category</h2>
          <div class="sheet-wrap"><table class="sheet mini"><thead><tr><th>Category</th><th class="r">Amount</th><th class="r">Share</th></tr></thead>
            <tbody>${cats.map(k => `<tr><td>${esc(k)}</td><td class="r">${kes(c.byCat[k])}</td><td class="r">${pct(c.byCat[k])}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-row">No costs yet.</td></tr>'}</tbody>
            <tfoot><tr><td><b>Total spent</b></td><td class="r"><b>${kes(c.spent)}</b></td><td></td></tr></tfoot></table></div>
        </section>
        <section class="panel-box lg-box">
          <h2>Against the contract</h2>
          <div class="kv-out"><span>Contract amount</span><b>${kes(c.contract)}</b></div>
          <div class="kv-out"><span>Withholding tax (${num(p.wht_rate)}%)</span><b>${kes(c.contractWht)}</b></div>
          <div class="kv-out"><span>You will receive</span><b>${kes(c.contractNet)}</b></div>
          <div class="kv-out"><span>Spent so far</span><b>${kes(c.spent)}</b></div>
          <div class="kv-out total"><span>Expected profit</span><b class="${c.expProfit < 0 ? 'neg' : 'pos'}">${kes(c.expProfit)}</b></div>
          <p class="lg-status-line">${esc(c.status)}</p>
        </section>
        <section class="panel-box lg-box">
          <h2>Money in</h2>
          <div class="kv-out"><span>Paid by the client (before WHT)</span><b>${kes(c.gross)}</b></div>
          <div class="kv-out"><span>Withholding tax held back</span><b>${kes(c.wht)}</b></div>
          <div class="kv-out"><span>Received</span><b>${kes(c.net)}</b></div>
          <div class="kv-out"><span>Still owed</span><b>${kes(c.owed)}</b></div>
          <div class="kv-out total"><span>Cash so far (received − spent)</span><b class="${c.cash < 0 ? 'neg' : 'pos'}">${kes(c.cash)}</b></div>
        </section>
        <section class="panel-box lg-box">
          <h2>Other figures</h2>
          <div class="kv-out"><span>Days worked</span><b>${c.days}</b></div>
          <div class="kv-out"><span>Average cost per day</span><b>${c.days ? kes(c.spent / c.days) : '–'}</b></div>
          <div class="kv-out"><span>Murram trips</span><b>${kes(c.trips)}</b></div>
          <div class="kv-out"><span>Fuel bought (litres)</span><b>${kes(R.costs.filter(r => /fuel/i.test(r.category) || /litre/i.test(r.unit)).reduce((t, r) => t + num(r.qty), 0))}</b></div>
          <div class="kv-out"><span>Lines in the log</span><b>${R.costs.length}</b></div>
        </section>
      </div>`;
  }

  async function newRoadProject(){
    if (R.dirty && !confirmLeaveRoad()) return;
    const from = R.project;
    const row = { name: `Road project ${R.projects.length + 1}`, started_on: today() };
    if (grouped()) row.company = co;
    if (from) Object.assign(row, { client: from.client, wht_rate: from.wht_rate, diesel_price: from.diesel_price, petrol_price: from.petrol_price, templates: from.templates });
    const { data, error } = await db.from('road_projects').insert([row]).select().single();
    if (error){ toast('Not created: ' + error.message); return; }
    try { localStorage.setItem('kanam_road', data.id); localStorage.setItem('kanam_road_sheet', 'summary'); } catch (e) {}
    toast(from ? `${data.name} created with the same rates and standard days as ${from.name}. Name it and enter the contract.` : 'Project created. Name it and enter the contract.');
    refresh();
  }

  // The project as an Excel workbook (values): summary, daily log, costs by category.
  async function downloadRoads(){
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const p = R.project, c = roadCalc(p, R.costs);
      const cats = Object.keys(c.byCat).sort((a, b) => ROAD_CATS.indexOf(a) - ROAD_CATS.indexOf(b));
      const S = [[`Road Works Ledger – ${p.name}`], ['All amounts in KES. Downloaded from the Kanam portal ' + day(new Date())], [],
        ['Client', p.client], ['Started on', p.started_on || ''], ['Status', p.status], [],
        ['Contract'], ['Contract amount', c.contract], [`Withholding tax (${num(p.wht_rate)}%)`, c.contractWht], ['You will receive', c.contractNet], [],
        ['Payments from the client'], ['Date', 'What', 'Before WHT', 'WHT %', 'WHT', 'Received'],
        ...(p.payments || []).map((x, i) => [x.date || '', x.label, c.pays[i].gross, c.pays[i].rate, c.pays[i].wht, c.pays[i].net]),
        ['Total', '', c.gross, '', c.wht, c.net], ['Still owed', '', c.owed], [],
        ['Costs by category', 'Amount'], ...cats.map(k => [k, c.byCat[k]]), ['TOTAL SPENT', c.spent], [],
        ['Expected profit (contract after WHT − spent)', c.contract ? c.expProfit : ''],['Cash so far (received − spent)', c.cash],
        ['Days worked', c.days], ['Murram trips', c.trips], ['Status', c.status]];
      const G = [['Date', 'Category', 'Item', 'Qty', 'Unit', 'Price', 'Amount (KES)', 'Notes'],
        ...R.costs.map((r, i) => [r.spent_on, r.category, r.item, r.qty, r.unit, r.price, c.rows[i], r.notes]),
        [], ['Total', '', '', '', '', '', c.spent]];
      const days = Object.keys(c.byDay).sort();
      const T = [['Date', ...cats, 'Day total'],
        ...days.map(d => [d, ...cats.map(k => R.costs.reduce((t, r, i) => t + (r.spent_on === d && r.category === k ? c.rows[i] : 0), 0)), c.byDay[d]]),
        ['Total', ...cats.map(k => c.byCat[k]), c.spent]];
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet(S); ws1['!cols'] = [{ wch: 44 }, { wch: 22 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 14 }];
      const ws2 = XLSX.utils.aoa_to_sheet(G); ws2['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 40 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 30 }];
      const ws3 = XLSX.utils.aoa_to_sheet(T); ws3['!cols'] = [{ wch: 12 }, ...cats.map(() => ({ wch: 13 })), { wch: 13 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
      XLSX.utils.book_append_sheet(wb, ws2, 'Daily Log');
      XLSX.utils.book_append_sheet(wb, ws3, 'By Day and Category');
      XLSX.writeFile(wb, `Kanam road works - ${fileSafe(p.name)}.xlsx`);
    } catch (err){ toast('Download failed: ' + err.message); }
  }

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
  // A sister company's details live in its "companies" row.
  const CO_FIELDS = [
    ['name', 'Registered name'], ['what', 'What it does (one line)', 'wide'],
    ['phone', 'Phone'], ['whatsapp', 'WhatsApp number, in full (2547…)'], ['email', 'Email'],
    ['location', 'Office or shop location'], ['postal', 'Postal address'], ['hours', 'Opening hours'],
    ['year_registered', 'Year registered'], ['reg_no', 'Registration number'], ['kra_pin', 'KRA PIN'], ['directors', 'Directors'],
    ['services', 'Services (one per line)', 'wide'], ['about', 'About the company', 'wide']
  ];
  function companyDetails(main){
    const c = coRow();
    main.innerHTML = `
      <div class="p-head"><h1>Company details${coLabel()}</h1><button class="btn btn-navy btn-sm" type="submit" form="settings-form">Save changes</button></div>
      <p class="muted">Shown on this company’s page on the website${c.published ? '' : ' once it is switched on under <b>Companies</b>'}. Leave the phone, WhatsApp or email empty to use Kanam’s. Anything in [square brackets] shows highlighted as a placeholder.</p>
      <form id="settings-form" class="settings">${CO_FIELDS.map(([key, label, wide]) => {
        const long = wide === 'wide' && key !== 'what';
        return `<label class="${wide || ''}">${esc(label)}${long ? `<textarea name="${key}" rows="4">${esc(c[key] || '')}</textarea>` : `<input name="${key}" value="${esc(c[key] || '')}"${key === 'name' ? ' required' : ''}>`}</label>`;
      }).join('')}</form>`;
    const f = $('settings-form');
    const mark = el => el.classList.toggle('is-ph', isPlaceholder(el.value));
    f.querySelectorAll('input,textarea').forEach(el => { mark(el); el.oninput = () => mark(el); });
    f.onsubmit = async e => {
      e.preventDefault();
      const patch = Object.fromEntries(CO_FIELDS.map(([key]) => [key, f[key].value.trim()]));
      patch.updated_at = new Date().toISOString();
      const { error } = await db.from('companies').update(patch).eq('id', c.id);
      if (error){ toast('Not saved: ' + error.message); return; }
      await loadCompanies();
      toast('Saved');
    };
  }

  VIEWS.settings = async main => {
    if (grouped() && co !== 'kanam' && coRow()) return companyDetails(main);
    const { data, error } = await db.from('settings').select('key,value');
    if (error) throw error;
    const saved = {};
    (data || []).forEach(r => { saved[r.key] = r.value; });
    main.innerHTML = `
      <div class="p-head"><h1>Company details${coLabel()}</h1><button class="btn btn-navy btn-sm" type="submit" form="settings-form">Save changes</button></div>
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

  /* ---------------- Company profile (tender documents) ---------------- */
  // The checklist. "docs" are the usual documents for each item; they are
  // offered as names when a file is uploaded.
  // Every checklist item a company can have. Which ones it gets depends on
  // its checklist type (CHECKLISTS below), plus any items added by hand.
  const SECTIONS = Object.fromEntries([
    { key: 'incorporation', title: 'Certificate of incorporation', docs: ['Certificate of incorporation'] },
    { key: 'cr12', title: 'CR12', docs: ['CR12'], hint: 'Tenders usually want one issued in the last 12 months.' },
    { key: 'kra', title: 'KRA PIN & tax compliance (TCC)', docs: ['Company KRA PIN certificate', 'Company TCC', 'Director KRA PIN certificate', 'Director TCC'], hint: 'Personal and company. A TCC lasts 12 months, so add its expiry date.' },
    { key: 'directors', title: 'Directors: ID & CV', docs: ['Director ID (front and back)', 'Director CV'] },
    { key: 'trade', title: 'Trade license', docs: ['Trade license (single business permit)'], hint: 'Renewed every year.' },
    { key: 'nca', title: 'NCA registration (7+)', docs: ['NCA registration certificate', 'NCA practising license'], hint: 'Category 7 or higher. The practising license is renewed every year.' },
    { key: 'authority', title: 'Authorities: power of attorney', docs: ['Power of attorney', 'Board resolution / letter of authority'] },
    { key: 'agpo', title: 'AGPO certificate', docs: ['AGPO certificate'] },
    { key: 'litigation', title: 'Litigation history & sworn affidavit', docs: ['Litigation history', 'Sworn affidavit'] },
    { key: 'bank', title: 'Bank: account statement', docs: ['Bank statement', 'Bank reference letter'], hint: 'Usually the last 6 or 12 months.' },
    { key: 'audited', title: 'Audited accounts', docs: ['Audited accounts'], hint: 'Usually the last 2 or 3 years, one file per year.' },
    { key: 'experience', title: 'Past experience (last 3 years)', docs: ['Contract / LPO', 'Completion certificate', 'Recommendation letter'], hint: 'Contracts, LPOs and completion certificates for similar work.' },
    { key: 'health', title: 'Public health licence', docs: ['Public health licence', 'Food hygiene certificate'], hint: 'From the county public health office. Renewed every year.' },
    { key: 'handlers', title: 'Food handlers\' medical certificates', docs: ['Food handler medical certificate'], hint: 'One for everyone who handles the food. Valid for 6 months.' },
    { key: 'vet', title: 'Veterinary & movement permits', docs: ['Livestock movement permit', 'Veterinary inspection certificate'], hint: 'From the county veterinary office, for moving eggs or birds between counties.' },
    { key: 'farms', title: 'Supplier & farm agreements', docs: ['Farm supply agreement', 'Letter from the farm'], hint: 'Shows where the produce comes from and that supply is steady.' },
    { key: 'other', title: 'Other documents', docs: ['Company profile', 'Other'] }
  ].map(sec => [sec.key, sec]));
  const CHECKLISTS = {
    contractor: { keys: ['incorporation', 'cr12', 'kra', 'directors', 'trade', 'nca', 'authority', 'agpo', 'litigation', 'bank', 'audited', 'experience'] },
    food: { keys: ['incorporation', 'cr12', 'kra', 'directors', 'trade', 'health', 'handlers', 'vet', 'farms', 'authority', 'agpo', 'litigation', 'bank', 'audited', 'experience'] },
    general: { keys: ['incorporation', 'cr12', 'kra', 'directors', 'trade', 'authority', 'agpo', 'litigation', 'bank', 'audited', 'experience'] }
  };
  // The current company's checklist: its type's items, the ones added by
  // hand (company_profile rows marked custom), then Other documents.
  let PROFILE_SECTIONS = buildSections({});
  function buildSections(items){
    const kind = CHECKLISTS[(coRow() || {}).checklist] || CHECKLISTS.contractor;
    const own = Object.values(items).filter(r => r.custom).sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map(r => ({ key: r.key, title: r.title || 'Untitled', docs: r.title ? [r.title] : [], hint: r.hint || '', custom: true }));
    return [...kind.keys.map(k => SECTIONS[k]), ...own, SECTIONS.other];
  }
  // A file under an item this company's checklist doesn't have (say NCA, after
  // switching to the food checklist) shows under Other documents.
  const inSec = (d, sec) => d.section === sec.key || (sec.key === 'other' && !PROFILE_SECTIONS.some(s => s.key === d.section));
  const PROFILE_BUCKET = 'profile';
  const DOC_TYPES = '.pdf,image/jpeg,image/png,image/webp,image/heic,.doc,.docx,.xls,.xlsx';
  const secOf = key => PROFILE_SECTIONS.find(s => s.key === key) || PROFILE_SECTIONS[PROFILE_SECTIONS.length - 1];
  const secNum = sec => PROFILE_SECTIONS.indexOf(sec) + 1;
  const extOf = name => (String(name).match(/\.([a-z0-9]{1,5})$/i) || [, ''])[1].toLowerCase();
  const docKind = d => d.mime === 'application/pdf' || extOf(d.name) === 'pdf' ? 'pdf'
    : /^image\/(jpeg|png|webp|gif)$/.test(d.mime) ? 'image' : 'other';
  const daysTo = date => date ? Math.ceil((new Date(date + 'T23:59:59') - Date.now()) / 864e5) : null;
  const fileSafe = s => String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'document';

  // A document whose newer copy (same name, later expiry) is uploaded is "replaced" and no longer counts.
  function docState(d, all){
    const n = daysTo(d.expires_on);
    if (n == null || n > 30) return 'ok';
    const replaced = all.some(o => o !== d && o.section === d.section && o.title === d.title && o.expires_on && o.expires_on > d.expires_on);
    return replaced ? 'replaced' : n < 0 ? 'expired' : 'soon';
  }
  function sectionState(sec, docs, all, item){
    if (item && item.not_applicable) return ['na', 'Not applicable'];
    if (!docs.length) return sec.key === 'other' ? ['', ''] : ['missing', 'Missing'];
    const states = docs.map(d => docState(d, all));
    if (states.includes('expired')) return ['expired', 'Expired'];
    if (states.includes('soon')) return ['soon', 'Renew soon'];
    return ['ready', 'Ready'];
  }
  async function loadProfile(){
    const [docs, items] = await Promise.all([
      byCo(db.from('company_docs').select('*')).order('created_at'),
      byCo(db.from('company_profile').select('*'))
    ]);
    if (docs.error) throw docs.error;
    if (items.error) throw items.error;
    const byKey = Object.fromEntries((items.data || []).map(r => [r.key, r]));
    PROFILE_SECTIONS = buildSections(byKey);
    return { docs: docs.data || [], items: byKey };
  }
  // For the dashboard: how many checklist items need attention (null if not set up yet).
  async function profileStatus(){
    try {
      const { docs, items } = await loadProfile();
      const todo = PROFILE_SECTIONS.filter(sec => ['missing', 'expired', 'soon'].includes(sectionState(sec, docs.filter(d => inSec(d, sec)), docs, items[sec.key])[0])).length;
      return { todo };
    } catch (e){ return null; }
  }

  // Libraries for previews and the ZIP, loaded only when needed.
  const scripts = {};
  const loadScript = src => scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete scripts[src]; reject(new Error('Could not load ' + src.split('/').pop())); };
    document.head.appendChild(s);
  }));
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const pdfjs = () => loadScript(PDFJS + 'pdf.min.js').then(() => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    return window.pdfjsLib;
  });
  // Render a PDF's pages as canvases into box (just the first page for thumbnails).
  async function renderPdf(url, box, { width, pages = 40, isCurrent = () => true }){
    const lib = await pdfjs();
    const pdf = await lib.getDocument(url).promise;
    try {
      const n = Math.min(pdf.numPages, pages);
      for (let i = 1; i <= n && isCurrent(); i++){
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: width * (window.devicePixelRatio || 1) / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (isCurrent()) box.appendChild(canvas);
      }
      return pdf.numPages;
    } finally { pdf.destroy(); }
  }

  let profile = { docs: [], items: {} }, signed = {}, editingDoc = null, previewRun = 0;
  async function signAll(docs){
    const need = docs.map(d => d.path).filter(p => !signed[p]);
    if (!need.length) return;
    const { data, error } = await db.storage.from(PROFILE_BUCKET).createSignedUrls(need, 3600);
    if (error) throw error;
    (data || []).forEach(r => { if (r.signedUrl) signed[r.path] = r.signedUrl; });
  }

  VIEWS.profile = async main => {
    try { profile = await loadProfile(); }
    catch (err){
      if (!/(does not exist|schema cache)/.test(err.message)) throw err;
      main.innerHTML = `<div class="p-head"><h1>Company profile</h1></div>
        <p class="empty">One more step: run <code>sql/03-profile.sql</code> in the Supabase SQL editor, then reload this page.</p>`;
      return;
    }
    signed = {};
    await signAll(profile.docs);
    const S = await companyFacts();
    const known = v => v && !isPlaceholder(v);
    main.innerHTML = `
      <div class="p-head">
        <h1>Company profile${coLabel()}</h1>
        <div class="p-tools"><button class="btn btn-sm btn-navy" type="button" id="doc-zip">Download all (ZIP)</button></div>
      </div>
      <div class="panel-box profile-head">
        <div><b>${esc(S.company)}</b><span class="muted">${[S.email, S.phone, S.postal].filter(known).map(esc).join(' · ')}</span>
          <span class="muted small">${[known(S.reg_no) && 'Reg. ' + S.reg_no, known(S.kra_pin) && 'KRA PIN ' + S.kra_pin].filter(Boolean).map(esc).join(' · ')}</span></div>
        <div id="profile-summary" class="profile-summary"></div>
      </div>
      <p class="muted small">Private: only admins can see these files. Upload PDFs, phone photos or scans, Word or Excel files (up to 25 MB each). Add expiry dates and the portal warns you 30 days before.</p>
      <div class="doc-cards" id="doc-cards"></div>`;
    $('doc-zip').onclick = downloadZip;
    drawProfile();
  };

  // Name, contacts and registration of the company on the switcher.
  async function companyFacts(){
    const c = coRow();
    if (grouped() && co !== 'kanam' && c) return { company: c.name, email: c.email, phone: c.phone, postal: c.postal, reg_no: c.reg_no, kra_pin: c.kra_pin };
    const { data: set } = await db.from('settings').select('key,value');
    const S = Object.assign({}, D.settings);
    (set || []).forEach(r => { if (r.value) S[r.key] = r.value; });
    return S;
  }

  function drawProfile(){
    const { docs, items } = profile;
    const counts = { ready: 0, missing: 0, expired: 0, soon: 0, na: 0 };
    $('doc-cards').innerHTML = PROFILE_SECTIONS.map(sec => {
      const mine = docs.filter(d => inSec(d, sec));
      const item = items[sec.key];
      const [st, label] = sectionState(sec, mine, docs, item);
      if (st in counts) counts[st]++;
      return `<section class="doc-card st-${st || 'none'}" data-sec="${sec.key}">
        <header>
          <span class="doc-num">${secNum(sec)}</span>
          <div class="doc-card-title"><h2>${esc(sec.title)}</h2>${sec.hint ? `<p class="muted small">${esc(sec.hint)}</p>` : ''}</div>
          ${label ? `<span class="pill st-${st}">${label}</span>` : ''}
        </header>
        ${mine.length ? `<div class="doc-files">${mine.map(d => docTile(d, docs)).join('')}</div>` : ''}
        <div class="doc-actions">
          <label class="btn btn-sm btn-quiet file-btn">Upload <input type="file" accept="${DOC_TYPES}" multiple hidden data-upload></label>
          ${sec.custom ? '<button type="button" class="btn-text danger" data-remove>Remove item</button>' : ''}
          ${sec.key === 'other' ? '' : `<label class="check small"><input type="checkbox" data-na${item && item.not_applicable ? ' checked' : ''}> Not applicable</label>`}
        </div>
      </section>`;
    }).join('') + `
      <form class="doc-card doc-add" id="doc-add">
        <h2>Add a checklist item</h2>
        <p class="muted small">For a document this checklist doesn't list, e.g. a KEBS permit or insurance cover. It shows as missing until a file is uploaded.</p>
        <input name="title" maxlength="120" placeholder="e.g. Public liability insurance" required>
        <input name="hint" maxlength="200" placeholder="Note (optional), e.g. Renewed every March">
        <div class="doc-actions"><span class="muted small" id="doc-add-error"></span><button type="submit" class="btn btn-sm btn-navy">Add item</button></div>
      </form>`;
    $('doc-add').onsubmit = addItem;
    const total = PROFILE_SECTIONS.length - 1;
    // (Other documents never counts towards "ready".)
    $('profile-summary').innerHTML = `<b>${counts.ready + counts.na} of ${total}</b> ready`
      + [['missing', 'missing'], ['expired', 'expired'], ['soon', 'to renew soon']].filter(([k]) => counts[k]).map(([k, t]) => ` <span class="pill st-${k}">${counts[k]} ${t}</span>`).join('');

    $('doc-cards').querySelectorAll('.doc-card').forEach(card => {
      const sec = secOf(card.dataset.sec);
      card.querySelector('[data-upload]').onchange = e => uploadDocs(sec, [...e.target.files]);
      const na = card.querySelector('[data-na]');
      const rm = card.querySelector('[data-remove]');
      if (rm) rm.onclick = () => removeItem(sec, rm);
      if (na) na.onchange = async () => {
        const row = { key: sec.key, not_applicable: na.checked, updated_at: new Date().toISOString() };
        if (grouped()) row.company = co;
        const { error } = await db.from('company_profile').upsert([row], { onConflict: grouped() ? 'company,key' : 'key' });
        if (error){ toast('Not saved: ' + error.message); na.checked = !na.checked; return; }
        profile.items[sec.key] = Object.assign(profile.items[sec.key] || {}, row);
        drawProfile();
      };
      card.querySelectorAll('.doc-tile').forEach(b => { b.onclick = () => openDoc(profile.docs.find(d => d.id === b.dataset.id)); });
    });
    // Thumbnails: photos straight away, PDFs one at a time.
    const queue = [];
    $('doc-cards').querySelectorAll('.doc-thumb').forEach(t => {
      const d = docs.find(x => x.id === t.dataset.id), url = signed[d.path];
      if (!url) return;
      const kind = docKind(d);
      if (kind === 'image') t.style.backgroundImage = `url('${url}')`;
      if (kind === 'pdf') queue.push(() => renderPdf(url, t, { width: 120, pages: 1 }).then(() => t.classList.add('drawn')));
    });
    (async () => { for (const job of queue){ try { await job(); } catch (e) {} } })();
  }

  async function addItem(e){
    e.preventDefault();
    const f = e.target, title = f.title.value.trim();
    if (!title) return;
    const row = { key: 'x-' + crypto.randomUUID().slice(0, 8), title, hint: f.hint.value.trim(), custom: true,
      sort: Math.max(0, ...Object.values(profile.items).filter(r => r.custom).map(r => r.sort || 0)) + 1, updated_at: new Date().toISOString() };
    if (grouped()) row.company = co;
    const { data, error } = await db.from('company_profile').insert([row]).select().single();
    if (error){
      $('doc-add-error').textContent = /column|schema cache/.test(error.message) ? 'Run sql/08-checklists.sql in Supabase first.' : error.message;
      return;
    }
    profile.items[data.key] = data;
    PROFILE_SECTIONS = buildSections(profile.items);
    drawProfile();
    toast(`Added “${title}”`);
  }

  async function removeItem(sec, btn){
    if (profile.docs.some(d => d.section === sec.key)){ toast('Move or delete its files first'); return; }
    if (!armed(btn)) return;
    let q = db.from('company_profile').delete().eq('key', sec.key);
    if (grouped()) q = q.eq('company', co);
    const { error } = await q;
    if (error){ toast('Not removed: ' + error.message); return; }
    delete profile.items[sec.key];
    PROFILE_SECTIONS = buildSections(profile.items);
    drawProfile();
    toast('Removed');
  }

  function docTile(d, all){
    const st = docState(d, all), n = daysTo(d.expires_on);
    const sub = d.expires_on ? (n < 0 ? `Expired ${day(d.expires_on)}` : `Expires ${day(d.expires_on)}`)
      : d.issued_on ? `Issued ${day(d.issued_on)}` : day(d.created_at);
    return `<button type="button" class="doc-tile" data-id="${d.id}" title="${esc(d.name)}">
      <span class="doc-thumb kind-${docKind(d)}" data-id="${d.id}"><span class="doc-ext">${esc(extOf(d.name).toUpperCase() || 'FILE')}</span></span>
      <span class="doc-title">${esc(d.title || d.name)}</span>
      <span class="doc-sub${st === 'expired' ? ' is-err' : st === 'soon' ? ' is-warn' : ''}">${esc(sub)}${st === 'replaced' ? ' · replaced' : ''}</span>
    </button>`;
  }

  async function uploadDocs(sec, files){
    if (!files.length) return;
    const added = [];
    for (const [i, file] of files.entries()){
      toast(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : 'Uploading…');
      try {
        const ext = extOf(file.name) || 'pdf';
        // Kanam's files stay where they were; the other companies' get their own folder.
        const path = `${grouped() && co !== 'kanam' ? co + '/' : ''}${sec.key}/${crypto.randomUUID()}.${ext}`;
        const up = await db.storage.from(PROFILE_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) throw /mime|type/i.test(up.error.message) ? new Error('only PDFs, photos, Word and Excel files can be uploaded') : /size|large/i.test(up.error.message) ? new Error('the file is over 25 MB') : up.error;
        const title = sec.docs.length === 1 ? sec.docs[0] : file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        const doc = { section: sec.key, title, path, name: file.name, mime: file.type, size: file.size };
        if (grouped()) doc.company = co;
        const { data, error } = await db.from('company_docs').insert([doc]).select().single();
        if (error){ await db.storage.from(PROFILE_BUCKET).remove([path]); throw error; }
        profile.docs.push(data);
        added.push(data);
      } catch (err){ toast(`${file.name}: ${err.message}`); await new Promise(r => setTimeout(r, 1800)); }
    }
    if (!added.length) return;
    await signAll(added).catch(() => {});
    drawProfile();
    if (added.length === 1) openDoc(added[0], true);
    else toast(`Uploaded ${added.length} files. Tap each one to name it and add dates.`);
  }

  async function openDoc(d, isNew){
    editingDoc = d;
    const f = $('doc-form'), sec = secOf(d.section);
    $('doc-heading').textContent = isNew ? 'Name this document' : d.title || d.name;
    f.title.value = d.title || '';
    f.section.innerHTML = PROFILE_SECTIONS.map(s => `<option value="${s.key}"${s.key === d.section ? ' selected' : ''}>${secNum(s)}. ${esc(s.title)}</option>`).join('');
    f.issued_on.value = d.issued_on || '';
    f.expires_on.value = d.expires_on || '';
    f.notes.value = d.notes || '';
    const fillTitles = () => { $('doc-titles').innerHTML = secOf(f.section.value).docs.map(t => `<option value="${esc(t)}">`).join(''); };
    f.section.onchange = fillTitles;
    fillTitles();
    $('doc-info').textContent = [d.name, d.size ? (d.size > 1048576 ? (d.size / 1048576).toFixed(1) + ' MB' : Math.round(d.size / 1024) + ' KB') : '', 'uploaded ' + day(d.created_at)].filter(Boolean).join(' · ');
    $('doc-error').textContent = '';
    disarm($('doc-delete'));
    const url = signed[d.path] || '';
    $('doc-open').href = url;
    $('doc-download').removeAttribute('href');
    db.storage.from(PROFILE_BUCKET).createSignedUrl(d.path, 600, { download: downloadName(d) })
      .then(({ data }) => { if (editingDoc === d && data) $('doc-download').href = data.signedUrl; });
    if (!$('doc-dialog').open) $('doc-dialog').showModal();

    // Preview
    const view = $('doc-view'), run = ++previewRun, kind = docKind(d);
    view.innerHTML = '';
    view.scrollTop = 0;
    if (!url){ view.innerHTML = '<p class="doc-none">Could not open the file. Reload the page and try again.</p>'; return; }
    if (kind === 'image'){ view.innerHTML = `<img src="${esc(url)}" alt="${esc(d.title)}">`; return; }
    if (kind !== 'pdf'){
      view.innerHTML = `<p class="doc-none"><b>${esc(extOf(d.name).toUpperCase() || 'This')} file</b>No preview for this kind of file. Use <b>Download</b> to open it.</p>`;
      return;
    }
    view.innerHTML = '<p class="doc-none">Loading preview…</p>';
    const pages = document.createElement('div');
    pages.className = 'doc-pages';
    try {
      const n = await renderPdf(url, pages, { width: Math.min(view.clientWidth || 600, 900) - 24, isCurrent: () => run === previewRun });
      if (run !== previewRun) return;
      view.innerHTML = '';
      view.appendChild(pages);
      if (n > 40) view.insertAdjacentHTML('beforeend', `<p class="doc-none">Showing the first 40 of ${n} pages. Open it in a new tab to see the rest.</p>`);
    } catch (err){
      if (run === previewRun) view.innerHTML = `<p class="doc-none">The preview didn't load (${esc(err.message)}). Use <b>Open in new tab</b> instead.</p>`;
    }
  }
  $('doc-dialog').addEventListener('close', () => { previewRun++; $('doc-view').innerHTML = ''; });

  const downloadName = d => {
    const sec = secOf(d.section);
    return `${String(secNum(sec)).padStart(2, '0')} ${fileSafe(d.title || d.name.replace(/\.[^.]+$/, ''))}${extOf(d.name) ? '.' + extOf(d.name) : ''}`;
  };

  $('doc-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    if (f.expires_on.value && f.issued_on.value && f.expires_on.value < f.issued_on.value){ $('doc-error').textContent = 'The expiry date is before the issue date.'; return; }
    const patch = { title: f.title.value.trim(), section: f.section.value, issued_on: f.issued_on.value || null,
      expires_on: f.expires_on.value || null, notes: f.notes.value.trim(), updated_at: new Date().toISOString() };
    const { data, error } = await db.from('company_docs').update(patch).eq('id', editingDoc.id).select().single();
    if (error){ $('doc-error').textContent = error.message; return; }
    Object.assign(editingDoc, data);
    $('doc-dialog').close();
    if (current === 'profile') drawProfile();
    toast('Saved');
  };
  $('doc-delete').onclick = async () => {
    if (!armed($('doc-delete'))) return;
    const d = editingDoc;
    const { error } = await db.from('company_docs').delete().eq('id', d.id);
    if (error){ $('doc-error').textContent = error.message; return; }
    await db.storage.from(PROFILE_BUCKET).remove([d.path]);
    profile.docs = profile.docs.filter(x => x !== d);
    $('doc-dialog').close();
    if (current === 'profile') drawProfile();
    toast('Deleted');
  };

  // Every current document in one ZIP, in checklist order, ready to attach to a tender.
  async function downloadZip(){
    const btn = $('doc-zip');
    const docs = PROFILE_SECTIONS.flatMap(sec => profile.docs.filter(d => inSec(d, sec) && docState(d, profile.docs) !== 'replaced'));
    if (!docs.length){ toast('Nothing uploaded yet'); return; }
    btn.disabled = true;
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      await signAll(docs);
      const zip = new JSZip(), used = new Set();
      for (const [i, d] of docs.entries()){
        toast(`Adding ${i + 1} of ${docs.length}…`);
        const sec = secOf(d.section);
        const folder = `${String(secNum(sec)).padStart(2, '0')} ${fileSafe(sec.title)}`;
        let name = `${folder}/${downloadName(d).slice(3)}`, n = 2;
        while (used.has(name.toLowerCase())) name = `${folder}/${downloadName(d).slice(3).replace(/(\.[a-z0-9]+)?$/i, ` (${n++})$1`)}`;
        used.add(name.toLowerCase());
        const res = await fetch(signed[d.path]);
        if (!res.ok) throw new Error(`${d.title || d.name} could not be downloaded`);
        zip.file(name, await res.blob());
      }
      toast('Making the ZIP…');
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${fileSafe(coName())} - company profile - ${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`Downloaded ${docs.length} files`);
    } catch (err){ toast('ZIP failed: ' + err.message); }
    finally { btn.disabled = false; }
  }

  /* ---------------- Activity log ---------------- */
  const TABLE_TEXT = { content: 'page text', media: 'photo', posts: 'news post', testimonials: 'testimonial', faqs: 'FAQ', team: 'team member',
    projects: 'project', products: 'product', settings: 'company detail', staff: 'staff member', inquiries: 'inquiry',
    company_docs: 'profile document', company_profile: 'profile item', rice_batches: 'rice batch', rice_sales: 'rice sale', equipment: 'machine',
    road_projects: 'road project', road_costs: 'road cost', companies: 'company' };
  function describe(a){
    const r = a.after || a.before || {};
    const name = r.title || r.name || r.buyer || r.item || r.question || r.key || r.email || r.path || '';
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
