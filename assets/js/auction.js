// =====================================================================
//  GDX — Auctions (gdxgarage.com/auction)
//  Buy or sell? · full live list · one auction (photos, bids, comments, bidding) · sell
//  All bidding rules are checked again by the database (phase10 + phase14 SQL).
// =====================================================================
(async function () {
  const { sb, esc, money, param, Auth, ready, googleButton, waLink, toast, errMsg } = window.MHC;
  const $ = id => document.getElementById(id);
  const BUCKET = 'auction-photos';
  const COLS = 'id,seller_id,seller_name,title,description,photo_path,start_price,min_increment,buy_now_price,' +
               'end_time,status,current_bid,current_bidder,current_bidder_label,bid_count,extensions,closed_at,created_at';
  const COLS_X = COLS + ',extra_photos';

  await ready;
  const me = Auth.user ? Auth.user.id : null;

  // ---------- server clock (bidding closes on the server's time, not the phone's) ----------
  let offset = 0;
  async function syncClock() {
    try {
      const t0 = Date.now();
      const { data, error } = await sb.rpc('server_now');
      if (!error && data) offset = new Date(data).getTime() - (t0 + Date.now()) / 2;
    } catch (e) { /* keep last offset */ }
  }
  const now = () => Date.now() + offset;

  // ---------- helpers ----------
  const url = path => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const photos = a => [a.photo_path].concat(a.extra_photos || []).filter(Boolean).map(url);
  const ended = a => a.status === 'sold' || (a.status === 'live' && new Date(a.end_time).getTime() <= now());
  const isLive = a => a.status === 'live' && new Date(a.end_time).getTime() > now();
  // Final 2 minutes: steps of at least ₹100, and every bid resets the clock to 2 minutes
  const LATE_MS = 2 * 60 * 1000, LATE_STEP = 100;
  const isLate = a => isLive(a) && new Date(a.end_time).getTime() - now() <= LATE_MS;
  const step = a => isLate(a) ? Math.max(a.min_increment, LATE_STEP) : a.min_increment;
  const nextMin = a => a.current_bid == null ? a.start_price : a.current_bid + step(a);
  const fmtDate = d => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const ago = d => {
    const s = Math.max(0, Math.floor((now() - new Date(d).getTime()) / 1000));
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return fmtDate(d);
  };
  const initial = n => esc(String(n || '?').trim().charAt(0).toUpperCase() || '?');
  const signInBlock = text =>
    `<div class="auc-signin"><p>${esc(text)}</p>${googleButton('Continue with Google')
      .replace('data-google-signin', `data-google-signin data-return-to="${esc(location.href.split('#')[0])}"`)}</div>`;
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  // ⭐ watchlist (kept on this device)
  const WATCH = 'gdx-watch';
  const watching = id => store.get(WATCH, []).includes(id);
  function toggleWatch(id) {
    const w = store.get(WATCH, []); const i = w.indexOf(id);
    if (i >= 0) w.splice(i, 1); else w.unshift(id);
    store.set(WATCH, w.slice(0, 100)); return i < 0;
  }

  function left(a) {
    const ms = new Date(a.end_time).getTime() - now();
    if (ms <= 0) return 'Ended';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
          m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }
  const urgent = a => isLive(a) && new Date(a.end_time).getTime() - now() < 5 * 60 * 1000;

  // Every [data-ends] element counts down by itself
  setInterval(() => {
    document.querySelectorAll('[data-ends]').forEach(el => {
      const a = { status: 'live', end_time: el.dataset.ends };
      el.textContent = left(a);
      el.classList.toggle('urgent', urgent(a));
      if (left(a) === 'Ended' && !el.dataset.done) { el.dataset.done = '1'; refreshSoon(); }
      if (new Date(a.end_time).getTime() - now() <= LATE_MS && !el.dataset.late) { el.dataset.late = '1'; refreshSoon(); }
    });
  }, 1000);
  let refreshTimer = null, refreshFn = null;
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refreshFn && refreshFn(), 800); }
  function poll(fn, ms) {
    refreshFn = fn;
    setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { syncClock(); fn(); } });
  }

  function confirmBox(title, text, yes) {
    const d = $('confirmDlg');
    $('cfTitle').textContent = title; $('cfText').innerHTML = text; $('cfYes').textContent = yes || 'Confirm';
    return new Promise(res => {
      if (!d.showModal) return res(window.confirm(title));
      d.returnValue = ''; d.showModal();
      d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
    });
  }

  await syncClock();
  if (param('new') != null) return showNew();
  if (param('id')) return showDetail(param('id'));
  if (param('view') === 'buy' || param('tab')) return showList();
  return showChoose();

  // =================================================================
  //  BUY OR SELL?
  // =================================================================
  async function showChoose() {
    $('chooseView').hidden = false;
    try {
      const { count } = await sb.from('auctions').select('id', { count: 'exact', head: true })
        .eq('status', 'live').gt('end_time', new Date(now()).toISOString());
      if (count != null) $('acLive').textContent = `${count} live now`;
    } catch (e) {}
  }

  // =================================================================
  //  BUY — full list of auctions
  // =================================================================
  async function showList() {
    $('listView').hidden = false;
    let tab = ['live', 'watch', 'ended', 'mine', 'bids'].includes(param('tab')) ? param('tab') : 'live';
    let rows = [], myBids = null, comments = {}, lastBids = {};
    const prefs = store.get('gdx-auc-list', {});
    $('alSort').value = prefs.sort || 'ending';
    $('alBin').checked = !!prefs.bin;
    $('aucTabs').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      tab = b.dataset.tab; load(true);
    });
    const savePrefs = () => store.set('gdx-auc-list', { sort: $('alSort').value, bin: $('alBin').checked });
    $('alSearch').addEventListener('input', draw);
    $('alSort').addEventListener('change', () => { savePrefs(); draw(); });
    $('alBin').addEventListener('change', () => { savePrefs(); draw(); });
    $('listBody').addEventListener('click', e => {
      const w = e.target.closest('[data-watch]');
      if (w) {
        e.preventDefault(); e.stopPropagation();
        const on = toggleWatch(w.dataset.watch);
        w.classList.toggle('on', on); w.setAttribute('aria-pressed', on);
        toast(on ? 'Added to Watching ⭐' : 'Removed from Watching', 'ok');
        if (tab === 'watch') load(false);
        return;
      }
      const row = e.target.closest('.al-row');
      if (row) {   // remember where we were so "back" returns to the same spot
        try { sessionStorage.setItem('gdx-auc-back', JSON.stringify({ url: location.pathname + location.search, y: scrollY })); } catch (x) {}
      }
    });
    poll(() => load(false), 10000);
    await load(true);
    // came back from an auction: restore the scroll position
    try {
      const back = JSON.parse(sessionStorage.getItem('gdx-auc-back') || 'null');
      if (back && back.url === location.pathname + location.search && back.restore) { scrollTo(0, back.y || 0); sessionStorage.removeItem('gdx-auc-back'); }
    } catch (e) {}

    async function load(fresh) {
      document.querySelectorAll('#aucTabs .chip').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
      try { history.replaceState(null, '', 'auction.html?view=buy' + (tab === 'live' ? '' : '&tab=' + tab)); } catch (e) {}
      $('listLead').textContent = {
        live: 'Tap a car to see photos, every bid and comments — then bid.',
        watch: 'Cars you starred ⭐ on this device.',
        bids: 'Auctions you have bid on.',
        mine: 'Auctions you started.',
        ended: 'Finished auctions.'
      }[tab];
      const body = $('listBody');
      if (fresh) body.innerHTML = '<div class="al-list">' + Array(5).fill('<div class="al-row skeleton"><span></span><span></span></div>').join('') + '</div>';
      if ((tab === 'mine' || tab === 'bids') && !me) {
        body.innerHTML = `<div class="panel">${signInBlock(tab === 'mine' ? 'Sign in to see the auctions you started.' : 'Sign in to see the auctions you bid on.')}</div>`;
        rows = []; return;
      }
      const iso = new Date(now()).toISOString();
      let q = sb.from('auctions').select(COLS);
      myBids = null;
      if (tab === 'live') q = q.eq('status', 'live').gt('end_time', iso).limit(200);
      if (tab === 'ended') q = q.or(`status.eq.sold,and(status.eq.live,end_time.lte.${iso})`).order('end_time', { ascending: false }).limit(60);
      if (tab === 'mine') q = q.eq('seller_id', me).order('created_at', { ascending: false }).limit(100);
      if (tab === 'watch') {
        const ids = store.get(WATCH, []);
        if (!ids.length) { rows = []; body.innerHTML = emptyBox('Tap ☆ on any auction to watch it here.', 'See live auctions', 'auction.html?view=buy'); return; }
        q = q.in('id', ids);
      }
      if (tab === 'bids') {
        const r = await sb.from('auction_bids').select('auction_id,amount').order('created_at', { ascending: false }).limit(300);
        if (r.error) { body.innerHTML = `<p class="empty">${esc(errMsg(r.error))}</p>`; return; }
        myBids = {};
        (r.data || []).forEach(b => { myBids[b.auction_id] = Math.max(myBids[b.auction_id] || 0, b.amount); });
        const ids = Object.keys(myBids);
        if (!ids.length) { rows = []; body.innerHTML = emptyBox('You haven\'t bid on anything yet.', 'See live auctions', 'auction.html?view=buy'); return; }
        q = q.in('id', ids);
      }
      const { data, error } = await q;
      if (error) {
        body.innerHTML = /auctions|relation|schema/i.test(error.message)
          ? '<p class="empty">Auctions are being set up — check back soon.</p>'
          : `<p class="empty">Couldn't load auctions. ${esc(errMsg(error))}</p>`;
        return;
      }
      // flash rows whose bid changed since the last refresh
      const changed = new Set();
      (data || []).forEach(a => { if (lastBids[a.id] != null && lastBids[a.id] !== a.current_bid) changed.add(a.id); lastBids[a.id] = a.current_bid; });
      rows = data || [];
      try {
        const c = await sb.rpc('auction_comment_counts', { p_ids: rows.map(a => a.id) });
        comments = {}; (c.data || []).forEach(x => { comments[x.auction_id] = x.n; });
      } catch (e) { comments = {}; }
      draw(changed);
    }

    function draw(changed) {
      changed = changed instanceof Set ? changed : new Set();
      const body = $('listBody');
      if (!rows.length && body.querySelector('.panel, .empty')) return;
      const term = $('alSearch').value.trim().toLowerCase();
      let list = rows.filter(a => !term || [a.title, a.description, a.seller_name].join(' ').toLowerCase().includes(term));
      if ($('alBin').checked) list = list.filter(a => a.buy_now_price && isLive(a));
      const cur = a => a.current_bid != null ? a.current_bid : a.start_price;
      const sorters = {
        ending: (x, y) => (isLive(y) - isLive(x)) || (isLive(x) ? new Date(x.end_time) - new Date(y.end_time) : new Date(y.end_time) - new Date(x.end_time)),
        new: (x, y) => new Date(y.created_at) - new Date(x.created_at),
        low: (x, y) => cur(x) - cur(y),
        high: (x, y) => cur(y) - cur(x),
        bids: (x, y) => y.bid_count - x.bid_count
      };
      list.sort(sorters[$('alSort').value] || sorters.ending);
      if (!list.length) {
        body.innerHTML = rows.length ? emptyBox('No auctions match your search.')
          : {
              live: emptyBox('No live auctions right now.', '+ Sell a car', 'auction.html?new=1'),
              watch: emptyBox('Nothing on your watchlist yet.'),
              ended: emptyBox('No finished auctions yet.'),
              mine: emptyBox('You haven\'t started an auction yet.', '+ Sell a car', 'auction.html?new=1'),
              bids: emptyBox('You haven\'t bid on anything yet.')
            }[tab];
        return;
      }
      body.innerHTML = `
        <div class="al-list" role="table" aria-label="Auctions">
          <div class="al-row al-headrow" role="row">
            <span role="columnheader">Car</span><span role="columnheader">Highest bid</span><span role="columnheader">Next bid</span>
            <span role="columnheader">Buy Now</span><span role="columnheader">Ends in</span><span></span>
          </div>
          ${list.map(a => row(a, changed.has(a.id))).join('')}
        </div>
        <p class="muted small al-foot">${list.length} auction${list.length === 1 ? '' : 's'} · updates every 10 seconds</p>`;
    }

    function row(a, flash) {
      const live = isLive(a), done = ended(a);
      const mineWin = me && a.current_bidder === me, mineSeller = me && a.seller_id === me;
      let pill = '';
      if (a.status === 'cancelled') pill = '<span class="auc-pill">Cancelled</span>';
      else if (a.status === 'removed') pill = '<span class="auc-pill">Removed</span>';
      else if (myBids && me) pill = mineWin ? `<span class="auc-pill ${done ? 'won' : 'win'}">${done ? 'You won' : 'You\'re winning'}</span>`
                                            : `<span class="auc-pill out">${done ? 'Not won' : 'Outbid'}</span>`;
      else if (mineWin) pill = `<span class="auc-pill ${done ? 'won' : 'win'}">${done ? 'You won' : 'You\'re winning'}</span>`;
      else if (mineSeller) pill = '<span class="auc-pill">Your auction</span>';
      const n = comments[a.id] || 0;
      const w = watching(a.id);
      return `
        <a class="al-row${live ? '' : ' is-done'}${flash ? ' flash' : ''}" role="row" href="auction.html?id=${encodeURIComponent(a.id)}">
          <span class="al-car" role="cell">
            <span class="al-thumb"><img src="${esc(url(a.photo_path))}" alt="" loading="lazy"></span>
            <span class="al-name"><b>${esc(a.title)}</b>
              <small>by ${esc(a.seller_name)} · ${a.bid_count} bid${a.bid_count === 1 ? '' : 's'}${n ? ` · 💬 ${n}` : ''}</small>
              ${pill}</span>
          </span>
          <span class="al-cell al-bid" role="cell"><small class="al-k">${a.current_bid != null ? (done ? 'Winning bid' : 'Highest bid') : 'Starting bid'}</small>
            <b>${money(a.current_bid != null ? a.current_bid : a.start_price)}</b>
            ${a.current_bid != null ? `<small>${esc(a.current_bidder_label || '')}${mineWin ? ' (you)' : ''}</small>` : '<small>No bids yet</small>'}</span>
          <span class="al-cell" role="cell"><small class="al-k">Next bid</small>${live ? `<b>${money(nextMin(a))}</b><small>+${money(step(a))} steps</small>` : '<span class="muted">—</span>'}</span>
          <span class="al-cell" role="cell"><small class="al-k">Buy Now</small>${a.buy_now_price ? `<b class="al-bin">${money(a.buy_now_price)}</b>` : '<span class="muted">—</span>'}</span>
          <span class="al-cell" role="cell"><small class="al-k">Ends in</small>${live
            ? `<b class="auc-time${urgent(a) ? ' urgent' : ''}" data-ends="${esc(a.end_time)}">${left(a)}</b><small>${fmtDate(a.end_time)}</small>`
            : `<b class="auc-time ended">${a.status === 'live' || a.status === 'sold' ? (a.bid_count ? 'Sold' : 'Ended') : esc(a.status)}</b>`}</span>
          <span class="al-act" role="cell">
            <button type="button" class="al-star${w ? ' on' : ''}" data-watch="${esc(a.id)}" aria-pressed="${w}" aria-label="Watch">${w ? '★' : '☆'}</button>
            <span class="al-go">${live && !mineSeller ? 'Bid' : 'View'} ›</span>
          </span>
        </a>`;
    }
  }

  function emptyBox(text, btn, href) {
    return `<div class="panel empty">${esc(text)}${btn ? `<br><br><a class="btn btn-primary" href="${href}">${esc(btn)}</a>` : ''}</div>`;
  }

  // =================================================================
  //  ONE AUCTION — photos, bidding, every bid and comments
  // =================================================================
  async function showDetail(id) {
    $('detailView').hidden = false;
    const box = $('detailBody');
    box.innerHTML = '<p class="empty">Loading…</p>';
    let a = null, bids = [], notes = [], contact = null, busy = false, lastBidSeen = null, shot = 0, drew = false;
    // "+₹ step" the buyer picked: the bid box follows the current bid + this step
    const STEP_KEY = 'gdx-auc-step-' + id;
    let autoStep = Number(sessionStorage.getItem(STEP_KEY) || 0) || 0;
    let typed = false;

    // Back to the list, at the same scroll position
    try {
      const back = JSON.parse(sessionStorage.getItem('gdx-auc-back') || 'null');
      if (back && back.url) {
        $('backList').href = back.url;
        $('backList').onclick = () => { back.restore = true; sessionStorage.setItem('gdx-auc-back', JSON.stringify(back)); };
      }
    } catch (e) {}

    async function load() {
      let r = await sb.from('auctions').select(COLS_X).eq('id', id).maybeSingle();
      if (r.error && /extra_photos/.test(r.error.message || '')) r = await sb.from('auctions').select(COLS).eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      const [b, c] = await Promise.all([
        sb.rpc('auction_bids_for', { p_auction: id }),
        sb.rpc('auction_comments_for', { p_auction: id })
      ]);
      a = r.data; bids = b.error ? [] : (b.data || []); notes = c.error ? [] : (c.data || []);
      if (a && ended(a) && me && (me === a.seller_id || me === a.current_bidder) && !contact) {
        const k = await sb.rpc('auction_contact', { p_auction: id });
        contact = k.error ? null : (k.data || [])[0] || null;
      }
    }

    async function refresh(first) {
      if (busy) return;
      try { await load(); }
      catch (e) { if (first) box.innerHTML = `<p class="empty">Couldn't load this auction. ${esc(errMsg(e))}</p>`; return; }
      if (!a) { box.innerHTML = '<div class="panel empty">This auction doesn\'t exist or was removed.<br><br><a class="btn btn-primary" href="auction.html?view=buy">See all auctions</a></div>'; return; }
      if (!first && me && lastBidSeen && lastBidSeen.bidder === me && a.current_bidder !== me && isLive(a))
        toast(`You've been outbid by ${a.current_bidder_label} — new bid ${money(a.current_bid)}`, 'warn');
      const priceMoved = lastBidSeen && lastBidSeen.amount !== a.current_bid;
      lastBidSeen = { bidder: a.current_bidder, amount: a.current_bid };
      // keep what the user is typing (comment or manual bid) across refreshes
      const keepBid = $('bidAmt') && typed ? $('bidAmt').value : null;
      const keepNote = $('noteText') ? $('noteText').value : '';
      const noteFocus = document.activeElement === $('noteText');
      render();
      if ($('bidAmt')) {
        if (keepBid != null && Number(keepBid) >= nextMin(a) && !priceMoved) { $('bidAmt').value = keepBid; }
        else { typed = false; setAmount(); }
      }
      if ($('noteText')) { $('noteText').value = keepNote; if (noteFocus) $('noteText').focus(); }
    }

    // amount in the bid box = current bid + chosen step (never below the minimum)
    function stepAmount(s) {
      const base = a.current_bid != null ? a.current_bid : a.start_price - (s || 0);
      return Math.max(nextMin(a), base + (s || 0));
    }
    function setAmount() {
      const inp = $('bidAmt'); if (!inp) return;
      inp.value = autoStep ? stepAmount(autoStep) : nextMin(a);
      syncBidButton();
    }
    function syncBidButton() {
      const v = Number($('bidAmt').value || 0);
      $('bidBtn').textContent = v ? `Place bid ${money(v)}` : 'Place bid';
      document.querySelectorAll('#stepChips .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.s) === autoStep && !typed));
    }

    function statusBox() {
      if (a.status === 'cancelled') return '<div class="notice">The seller cancelled this auction.</div>';
      if (a.status === 'removed') return '<div class="notice bad">This auction was removed by GDX.</div>';
      if (!ended(a)) {
        if (!me) return '';
        if (a.seller_id === me) return '<div class="auc-banner">This is your auction. You\'ll see the winner\'s contact here when it ends.</div>';
        if (a.current_bidder === me) return '<div class="auc-banner win">You\'re the highest bidder 🎉</div>';
        if (bids.some(b => b.is_me)) return '<div class="auc-banner out">You\'ve been outbid — bid again to win.</div>';
        return '';
      }
      if (!a.current_bidder) return '<div class="auc-banner">Auction ended with no bids.</div>';
      const price = money(a.current_bid);
      if (me === a.current_bidder) {
        const c = contact || {};
        const wa = c.seller_whatsapp ? '91' + c.seller_whatsapp : null;
        return `<div class="auc-result won">
          <div class="auc-result-ico">🏆</div>
          <h3>You won${a.status === 'sold' ? ' with Buy Now' : ''}!</h3>
          <p>Winning bid <b>${price}</b>. Contact <b>${esc(c.seller_name || a.seller_name)}</b> to arrange payment and delivery.</p>
          <div class="auc-result-actions">
            ${wa ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink(wa, `Hi! I won your GDX auction "${a.title}" for ${price}. ${location.href}`))}">WhatsApp seller</a>` : ''}
            ${c.seller_email ? `<a class="btn btn-ghost" href="mailto:${esc(c.seller_email)}">Email seller</a>` : ''}
          </div></div>`;
      }
      if (me === a.seller_id) {
        const c = contact || {};
        return `<div class="auc-result">
          <div class="auc-result-ico">🔨</div>
          <h3>Sold for ${price}</h3>
          <p>Winner: <b>${esc(c.winner_name || a.current_bidder_label)}</b>${c.winner_email ? ` · ${esc(c.winner_email)}` : ''}</p>
          <div class="auc-result-actions">
            ${c.winner_phone ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(waLink('91' + c.winner_phone, `Hi! You won my GDX auction "${a.title}" for ${price}.`))}">WhatsApp winner</a>` : ''}
            ${c.winner_email ? `<a class="btn btn-ghost" href="mailto:${esc(c.winner_email)}?subject=${encodeURIComponent('You won: ' + a.title)}">Email winner</a>` : ''}
          </div>
          ${!c.winner_phone ? '<p class="muted small">The winner hasn\'t added a mobile number — use email. They can also WhatsApp you.</p>' : ''}
          </div>`;
      }
      return `<div class="auc-banner">Ended — won by <b>${esc(a.current_bidder_label)}</b> for <b>${price}</b>.</div>`;
    }

    function stepsFor() {
      const s = step(a);
      const set = new Set([s, 10, 50, 100, 500].filter(v => v >= s));
      return [...set].sort((x, y) => x - y).slice(0, 5);
    }

    function bidBox() {
      if (!isLive(a)) return '';
      if (!me) return signInBlock('Sign in with Google to bid.');
      if (a.seller_id === me) {
        return a.bid_count === 0
          ? '<button class="btn btn-ghost btn-block" id="cancelBtn">Cancel auction</button><p class="muted small center">You can cancel only before the first bid.</p>'
          : '';
      }
      if (a.current_bidder === me) return '<p class="muted small">You\'ll be told here if someone outbids you. You can\'t outbid yourself.</p>' +
        (a.buy_now_price ? `<button class="btn btn-dark btn-block" id="binBtn">Buy Now for ${money(a.buy_now_price)}</button>` : '');
      const min = nextMin(a);
      return `
        <form id="bidForm" class="auc-bid" novalidate>
          ${isLate(a) ? `<div class="auc-late">⏱ <b>Final 2 minutes</b> — bids must be ${money(step(a))} higher, and each bid resets the clock to 2:00.</div>` : ''}
          <span class="auc-k">Bid step — tap once, your bid keeps following the highest bid + this amount</span>
          <div class="auc-quick" id="stepChips">
            ${stepsFor().map(s => `<button type="button" class="chip" data-s="${s}">+${money(s)}</button>`).join('')}
          </div>
          <label for="bidAmt" class="auc-k">Your bid (${money(min)} or more)</label>
          <div class="auc-bid-row">
            <button type="button" class="btn btn-ghost ad-pm" data-pm="-1" aria-label="Lower">−</button>
            <div class="auc-money"><span>₹</span><input id="bidAmt" class="input" type="number" inputmode="numeric" min="${min}" step="1" value="${min}" required></div>
            <button type="button" class="btn btn-ghost ad-pm" data-pm="1" aria-label="Higher">+</button>
          </div>
          <button class="btn btn-primary btn-block ad-bidbtn" id="bidBtn">Place bid</button>
          <div class="form-error" id="bidErr" hidden></div>
        </form>
        ${a.buy_now_price ? `<button class="btn btn-dark btn-block" id="binBtn">Buy Now for ${money(a.buy_now_price)}</button>` : ''}`;
    }

    // Facebook-style activity: auction started → every bid and comment, oldest first
    function feed() {
      const items = [{ t: 'start', at: a.created_at }]
        .concat(bids.map(b => ({ t: 'bid', at: b.created_at, b })))
        .concat(notes.map(n => ({ t: 'note', at: n.created_at, n })))
        .sort((x, y) => new Date(x.at) - new Date(y.at));
      const topAmt = bids.length ? Math.max(...bids.map(b => b.amount)) : null;
      return items.map(it => {
        if (it.t === 'start') return `<li class="af-item af-sys"><span class="af-ico">🏁</span><span><b>${esc(a.seller_name)}</b> started this auction at <b>${money(a.start_price)}</b> · +${money(a.min_increment)} steps${a.buy_now_price ? ` · Buy Now ${money(a.buy_now_price)}` : ''}<small>${ago(it.at)}</small></span></li>`;
        if (it.t === 'bid') {
          const b = it.b;
          return `<li class="af-item af-bid${b.is_me ? ' me' : ''}${b.amount === topAmt ? ' top' : ''}"><span class="af-ico">${b.is_buy_now ? '⚡' : '🔨'}</span>
            <span><b>${esc(b.bidder)}${b.is_me ? ' (you)' : ''}</b> ${b.is_buy_now ? 'bought it with Buy Now for' : 'bid'} <b class="af-amt">${money(b.amount)}</b>${b.amount === topAmt && !ended(a) ? ' <span class="auc-pill win">Highest</span>' : ''}<small>${ago(b.created_at)}</small></span></li>`;
        }
        const n = it.n;
        return `<li class="af-item af-note${n.is_me ? ' me' : ''}"><span class="af-av">${initial(n.author)}</span>
          <span class="af-bubble"><b>${esc(n.author)}${n.is_seller ? ' <span class="pill ok-pill af-seller">Seller</span>' : ''}</b>
            <span class="af-text">${esc(n.body)}</span>
            <small>${ago(n.created_at)}${n.can_delete ? ` · <button type="button" class="link-btn af-del" data-del="${n.id}">Delete</button>` : ''}</small></span></li>`;
      }).join('');
    }

    function render() {
      document.title = a.title + ' — Auction — GDX';
      const live = isLive(a), pics = photos(a);
      if (shot >= pics.length) shot = 0;
      box.innerHTML = `
        <div class="ad-grid">
          <div class="ad-media">
            <button type="button" class="gallery-main auc-photo ad-main" id="mainPic" aria-label="Open photo"><img src="${esc(pics[shot])}" alt="${esc(a.title)}"></button>
            ${pics.length > 1 ? `<div class="thumbs">${pics.map((p, i) => `<button type="button" class="thumb${i === shot ? ' active' : ''}" data-shot="${i}"><img src="${esc(p)}" alt="Photo ${i + 1}" loading="lazy"></button>`).join('')}</div>` : ''}
            ${me && a.seller_id === me && live && pics.length < 6 ? `<label class="upload small-upload ad-addpics"><input type="file" id="morePics" accept="image/*" multiple>📷 Add more photos (${6 - pics.length} left)</label>` : ''}
          </div>
          <div class="details">
            <div class="ad-top">
              <span class="card-brand">Auction · by ${esc(a.seller_name)}</span>
              <button type="button" class="al-star ad-star${watching(a.id) ? ' on' : ''}" id="starBtn" aria-pressed="${watching(a.id)}">${watching(a.id) ? '★ Watching' : '☆ Watch'}</button>
            </div>
            <h1 class="product-title">${esc(a.title)}</h1>
            ${a.description ? `<p class="desc">${esc(a.description).replace(/\n/g, '<br>')}</p>` : ''}
            <div class="auc-panel">
              <div class="auc-stats">
                <div><span class="auc-k">${a.current_bid != null ? (live ? 'Highest bid' : 'Winning bid') : 'Starting bid'}</span>
                     <b class="auc-big">${money(a.current_bid != null ? a.current_bid : a.start_price)}</b>
                     ${a.current_bid != null ? `<span class="muted small">by ${esc(a.current_bidder_label)}${a.current_bidder === me ? ' (you)' : ''}</span>` : ''}</div>
                <div class="auc-right"><span class="auc-k">${live ? 'Ends in' : 'Ended'}</span>
                     ${live ? `<b class="auc-big auc-time${urgent(a) ? ' urgent' : ''}" data-ends="${esc(a.end_time)}">${left(a)}</b>`
                            : `<b class="auc-big">${fmtDate(a.closed_at && a.status !== 'live' ? a.closed_at : a.end_time)}</b>`}
                     ${live ? `<span class="muted small">${fmtDate(a.end_time)}</span>` : ''}
                     ${a.extensions ? `<span class="auc-ext">Extended ${a.extensions}× by late bids</span>` : ''}</div>
              </div>
              <ul class="auc-facts">
                <li><span>Starting bid</span><b>${money(a.start_price)}</b></li>
                <li><span>Min. step</span><b>${money(a.min_increment)}</b></li>
                <li><span>Last 2 min</span><b>+${money(Math.max(a.min_increment, LATE_STEP))}</b></li>
                ${a.buy_now_price ? `<li><span>Buy Now</span><b>${money(a.buy_now_price)}</b></li>` : ''}
                <li><span>Bids</span><b>${a.bid_count}</b></li>
              </ul>
              ${statusBox()}
              ${bidBox()}
            </div>
            <div class="auc-share"><button class="link-btn" id="shareBtn">↗ Share this auction</button></div>
          </div>
        </div>

        <section class="panel ad-feed">
          <h2 class="panel-title">Bids &amp; comments <span class="muted small">· ${bids.length} bid${bids.length === 1 ? '' : 's'} · ${notes.length} comment${notes.length === 1 ? '' : 's'}</span></h2>
          <ol class="af-list">${feed()}</ol>
          ${a.status === 'removed' ? '' : me ? `
            <form class="af-compose" id="noteForm" novalidate>
              <span class="af-av">${initial((Auth.profile && Auth.profile.full_name) || Auth.user.email)}</span>
              <textarea class="input" id="noteText" rows="1" maxlength="500" placeholder="Write a comment… (ask about condition, card, delivery)"></textarea>
              <button class="btn btn-primary" id="noteBtn">Post</button>
            </form>` : signInBlock('Sign in with Google to comment.')}
        </section>

        ${live && me && a.seller_id !== me && a.current_bidder !== me ? `
          <div class="ad-sticky" id="stickyBar">
            <span><small class="muted">Highest</small><b>${money(a.current_bid != null ? a.current_bid : a.start_price)}</b></span>
            <span><small class="muted">Ends</small><b class="auc-time" data-ends="${esc(a.end_time)}">${left(a)}</b></span>
            <button class="btn btn-primary" id="stickyBid">Bid ${money(autoStep ? stepAmount(autoStep) : nextMin(a))}</button>
          </div>` : ''}`;
      wire();
      if (!drew) { drew = true; }
    }

    function wire() {
      // photos
      document.querySelectorAll('[data-shot]').forEach(t => t.onclick = () => { shot = Number(t.dataset.shot); render(); setAmount(); });
      $('mainPic').onclick = () => { $('zoomImg').src = photos(a)[shot]; $('photoDlg').showModal(); };
      $('photoDlg').onclick = e => { if (e.target === $('photoDlg') || e.target.closest('.ad-zoom-x')) $('photoDlg').close(); };
      const more = $('morePics');
      if (more) more.onchange = () => addPhotos([...more.files]);
      $('starBtn').onclick = () => { const on = toggleWatch(a.id); toast(on ? 'Added to Watching ⭐' : 'Removed from Watching', 'ok'); render(); setAmount(); };

      const f = $('bidForm');
      if (f) {
        $('stepChips').onclick = e => {
          const c = e.target.closest('.chip'); if (!c) return;
          autoStep = Number(c.dataset.s); typed = false;
          try { sessionStorage.setItem(STEP_KEY, autoStep); } catch (x) {}
          setAmount(); $('bidAmt').focus();
        };
        f.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => {
          const s = autoStep || step(a), v = Number($('bidAmt').value || nextMin(a)) + Number(b.dataset.pm) * s;
          $('bidAmt').value = Math.max(nextMin(a), v); typed = true; syncBidButton();
        });
        $('bidAmt').oninput = () => { typed = true; syncBidButton(); };
        f.onsubmit = e => { e.preventDefault(); placeBid(Number($('bidAmt').value.trim()), $('bidAmt').value.trim()); };
      }
      const sticky = $('stickyBid');
      if (sticky) sticky.onclick = () => {
        const v = $('bidAmt') ? $('bidAmt').value.trim() : String(nextMin(a));
        placeBid(Number(v), v);
      };
      const bin = $('binBtn');
      if (bin) bin.onclick = async () => {
        const ok = await confirmBox(`Buy now for ${money(a.buy_now_price)}?`,
          'This ends the auction immediately and you win the car at this price. It can\'t be undone.', 'Buy Now');
        if (!ok) return;
        busy = true; bin.disabled = true;
        const { error } = await sb.rpc('buy_now', { p_auction: a.id });
        busy = false;
        if (error) { toast(errMsg(error), 'warn'); bin.disabled = false; return refresh(false); }
        toast('You won it! Contact the seller below.', 'ok');
        contact = null; await refresh(false);
      };
      const cancel = $('cancelBtn');
      if (cancel) cancel.onclick = async () => {
        if (!(await confirmBox('Cancel this auction?', 'It will be closed and nobody can bid.', 'Cancel auction'))) return;
        const { error } = await sb.rpc('cancel_auction', { p_auction: a.id });
        if (error) { toast(errMsg(error), 'warn'); return refresh(false); }
        toast('Auction cancelled', 'ok'); refresh(false);
      };
      $('shareBtn').onclick = async () => {
        const link = location.origin + location.pathname + '?id=' + a.id;
        const text = `${a.title} — bid on GDX Auctions`;
        try {
          if (navigator.share) await navigator.share({ title: text, url: link });
          else { await navigator.clipboard.writeText(link); toast('Link copied', 'ok'); }
        } catch (e) { /* closed */ }
      };
      // comments
      const nf = $('noteForm');
      if (nf) {
        const ta = $('noteText');
        ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; };
        ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); nf.requestSubmit(); } };
        nf.onsubmit = async e => {
          e.preventDefault();
          const body = ta.value.trim(); if (!body) return;
          $('noteBtn').disabled = true;
          const { error } = await sb.rpc('add_auction_comment', { p_auction: a.id, p_body: body });
          $('noteBtn').disabled = false;
          if (error) return toast(errMsg(error), 'warn');
          ta.value = ''; await refresh(false);
          const list = document.querySelector('.af-list'); if (list && list.lastElementChild) list.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
      }
      document.querySelectorAll('[data-del]').forEach(d => d.onclick = async () => {
        if (!confirm('Delete this comment?')) return;
        const { error } = await sb.rpc('delete_auction_comment', { p_id: Number(d.dataset.del) });
        if (error) return toast(errMsg(error), 'warn');
        refresh(false);
      });
    }

    async function placeBid(amt, raw) {
      const err = $('bidErr'); if (err) err.hidden = true;
      const fail = m => { if (err) { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else toast(m, 'warn'); };
      const min = nextMin(a);
      if (!/^\d+$/.test(String(raw))) return fail('Enter a whole rupee amount, e.g. ' + min);
      if (amt < min) return fail(a.current_bid == null ? `Bid at least the starting bid of ${money(min)}.`
        : `Bid at least ${money(min)} (highest bid + ${money(step(a))}${isLate(a) ? ' in the final 2 minutes' : ''}).`);
      if (a.buy_now_price && amt >= a.buy_now_price) return fail(`That's at or above the Buy Now price — use Buy Now for ${money(a.buy_now_price)}.`);
      const big = amt >= min * 3 && amt - min >= 1000;
      const ok = await confirmBox(`Bid ${money(amt)}?`,
        `${big ? '<b>That\'s much higher than the minimum bid of ' + money(min) + '.</b> ' : ''}Bids are final and can't be withdrawn. If you win, you agree to buy at this price.`,
        'Place bid');
      if (!ok) return;
      busy = true; if ($('bidBtn')) $('bidBtn').disabled = true;
      const { error } = await sb.rpc('place_bid', { p_auction: a.id, p_amount: amt });
      busy = false;
      if (error) { await refresh(false); return fail(errMsg(error)); }
      toast(`Bid placed: ${money(amt)} — you're the highest bidder`, 'ok');
      typed = false;
      await refresh(false);
    }

    async function addPhotos(files) {
      const room = 6 - photos(a).length;
      files = files.filter(f => /^image\//.test(f.type)).slice(0, room);
      if (!files.length) return;
      toast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
      const paths = [];
      for (const f of files) {
        try {
          const blob = await shrink(f);
          const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
          const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
          if (up.error) throw up.error;
          paths.push(path);
        } catch (e) { toast('A photo failed to upload: ' + errMsg(e), 'warn'); }
      }
      if (!paths.length) return;
      const { error } = await sb.rpc('add_auction_photos', { p_auction: a.id, p_paths: paths });
      if (error) return toast(errMsg(error), 'warn');
      toast('Photos added', 'ok'); refresh(false);
    }

    await refresh(true);
    poll(() => refresh(false), 4000);
  }

  // =================================================================
  //  SELL — start an auction (Google sign-in + WhatsApp required)
  // =================================================================
  function showNew() {
    $('newView').hidden = false;
    const body = $('newBody');
    if (!me) { body.innerHTML = `<div class="panel">${signInBlock('Sign in with Google to sell by auction. Buyers and sellers must be signed in.')}</div>`; return; }
    const p = Auth.profile || {};
    const pad = n => String(n).padStart(2, '0');
    const local = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const inDays = n => { const d = new Date(now() + n * 864e5); d.setSeconds(0, 0); return d; };

    body.innerHTML = `
      <form id="newForm" class="panel" novalidate>
        <div class="field"><label>Photos of the car * <span class="muted small">(up to 6 — the first is the cover)</span></label>
          <div class="ad-picks" id="picks"></div>
          <label class="upload" id="upBox"><input type="file" id="photo" accept="image/*" multiple>
            <span id="upText">📷 Tap to add photos<br><span class="muted small">Clear, well-lit — card front, back and any damage</span></span></label></div>
        <div class="field"><label for="title">Title *</label>
          <input id="title" class="input" maxlength="80" placeholder="e.g. Hot Wheels '71 Datsun 510 — Super Treasure Hunt"></div>
        <div class="field"><label for="desc">Description</label>
          <textarea id="desc" class="input" rows="3" maxlength="600" placeholder="Condition, card, year, anything buyers should know"></textarea></div>
        <div class="three">
          <div class="field"><label for="start">Starting bid (₹) *</label><input id="start" class="input" type="number" inputmode="numeric" min="1" step="1" placeholder="100"></div>
          <div class="field"><label for="inc">Min. step (₹) *</label><input id="inc" class="input" type="number" inputmode="numeric" min="1" step="1" value="10"></div>
          <div class="field"><label for="bin">Buy Now (₹)</label><input id="bin" class="input" type="number" inputmode="numeric" min="1" step="1" placeholder="Optional"></div>
        </div>
        <div class="field"><label for="end">Ends at *</label>
          <div class="chips auc-ends" id="endChips">
            <button type="button" class="chip" data-d="1">1 day</button>
            <button type="button" class="chip active" data-d="3">3 days</button>
            <button type="button" class="chip" data-d="7">7 days</button>
          </div>
          <input id="end" class="input" type="datetime-local" value="${local(inDays(3))}" min="${local(new Date(now() + 16 * 60000))}" max="${local(inDays(30))}">
          <span class="muted small">Between 15 minutes and 30 days from now. Bidding closes exactly at this time.</span></div>
        <div class="field"><label for="wa">Your WhatsApp number * <span class="muted small">(required to sell)</span></label>
          <input id="wa" class="input" type="tel" inputmode="numeric" maxlength="14" placeholder="10-digit mobile" value="${esc(p.phone || '')}">
          <span class="muted small">Shown only to the winner after the auction ends.</span></div>
        <div class="form-error" id="newErr" hidden></div>
        <button class="btn btn-primary btn-block" id="newSubmit">Start auction</button>
        <p class="muted small center">Once someone bids, the auction can't be edited or cancelled. You can still add more photos.</p>
      </form>`;

    let files = [];
    function drawPicks() {
      $('picks').innerHTML = files.map((f, i) => `<span class="ad-pick"><img src="${URL.createObjectURL(f)}" alt="">${i === 0 ? '<em>Cover</em>' : ''}<button type="button" data-rm="${i}" aria-label="Remove">✕</button></span>`).join('');
      $('upBox').classList.toggle('has-file', files.length > 0);
      $('upText').innerHTML = files.length >= 6 ? '6 photos — that\'s the maximum' : files.length ? `📷 Add more (${6 - files.length} left)` : '📷 Tap to add photos<br><span class="muted small">Clear, well-lit — card front, back and any damage</span>';
      $('photo').disabled = files.length >= 6;
    }
    drawPicks();
    $('photo').onchange = async e => {
      for (const f of [...e.target.files].slice(0, 6 - files.length)) {
        if (!/^image\//.test(f.type)) continue;
        try { files.push(await shrink(f)); } catch (err) { toast('Couldn\'t read a photo — try JPG or PNG.', 'warn'); }
      }
      e.target.value = ''; drawPicks();
    };
    $('picks').onclick = e => { const b = e.target.closest('[data-rm]'); if (!b) return; files.splice(Number(b.dataset.rm), 1); drawPicks(); };
    $('endChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      document.querySelectorAll('#endChips .chip').forEach(x => x.classList.toggle('active', x === c));
      $('end').value = local(inDays(Number(c.dataset.d)));
    });
    $('end').oninput = () => document.querySelectorAll('#endChips .chip').forEach(x => x.classList.remove('active'));

    $('newForm').onsubmit = async e => {
      e.preventDefault();
      const err = $('newErr'); err.hidden = true;
      const fail = m => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      const title = $('title').value.trim(), desc = $('desc').value.trim();
      const whole = id => { const v = $(id).value.trim(); return v === '' ? null : (/^\d+$/.test(v) ? Number(v) : NaN); };
      const start = whole('start'), inc = whole('inc'), bin = whole('bin');
      const endVal = $('end').value, end = endVal ? new Date(endVal) : null;
      let wa = $('wa').value.replace(/\D/g, ''); if (wa.length === 12 && wa.startsWith('91')) wa = wa.slice(2);
      if (!files.length) return fail('Please add at least one photo of the car.');
      if (title.length < 3) return fail('Please enter a title (at least 3 letters).');
      if (!start || start < 1) return fail('Starting bid must be a whole amount of at least ₹1.');
      if (!inc || inc < 1) return fail('Minimum step must be a whole amount of at least ₹1.');
      if (Number.isNaN(bin)) return fail('Buy Now must be a whole rupee amount (or leave it empty).');
      if (bin != null && bin < start + inc) return fail(`Buy Now must be at least ${money(start + inc)} (starting bid + step), or leave it empty.`);
      if (!end || isNaN(end)) return fail('Please choose when the auction ends.');
      if (end.getTime() < now() + 15 * 60000) return fail('End time must be at least 15 minutes from now.');
      if (end.getTime() > now() + 30 * 864e5) return fail('End time can be at most 30 days from now.');
      if (!/^[6-9]\d{9}$/.test(wa)) return fail('Please enter a valid 10-digit WhatsApp number — it\'s required to sell.');

      const ok = await confirmBox('Start this auction?',
        `${files.length} photo${files.length > 1 ? 's' : ''} · starting bid ${money(start)}, +${money(inc)} steps${bin ? `, Buy Now ${money(bin)}` : ''}.<br>Ends ${esc(fmtDate(end))}.`, 'Start auction');
      if (!ok) return;
      const btn = $('newSubmit'); btn.disabled = true;
      const paths = [];
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `Uploading photo ${i + 1} of ${files.length}…`;
        const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, files[i], { contentType: 'image/jpeg', upsert: false });
        if (up.error) {
          if (paths.length) sb.storage.from(BUCKET).remove(paths).catch(() => {});
          btn.disabled = false; btn.textContent = 'Start auction';
          return fail('Photo upload failed: ' + errMsg(up.error));
        }
        paths.push(path);
      }
      btn.textContent = 'Starting…';
      const { data, error } = await sb.rpc('create_auction', {
        p_title: title, p_description: desc, p_photo_path: paths[0], p_start_price: start, p_min_increment: inc,
        p_buy_now_price: bin, p_end_time: end.toISOString(), p_whatsapp: wa });
      if (error) {
        sb.storage.from(BUCKET).remove(paths).catch(() => {});
        btn.disabled = false; btn.textContent = 'Start auction';
        return fail(errMsg(error));
      }
      if (paths.length > 1) {
        const r = await sb.rpc('add_auction_photos', { p_auction: data, p_paths: paths.slice(1) });
        if (r.error) toast('Auction is live, but extra photos didn\'t attach: ' + errMsg(r.error), 'warn');
      }
      toast('Your auction is live!', 'ok');
      location.href = 'auction.html?id=' + encodeURIComponent(data);
    };
  }

  // Resize to max 1600px and save as JPEG (keeps uploads small and fast)
  function shrink(f) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.86);
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(f);
    });
  }
})();
