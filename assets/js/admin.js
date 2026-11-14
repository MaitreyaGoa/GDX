// =====================================================================
//  GDX — admin panel (master admin + sellers)
// =====================================================================
(function () {
  const { C, esc, money, placeholder, toast } = window.MHC;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    // Login lasts only while the browser is open (sessionStorage), never saved long-term
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
            flowType: 'pkce', storage: window.sessionStorage, storageKey: 'mhc-admin-auth' }
  });
  try { localStorage.removeItem('mhc-admin-auth'); } catch (e) {}   // remove logins saved by older versions
  const $ = id => document.getElementById(id);
  const SITE = location.origin + location.pathname.replace(/admin\.html$/, '');
  const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'rejected', 'cancelled'];

  const state = {
    status: 'pending', orders: [], counts: {}, shots: {},
    products: [], settings: null,
    role: null, me: null, uid: null, sellers: [], sellerFilter: '', productSellerFilter: '',
    edit: null, editImages: [], removedImages: [], uploading: 0,
    lastPending: null, poll: null
  };
  const errText = e => (e && (e.message || e.error_description)) || 'Something went wrong';

  // ------------------------------------------------------------------ AUTH
  const isMaster = () => state.role === 'admin';
  // Returns 'app' (admin / approved seller), 'apply' (Google user: apply or waiting), or false
  async function loadProfile() {
    const { data: u } = await sb.auth.getUser();
    const user = u && u.user;
    state.uid = user ? user.id : null;
    state.provider = user ? ((user.app_metadata || {}).provider || '') : '';
    state.email = user ? user.email : '';
    let { data, error } = await sb.rpc('seller_login');               // links a pre-approved Gmail
    if (error) ({ data, error } = await sb.rpc('my_profile'));
    state.profile = data || {};
    state.me = (data && data.seller) || null;
    state.role = (data && data.role) || null;
    if (state.role === 'admin' || state.role === 'seller') return 'app';
    if (state.provider === 'google') return 'apply';
    if (!data) {   // very old database: fall back to the admin check
      const old = await sb.rpc('is_admin');
      if (!old.error && old.data === true) { state.role = 'admin'; return 'app'; }
    }
    return false;
  }
  async function route() {
    const r = await loadProfile();
    if (r === 'app') return mustChange() ? showPwView('first') : showApp();
    if (r === 'apply') return showApply();
    await sb.auth.signOut();
    showLogin('This account has no seller access. Sellers sign in with Google.');
  }
  async function boot() {
    const { data } = await sb.auth.getSession();
    cleanUrl();
    if (recoveryMode) { if (data.session) showPwView('recovery'); else showLogin(); return; }
    if (data.session) route(); else showLogin(googleErr);
  }
  // Admins made with a one-time password (e.g. Harish / 1234) must set their own first
  const mustChange = () => !!(state.profile && state.profile.must_change_password);
  // "Harish" → harish@admin.gdxgarage.com (username logins for admins)
  const loginEmail = v => { v = String(v || '').trim().toLowerCase(); return v.includes('@') ? v : v.replace(/[^a-z0-9._-]/g, '') + '@admin.gdxgarage.com'; };
  // Google sign-in returns here with ?code=… (or ?error=…): tidy the address bar
  const googleErr = new URLSearchParams(location.search).get('error_description');
  function cleanUrl() {
    const u = new URL(location.href); let changed = false;
    ['code', 'error', 'error_code', 'error_description', 'state'].forEach(k => { if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; } });
    if (changed) try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
  }
  $('googleBtn').onclick = async () => {
    const btn = $('googleBtn'); btn.disabled = true;
    const next = new URLSearchParams(location.search).get('next');
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: {
      redirectTo: location.origin + location.pathname + (next ? '?next=' + encodeURIComponent(next) : ''),
      queryParams: { prompt: 'select_account' } } });
    if (error) { $('googleError').textContent = "Couldn't open Google sign-in: " + errText(error); $('googleError').hidden = false; btn.disabled = false; }
  };

  // ------------------------------------------------------------------ APPLY TO SELL
  function showApply() {
    $('loginView').hidden = true; $('pwView').hidden = true; $('appView').hidden = true; $('applyView').hidden = false;
    const m = state.me, role = state.role, box = $('applyStatus'), form = $('applyForm');
    $('applyWho').textContent = 'Signed in as ' + (state.email || '');
    const when = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
    if (role === 'pending') {
      box.innerHTML = `<div class="ap-status wait"><div class="big">⏳</div><h2>Application received</h2>
        <p><b>${esc(m.shop_name)}</b> · sent ${when(m.applied_at)}</p>
        <p>The GDX admin will review it and approve you, usually within a day. Come back here and sign in with Google once approved.</p></div>`;
      form.hidden = false; $('applyTitle').textContent = 'Update your application'; $('applyBtn').textContent = 'Update application';
    } else if (role === 'rejected') {
      box.innerHTML = `<div class="ap-status no"><div class="big">✋</div><h2>Not approved this time</h2>
        ${m.review_note ? `<p>Note from the admin: ${esc(m.review_note)}</p>` : ''}
        <p>You can update your details and apply again.</p></div>`;
      form.hidden = false; $('applyTitle').textContent = 'Apply again'; $('applyBtn').textContent = 'Send application';
    } else if (role === 'paused') {
      box.innerHTML = `<div class="ap-status no"><div class="big">⏸️</div><h2>Your shop is paused</h2>
        <p>Please contact the GDX admin on WhatsApp to switch it back on.</p></div>`;
      form.hidden = true;
    } else {
      box.innerHTML = '';
      form.hidden = false; $('applyTitle').textContent = 'Apply to sell on GDX'; $('applyBtn').textContent = 'Send application';
    }
    if (m) { $('ap_shop').value = m.shop_name || ''; $('ap_whatsapp').value = m.whatsapp || ''; $('ap_area').value = m.area || ''; $('ap_about').value = m.about || ''; }
    else if (!$('ap_shop').value) { $('ap_shop').value = ''; }
  }
  $('applyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('applyError'), show = (m, f) => { err.textContent = m; err.hidden = false; if (f) $(f).focus(); };
    err.hidden = true;
    const shop = $('ap_shop').value.trim(), wa = $('ap_whatsapp').value.trim();
    if (shop.length < 3) return show('Enter your shop name.', 'ap_shop');
    if (!validWa(wa)) return show('Enter a valid 10-digit WhatsApp number — the admin and buyers contact you on it.', 'ap_whatsapp');
    const btn = $('applyBtn'); btn.disabled = true;
    const { data, error } = await sb.rpc('apply_as_seller', { p_shop: shop, p_whatsapp: wa,
      p_area: $('ap_area').value.trim() || null, p_about: $('ap_about').value.trim() || null });
    btn.disabled = false;
    if (error) return show(errText(error));
    state.profile = data; state.me = data.seller; state.role = data.role;
    toast('Application sent ✓', 'ok');
    showApply();
  });
  $('applyLogout').onclick = async () => { await sb.auth.signOut(); showLogin(); };
  let recoveryMode = false;
  function showPwView(mode) {
    recoveryMode = mode === 'recovery';
    $('appView').hidden = true; $('loginView').hidden = true; $('pwView').hidden = false;
    $('pwTitle').textContent = recoveryMode ? 'Choose a new password' : 'Set your own password';
    $('pwLead').textContent = recoveryMode
      ? 'Enter a new password for your account.'
      : `Welcome${state.profile && state.profile.admin_name ? ', ' + state.profile.admin_name : ''}! You logged in with a one-time password. Choose your own to continue — you'll use it from any device.`;
    $('pwError').hidden = true; $('pwNew').value = ''; $('pwNew2').value = '';
    $('pwNew').focus();
  }
  async function setPassword(pw) {
    const { error } = await sb.rpc('set_my_password', { p_new: pw });
    if (!error) return null;
    if (/function .*set_my_password|does not exist|schema cache/i.test(error.message || '')) {
      const r = await sb.auth.updateUser({ password: pw });          // before phase9 is installed
      return r.error;
    }
    return error;
  }
  $('pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const a1 = $('pwNew').value, a2 = $('pwNew2').value, err = $('pwError');
    const show = m => { err.textContent = m; err.hidden = false; };
    if (a1.length < 8) return show('Use at least 8 characters.');
    if (a1 !== a2) return show('The two passwords don\'t match.');
    if (['1234', '12345678', 'abcd', 'password'].includes(a1.toLowerCase())) return show('Choose a stronger password.');
    const btn = $('pwBtn'); btn.disabled = true; btn.textContent = 'Saving…';
    const error = await setPassword(a1);
    btn.disabled = false; btn.textContent = 'Save password & continue';
    if (error) return show(errText(error));
    $('pwView').hidden = true;
    toast('Password saved', 'ok');
    route();
  });
  $('pwLogout').onclick = async () => { await sb.auth.signOut(); $('pwView').hidden = true; showLogin(); };

  function showLogin(msg) {
    $('pwView').hidden = true; $('applyView').hidden = true;
    $('appView').hidden = true; $('loginView').hidden = false;
    clearInterval(state.poll);
    $('googleBtn').disabled = false;
    $('googleError').textContent = msg || ''; $('googleError').hidden = !msg;
  }
  function applyRole() {
    document.querySelectorAll('[data-role="admin"]').forEach(el => { el.hidden = !isMaster(); });
    const p = state.profile || {};
    $('roleLabel').textContent = isMaster() ? `${p.is_owner ? 'Owner' : 'Admin'}${p.admin_name ? ' · ' + p.admin_name : ''}` : (state.me ? state.me.shop_name : '');
    // an admin without a shop of their own (e.g. Harish) doesn't need the My shop tab
    const shopTab = document.querySelector('.a-tab[data-tab="shop"]');
    if (shopTab) shopTab.hidden = isMaster() && !state.me;
    document.body.classList.toggle('is-seller', !isMaster());
  }
  const shopIncomplete = () => !isMaster() && state.me && (!state.me.whatsapp || !state.me.upi_id);
  function applySetupGate() {
    const gate = shopIncomplete();
    document.querySelectorAll('.a-tab').forEach(t => {
      if (t.dataset.tab !== 'shop') t.disabled = gate;
    });
    $('setupNote').hidden = !gate;
    if (gate) {
      document.querySelectorAll('.a-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'shop'));
      document.querySelectorAll('.a-section').forEach(s => { s.hidden = s.id !== 'tab-shop'; });
    }
  }
  async function showApp() {
    $('loginView').hidden = true; $('pwView').hidden = true; $('applyView').hidden = true; $('appView').hidden = false;
    applyRole();
    $('passwordForm').hidden = state.provider !== 'email';   // only username / email logins have a password
    // admins without a shop (e.g. Harish) change their password in Settings
    if (isMaster() && !state.me) $('tab-settings').appendChild($('passwordForm'));
    await loadSellers();
    loadOrders(); loadProducts(); loadShop();
    if (isMaster()) { loadSettings(); loadCommunity(); }
    const nxt = new URLSearchParams(location.search).get('next');
    if (isMaster() && (nxt === 'giveaway' || nxt === 'race')) { location.href = nxt + '.html'; return; }
    applySetupGate();
    $('shopError').hidden = true;
    clearInterval(state.poll);
    state.poll = setInterval(() => { if (!document.hidden) loadOrders(true); }, 60000);
  }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('loginBtn'), err = $('loginError');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Logging in…';
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail($('email').value), password: $('password').value });
    if (!error && await loadProfile() === 'app') { $('password').value = ''; mustChange() ? showPwView('first') : showApp(); }
    else {
      if (!error) await sb.auth.signOut();
      err.textContent = error ? 'Wrong email or password.' : 'Email & password is only for the master admin. Sellers: use Continue with Google.';
      err.hidden = false;
    }
    btn.disabled = false; btn.textContent = 'Log in';
  });
  $('logoutBtn').onclick = async () => { await sb.auth.signOut(); showLogin(); };
  $('pwLogin').addEventListener('toggle', () => { if ($('pwLogin').open) $('email').focus(); });
  $('forgotBtn').onclick = () => { $('forgotBox').hidden = !$('forgotBox').hidden; };
  $('sendResetBtn').onclick = async () => {
    const email = $('email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Type your login email above first', 'warn'); $('email').focus(); return; }
    const btn = $('sendResetBtn'); btn.disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    btn.disabled = false;
    if (error) return toast(errText(error), 'warn');
    toast('If that email has an account, a reset link is on its way. Check spam too.', 'ok');
  };

  // ------------------------------------------------------------------ SELLERS (data)
  const sellerName = id => { const s = state.sellers.find(x => x.id === id); return s ? s.shop_name : 'No seller'; };
  async function loadSellers() {
    if (isMaster()) {
      const { data, error } = await sb.rpc('admin_list_sellers');
      state.sellers = error ? [] : (data || []);
    } else state.sellers = state.me ? [state.me] : [];
    const opts = state.sellers.filter(s => !s.status || s.status === 'approved').map(s => `<option value="${esc(s.id)}">${esc(s.shop_name)}${s.is_active ? '' : ' (paused)'}</option>`).join('');
    $('orderSeller').innerHTML = '<option value="">All sellers</option>' + opts;
    $('productSeller').innerHTML = '<option value="">All sellers</option>' + opts;
    $('orderSeller').value = state.sellerFilter; $('productSeller').value = state.productSellerFilter;
    $('p_seller').innerHTML = opts;
    if (isMaster()) renderSellers();
  }
  $('orderSeller').addEventListener('change', e => { state.sellerFilter = e.target.value; loadOrders(); });
  $('productSeller').addEventListener('change', e => { state.productSellerFilter = e.target.value; renderProducts(); });

  // ------------------------------------------------------------------ TABS
  $('tabs').addEventListener('click', e => {
    const t = e.target.closest('.a-tab'); if (!t || t.disabled) return;
    document.querySelectorAll('.a-tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.a-section').forEach(s => { s.hidden = s.id !== 'tab-' + t.dataset.tab; });
    window.scrollTo(0, 0);
  });

  // Dialogs: forms (add/edit) close only with Cancel or Save — never by clicking outside,
  // so typed details aren't lost. Esc asks first if something was typed.
  // Simple viewers (no form) still close by clicking outside.
  document.querySelectorAll('dialog').forEach(d => {
    const isForm = !!d.querySelector('form input, form textarea, form select');
    let dirty = false;
    d.addEventListener('input', () => { dirty = true; });
    d.addEventListener('change', () => { dirty = true; });
    new MutationObserver(() => { if (d.open) dirty = false; }).observe(d, { attributes: true, attributeFilter: ['open'] });
    d.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return d.close();
      if (e.target === d && !isForm) d.close();
    });
    d.addEventListener('cancel', e => {   // Esc key
      if (isForm && dirty && !confirm('Close without saving? What you typed will be lost.')) e.preventDefault();
    });
  });

  // ------------------------------------------------------------------ ORDERS
  async function loadOrders(silent) {
    const list = $('orderList');
    if (!silent) list.innerHTML = '<p class="empty">Loading orders…</p>';
    try {
      const [cnt, res] = await Promise.all([
        (() => { let c = sb.from('orders').select('status').limit(5000);
                 if (isMaster() && state.sellerFilter) c = c.eq('seller_id', state.sellerFilter);
                 return c; })(),
        (() => {
          // Pending: oldest first so nothing waits too long. Others: newest first.
          let q = sb.from('orders').select('*').order('created_at', { ascending: state.status === 'pending' }).limit(150);
          if (state.status !== 'all') q = q.eq('status', state.status);
          if (isMaster() && state.sellerFilter) q = q.eq('seller_id', state.sellerFilter);
          return q;
        })()
      ]);
      if (cnt.error) throw cnt.error;
      if (res.error) throw res.error;
      state.counts = {};
      (cnt.data || []).forEach(r => { state.counts[r.status] = (state.counts[r.status] || 0) + 1; });
      state.orders = res.data || [];
      notifyPending();
      renderChips();
      await signShots();
      renderOrders();
    } catch (e) {
      if (!silent) list.innerHTML = `<p class="empty">Couldn't load orders: ${esc(errText(e))}</p>`;
    }
  }

  function notifyPending() {
    const p = state.counts.pending || 0;
    $('pendingBadge').textContent = p; $('pendingBadge').hidden = !p;
    document.title = (p ? `(${p}) ` : '') + 'Admin — GDX';
    if (state.lastPending !== null && p > state.lastPending) {
      toast(`🔔 ${p - state.lastPending} new order(s) to verify`, 'ok');
      try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) {}
    }
    state.lastPending = p;
  }

  function renderChips() {
    const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
    $('statusChips').innerHTML = [...STATUSES, 'all'].map(s => {
      const n = s === 'all' ? total : (state.counts[s] || 0);
      return `<button class="chip${state.status === s ? ' active' : ''}" data-status="${s}">
        ${s[0].toUpperCase() + s.slice(1)} <span class="chip-n">${n}</span></button>`;
    }).join('');
  }
  $('statusChips').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    state.status = c.dataset.status; loadOrders();
  });
  $('refreshOrders').onclick = () => loadOrders();
  $('orderSearch').addEventListener('input', renderOrders);

  async function signShots() {
    const paths = state.orders.map(o => o.screenshot_path).filter(p => p && !state.shots[p]);
    if (!paths.length) return;
    const { data } = await sb.storage.from('payment-screenshots').createSignedUrls(paths, 3600);
    (data || []).forEach(d => { if (d.signedUrl) state.shots[d.path] = d.signedUrl; });
  }

  function orderCard(o) {
    const shot = state.shots[o.screenshot_path];
    const date = new Date(o.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const items = (o.items || []).map(i =>
      `<li><img src="${esc(i.image || placeholder(i.id))}" alt=""><span>${esc(i.name)} <b>× ${i.qty}</b></span><span>${money(i.price * i.qty)}</span></li>`).join('');
    const acts = {
      pending:   `<button class="btn btn-ok" data-act="confirmed">✓ Approve payment</button>
                  <button class="btn btn-ghost danger" data-act="rejected">✕ Reject</button>`,
      confirmed: `<button class="btn btn-primary" data-act="shipped">🚚 Mark shipped</button>
                  <button class="btn btn-ghost danger" data-act="cancelled">Cancel order</button>`,
      shipped:   `<button class="btn btn-ok" data-act="delivered">✓ Mark delivered</button>`,
      delivered: '', rejected: `<button class="btn btn-ghost" data-act="pending">↺ Back to pending</button>`,
      cancelled: `<button class="btn btn-ghost" data-act="pending">↺ Back to pending</button>`
    }[o.status] || '';
    const hours = Math.floor((Date.now() - new Date(o.created_at)) / 36e5);
    const overdue = o.status === 'pending' && hours >= 24;
    return `
      <article class="a-order${overdue ? ' overdue' : ''}" data-id="${esc(o.id)}">
        ${overdue ? `<div class="overdue-bar">⏰ Waiting ${hours >= 48 ? Math.floor(hours / 24) + ' days' : hours + ' hours'} — please verify</div>` : ''}
        <header class="a-order-head">
          <div><b class="mono">${esc(o.order_code)}</b> <span class="status ${esc(o.status)}">${esc(o.status)}</span>
            ${isMaster() && state.sellers.length > 1 ? `<span class="pill seller">${esc(sellerName(o.seller_id))}</span>` : ''}</div>
          <span class="muted small">${date}</span>
        </header>
        <div class="a-order-body">
          <button class="a-shot" data-shot="${esc(shot || '')}" ${shot ? '' : 'disabled'} title="View payment screenshot">
            ${shot ? `<img src="${esc(shot)}" alt="Payment screenshot" loading="lazy">` : '<span>No image</span>'}
            <span class="a-shot-label">Payment</span>
          </button>
          <div class="a-order-info">
            <div class="a-amount">${money(o.total)} <span class="muted small">${o.shipping > 0 ? `incl. ${money(o.shipping)} shipping` : 'free shipping'}</span></div>
            ${o.ship_method_name ? `<div class="small">🚚 Deliver by <b>${esc(o.ship_method_name)}</b></div>` : ''}
            ${o.utr ? `<div class="small">UTR: <b class="mono">${esc(o.utr)}</b></div>` : '<div class="small muted">No UTR given</div>'}
            <div class="a-cust">
              <div><b>${esc(o.customer_name)}</b> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div>
              <div class="small">${esc(o.address)}${o.city ? ', ' + esc(o.city) : ''}${o.state ? ', ' + esc(o.state) : ''} – <b>${esc(o.pincode)}</b>
                <span class="pill ${o.is_goa ? 'goa' : ''}">${o.is_goa ? 'Goa' : 'Outside Goa'}</span></div>
              ${o.email ? `<div class="small muted">${esc(o.email)}</div>` : ''}
            </div>
          </div>
        </div>
        <ul class="a-items">${items}</ul>
        ${o.tracking_number ? `<div class="small">📦 Tracking: <b class="mono">${esc(o.tracking_number)}</b></div>` : ''}
        ${o.admin_note ? `<div class="small muted">📝 ${esc(o.admin_note)}</div>` : ''}
        <div class="a-actions">
          ${acts}
          <span class="grow"></span>
          <button class="btn btn-ghost" data-act="copy" title="Copy shipping address">📋 Address</button>
          <button class="btn btn-wa" data-act="wa" title="WhatsApp buyer">WhatsApp</button>
        </div>
      </article>`;
  }

  function renderOrders() {
    const term = $('orderSearch').value.trim().toLowerCase();
    const list = state.orders.filter(o => !term ||
      [o.order_code, o.customer_name, o.phone, o.pincode, o.utr].join(' ').toLowerCase().includes(term));
    $('orderList').innerHTML = list.length ? list.map(orderCard).join('')
      : `<p class="empty">${term ? 'No orders match.' : state.status === 'pending' ? 'No payments waiting. 🏁' : 'No orders here yet.'}</p>`;
  }

  function waMessage(o, status) {
    const track = `${SITE}track.html?order=${encodeURIComponent(o.order_code)}&phone=${o.phone}`;
    const name = o.customer_name.split(' ')[0];
    return {
      pending:   `Hi ${name}, we've received your order ${o.order_code} (${money(o.total)}). We're verifying your payment and will confirm shortly.`,
      confirmed: `Hi ${name}, payment received ✅ Your order ${o.order_code} is confirmed and will be shipped soon.\nTrack: ${track}`,
      shipped:   `Hi ${name}, your order ${o.order_code} has been shipped 🚚${o.tracking_number ? `\nTracking no: ${o.tracking_number}` : ''}\nTrack: ${track}`,
      delivered: `Hi ${name}, your order ${o.order_code} has been delivered. Thank you for shopping with ${o.seller_id ? sellerName(o.seller_id) : C.STORE_NAME}! 🏁`,
      rejected:  `Hi ${name}, we couldn't verify the payment for order ${o.order_code}. Please reply with the correct screenshot / UTR so we can help.`,
      cancelled: `Hi ${name}, your order ${o.order_code} has been cancelled. Any amount paid will be refunded. Sorry for the trouble.`
    }[status || o.status];
  }
  const waUrl = (o, status) => `https://wa.me/91${o.phone}?text=${encodeURIComponent(waMessage(o, status))}`;

  $('orderList').addEventListener('click', async e => {
    const shotBtn = e.target.closest('.a-shot');
    if (shotBtn && shotBtn.dataset.shot) {
      $('imgFull').src = shotBtn.dataset.shot; $('imgOpen').href = shotBtn.dataset.shot;
      $('imgDialog').showModal(); return;
    }
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const o = state.orders.find(x => x.id === btn.closest('.a-order').dataset.id); if (!o) return;
    const act = btn.dataset.act;

    if (act === 'wa') { window.open(waUrl(o), '_blank'); return; }
    if (act === 'copy') {
      const txt = `${o.customer_name}\n${o.phone}\n${o.address}${o.city ? ', ' + o.city : ''}\n${o.state ? o.state + ' – ' : ''}${o.pincode}`;
      try { await navigator.clipboard.writeText(txt); toast('Address copied', 'ok'); } catch (_) { prompt('Copy address:', txt); }
      return;
    }

    const patch = { status: act };
    if (act === 'rejected' || act === 'cancelled') {
      const why = prompt(`${act === 'rejected' ? 'Reject' : 'Cancel'} ${o.order_code}? Stock will be put back.\nReason (optional, for your notes):`, '');
      if (why === null) return;
      if (why.trim()) patch.admin_note = why.trim();
    } else if (act === 'shipped') {
      const tn = prompt('Tracking / courier number (leave empty for hand delivery):', o.tracking_number || '');
      if (tn === null) return;
      patch.tracking_number = tn.trim() || null;
    } else if (act === 'confirmed') {
      if (!confirm(`Approve payment of ${money(o.total)} for ${o.order_code}?\nCheck the amount reached ${isMaster() && o.seller_id && (!state.me || o.seller_id !== state.me.id) ? sellerName(o.seller_id) + "'s" : 'your'} UPI account.`)) return;
    }

    btn.disabled = true;
    const { error } = await sb.from('orders').update(patch).eq('id', o.id);
    if (error) { toast(errText(error), 'warn'); btn.disabled = false; return; }
    toast(`${o.order_code} → ${act}`, 'ok');
    const updated = { ...o, ...patch };
    if (['confirmed', 'shipped', 'rejected', 'cancelled', 'delivered'].includes(act) &&
        confirm('Send WhatsApp update to the buyer?')) window.open(waUrl(updated, act), '_blank');
    if (['rejected', 'cancelled', 'pending'].includes(act)) loadProducts();
    loadOrders(true);
  });

  // ------------------------------------------------------------------ PRODUCTS
  async function loadProducts() {
    let q = sb.from('products').select('*').order('created_at', { ascending: false });
    if (!isMaster()) q = q.eq('seller_id', state.me ? state.me.id : '00000000-0000-0000-0000-000000000000');
    const { data, error } = await q;
    if (error) { $('productList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    state.products = data || [];
    const uniq = k => [...new Set(state.products.map(p => p[k]).filter(Boolean))].sort();
    $('brandList').innerHTML = [...new Set([...CAT.BRANDS, ...uniq('brand')])]
      .map(b => `<option value="${esc(b)}">`).join('');
    fillSeries();
    renderProducts();
  }

  // ---------- catalogue suggestions (assets/js/catalog.js) ----------
  const CAT = window.MHC_CATALOG || { CATEGORIES: ['Mainline', 'Premium', 'Chase', 'Pre-owned', 'Accessory'],
                                       BRANDS: [], SERIES: {}, SCALES: ['1:64'], guessCategory: () => '' };
  $('p_category').innerHTML = '<option value="">Choose…</option>' +
    CAT.CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('scaleList').innerHTML = CAT.SCALES.map(s => `<option value="${esc(s)}">`).join('');
  function fillSeries() {
    const brand = $('p_brand').value.trim();
    const used = state.products.filter(p => p.brand === brand).map(p => p.series).filter(Boolean);
    const list = [...new Set([...(CAT.SERIES[brand] || []), ...used, ...(CAT.SERIES['*'] || [])])];
    $('seriesList').innerHTML = list.map(s => `<option value="${esc(s)}">`).join('');
  }
  $('p_brand').addEventListener('input', fillSeries);
  $('p_series').addEventListener('change', () => {
    if ($('p_category').value) return;           // never overwrite a choice
    const g = CAT.guessCategory($('p_series').value);
    if (g) $('p_category').value = g;
  });

  function renderProducts() {
    const term = $('productSearch').value.trim().toLowerCase();
    const ps = state.products.filter(p => !isMaster() || !state.productSellerFilter || p.seller_id === state.productSellerFilter);
    const live = ps.filter(p => p.is_active && p.stock > 0).length;
    $('productStats').textContent = `${ps.length} cars · ${live} on sale · ${ps.filter(p => p.stock <= 0).length} sold out · ${ps.filter(p => !p.is_active).length} hidden`;
    const list = ps.filter(p => !term || [p.name, p.brand, p.series, p.category].join(' ').toLowerCase().includes(term));
    $('productList').innerHTML = list.length ? list.map(p => `
      <div class="a-prod${p.is_active ? '' : ' hidden-prod'}" data-id="${esc(p.id)}">
        <img src="${esc((p.images && p.images[0]) || placeholder(p.id))}" alt="" loading="lazy">
        <div class="a-prod-info">
          <span class="card-brand">${esc(p.brand)}${p.series ? ' · ' + esc(p.series) : ''}</span>
          <b>${esc(p.name)}</b>
          <span class="a-pills">${p.category ? `<span class="pill cat">${esc(p.category)}</span>` : '<span class="pill bad">No category</span>'}
            ${isMaster() && state.sellers.length > 1 ? `<span class="pill seller">${esc(sellerName(p.seller_id))}</span>` : ''}</span>
          <span class="small">${money(p.price)} <span class="muted">MRP ${money(p.mrp)}</span>
            ${p.is_active ? '' : '<span class="pill">Hidden</span>'}${p.stock <= 0 ? '<span class="pill bad">Sold out</span>' : ''}</span>
        </div>
        <div class="a-prod-side">
          <div class="qty sm" title="Stock">
            <button data-act="dec" aria-label="Less stock">−</button><input value="${p.stock}" readonly aria-label="Stock"><button data-act="inc" aria-label="More stock">+</button>
          </div>
          <button class="btn btn-ghost sm" data-act="edit">Edit</button>
        </div>
      </div>`).join('')
      : `<p class="empty">${term ? 'No cars match.' : 'No cars yet — tap “+ Add car”.'}</p>`;
  }
  $('productSearch').addEventListener('input', renderProducts);

  $('productList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const p = state.products.find(x => x.id === btn.closest('.a-prod').dataset.id); if (!p) return;
    if (btn.dataset.act === 'edit') return openProduct(p);
    const stock = Math.max(0, p.stock + (btn.dataset.act === 'inc' ? 1 : -1));
    if (stock === p.stock) return;
    p.stock = stock; renderProducts();
    const { error } = await sb.from('products').update({ stock, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { toast(errText(error), 'warn'); loadProducts(); }
  });

  // ---------- product editor ----------
  $('addProduct').onclick = () => openProduct(null);

  function openProduct(p) {
    state.edit = p ? { ...p } : { id: (crypto.randomUUID ? crypto.randomUUID() : uuid()), _new: true };
    state.editImages = p ? [...(p.images || [])] : [];
    state.removedImages = [];
    $('productDialogTitle').textContent = p ? 'Edit car' : 'Add car';
    $('p_name').value = p ? p.name : '';
    $('p_brand').value = p ? p.brand : 'Hot Wheels';
    $('p_series').value = p ? (p.series || '') : '';
    $('p_mrp').value = p ? p.mrp : '';
    $('p_price').value = p ? p.price : '';
    $('p_stock').value = p ? p.stock : 1;
    $('p_scale').value = p ? (p.scale || '1:64') : '1:64';
    $('p_category').value = p ? (p.category || '') : '';
    if (isMaster()) $('p_seller').value = p ? (p.seller_id || '') : (state.productSellerFilter || (state.me && state.me.id) || (state.sellers[0] && state.sellers[0].id) || '');
    fillSeries();
    $('p_active').checked = p ? p.is_active : true;
    $('p_description').value = p ? (p.description || '') : '';
    $('deleteProduct').hidden = !p;
    $('productError').hidden = true;
    renderPhotos();
    $('productDialog').showModal();
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function renderPhotos() {
    $('photoGrid').innerHTML = state.editImages.map((src, i) => `
      <div class="photo" data-i="${i}">
        <img src="${esc(src)}" alt="">
        ${i === 0 ? '<span class="cover-tag">Cover</span>' : `<button type="button" class="ph-btn" data-ph="cover" title="Make cover">★</button>`}
        <button type="button" class="ph-btn ph-del" data-ph="del" title="Remove">✕</button>
      </div>`).join('') +
      Array.from({ length: state.uploading }, () => '<div class="photo loading"><span>Uploading…</span></div>').join('');
  }
  $('photoGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-ph]'); if (!b) return;
    const i = +b.closest('.photo').dataset.i;
    if (b.dataset.ph === 'del') state.removedImages.push(...state.editImages.splice(i, 1));
    if (b.dataset.ph === 'cover') state.editImages.unshift(...state.editImages.splice(i, 1));
    renderPhotos();
  });

  async function compress(file, max = 1200, quality = 0.85) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      return await new Promise(r => cv.toBlob(b => r(b || file), 'image/jpeg', quality));
    } catch (_) { return file; }
  }
  async function uploadImage(bucket, folder, file) {
    const blob = await compress(file);
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false });
    if (error) throw error;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }
  const pathFromUrl = (url, bucket) => {
    const i = url.indexOf(`/${bucket}/`); return i >= 0 ? decodeURIComponent(url.slice(i + bucket.length + 2)) : null;
  };

  $('photoFiles').addEventListener('change', async e => {
    const files = [...e.target.files].filter(f => f.type.startsWith('image/'));
    e.target.value = '';
    const folder = state.edit.id;
    await Promise.all(files.map(async f => {
      state.uploading++; renderPhotos();
      try { state.editImages.push(await uploadImage('product-images', folder, f)); }
      catch (err) { toast('Photo upload failed: ' + errText(err), 'warn'); }
      finally { state.uploading--; renderPhotos(); }
    }));
  });

  $('productForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('productError');
    const show = (m, f) => { err.textContent = m; err.hidden = false; if (f) $(f).focus(); };
    const row = {
      id: state.edit.id,
      name: $('p_name').value.trim(),
      brand: $('p_brand').value.trim() || 'Hot Wheels',
      series: $('p_series').value.trim() || null,
      scale: $('p_scale').value.trim() || '1:64',
      category: $('p_category').value || null,
      seller_id: isMaster() ? ($('p_seller').value || null) : (state.me && state.me.id),
      mrp: Number($('p_mrp').value),
      price: Number($('p_price').value),
      stock: parseInt($('p_stock').value, 10),
      is_active: $('p_active').checked,
      description: $('p_description').value.trim() || null,
      images: state.editImages,
      updated_at: new Date().toISOString()
    };
    if (!row.name) return show('Enter the car name.', 'p_name');
    if (!row.category) return show('Choose a category.', 'p_category');
    if (!row.seller_id && state.sellers.length) return show('Choose the seller.', 'p_seller');
    if (!state.sellers.length) delete row.seller_id;   // before the multi-seller update
    if (!(row.mrp >= 0) || $('p_mrp').value === '') return show('Enter the MRP.', 'p_mrp');
    if (!(row.price >= 0) || $('p_price').value === '') return show('Enter the selling price.', 'p_price');
    if (!(row.stock >= 0)) return show('Stock must be 0 or more.', 'p_stock');
    if (state.uploading) return show('Wait for photos to finish uploading.');
    if (row.price > row.mrp && !confirm('Selling price is higher than MRP. Save anyway?')) return;

    const btn = $('saveProduct'); btn.disabled = true; btn.textContent = 'Saving…';
    const q = state.edit._new ? sb.from('products').insert(row) : sb.from('products').update(row).eq('id', row.id);
    const { error } = await q;
    btn.disabled = false; btn.textContent = 'Save';
    if (error && /category/i.test(error.message || '')) return show('Run supabase/phase6-categories.sql in Supabase first, then save again.');
    if (error) return show(errText(error));
    state.edit._saved = true;
    removeFiles(state.removedImages);
    $('productDialog').close();
    toast(state.edit._new ? 'Car added 🏁' : 'Car updated', 'ok');
    loadProducts();
  });

  // Clean up photos uploaded for a new car that was never saved
  $('productDialog').addEventListener('close', () => {
    if (state.edit && state.edit._new && !state.edit._saved) {
      removeFiles(state.editImages);
    }
  });

  function removeFiles(urls) {
    const paths = (urls || []).map(u => pathFromUrl(u, 'product-images')).filter(Boolean);
    if (paths.length) sb.storage.from('product-images').remove(paths);
  }

  $('deleteProduct').onclick = async () => {
    const p = state.edit;
    if (!confirm(`Delete "${p.name}" permanently?\nTip: to just stop selling it, untick "Visible in shop" instead.`)) return;
    const { error } = await sb.from('products').delete().eq('id', p.id);
    if (error) { toast(errText(error), 'warn'); return; }
    removeFiles([...(p.images || []), ...state.editImages]);
    state.edit = null;
    $('productDialog').close();
    toast('Car deleted', 'ok');
    loadProducts();
  };

  // ------------------------------------------------------------------ SETTINGS (master)
  const SFIELDS = ['store_name', 'whatsapp_number'];
  async function loadAdmins() {
    const { data, error } = await sb.rpc('admin_list_admins');
    $('adminList').innerHTML = error ? `<p class="muted small">${esc(errText(error))}</p>` : (data || []).map(a => `
      <div class="a-seller"><div class="a-seller-info">
        <b>${esc(a.display_name)} <span class="pill ${a.is_owner ? 'ok-pill' : 'cat'}">${a.is_owner ? 'Owner' : 'Admin'}</span>${a.must_change_password ? ' <span class="pill warn">Hasn\'t set own password yet</span>' : ''}</b>
        <span class="small muted">Login: ${esc(a.login)}</span></div></div>`).join('');
  }
  async function loadSettings() {
    loadAdmins();
    const { data, error } = await sb.from('settings').select('*').eq('id', 1).single();
    if (error) { toast(errText(error), 'warn'); return; }
    state.settings = data;
    SFIELDS.forEach(k => { $('s_' + k).value = data[k] == null ? '' : data[k]; });
  }
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const row = {};
    SFIELDS.forEach(k => { row[k] = $('s_' + k).value.trim() || null; });
    row.whatsapp_number = row.whatsapp_number ? row.whatsapp_number.replace(/\D/g, '') : null;
    if (row.whatsapp_number && row.whatsapp_number.length === 10) row.whatsapp_number = '91' + row.whatsapp_number;
    row.store_name = row.store_name || 'GDX';
    row.updated_at = new Date().toISOString();
    const btn = $('saveSettings'); btn.disabled = true;
    const { error } = await sb.from('settings').update(row).eq('id', 1);
    btn.disabled = false;
    if (error) { toast(errText(error), 'warn'); return; }
    toast('Settings saved', 'ok');
    loadSettings();
  });

  // ------------------------------------------------------------------ MY SHOP (every seller)
  const MFIELDS = ['shop_name', 'whatsapp', 'upi_id', 'payee_name', 'outside_goa_shipping'];
  const validWa = v => /^[6-9]\d{9}$/.test(String(v).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''));
  const validUpi = v => /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v);
  function loadShop() {
    const m = state.me;
    $('shopForm').querySelectorAll('input, button').forEach(el => { el.disabled = !m; });
    if (!m) return;
    MFIELDS.forEach(k => { $('m_' + k).value = m[k] == null ? '' : m[k]; });
    showQr(m.qr_image_url);
  }
  function showQr(url) {
    $('qrPreview').hidden = !url; $('qrRemove').hidden = !url;
    if (url) $('qrPreview').src = url;
  }
  async function refreshMe() {
    const { data } = await sb.rpc('my_profile');
    if (data && data.seller) state.me = data.seller;
    await loadSellers(); applyRole(); loadShop();
    const wasGated = document.querySelector('.a-tab[disabled]');
    applySetupGate();
    if (wasGated && !shopIncomplete()) { toast('Shop ready — you can add cars now 🏁', 'ok'); loadOrders(); loadProducts(); }
  }
  $('shopForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('shopError');
    const show = (m, f) => { err.textContent = m; err.hidden = false; if (f) $(f).focus(); };
    err.hidden = true;
    const row = {};
    MFIELDS.forEach(k => { row[k] = $('m_' + k).value.trim() || null; });
    if (!row.shop_name) return show('Enter your shop name.', 'm_shop_name');
    if (!row.whatsapp || !validWa(row.whatsapp)) return show('Enter a valid 10-digit WhatsApp number — buyers contact you on it.', 'm_whatsapp');
    if (!row.upi_id || !validUpi(row.upi_id)) return show('Enter a valid UPI ID (e.g. name@okicici) — buyers pay you on it.', 'm_upi_id');
    row.outside_goa_shipping = Number(row.outside_goa_shipping || 0);
    const btn = $('saveShop'); btn.disabled = true;
    const { error } = await sb.from('sellers').update(row).eq('id', state.me.id);
    btn.disabled = false;
    if (error) return show(errText(error));
    toast('Shop details saved', 'ok');
    refreshMe();
  });
  $('qrFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !state.me) return;
    try {
      const old = state.me.qr_image_url;
      const url = await uploadImage('site-assets', 'qr/' + state.me.id, f);
      const { error } = await sb.from('sellers').update({ qr_image_url: url }).eq('id', state.me.id);
      if (error) throw error;
      if (old) { const p = pathFromUrl(old, 'site-assets'); if (p) sb.storage.from('site-assets').remove([p]); }
      state.me.qr_image_url = url; showQr(url); toast('QR uploaded', 'ok');
    } catch (err) { toast('QR upload failed: ' + errText(err), 'warn'); }
  });
  $('qrRemove').onclick = async () => {
    const old = state.me.qr_image_url;
    const { error } = await sb.from('sellers').update({ qr_image_url: null }).eq('id', state.me.id);
    if (error) { toast(errText(error), 'warn'); return; }
    const p = pathFromUrl(old || '', 'site-assets'); if (p) sb.storage.from('site-assets').remove([p]);
    state.me.qr_image_url = null; showQr(null);
  };

  // ------------------------------------------------------------------ SELLERS TAB (master)
  const others = () => state.sellers.filter(s => s.user_id !== state.uid);
  const PILL = { pending: '<span class="pill warn">Waiting for approval</span>', rejected: '<span class="pill bad">Rejected</span>' };
  async function renderSellers() {
    const [cars, pend] = await Promise.all([
      sb.from('products').select('seller_id').limit(10000),
      sb.from('orders').select('seller_id').eq('status', 'pending').limit(10000)
    ]);
    const tally = rows => (rows.data || []).reduce((m, r) => (m[r.seller_id] = (m[r.seller_id] || 0) + 1, m), {});
    const nCars = tally(cars), nPend = tally(pend);
    const apps = state.sellers.filter(s => s.status === 'pending');
    const shops = state.sellers.filter(s => s.status !== 'pending');
    const live = shops.filter(s => s.is_active && s.user_id !== state.uid).length;
    $('sellerStats').textContent = `${live} active seller${live === 1 ? '' : 's'} · plus your own shop${apps.length ? ` · ${apps.length} waiting for approval` : ''}`;
    $('addSeller').disabled = false;
    $('applyBadge').textContent = apps.length; $('applyBadge').hidden = !apps.length;
    const appsHtml = apps.length ? `<div class="a-apps"><h3 class="panel-title" style="margin:0">New seller applications</h3>${apps.map(s => `
      <div class="a-app" data-id="${esc(s.id)}">
        <h3>${esc(s.shop_name)} ${PILL.pending}</h3>
        <span class="small">🔑 ${esc(s.login_email || '')} · 💬 <a href="https://wa.me/91${esc(s.whatsapp || '')}" target="_blank" rel="noopener">${esc(s.whatsapp || '')}</a>${s.area ? ' · 📍 ' + esc(s.area) : ''}</span>
        ${s.about ? `<span class="small muted">${esc(s.about)}</span>` : ''}
        <span class="small muted">Applied ${new Date(s.applied_at || s.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
        <div class="acts"><button class="btn btn-ok sm" data-review="approve">✓ Approve</button><button class="btn btn-ghost sm danger" data-review="reject">✕ Reject</button></div>
      </div>`).join('')}</div>` : '';
    $('sellerList').innerHTML = appsHtml + (shops.length ? shops.map(s => `
      <div class="a-seller${s.is_active ? '' : ' hidden-prod'}" data-id="${esc(s.id)}">
        <div class="a-seller-info">
          <b>${esc(s.shop_name)}${s.user_id === state.uid ? ' <span class="pill cat">You</span>' : ''}${PILL[s.status] || (s.is_active ? '' : ' <span class="pill bad">Paused</span>')}</b>
          <span class="small">${s.whatsapp ? `💬 <a href="https://wa.me/91${esc(s.whatsapp)}" target="_blank" rel="noopener">${esc(s.whatsapp)}</a>` : '<span class="bad">No WhatsApp yet</span>'}
            · ${s.upi_id ? 'UPI ' + esc(s.upi_id) : '<span class="bad">No UPI yet</span>'}</span>
          ${s.reviewed_by ? `<span class="small">${s.status === 'rejected' ? '✕ Rejected' : '✓ Approved'} by <b>${esc(s.reviewed_by)}</b>${s.reviewed_at ? ' · ' + new Date(s.reviewed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>` : ''}
          <span class="small muted">${s.login_email ? '🔑 ' + esc(s.login_email) + (s.user_id ? '' : ' <span class="pill warn">Not signed in yet</span>') : '<span class="warn">No Google account linked</span>'}
            · ${nCars[s.id] || 0} cars · ${nPend[s.id] || 0} pending orders</span>
        </div>
        <button class="btn btn-ghost sm" data-act="edit-seller">Edit</button>
      </div>`).join('') : '<p class="empty">Run supabase/2-gdx-all-phases.sql first, then add sellers here.</p>');
  }
  $('sellerList').addEventListener('click', async e => {
    const b = e.target.closest('[data-review]'); if (!b) return;
    const s = state.sellers.find(x => x.id === b.closest('.a-app').dataset.id); if (!s) return;
    const approve = b.dataset.review === 'approve';
    let note = null;
    if (approve) { if (!confirm(`Approve ${s.shop_name} (${s.login_email}) as a seller?`)) return; }
    else { note = prompt(`Reject ${s.shop_name}? Optional note they will see:`, ''); if (note === null) return; }
    b.disabled = true;
    const { error } = await sb.rpc('admin_review_seller', { p_seller: s.id, p_approve: approve, p_note: note || null });
    if (error) { b.disabled = false; return toast(errText(error), 'warn'); }
    toast(approve ? `${s.shop_name} approved ✓` : 'Application rejected', 'ok');
    if (approve && s.whatsapp) {
      const msg = `Hi ${s.shop_name}! 🎉 You're approved as a seller on GDX — Goa Diecast Exchange.\n\nSign in with Google at ${SITE}admin.html → add your UPI ID in "My shop" → start listing your cars.`;
      if (confirm('Send them a WhatsApp message about the approval?')) window.open(`https://wa.me/91${s.whatsapp}?text=${encodeURIComponent(msg)}`, '_blank');
    }
    loadSellers();
  });
  $('addSeller').onclick = () => openSeller(null);
  $('resetPwBtn').onclick = async () => {   // (no longer shown — sellers use Google)
    const s = editingSeller; if (!s) return;
    if (!confirm(`Reset ${s.shop_name}'s password to the default (${C.DEFAULT_SELLER_PASSWORD || 'abcd'})?\nThey'll set a new one at their next login.`)) return;
    const { error } = await sb.rpc('admin_reset_seller_password', { p_seller: s.id });
    if (error) return toast(errText(error), 'warn');
    toast('Password reset — send them the default password', 'ok');
    $('sellerDialog').close();
    loadSellers();
  };
  $('sellerList').addEventListener('click', e => {
    const b = e.target.closest('[data-act="edit-seller"]'); if (!b) return;
    openSeller(state.sellers.find(s => s.id === b.closest('.a-seller').dataset.id));
  });
  let editingSeller = null;
  function openSeller(s) {
    editingSeller = s;
    $('sellerDialogTitle').textContent = s ? 'Edit seller' : 'Add seller';
    $('d_shop_name').value = s ? s.shop_name : '';
    $('d_whatsapp').value = s ? s.whatsapp : '';
    $('d_email').value = s ? (s.login_email || '') : '';
    $('d_upi_id').value = s ? (s.upi_id || '') : '';
    $('d_payee_name').value = s ? (s.payee_name || '') : '';
    $('d_outside_goa_shipping').value = s ? s.outside_goa_shipping : 100;
    $('d_active').checked = s ? s.is_active : true;
    $('d_active').disabled = !!(s && s.user_id === state.uid);   // can't pause yourself
    $('pwRow').hidden = true;
    $('d_email').disabled = !!(s && s.user_id === state.uid);   // your own login stays as it is
    if (s) $('pwState').textContent = s.must_change_password
      ? 'On the default password — they set their own at next login.'
      : 'Using their own password.';
    $('sellerError').hidden = true;
    $('sellerDialog').showModal();
  }
  $('sellerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('sellerError');
    const show = (m, f) => { err.textContent = m; err.hidden = false; if (f) $(f).focus(); };
    const row = {
      shop_name: $('d_shop_name').value.trim(),
      whatsapp: $('d_whatsapp').value.trim(),
      upi_id: $('d_upi_id').value.trim() || null,
      payee_name: $('d_payee_name').value.trim() || null,
      outside_goa_shipping: Number($('d_outside_goa_shipping').value || 0),
      is_active: $('d_active').checked
    };
    const email = $('d_email').value.trim().toLowerCase();
    if (!row.shop_name) return show('Enter the shop name.', 'd_shop_name');
    if (row.whatsapp && !validWa(row.whatsapp)) return show('Enter a valid 10-digit WhatsApp number.', 'd_whatsapp');
    if (!row.whatsapp) row.whatsapp = null;
    if (row.upi_id && !validUpi(row.upi_id)) return show('UPI ID looks wrong (e.g. name@okicici).', 'd_upi_id');
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return show('Check the login email.', 'd_email');
    const btn = $('saveSeller'); btn.disabled = true;
    try {
      let id = editingSeller && editingSeller.id;
      if (id) {
        const { error } = await sb.from('sellers').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('sellers').insert(row).select('id').single();
        if (error) throw error;
        id = data.id;
        // if linking the login fails below, a retry edits this seller instead of adding it twice
        editingSeller = { id, ...row, user_id: null, login_email: null, _justAdded: true };
        $('sellerDialogTitle').textContent = 'Edit seller';
      }
      const oldEmail = editingSeller ? (editingSeller.login_email || '') : '';
      if (email !== oldEmail && !(editingSeller && editingSeller.user_id === state.uid)) {
        const { data: how, error } = await sb.rpc('admin_set_seller_email', { p_seller: id, p_email: email || null });
        if (error) throw error;
        if (how === 'waiting') setTimeout(() => alert(`Done. ${row.shop_name} can now sign in with Google as ${email} at ${SITE}admin.html — their shop opens on first sign-in.`), 300);
      }
      $('sellerDialog').close();
      toast(editingSeller && !editingSeller._justAdded ? 'Seller updated' : 'Seller added', 'ok');
      await loadSellers(); loadProducts();
    } catch (x) { show(errText(x)); loadSellers(); }
    finally { btn.disabled = false; }
  });

  $('passwordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('newPass').value, b = $('newPass2').value;
    if (a.length < 8) { toast('Use at least 8 characters', 'warn'); return; }
    if (a !== b) { toast('Passwords do not match', 'warn'); return; }
    if (['1234', '12345678', 'abcd', 'password'].includes(a.toLowerCase())) { toast('Choose a stronger password', 'warn'); return; }
    const error = await setPassword(a);
    if (error) { toast(errText(error), 'warn'); return; }
    $('newPass').value = $('newPass2').value = '';
    toast('Password updated', 'ok');
  });

  // ------------------------------------------------------------------ COMMUNITY (master): delivery rates + sponsors
  let shipRows = [];
  async function loadCommunity() { loadShipping(); loadSponsors(); }
  async function loadShipping() {
    const { data, error } = await sb.from('shipping_methods').select('*').order('sort');
    if (error) { $('shipRows').innerHTML = `<p class="form-error">Run supabase/2-gdx-all-phases.sql first. (${esc(errText(error))})</p>`; return; }
    shipRows = data || [];
    $('shipRows').innerHTML = shipRows.map((m, i) => `
      <div class="cm-row" data-i="${i}">
        <div class="name"><input class="input" data-f="name" value="${esc(m.name)}" aria-label="Name">
          <label class="toggle" title="Show at checkout"><input type="checkbox" data-f="is_active" ${m.is_active ? 'checked' : ''}><span></span></label></div>
        <div class="field"><label>Note</label><input class="input" data-f="note" value="${esc(m.note || '')}"></div>
        <div class="field"><label>Within Goa (₹)</label><input class="input" data-f="goa_rate" type="number" min="0" step="1" value="${esc(m.goa_rate)}"></div>
        <div class="field"><label>Rest of India (₹)</label><input class="input" data-f="india_rate" type="number" min="0" step="1" value="${m.india_rate == null ? '' : esc(m.india_rate)}" placeholder="Goa only"></div>
      </div>`).join('');
  }
  $('shipForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('shipError'); err.hidden = true;
    const rows = [...$('shipRows').querySelectorAll('.cm-row')].map(r => {
      const m = shipRows[+r.dataset.i], v = f => r.querySelector(`[data-f="${f}"]`);
      return { code: m.code, sort: m.sort, name: v('name').value.trim() || m.name, note: v('note').value.trim() || null,
               goa_rate: Number(v('goa_rate').value || 0),
               india_rate: v('india_rate').value === '' ? null : Number(v('india_rate').value),
               is_active: v('is_active').checked, updated_at: new Date().toISOString() };
    });
    if (rows.some(r => r.goa_rate < 0 || (r.india_rate != null && r.india_rate < 0))) { err.textContent = 'Rates can\'t be negative.'; err.hidden = false; return; }
    if (!rows.some(r => r.is_active)) { err.textContent = 'Keep at least one delivery option switched on.'; err.hidden = false; return; }
    const btn = $('saveShip'); btn.disabled = true;
    const { error } = await sb.from('shipping_methods').upsert(rows);
    btn.disabled = false;
    if (error) { err.textContent = errText(error); err.hidden = false; return; }
    toast('Delivery rates saved', 'ok'); loadShipping();
  });

  let sponsors = [], editingSponsor = null, spLogo = null, spOldLogo = null;
  const KIND_LABEL = { sponsor: 'Sponsor', patron: 'Patron', store: 'Offline store', online: 'Online shop', garage: 'Display & storage', service: 'Service' };
  const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  async function loadSponsors() {
    const { data, error } = await sb.from('sponsors').select('*').order('sort').order('created_at');
    if (error) { $('sponsorList').innerHTML = `<p class="muted small">${esc(errText(error))}</p>`; return; }
    sponsors = data || [];
    $('sponsorList').innerHTML = sponsors.length ? sponsors.map(s => `
      <div class="a-seller${s.is_active ? '' : ' hidden-prod'}" data-id="${esc(s.id)}">
        <div class="a-seller-info">
          <b>${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="" style="width:26px;height:26px;border-radius:8px;object-fit:cover;display:inline-block;vertical-align:middle;margin-right:6px">` : ''}${esc(s.name)}
            <span class="pill cat">${KIND_LABEL[s.kind] || s.kind}</span>${s.tier === 'featured' ? ' <span class="pill ok-pill">⭐ Featured</span>' : ''}${s.is_active ? '' : ' <span class="pill bad">Hidden</span>'}${s.paid_until && s.paid_until < today() ? ' <span class="pill bad">Expired</span>' : ''}</b>
          <span class="small muted">👁 ${Number(s.views || 0)} views · 👆 ${Number(s.clicks || 0)} clicks${s.paid_until ? ' · until ' + new Date(s.paid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
          <span class="small muted">${esc(s.about || s.address || '')}</span>
        </div>
        <button class="btn btn-ghost sm" data-sp="${esc(s.id)}">Edit</button>
      </div>`).join('') : '<p class="empty">No sponsors yet. They\'ll show on the Sponsors page once added.</p>';
  }
  function showSpLogo(url) { $('spLogoPreview').hidden = !url; $('spLogoRemove').hidden = !url; if (url) $('spLogoPreview').src = url; }
  function openSponsor(s) {
    editingSponsor = s; spLogo = s ? s.logo_url : null; spOldLogo = spLogo;
    $('sponsorTitle').textContent = s ? 'Edit ' + s.name : 'Add partner';
    $('sp_name').value = s ? s.name : ''; $('sp_kind').value = s ? s.kind : 'sponsor';
    $('sp_about').value = s ? s.about || '' : ''; $('sp_address').value = s ? s.address || '' : '';
    $('sp_phone').value = s ? s.phone || '' : ''; $('sp_sort').value = s ? s.sort : 0;
    $('sp_website').value = s ? s.website || '' : ''; $('sp_map').value = s ? s.map_url || '' : '';
    $('sp_active').checked = s ? s.is_active : true;
    $('sp_tier').value = s ? (s.tier || 'standard') : 'standard';
    $('sp_until').value = s && s.paid_until ? s.paid_until : '';
    $('sp_offer').value = s ? s.offer || '' : '';
    $('sp_insta').value = s ? s.instagram || '' : '';
    $('deleteSponsor').hidden = !s; $('spError').hidden = true;
    showSpLogo(spLogo);
    $('sponsorDialog').showModal();
  }
  $('addSponsor').onclick = () => openSponsor(null);
  $('sponsorList').addEventListener('click', e => {
    const b = e.target.closest('[data-sp]'); if (!b) return;
    openSponsor(sponsors.find(x => x.id === b.dataset.sp));
  });
  $('spLogoFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { spLogo = await uploadImage('site-assets', 'sponsors', f); showSpLogo(spLogo); }
    catch (x) { toast('Logo upload failed: ' + errText(x), 'warn'); }
  });
  $('spLogoRemove').onclick = () => { spLogo = null; showSpLogo(null); };
  const okUrl = v => !v || /^https?:\/\/\S+$/i.test(v);
  $('sponsorForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('spError'), show = m => { err.textContent = m; err.hidden = false; };
    const row = {
      name: $('sp_name').value.trim(), kind: $('sp_kind').value, about: $('sp_about').value.trim() || null,
      address: $('sp_address').value.trim() || null, phone: $('sp_phone').value.replace(/\D/g, '') || null,
      sort: Number($('sp_sort').value || 0), website: $('sp_website').value.trim() || null,
      map_url: $('sp_map').value.trim() || null, is_active: $('sp_active').checked, logo_url: spLogo,
      tier: $('sp_tier').value, paid_until: $('sp_until').value || null,
      offer: $('sp_offer').value.trim() || null, instagram: $('sp_insta').value.trim() || null
    };
    if (!row.name) return show('Enter a name.');
    if (!okUrl(row.website) || !okUrl(row.map_url)) return show('Links must start with https://');
    const btn = $('saveSponsor'); btn.disabled = true;
    const q = editingSponsor ? sb.from('sponsors').update(row).eq('id', editingSponsor.id) : sb.from('sponsors').insert(row);
    const { error } = await q;
    btn.disabled = false;
    if (error) return show(errText(error));
    if (spOldLogo && spOldLogo !== spLogo) { const p = pathFromUrl(spOldLogo, 'site-assets'); if (p) sb.storage.from('site-assets').remove([p]); }
    $('sponsorDialog').close(); toast('Saved', 'ok'); loadSponsors();
  });
  $('deleteSponsor').onclick = async () => {
    const s = editingSponsor; if (!s || !confirm(`Delete ${s.name}?`)) return;
    const { error } = await sb.from('sponsors').delete().eq('id', s.id);
    if (error) return toast(errText(error), 'warn');
    if (s.logo_url) { const p = pathFromUrl(s.logo_url, 'site-assets'); if (p) sb.storage.from('site-assets').remove([p]); }
    $('sponsorDialog').close(); toast('Deleted', 'ok'); loadSponsors();
  };

  sb.auth.onAuthStateChange(ev => {
    if (ev === 'SIGNED_OUT') showLogin();
    if (ev === 'PASSWORD_RECOVERY') showPwView('recovery');
  });
  if (/type=recovery/.test(location.hash)) recoveryMode = true;
  boot();
})();
