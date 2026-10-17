/* Staff portal: sign in (admins only, see sql/01-schema.sql), then
   Inquiries (orders and quote requests from the site), Products, Projects
   and Settings (the company details the site shows). Photos go to the
   public "site" storage bucket. */
(function(){
  const D = window.KANAM_DEFAULTS;
  const cfg = window.KANAM_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = n => n == null ? 'Call for price' : 'KES ' + Number(n).toLocaleString('en-KE');
  const isPlaceholder = v => /\[[^\]]+\]/.test(String(v || ''));
  const when = iso => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

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
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // Delete buttons ask once: the first tap arms, the second deletes.
  function armed(btn){
    if (btn.classList.contains('armed')) return true;
    btn.classList.add('armed');
    btn.textContent = 'Tap again to delete';
    setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Delete'; }, 4000);
    return false;
  }
  const disarm = btn => { btn.classList.remove('armed'); btn.textContent = 'Delete'; };
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });

  /* ------------------------------ Sign in ------------------------------ */
  $('signin-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    $('signin-error').textContent = '';
    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) $('signin-error').textContent = /invalid login/i.test(error.message) ? 'That email and password don\'t match.' : error.message;
    else f.password.value = '';
  };
  $('sign-out').onclick = () => db.auth.signOut();

  let shown = undefined;
  db.auth.onAuthStateChange((_e, session) => {
    const user = session ? session.user : null;
    const id = user ? user.id : null;
    if (id === shown) return;
    shown = id;
    // Leave the auth callback before querying, so Supabase isn't waited on from inside it.
    setTimeout(() => enter(user), 0);
  });

  async function enter(user){
    if (!user){ $('app').hidden = true; $('signin').hidden = false; return; }
    const { data: admin, error } = await db.rpc('is_admin');
    if (error || !admin){
      await db.auth.signOut();
      $('signin-error').textContent = error ? error.message : 'This account is not a portal admin. See the README to add it.';
      return;
    }
    $('user-email').textContent = user.email;
    $('signin').hidden = true;
    $('app').hidden = false;
    show(localStorage.getItem('kanam_tab') || 'inquiries');
    loadInquiries(); loadProducts(); loadProjects(); loadSettings();
  }

  function show(tab){
    document.querySelectorAll('#tabs [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    document.querySelectorAll('.p-tab').forEach(s => { s.hidden = s.id !== 'tab-' + tab; });
    try { localStorage.setItem('kanam_tab', tab); } catch (e) {}
  }
  document.querySelectorAll('#tabs [data-tab]').forEach(b => { b.onclick = () => show(b.dataset.tab); });

  /* ------------------------------ Photos ------------------------------ */
  async function upload(folder, file){
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  }
  const removeFile = path => path ? db.storage.from(BUCKET).remove([path]) : null;

  // Shared photo field for the product and project dialogs.
  function photoField(prefix){
    const form = $(prefix + '-form'), preview = $(prefix + '-preview');
    let current = null, clear = false;
    function draw(src){
      preview.style.backgroundImage = src ? `url("${src}")` : '';
      preview.textContent = src ? '' : 'No photo';
    }
    form.image.onchange = () => { const f = form.image.files[0]; if (f){ clear = false; draw(URL.createObjectURL(f)); } };
    $(prefix + '-clear-image').onclick = () => { form.image.value = ''; clear = true; draw(''); };
    return {
      reset(path){ current = path || null; clear = false; form.image.value = ''; draw(imgUrl(current)); },
      // Uploads a new photo if one was chosen; returns the image_path to save.
      async commit(folder){
        const file = form.image.files[0];
        if (file) return await upload(folder, file);
        return clear ? null : current;
      },
      // After a successful save, remove the file that was replaced.
      cleanup(saved){ if (current && current !== saved) removeFile(current); }
    };
  }

  /* ------------------------------ Inquiries ------------------------------ */
  let inquiries = [], editingInq = null;

  async function loadInquiries(){
    const { data, error } = await db.from('inquiries').select('*').order('created_at', { ascending: false }).limit(500);
    if (error){ $('inq-list').innerHTML = `<p class="empty">Could not load inquiries: ${esc(error.message)}</p>`; return; }
    inquiries = data || [];
    drawInquiries();
  }

  function drawInquiries(){
    const status = $('inq-status').value, q = $('inq-search').value.trim().toLowerCase();
    const list = inquiries.filter(i =>
      (status === 'all' || (status === 'open' ? i.status !== 'done' : i.status === status)) &&
      (!q || [i.name, i.phone, i.email, i.message, i.product, i.kind].join(' ').toLowerCase().includes(q)));
    const fresh = inquiries.filter(i => i.status === 'new').length;
    $('new-count').hidden = !fresh;
    $('new-count').textContent = fresh;
    $('inq-list').innerHTML = list.length ? `<ul class="rows inq-rows">${list.map(i => `
      <li><button type="button" class="row" data-id="${i.id}">
        <span><span class="title">${esc(i.name)} · ${esc(i.kind)}</span>
          <span class="sub">${esc(i.kind === 'Rice order' ? [i.product, i.quantity && '× ' + i.quantity].filter(Boolean).join(' ') : '')}${i.kind === 'Rice order' && i.message ? ' — ' : ''}${esc(i.message)}</span></span>
        <span class="right"><span class="pill ${i.status}">${esc(i.status)}</span>${esc(when(i.created_at))}</span>
      </button></li>`).join('')}</ul>`
      : `<p class="empty">${inquiries.length ? 'Nothing matches.' : 'No inquiries yet. Orders and quote requests from the website will appear here.'}</p>`;
    $('inq-list').querySelectorAll('[data-id]').forEach(b => { b.onclick = () => openInquiry(inquiries.find(i => i.id === b.dataset.id)); });
  }
  $('inq-status').onchange = drawInquiries;
  $('inq-search').oninput = drawInquiries;

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
    drawInquiries();
    toast('Saved');
  };
  $('inq-delete').onclick = async () => {
    if (!armed($('inq-delete'))) return;
    const { error } = await db.from('inquiries').delete().eq('id', editingInq.id);
    if (error){ $('inq-error').textContent = error.message; return; }
    inquiries = inquiries.filter(i => i !== editingInq);
    $('inq-dialog').close();
    drawInquiries();
    toast('Deleted');
  };

  /* ------------------------------ Products ------------------------------ */
  let products = [], editingProduct = null;
  const productPhoto = photoField('product');

  async function loadProducts(){
    const { data, error } = await db.from('products').select('*').order('sort').order('size_kg');
    if (error){ $('product-list').innerHTML = `<p class="empty">Could not load products: ${esc(error.message)}</p>`; return; }
    products = data || [];
    drawProducts();
  }

  function drawProducts(){
    $('product-list').innerHTML = products.length ? `<ul class="rows">${products.map(p => {
      const img = imgUrl(p.image_path);
      return `
      <li><button type="button" class="row" data-id="${p.id}">
        <span class="thumb" ${img ? `style="background-image:url('${esc(img)}')"` : ''}>${img ? '' : esc(p.size_kg ? Number(p.size_kg) + 'kg' : '')}</span>
        <span><span class="title">${esc(p.name)}${p.size_kg ? ' – ' + Number(p.size_kg) + ' kg' : ''}</span><span class="sub">${esc(p.description)}</span></span>
        <span class="right"><b>${esc(money(p.price))}</b>
          <span>${p.in_stock ? '' : '<span class="pill hidden">Out of stock</span> '}${p.published ? '' : '<span class="pill hidden">Hidden</span>'}</span></span>
      </button></li>`; }).join('')}</ul>`
      : '<p class="empty">No products yet. Add your first one.</p>';
    $('product-list').querySelectorAll('[data-id]').forEach(b => { b.onclick = () => openProduct(products.find(p => p.id === b.dataset.id)); });
  }

  function openProduct(p){
    editingProduct = p || null;
    const f = $('product-form');
    f.reset();
    $('product-title').textContent = p ? 'Edit product' : 'New product';
    f.name.value = p ? p.name : 'Pishori rice';
    f.size_kg.value = p && p.size_kg != null ? p.size_kg : '';
    f.price.value = p && p.price != null ? p.price : '';
    f.description.value = p ? p.description : '';
    f.in_stock.checked = p ? p.in_stock : true;
    f.published.checked = p ? p.published : true;
    f.sort.value = p ? p.sort : products.length + 1;
    productPhoto.reset(p && p.image_path);
    $('product-delete').hidden = !p;
    disarm($('product-delete'));
    $('product-error').textContent = '';
    $('product-dialog').showModal();
  }
  $('add-product').onclick = () => openProduct(null);

  $('product-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const image_path = await productPhoto.commit('products');
      const row = {
        name: f.name.value.trim(), size_kg: f.size_kg.value === '' ? null : Number(f.size_kg.value),
        price: f.price.value === '' ? null : Math.round(Number(f.price.value)), description: f.description.value.trim(),
        in_stock: f.in_stock.checked, published: f.published.checked, sort: Number(f.sort.value) || 0,
        image_path, updated_at: new Date().toISOString()
      };
      const q = editingProduct ? db.from('products').update(row).eq('id', editingProduct.id) : db.from('products').insert([row]);
      const { error } = await q;
      if (error) throw error;
      productPhoto.cleanup(image_path);
      $('product-dialog').close();
      await loadProducts();
      toast('Saved');
    } catch (err){ $('product-error').textContent = err.message; }
    finally { btn.disabled = false; }
  };
  $('product-delete').onclick = async () => {
    if (!armed($('product-delete'))) return;
    const { error } = await db.from('products').delete().eq('id', editingProduct.id);
    if (error){ $('product-error').textContent = error.message; return; }
    removeFile(editingProduct.image_path);
    $('product-dialog').close();
    await loadProducts();
    toast('Deleted');
  };

  /* ------------------------------ Projects ------------------------------ */
  let projects = [], editingProject = null;
  const projectPhoto = photoField('project');

  async function loadProjects(){
    const { data, error } = await db.from('projects').select('*').order('sort').order('created_at', { ascending: false });
    if (error){ $('project-list').innerHTML = `<p class="empty">Could not load projects: ${esc(error.message)}</p>`; return; }
    projects = data || [];
    drawProjects();
  }

  function drawProjects(){
    $('project-list').innerHTML = projects.length ? `<ul class="rows">${projects.map(p => {
      const img = imgUrl(p.image_path);
      return `
      <li><button type="button" class="row" data-id="${p.id}">
        <span class="thumb" ${img ? `style="background-image:url('${esc(img)}')"` : ''}></span>
        <span><span class="title">${esc(p.title)}</span><span class="sub">${esc([p.category, p.client, p.location, p.year].filter(Boolean).join(' · '))}</span></span>
        <span class="right">${p.published ? '' : '<span class="pill hidden">Hidden</span>'}</span>
      </button></li>`; }).join('')}</ul>`
      : '<p class="empty">No projects yet. The website shows sample projects until you add your own.</p>';
    $('project-list').querySelectorAll('[data-id]').forEach(b => { b.onclick = () => openProject(projects.find(p => p.id === b.dataset.id)); });
  }

  function openProject(p){
    editingProject = p || null;
    const f = $('project-form');
    f.reset();
    $('project-title').textContent = p ? 'Edit project' : 'New project';
    ['title', 'client', 'location', 'year', 'description'].forEach(k => { f[k].value = p ? p[k] || '' : ''; });
    f.category.value = p ? p.category : 'Road works';
    f.published.checked = p ? p.published : true;
    f.sort.value = p ? p.sort : 0;
    projectPhoto.reset(p && p.image_path);
    $('project-delete').hidden = !p;
    disarm($('project-delete'));
    $('project-error').textContent = '';
    $('project-dialog').showModal();
  }
  $('add-project').onclick = () => openProject(null);

  $('project-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const image_path = await projectPhoto.commit('projects');
      const row = {
        title: f.title.value.trim(), category: f.category.value, client: f.client.value.trim(), location: f.location.value.trim(),
        year: f.year.value.trim(), description: f.description.value.trim(), published: f.published.checked,
        sort: Number(f.sort.value) || 0, image_path, updated_at: new Date().toISOString()
      };
      const q = editingProject ? db.from('projects').update(row).eq('id', editingProject.id) : db.from('projects').insert([row]);
      const { error } = await q;
      if (error) throw error;
      projectPhoto.cleanup(image_path);
      $('project-dialog').close();
      await loadProjects();
      toast('Saved');
    } catch (err){ $('project-error').textContent = err.message; }
    finally { btn.disabled = false; }
  };
  $('project-delete').onclick = async () => {
    if (!armed($('project-delete'))) return;
    const { error } = await db.from('projects').delete().eq('id', editingProject.id);
    if (error){ $('project-error').textContent = error.message; return; }
    removeFile(editingProject.image_path);
    $('project-dialog').close();
    await loadProjects();
    toast('Deleted');
  };

  /* ------------------------------ Settings ------------------------------ */
  const FIELDS = [
    ['company', 'Company name'], ['tagline', 'Tagline (under the headline)', 'wide'],
    ['phone', 'Phone'], ['whatsapp', 'WhatsApp number, in full (2547…)'], ['email', 'Email'],
    ['location', 'Office location'], ['postal', 'Postal address'], ['hours', 'Opening hours'],
    ['delivery_areas', 'Delivery areas'], ['year_registered', 'Year registered'],
    ['reg_no', 'Registration number'], ['kra_pin', 'KRA PIN'], ['directors', 'Directors'],
    ['roads_done', 'Road contracts done (shown on Home)'], ['years_supplying', 'Years supplying institutions'],
    ['about', 'About us (our story)', 'wide'], ['mission', 'Mission', 'wide']
  ];

  async function loadSettings(){
    const { data, error } = await db.from('settings').select('key,value');
    const saved = {};
    (data || []).forEach(r => { saved[r.key] = r.value; });
    const f = $('settings-form');
    f.innerHTML = FIELDS.map(([key, label, wide]) => {
      const v = saved[key] != null && saved[key] !== '' ? saved[key] : D.settings[key] || '';
      const long = wide === 'wide' && key !== 'tagline';
      return `<label class="${wide || ''}">${esc(label)}
        ${long ? `<textarea name="${key}" rows="4">${esc(v)}</textarea>` : `<input name="${key}" value="${esc(v)}">`}</label>`;
    }).join('') + (error ? `<p class="form-status err wide">Could not load saved settings: ${esc(error.message)}</p>` : '');
    const mark = el => el.classList.toggle('is-ph', isPlaceholder(el.value));
    f.querySelectorAll('input,textarea').forEach(el => { mark(el); el.oninput = () => mark(el); });
  }

  $('settings-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, now = new Date().toISOString();
    const rows = FIELDS.map(([key]) => ({ key, value: f[key].value.trim(), updated_at: now }));
    const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
    if (error){ toast('Not saved: ' + error.message); return; }
    toast('Saved. The website now shows the new details.');
  };
})();
