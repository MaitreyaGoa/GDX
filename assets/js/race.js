// =====================================================================
//  GDX Racing — live board, locked race log, registration, host control
//  Ratings (GDX Rating, Elo-style) and records are worked out here from the
//  locked results; the results themselves are written only by the database.
// =====================================================================
(async function () {
  const { C, sb, esc, Auth, ready, signIn, googleButton, toast, errMsg, waLink } = window.MHC;
  const $ = id => document.getElementById(id);
  const TV = /[?&]tv=1/.test(location.search);
  const BUCKET = 'auction-photos';
  const ALL = 'all';
  // Points: every race counts — the more you race, the higher you can climb
  const WIN_PTS = 3, LOSE_PTS = 1, STREAK = 3, STREAK_BONUS = 1;
  let sortBy = 'pts';

  // Host session lives in this tab only (same as the admin panel)
  const host = window.supabase && C.SUPABASE_URL ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
            storage: window.sessionStorage, storageKey: 'mhc-admin-auth' } }) : null;
  let isHost = false;

  let events = [], ev = null, entries = [], races = [], hostInfo = {}, cls = '';
  let slots = [], requests = [], slotView = 'up', slotsErr = false;
  // what to do after Google sign-in brings the member back (join a race, open the tracker)
  const NEXT_KEY = 'gdx-race-next';
  const getNext = () => { try { return JSON.parse(sessionStorage.getItem(NEXT_KEY) || 'null'); } catch (e) { return null; } };
  const setNext = v => { try { v ? sessionStorage.setItem(NEXT_KEY, JSON.stringify(v)) : sessionStorage.removeItem(NEXT_KEY); } catch (e) {} };
  const picks = {}, feeTick = {};   // host's half-filled choices survive the auto-refresh
  const params = new URLSearchParams(location.search);
  const photo = p => p ? sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl : '';
  const when = d => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const carKey = e => (e.user_id || ('walkin:' + e.racer_name.toLowerCase())) + '|' + e.car_name.trim().toLowerCase() + '|' + e.class;

  // ---------------------------------------------------------------- load
  async function loadEvents() {
    const { data, error } = await sb.from('race_events').select('*').order('event_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    events = data || [];
  }
  async function loadEvent() {
    const active = events.find(x => x.status !== 'closed');
    const id = params.get('e') || (active && active.id) || (events[0] && events[0].id) || '';
    const all = id === ALL;
    ev = all ? null : events.find(x => x.id === id) || events[0] || null;
    const cols = 'id,event_id,number,user_id,racer_name,car_name,brand,class,photo_path,status,created_at';
    let qe = sb.from('race_entries').select(cols).order('number'), qr = sb.from('races').select('*').order('seq');
    if (!all) { if (!ev) { entries = []; races = []; return; } qe = qe.eq('event_id', ev.id); qr = qr.eq('event_id', ev.id); }
    const [e, r] = await Promise.all([qe.limit(2000), qr.limit(5000)]);
    if (e.error) throw e.error; if (r.error) throw r.error;
    entries = e.data || []; races = r.data || [];
    slots = []; requests = []; slotsErr = false;
    if (!all && ev) {
      const [sl, rq] = await Promise.all([
        sb.from('race_slots').select('*').eq('event_id', ev.id).order('slot_no').limit(2000),
        sb.from('race_slot_requests').select('*').eq('event_id', ev.id).order('created_at').limit(5000)]);
      slotsErr = !!sl.error; slots = sl.error ? [] : sl.data || []; requests = rq.error ? [] : rq.data || [];
    }
    if (isHost && ev) {
      const h = await host.rpc('race_host_entries', { p_event: ev.id });
      hostInfo = {}; (h.data || []).forEach(x => { hostInfo[x.id] = x; });
    }
  }

  // ---------------------------------------------------------------- stats
  function compute() {
    const byId = {}; entries.forEach(e => { byId[e.id] = e; });
    const allTime = !ev;
    // a car = owner + model (+ class). In "all events" mode the same car is merged across events.
    const keyOf = e => allTime ? carKey(e) : e.id;
    const ownerOf = e => e.user_id || ('walkin:' + e.racer_name.trim().toLowerCase());
    const cars = {}, owners = {};
    entries.forEach(e => {
      const k = keyOf(e);
      if (!cars[k]) cars[k] = { key: k, entry: e, ids: [], pts: 0, bonus: 0, w: 0, l: 0, races: 0, streak: 0, bestStreak: 0, form: [] };
      cars[k].ids.push(e.id);
      if (e.created_at > cars[k].entry.created_at) cars[k].entry = e;
      const o = ownerOf(e);
      if (!owners[o]) owners[o] = { key: o, name: e.racer_name, entry: e, cars: new Set(), pts: 0, w: 0, l: 0, races: 0 };
      owners[o].cars.add(k);
    });
    const live = races.filter(r => !r.voided);
    live.forEach(r => {
      const A = byId[r.lane_a], B = byId[r.lane_b]; if (!A || !B) return;
      const aWon = r.winner === r.lane_a;
      [[A, aWon], [B, !aWon]].forEach(([e, won]) => {
        const c = cars[keyOf(e)], o = owners[ownerOf(e)];
        let got = won ? WIN_PTS : LOSE_PTS;
        c.races++; won ? c.w++ : c.l++;
        c.streak = won ? (c.streak > 0 ? c.streak + 1 : 1) : (c.streak < 0 ? c.streak - 1 : -1);
        if (won && c.streak % STREAK === 0) { got += STREAK_BONUS; c.bonus += STREAK_BONUS; }   // 3 wins in a row → +1
        c.bestStreak = Math.max(c.bestStreak, c.streak);
        c.pts += got;
        c.form.push(won ? 'W' : 'L'); if (c.form.length > 5) c.form.shift();
        o.races++; won ? o.w++ : o.l++; o.pts += got;
      });
    });
    const used = {}; live.forEach(r => { used[r.lane_a] = (used[r.lane_a] || 0) + 1; used[r.lane_b] = (used[r.lane_b] || 0) + 1; });
    return { byId, cars: Object.values(cars), owners: Object.values(owners).map(o => ({ ...o, carCount: o.cars.size })), used, live };
  }

  // ---------------------------------------------------------------- render
  const carThumb = (e, size) => `<span class="rc-thumb${size ? ' ' + size : ''}">${e.photo_path ? `<img src="${esc(photo(e.photo_path))}" alt="" loading="lazy">` : '🏎️'}</span>`;
  const num = e => `<span class="rc-num">#${e.number}</span>`;
  const medal = i => i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const byPoints = (x, y) => y.pts - x.pts || y.w - x.w || x.l - y.l;
  const byWins = (x, y) => y.w - x.w || y.pts - x.pts || x.l - y.l;

  function renderHeader(S) {
    $('evPick').innerHTML = events.map(x => `<option value="${esc(x.id)}"${ev && x.id === ev.id ? ' selected' : ''}>${esc(x.name)} · ${esc(fmtDate(x.event_date))}</option>`).join('') +
      (events.length > 1 ? `<option value="${ALL}"${!ev ? ' selected' : ''}>🏆 All events — all-time records</option>` : '');
    $('tvLink').href = 'race.html?tv=1' + (ev ? '&e=' + ev.id : '');
    if (!ev) {
      $('evName').textContent = events.length ? 'All-time records' : 'GDX Racing';
      $('evStatus').textContent = events.length ? 'All events' : 'Coming soon';
      $('evMeta').textContent = events.length ? `${events.length} events · cars and owners across every GDX race night` : 'The first GDX race night is being set up. Join the WhatsApp community to hear first.';
      $('evChips').innerHTML = ''; $('regJump').hidden = true; return;
    }
    $('regJump').hidden = ev.status === 'closed';
    $('evName').textContent = ev.name;
    $('evStatus').textContent = { open: 'Registration open · starts soon', live: 'Racing live', closed: 'Finished · results locked' }[ev.status];
    $('evStatus').parentElement.classList.toggle('rc-live', ev.status === 'live');
    $('evMeta').textContent = [fmtDate(ev.event_date), ev.venue].filter(Boolean).join(' · ');
    $('evChips').innerHTML = [
      `<span>⚔️ 1 vs 1 races</span>`,
      (() => { const n = slots.find(x => x.status === 'set'), A = n && S.byId[n.lane_a], B = n && S.byId[n.lane_b]; return n && A && B ? `<span class="rc-prize">⏭️ Up next · Race ${n.slot_no}: #${A.number} ${esc(A.car_name)} vs #${B.number} ${esc(B.car_name)}</span>` : ''; })(),
      `<span>🏅 Win +${WIN_PTS} · Loss +${LOSE_PTS} · 🔥 3 wins in a row +${STREAK_BONUS}</span>`,
      ev.prize_info ? `<span class="rc-prize">🏆 ${esc(ev.prize_info)}</span>` : ''
    ].join('');
  }

  function renderLast(S) {
    const r = S.live[S.live.length - 1];
    if (!r) {
      $('lastRace').innerHTML = `<div class="rc-card-head"><h2>Last race</h2></div><div class="rc-empty">🏁<br>${ev && ev.status !== 'closed' ? 'Racing starts soon — results appear here live.' : 'No races yet.'}</div>`;
      return;
    }
    const A = S.byId[r.lane_a], B = S.byId[r.lane_b];
    const carOf = e => S.cars.find(c => c.ids.includes(e.id)) || { w: 0, races: 0, streak: 0 };
    const side = (e, lane, won) => { const c = carOf(e); return `
      <div class="rc-side${won ? ' won' : ' lost'}" data-car="${esc(e.id)}">
        <span class="rc-lane">Lane ${lane}</span>
        ${carThumb(e, 'xl')}
        <b class="rc-car">${num(e)} ${esc(e.car_name)}</b>
        <span class="muted small">${esc(e.racer_name)}</span>
        <span class="rc-res">${won ? 'WON' : 'LOST'}</span>
        <span class="rc-kmh">${plural(c.w, 'win')} from ${plural(c.races, 'race')}${won && c.streak >= 3 ? ` · 🔥 ${c.streak} in a row` : ''}</span>
        ${won ? '<span class="rc-win">🏆 WINNER</span>' : ''}
      </div>`; };
    $('lastRace').innerHTML = `
      <div class="rc-card-head"><h2>Last race <span class="muted small">· Race #${r.seq} · ${esc(r.round)}</span></h2><span class="muted small">${when(r.recorded_at)}</span></div>
      <div class="rc-vs">${side(A, 'A', r.winner === A.id)}<span class="rc-vs-x">VS</span>${side(B, 'B', r.winner === B.id)}</div>
      <div class="rc-flags rc-flags-c">${flagPaid}${flagOk(r.recorded_by)}</div>`;
  }

  // Cars leaderboard (owner + model)
  function renderBoard(S) {
    const classes = ev ? ev.classes : [...new Set(entries.map(e => e.class))];
    if (cls && !classes.includes(cls)) cls = '';
    $('clsChips').innerHTML = ['', ...classes].map(c => `<button class="chip${c === cls ? ' active' : ''}" data-cls="${esc(c)}">${c ? esc(c) : 'All'}</button>`).join('');
    const rows = S.cars.filter(c => c.races && (!cls || c.entry.class === cls))
      .sort(sortBy === 'wins' ? byWins : byPoints).slice(0, TV ? 10 : 50);
    $('leaderboard').innerHTML = rows.length ? `
      <div class="chips rc-sort"><button class="chip${sortBy === 'pts' ? ' active' : ''}" data-sort="pts">By points</button><button class="chip${sortBy === 'wins' ? ' active' : ''}" data-sort="wins">By races won</button></div>
      <div class="rc-table">
        <div class="rc-tr rc-th"><span>#</span><span>Car · owner</span><span>Won</span><span>Raced</span><span>Points</span></div>
        ${rows.map((c, i) => `
          <button type="button" class="rc-tr" data-car="${esc(c.entry.id)}">
            <span class="rc-rank r${i + 1}">${medal(i)}</span>
            <span class="rc-carcell">${carThumb(c.entry)}<span><b>${ev ? num(c.entry) + ' ' : ''}${esc(c.entry.car_name)}</b><small>${esc(c.entry.racer_name)} · ${esc(c.entry.class)}</small>
              <span class="rc-form">${c.form.map(f => `<i class="${f}">${f}</i>`).join('')}${c.streak >= 3 ? ` <em>🔥 ${c.streak} in a row</em>` : ''}</span></span></span>
            <span class="rc-won"><b>${c.w}</b></span>
            <span class="rc-wl"><span>${c.races}</span><small>${c.l} lost</small></span>
            <span class="rc-rating">${c.pts}${c.bonus ? `<small>incl. 🔥+${c.bonus}</small>` : ''}</span>
          </button>`).join('')}
      </div>
      <p class="muted small rc-pts-note">🏅 Win +${WIN_PTS} · Loss +${LOSE_PTS} · 🔥 every 3 wins in a row +${STREAK_BONUS} bonus. Only admin-approved races with the entry fee paid count — race more to climb.</p>`
      : `<div class="rc-empty">No results${cls ? ' in this class' : ''} yet.</div>`;
  }

  // Owners leaderboard (all of an owner's cars together)
  function renderOwners(S) {
    const rows = S.owners.filter(o => o.races).sort(byWins).slice(0, TV ? 8 : 30);
    $('owners').innerHTML = rows.length ? `
      <ol class="rc-fastlist rc-owners">${rows.map((o, i) => `
        <li><span class="rc-rank">${medal(i)}</span><span class="rc-ava">${esc((o.name || '?').trim().charAt(0).toUpperCase())}</span>
          <span><b>${esc(o.name)}</b><small>${plural(o.carCount, 'car')} · ${plural(o.races, 'race')} · ${o.pts} pts</small></span>
          <span class="rc-ft"><b>${o.w}</b><small>won</small></span></li>`).join('')}
      </ol>` : '<div class="rc-empty">👑<br>Owners appear after the first race.</div>';
  }

  function renderStats(S) {
    const cars = entries.filter(e => e.status !== 'withdrawn').length;
    const racers = new Set(entries.map(e => e.user_id || e.racer_name)).size;
    const topCar = S.cars.filter(c => c.races).sort(byWins)[0];
    const topOwner = S.owners.filter(o => o.races).sort(byWins)[0];
    const hot = S.cars.filter(c => c.bestStreak >= 3).sort((x, y) => y.bestStreak - x.bestStreak)[0];
    $('stats').innerHTML = `
      <div><b>${cars}</b><small>cars</small></div>
      <div><b>${racers}</b><small>owners</small></div>
      <div><b>${S.live.length}</b><small>races</small></div>
      <div class="rc-stat-wide"><small>🏎️ Fastest car (most wins)</small><b>${topCar ? esc(topCar.entry.car_name) + ` · ${topCar.w} won` : '—'}</b></div>
      <div class="rc-stat-wide"><small>👑 Top owner</small><b>${topOwner ? esc(topOwner.name) + ` · ${topOwner.w} won` : '—'}</b></div>
      ${hot ? `<div class="rc-stat-wide"><small>🔥 Longest streak</small><b>${esc(hot.entry.car_name)} · ${hot.bestStreak} in a row</b></div>` : ''}`;
  }

  // Race log + chain check
  function renderLog(S) {
    $('logCount').textContent = `· ${races.length} result${races.length === 1 ? '' : 's'}`;
    const list = races.slice().reverse().slice(0, 200);
    $('raceLog').innerHTML = list.length ? `<div class="rc-log-list">${list.map(r => {
      const A = S.byId[r.lane_a], B = S.byId[r.lane_b]; if (!A || !B) return '';
      const nm = (e, t, won) => `<span class="${won ? 'w' : ''}" data-car="${esc(e.id)}">${won ? '🏆 ' : ''}${num(e)} ${esc(e.car_name)} <small>${esc(e.racer_name)}</small></span>`;
      return `<div class="rc-log-row${r.voided ? ' voided' : ''}">
        <span class="rc-seq">#${r.seq}</span>
        <span class="rc-log-main">${nm(A, r.time_a_ms, r.winner === A.id)}<i>vs</i>${nm(B, r.time_b_ms, r.winner === B.id)}</span>
        <span class="rc-log-meta">${r.voided ? flagVoid : flagPaid + ' ' + flagOk('')} · ${esc(r.round)} · ${when(r.recorded_at)} · by ${esc(r.recorded_by)} · 🔒 <code title="${esc(r.hash)}">${esc(r.hash.slice(0, 8))}</code>
          ${r.voided ? `<br><b class="rc-void">VOIDED</b> by ${esc(r.voided_by)}: ${esc(r.void_reason)}` : ''}</span>
        ${isHost && !r.voided && ev ? `<button class="link-btn danger" data-void="${r.seq}">Void</button>` : ''}
      </div>`; }).join('')}</div>` : '<div class="rc-empty">No results yet.</div>';
    verifyChain();
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function verifyChain() {
    const el = $('verify');
    if (!races.length) { el.textContent = '🔒 Locked results'; el.className = 'rc-verify'; return; }
    if (!window.crypto || !crypto.subtle) { el.textContent = '🔒 Locked'; return; }
    try {
      for (const r of races) {
        const text = [r.seq, r.event_id, r.lane_a, r.lane_b, r.winner, r.time_a_ms ?? '-', r.time_b_ms ?? '-', r.round, Date.parse(r.recorded_at), r.prev_hash].join('|');
        if (await sha256(text) !== r.hash) throw new Error('Result #' + r.seq);
      }
      el.textContent = `✓ All ${races.length} results verified — untouched`; el.className = 'rc-verify ok';
    } catch (e) {
      el.textContent = '⚠ Could not verify ' + e.message; el.className = 'rc-verify bad';
    }
  }

  // Car history pop-up
  function openCar(id, S) {
    const e = S.byId[id]; if (!e) return;
    const key = ev ? e.id : carKey(e);
    const c = S.cars.find(x => x.key === key);
    const ids = c ? c.ids : [e.id];
    const mine = S.live.concat(races.filter(r => r.voided)).filter(r => ids.includes(r.lane_a) || ids.includes(r.lane_b)).sort((x, y) => y.seq - x.seq);
    $('carBody').innerHTML = `
      <div class="rc-car-head">${carThumb(e, 'xl')}<div><span class="sp-kind">${esc(e.class)}</span><h2>${ev ? num(e) + ' ' : ''}${esc(e.car_name)}</h2>
        <p class="muted">${esc(e.racer_name)}${e.brand ? ' · ' + esc(e.brand) : ''}</p></div></div>
      ${c ? `<div class="rc-car-stats"><div><b>${c.w}</b><small>won</small></div><div><b>${c.races}</b><small>raced</small></div><div><b>${c.pts}</b><small>points</small></div><div><b>${c.bestStreak > 0 ? c.bestStreak : 0}</b><small>best streak</small></div></div>` : ''}
      <ul class="rc-hist">${mine.length ? mine.map(r => {
        const meA = ids.includes(r.lane_a), other = S.byId[meA ? r.lane_b : r.lane_a], won = ids.includes(r.winner);
        return `<li class="${r.voided ? 'voided' : won ? 'w' : 'l'}"><b>${r.voided ? 'VOID' : won ? 'WON' : 'LOST'}</b><span>vs ${other ? esc(other.car_name) + ' <small>(' + esc(other.racer_name) + ')</small>' : '?'} <small>· ${esc(r.round)} · #${r.seq}</small></span><span>${won && !r.voided ? '+' + WIN_PTS : r.voided ? '' : '+' + LOSE_PTS}</span></li>`;
      }).join('') : '<li class="muted">No races yet.</li>'}</ul>`;
    $('carDlg').showModal();
  }

  // ---------------------------------------------------------------- race tracker (Race 1, 2, 3 …)
  function renderTracker(S) {
    const box = $('tracker'), list = $('slotList');
    box.hidden = false;
    if (!ev || !slots.length) {
      ['slotSummary', 'slotChips', 'upNext', 'evNote'].forEach(id => { $(id).innerHTML = ''; }); $('upNext').hidden = true; $('evNote').hidden = true;
      $('addSlots').hidden = !(isHost && ev && !slotsErr);
      list.innerHTML = `<div class="rc-empty rc-sl-none">🏁<br>${
        !ev ? (events.length ? 'Pick a race night above to see its races.' : 'No race night yet — the first one is being set up. Join the WhatsApp community to hear first.')
        : slotsErr ? (isHost ? '<b>Race slots aren\'t installed yet.</b><br>Run <code>supabase/10-update-race-slots.sql</code> once in Supabase → SQL Editor, then reload this page.' : 'Races for this night open soon — check back shortly.')
        : (isHost ? 'No races yet. Tap <b>+ Add 30 more races</b> to open Race 1–30.' : 'Races for this night open soon — check back shortly.')}</div>`;
      return;
    }
    const me = Auth.user && Auth.user.id;
    const raceBy = {}; races.forEach(r => { raceBy[r.seq] = r; });
    const reqOf = id => requests.filter(q => q.slot_id === id);
    const isMine = sl => !!me && (reqOf(sl.id).some(q => q.user_id === me) || [sl.lane_a, sl.lane_b].some(id => S.byId[id] && S.byId[id].user_id === me));
    const nextUp = slots.find(x => x.status === 'set');
    const counts = { open: 0, set: 0, done: 0 }; slots.forEach(x => counts[x.status]++);
    $('slotSummary').innerHTML = `<span>${counts.open} open</span><span>${counts.set} confirmed</span><span>${counts.done} raced</span>`;
    $('slotChips').innerHTML = [['up', `Upcoming · ${counts.open + counts.set}`], ['open', 'Open'], ['set', 'Confirmed'], ['done', `Results · ${counts.done}`], ...(me ? [['mine', 'My races']] : []), ['all', 'All']]
      .map(([k, l]) => `<button class="chip${slotView === k ? ' active' : ''}" data-slotview="${k}">${l}</button>`).join('');
    $('upNext').innerHTML = nextUp ? `⏭️ Up next: <b>Race ${nextUp.slot_no}</b> — ${carLine(S.byId[nextUp.lane_a])} <i>vs</i> ${carLine(S.byId[nextUp.lane_b])}` : '';
    $('upNext').hidden = !nextUp;
    $('evNote').innerHTML = ev.status === 'open' ? '⏳ <b>This race night hasn\'t started yet.</b> Register your car and join races now — racing begins when the admin starts the event.'
      : ev.status === 'closed' ? '🔒 <b>This race night is finished.</b> All results are locked. Watch for the next event.' : '';
    $('evNote').hidden = ev.status === 'live';
    $('addSlots').hidden = !isHost || ev.status === 'closed';

    const shown = slots.filter(x => slotView === 'all' || (slotView === 'up' ? x.status !== 'done' : slotView === 'mine' ? isMine(x) : x.status === slotView));
    const carMini = (e, won) => e ? `<span class="rc-sl-car${won ? ' w' : ''}" data-car="${esc(e.id)}">${carThumb(e, 'sm')}<span><b>${won ? '🏆 ' : ''}#${e.number} ${esc(e.car_name)}</b><small>${esc(e.racer_name)}</small></span></span>` : '<span class="rc-sl-car muted">— car removed —</span>';
    list.innerHTML = shown.length ? shown.map(sl => {
      const rq = reqOf(sl.id), r = sl.race_seq ? raceBy[sl.race_seq] : null;
      const myReq = me && rq.find(q => q.user_id === me);
      let st, body = '', act = '';
      if (sl.status === 'open') {
        st = rq.length ? `Open · ${rq.length} want${rq.length === 1 ? 's' : ''} in` : 'Open';
        body = `<div class="rc-flags">${flagDue}<span class="rc-flag wait">⏳ Waiting for admin approval</span></div>` + (rq.length ? `<div class="rc-sl-reqs">${rq.map(q => carMini(S.byId[q.entry_id])).join('')}</div>` : '<p class="rc-sl-empty">No one yet — be the first!</p>');
        act = myReq ? `<div class="rc-sl-me">✓ You're in with <b>#${(S.byId[myReq.entry_id] || {}).number || '?'} ${esc((S.byId[myReq.entry_id] || {}).car_name || '')}</b>
                         <button class="link-btn" data-join="${esc(sl.id)}">Change car</button> · <button class="link-btn danger" data-leave="${esc(sl.id)}">Leave</button></div>`
          : ev.status !== 'closed' ? `<button class="btn btn-primary btn-sm btn-block" data-join="${esc(sl.id)}">🏁 Join Race ${sl.slot_no}</button>` : '';
        if (isHost && ev.status !== 'closed') {
          const pk = picks[sl.id] || {};
          const asked = rq.map(q => S.byId[q.entry_id]).filter(Boolean), others = entries.filter(e => e.status !== 'withdrawn' && !asked.includes(e));
          const opts = v => `<option value="">— pick —</option>${asked.length ? `<optgroup label="Asked to join">${asked.map(e => `<option value="${esc(e.id)}"${v === e.id ? ' selected' : ''}>#${e.number} ${esc(e.car_name)} — ${esc(e.racer_name)}</option>`).join('')}</optgroup>` : ''}
            <optgroup label="Other cars">${others.map(e => `<option value="${esc(e.id)}"${v === e.id ? ' selected' : ''}>#${e.number} ${esc(e.car_name)} — ${esc(e.racer_name)}</option>`).join('')}</optgroup>`;
          act += `<div class="rc-sl-host"><span class="gv-admin-tag">Host</span>
            <div class="two"><select class="input" data-pick="a" data-slot="${esc(sl.id)}" aria-label="Lane A">${opts(pk.a)}</select><select class="input" data-pick="b" data-slot="${esc(sl.id)}" aria-label="Lane B">${opts(pk.b)}</select></div>
            <button class="btn btn-ghost btn-sm btn-block" data-confirm="${esc(sl.id)}">✅ Confirm Race ${sl.slot_no}</button></div>`;
        }
      } else if (sl.status === 'set') {
        const A = S.byId[sl.lane_a], B = S.byId[sl.lane_b];
        st = sl === nextUp ? 'Up next' : 'Confirmed';
        body = `<div class="rc-sl-vs">${carMini(A)}<i>vs</i>${carMini(B)}</div><div class="rc-flags">${flagDue}<span class="rc-flag ok">✅ Approved by ${esc(sl.set_by || 'host')}</span></div><p class="rc-sl-by">Waiting to race</p>`;
        if (isHost && ev.status !== 'live') act = `<div class="rc-sl-host"><span class="gv-admin-tag">Host</span><p class="rc-sl-by">▶ Start the event in Race control to record results.</p><button class="link-btn" data-reopen="${esc(sl.id)}">↺ Change cars</button></div>`;
        else if (isHost) act = `<div class="rc-sl-host"><span class="gv-admin-tag">Host</span>
            <label class="check rc-feecheck"><input type="checkbox" data-fee="${esc(sl.id)}"${feeTick[sl.id] ? ' checked' : ''}> Both racers have paid the entry fee</label>
            <div class="rc-winbtns"><button class="btn btn-ghost btn-sm" data-slotwin="${esc(sl.id)}" data-w="${esc(sl.lane_a)}">🏆 ${A ? '#' + A.number : 'A'} won</button><button class="btn btn-ghost btn-sm" data-slotwin="${esc(sl.id)}" data-w="${esc(sl.lane_b)}">🏆 ${B ? '#' + B.number : 'B'} won</button></div>
            <button class="link-btn" data-reopen="${esc(sl.id)}">↺ Change cars</button></div>`;
      } else {
        const A = r && S.byId[r.lane_a], B = r && S.byId[r.lane_b];
        st = r && r.voided ? 'Void' : 'Result';
        body = r ? `<div class="rc-sl-vs${r.voided ? ' voided' : ''}">${carMini(A, !r.voided && r.winner === r.lane_a)}<i>vs</i>${carMini(B, !r.voided && r.winner === r.lane_b)}</div>
            <div class="rc-flags">${r.voided ? flagVoid : flagPaid + flagOk(r.recorded_by)}</div><p class="rc-sl-by">${r.voided ? `Reason: ${esc(r.void_reason || '')}` : `🔒 Locked · result #${r.seq}`}</p>` : '<p class="rc-sl-empty">Result saved.</p>';
        if (isHost && r && r.voided) act = `<div class="rc-sl-host"><button class="link-btn" data-reopen="${esc(sl.id)}">↺ Re-run Race ${sl.slot_no}</button></div>`;
      }
      if (ev.status === 'closed' && sl.status !== 'done') { act = ''; if (sl.status === 'open') st = rq.length ? 'Not raced' : 'Not used'; }
      return `<article class="rc-slot s-${sl.status}${sl === nextUp ? ' next' : ''}${isMine(sl) ? ' mine' : ''}${r && r.voided ? ' void' : ''}" id="race-${sl.slot_no}">
        <header><b>Race ${sl.slot_no}</b><span class="rc-sl-st">${st}</span></header>${body}${act}</article>`;
    }).join('') : `<div class="rc-empty">${slotView === 'mine' ? 'You haven\'t joined a race yet — pick an open one.' : slotView === 'up' ? 'Every race is done — the host can add 30 more.' : 'Nothing here yet.'}</div>`;
  }
  const flagPaid = '<span class="rc-flag paid">💰 Entry fee paid</span>', flagDue = '<span class="rc-flag due">💰 Entry fee — pay at the track</span>';
  const flagOk = by => `<span class="rc-flag ok">✅ Admin approved${by ? ' · ' + esc(by) : ''} · counts on leaderboard</span>`, flagVoid = '<span class="rc-flag void">❌ Voided · not counted</span>';
  const carLine = e => e ? `#${e.number} ${esc(e.car_name)} <small>(${esc(e.racer_name)})</small>` : '?';

  function openJoin(slotId) {
    const sl = slots.find(x => x.id === slotId); if (!sl) return;
    const mine = Auth.user ? entries.filter(e => e.user_id === Auth.user.id && e.status !== 'withdrawn') : [];
    const cur = Auth.user && requests.find(q => q.slot_id === slotId && q.user_id === Auth.user.id);
    $('carBody').innerHTML = `<h2 class="rc-dlg-title">🏁 Join Race ${sl.slot_no}</h2>` + (
      !Auth.user ? `<p class="muted">Sign in with Google to join races.</p>${googleButton('Sign in to join')}`
      : !mine.length ? `<p class="muted">Register your car model first (your owner name comes from Google). Right after, this race opens again so you can join.</p><button type="button" class="btn btn-primary btn-block" data-toreg="${esc(slotId)}">🏎️ Register a car</button>`
      : `<p class="muted small">Pick the car you want to race with. The host picks the final two cars from everyone who asks.</p>
         <div class="rc-feenote">💰 <b>Racing is not free.</b> Each race has an entry fee, paid at the track before the race. Only races approved by the admin count on the leaderboard.</div>
         <div class="rc-joinlist">${mine.map(e => `<button class="rc-mine rc-joinpick${cur && cur.entry_id === e.id ? ' on' : ''}" data-joincar="${esc(e.id)}" data-slot="${esc(slotId)}">${carThumb(e)}<span><b>#${e.number} ${esc(e.car_name)}</b><small>${esc(e.class)}</small></span><span class="bid-flag lead"><i></i>${cur && cur.entry_id === e.id ? 'Joined' : 'Pick'}</span></button>`).join('')}</div>`);
    $('carDlg').showModal();
  }

  // Owner name = the member's Google name (or the part of the email before @) — set automatically, not typed
  const ownerName = () => {
    const u = Auth.user || {}, m = u.user_metadata || {};
    return ((Auth.profile && Auth.profile.full_name) || m.full_name || m.name || (u.email || '').split('@')[0] || 'Collector').trim().slice(0, 40);
  };
  const activeEv = () => events.find(x => x.status !== 'closed');
  const myActiveCars = () => Auth.user ? entries.filter(e => e.user_id === Auth.user.id && e.status !== 'withdrawn') : [];
  function goRegister() {
    const r = $('register'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { const f = $('rgCar'); if (f) f.focus({ preventScroll: true }); }, 500);
    toast('Register your car model first — owner name is filled from your Google account', 'ok');
  }
  function goTracker() {
    if (slots.some(x => x.status === 'open')) { slotView = 'open'; renderTracker(compute()); }
    $('tracker').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Hero "Join a race": sign in → register a car if needed → open races
  async function joinJump() {
    if (!ev) return toast(events.length ? 'Pick a race night first' : 'No race night is open yet — watch the WhatsApp community', 'warn');
    if (ev.status === 'closed') return toast('This race night has finished', 'warn');
    await ready;
    if (!Auth.user) { setNext({ tracker: true }); toast('Sign in with Google — you\'ll come right back here', 'ok'); return signIn(location.href.split('#')[0]); }
    if (!myActiveCars().length) return goRegister();
    goTracker();
  }
  // Back from Google sign-in: carry on with what the member was doing
  function resumeAfterLogin() {
    const nx = getNext(); if (!nx || !Auth.user || nx.afterReg) return;
    setNext(null);
    if (!myActiveCars().length) { if (nx.slot) setNext({ slot: nx.slot, afterReg: true }); return goRegister(); }
    if (nx.slot && slots.some(x => x.id === nx.slot && x.status === 'open')) { goTracker(); return openJoin(nx.slot); }
    goTracker();
  }

  // ---------------------------------------------------------------- register + my cars
  async function renderRegister(S) {
    await ready;
    const box = $('regBody');
    if (!ev) { box.innerHTML = '<p class="muted">Pick an event above to register.</p>'; $('myCars').innerHTML = ''; return; }
    if (ev.status === 'closed') box.innerHTML = '<p class="muted">This event has finished. Watch for the next GDX race night on WhatsApp.</p>';
    else if (!Auth.user) box.innerHTML = `<p class="muted">Sign in with Google and add your car model — the owner name comes from your Google account automatically. Your car gets a race number and its own record.</p>${googleButton('Sign in to register')}`;
    else if (!box.querySelector('form')) {
      box.innerHTML = `
        <form id="regForm" novalidate>
          <div class="two">
            <div class="field"><label for="rgCar">Car model *</label><input class="input" id="rgCar" maxlength="60" placeholder="e.g. Bone Shaker"></div>
            <div class="field"><label for="rgBrand">Brand</label><input class="input" id="rgBrand" maxlength="40" placeholder="Hot Wheels, Matchbox…"></div>
          </div>
          <div class="field"><label>Class *</label><div class="chips rc-pick" id="rgClass">${ev.classes.map((c, i) => `<button type="button" class="chip${i === 0 ? ' active' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
          <div class="two">
            <div class="field"><label>Owner</label><div class="rc-owner-auto"><span class="rc-ava">${esc(ownerName().charAt(0).toUpperCase())}</span><span><b>${esc(ownerName())}</b><small>from your Google sign-in · ${esc(Auth.user.email || '')}</small></span></div></div>
            <div class="field"><label for="rgPhone">Mobile *</label><input class="input" id="rgPhone" type="tel" inputmode="numeric" maxlength="14" placeholder="10-digit (only the host sees it)" value="${esc((Auth.profile && Auth.profile.phone) || '')}"></div>
          </div>
          <div class="field"><label class="upload small-upload" id="rgPicBox"><input type="file" id="rgPic" accept="image/*">📷 Add a photo of the car (shows on the big screen)</label></div>
          <p class="form-error" id="rgErr" hidden></p>
          <button class="btn btn-primary btn-block" id="rgBtn">Register my car</button>
          <p class="muted small center">Race as many times as you like — each 1 vs 1 race is settled at the track before it starts.</p>
        </form>`;
      let pic = null;
      $('rgClass').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; $('rgClass').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b)); };
      $('rgPic').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { pic = await shrink(f); $('rgPicBox').classList.add('has-file'); $('rgPicBox').lastChild.textContent = '✓ Photo added — tap to change'; } catch (x) { toast('Could not read that photo', 'warn'); } };
      $('regForm').onsubmit = async e => {
        e.preventDefault();
        const err = $('rgErr'); err.hidden = true;
        const fail = m => { err.textContent = m; err.hidden = false; };
        const car = $('rgCar').value.trim(), phone = $('rgPhone').value.trim();
        const klass = ($('rgClass').querySelector('.active') || {}).dataset.v;
        if (car.length < 2) return fail('Enter your car\'s name.');
        if (!/^(\+?91)?[6-9]\d{9}$/.test(phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))) return fail('Enter a valid 10-digit mobile number.');
        const btn = $('rgBtn'); btn.disabled = true;
        let path = null;
        if (pic) {
          path = `${Auth.user.id}/race-${Date.now()}.jpg`;
          const up = await sb.storage.from(BUCKET).upload(path, pic, { contentType: 'image/jpeg' });
          if (up.error) { path = null; toast('Photo didn\'t upload — registering without it', 'warn'); }
        }
        const { data, error } = await sb.rpc('race_register', { p_event: ev.id, p_racer: ownerName(), p_car: car,
          p_brand: $('rgBrand').value.trim(), p_class: klass, p_phone: phone, p_photo: path });
        btn.disabled = false;
        if (error) return fail(errMsg(error));
        toast(`Registered as #${data.number}! Now join a race in the Race tracker.`, 'ok');
        $('regForm').reset(); pic = null; $('rgPicBox').classList.remove('has-file');
        await refresh();
        const nx = getNext();
        if (nx && nx.slot) { setNext(null); if (slots.some(x => x.id === nx.slot && x.status === 'open')) openJoin(nx.slot); else goTracker(); }
      };
    }
    // my cars
    if (!Auth.user) return;
    const mine = entries.filter(e => e.user_id === Auth.user.id);
    $('myCars').innerHTML = mine.length ? mine.map(e => {
      const c = S.cars.find(x => x.ids.includes(e.id)) || {};
      return `<div class="rc-mine" data-car="${esc(e.id)}">${carThumb(e)}<span><b>${num(e)} ${esc(e.car_name)}</b><small>${esc(e.class)} · ${c.w || 0} won of ${c.races || 0} races</small></span>
        ${e.status === 'withdrawn' ? '<span class="bid-flag lost"><i></i>Withdrawn</span>' : `<span class="bid-flag lead"><i></i>${c.pts || 0} pts</span>`}</div>`;
    }).join('') + '<p class="muted small" style="margin:10px 0 0">Join races in the <a class="link-btn" href="#tracker">🏁 Race tracker</a>.</p>' : '<p class="muted small">No cars registered for this event yet.</p>';
  }

  // ---------------------------------------------------------------- host control
  function renderHost(S) {
    const box = $('host');
    box.hidden = !isHost; $('hostHint').hidden = isHost || TV;
    if (!isHost) return;
    const used = S.used;
    const opt = e => `<option value="${esc(e.id)}">#${e.number} ${esc(e.car_name)} — ${esc(e.racer_name)} (${esc(e.class)})</option>`;
    const active = entries.filter(e => e.status !== 'withdrawn');
    box.innerHTML = `
      <div class="rc-card-head"><h2>🎛️ Race control <span class="gv-admin-tag" style="margin:0 0 0 8px">Host</span></h2>
        ${ev ? `<span class="rc-money">${entries.filter(e => e.status !== 'withdrawn').length} cars · ${S.live.length} races</span>` : ''}</div>
      <div class="rc-host-grid">
        ${ev ? `
        <div class="panel">
          <h3 class="panel-title">Race slots</h3>
          <p class="muted small">Members join open races in the <a class="link-btn" href="#tracker">Race tracker</a>. For each race, pick the two cars and confirm it, then tick the fee and tap the winner — all right on the race card.</p>
          <div class="rc-car-stats"><div><b>${slots.length}</b><small>slots</small></div><div><b>${slots.filter(x => x.status === 'open').length}</b><small>open</small></div><div><b>${slots.filter(x => x.status === 'set').length}</b><small>confirmed</small></div><div><b>${requests.length}</b><small>requests</small></div></div>
          <button type="button" class="btn btn-primary btn-block" data-addslots>+ Add 30 more races</button>
        </div>` : ''}
        <div class="panel">
          <h3 class="panel-title">${ev ? 'Cars (owner + model)' : 'Events'}</h3>
          ${ev ? `
          <div class="rc-host-list">${entries.map(e => {
            const h = hostInfo[e.id] || {};
            return `<div class="rc-hrow${e.status === 'withdrawn' ? ' off' : ''}">
              <span><b>#${e.number} ${esc(e.car_name)}</b><small>${esc(e.racer_name)} · ${esc(e.class)}${h.phone ? ` · <a href="${esc(waLink('91' + h.phone, 'Hi from GDX Racing! '))}" target="_blank" rel="noopener">${esc(h.phone)}</a>` : ''}</small>
                <small>${(used[e.id] || 0)} race${(used[e.id] || 0) === 1 ? '' : 's'}</small></span>
              <span class="rc-hacts">
                ${e.status !== 'withdrawn' ? `<button class="link-btn danger" data-withdraw="${esc(e.id)}">Withdraw</button>` : ''}
              </span></div>`; }).join('') || '<p class="muted small">No cars yet. Racers register on this page, or add walk-ins below.</p>'}</div>
          <form id="walkForm" class="rc-walk" novalidate>
            <h4>+ Walk-in racer</h4>
            <div class="two"><input class="input" id="wRacer" placeholder="Racer name"><input class="input" id="wCar" placeholder="Car name"></div>
            <div class="two"><select class="input" id="wClass">${ev.classes.map(c => `<option>${esc(c)}</option>`).join('')}</select><input class="input" id="wPhone" inputmode="numeric" placeholder="Mobile (optional)"></div>
            <button class="btn btn-ghost btn-block">Add walk-in</button>
          </form>` : '<p class="muted small">Pick an event above, or create one.</p>'}
        </div>
        ${!ev && activeEv() ? `<div class="panel"><h3 class="panel-title">New event</h3><p class="muted">Finish <b>${esc(activeEv().name)}</b> before creating the next event — only one race night runs at a time.</p>
          <button type="button" class="btn btn-ghost btn-block" data-gotoev="${esc(activeEv().id)}">Go to ${esc(activeEv().name)}</button></div>` : `
        <form class="panel" id="evForm" novalidate>
          <h3 class="panel-title">${ev ? 'Event settings' : 'New event'}</h3>
          <div class="field"><label>Name</label><input class="input" id="eName" value="${esc(ev ? ev.name : 'GDX Drag Night #' + (events.length + 1))}"></div>
          <div class="two"><div class="field"><label>Date</label><input class="input" id="eDate" type="date" value="${esc(ev ? ev.event_date : new Date(Date.now() + 19800000).toISOString().slice(0, 10))}"></div>
            <div class="field"><label>Venue</label><input class="input" id="eVenue" value="${esc(ev ? ev.venue || '' : '')}"></div></div>
          <div class="field"><label>Classes (comma-separated)</label><input class="input" id="eClasses" value="${esc((ev ? ev.classes : ['Stock mainline', 'Premium / Real Riders', 'Open / Modified']).join(', '))}"></div>
          <div class="field"><label>Prizes</label><input class="input" id="ePrize" placeholder="e.g. Top of the leaderboard wins a trophy" value="${esc(ev ? ev.prize_info || '' : '')}"></div>
          ${ev ? `<div class="rc-life">${[['open', '1', 'Registration'], ['live', '2', 'Racing live'], ['closed', '3', 'Finished']].map(([k, n, l]) =>
              `<span class="${ev.status === k ? 'now' : ['open', 'live', 'closed'].indexOf(k) < ['open', 'live', 'closed'].indexOf(ev.status) ? 'done' : ''}"><i>${n}</i>${l}</span>`).join('<b>→</b>')}</div>
            ${ev.status === 'open' ? '<button type="button" class="btn btn-primary btn-block" data-evstatus="live">▶ Start event — racing begins</button><p class="muted small">Members can register and join races now. Results can be recorded only after you start the event.</p>'
              : ev.status === 'live' ? '<button type="button" class="btn btn-ghost btn-block rc-finish" data-evstatus="closed">🏁 Finish event — lock everything</button><p class="muted small">When the last race is done, finish the event. Then you can create the next one.</p>'
              : '<p class="muted small">🔒 This event is finished — every result is locked for good.</p>'}` : ''}
          <p class="form-error" id="eErr" hidden></p>
          <button class="btn btn-primary btn-block">${ev ? 'Save event' : 'Create event'}</button>
          ${ev ? (activeEv() && activeEv().id !== ev.id ? `<p class="muted small" style="margin-top:8px">Running now: <b>${esc(activeEv().name)}</b></p>` : !activeEv() ? '<button type="button" class="link-btn" id="eNew" style="margin-top:8px">+ Create the next event</button>' : '') : ''}
        </form>`}
      </div>`;
    wireHost(S);
  }

  function wireHost(S) {
    $('host').querySelectorAll('[data-withdraw]').forEach(b => b.onclick = async () => {
      if (!confirm('Withdraw this car? Its past results stay.')) return;
      const { error } = await host.rpc('race_set_entry_status', { p_entry: b.dataset.withdraw, p_status: 'withdrawn' });
      if (error) return toast(errMsg(error), 'warn'); refresh();
    });
    const wf = $('walkForm');
    if (wf) wf.onsubmit = async e => {
      e.preventDefault();
      const { data, error } = await host.rpc('race_add_walkin', { p_event: ev.id, p_racer: $('wRacer').value, p_car: $('wCar').value, p_brand: '', p_class: $('wClass').value, p_phone: $('wPhone').value });
      if (error) return toast(errMsg(error), 'warn');
      toast(`Walk-in added as #${data.number}`, 'ok'); refresh();
    };
    if ($('evForm')) $('evForm').onsubmit = async e => {
      e.preventDefault();
      const err = $('eErr'); err.hidden = true;
      const row = {
        name: $('eName').value.trim(), event_date: $('eDate').value, venue: $('eVenue').value.trim() || null,
        classes: $('eClasses').value.split(',').map(s => s.trim()).filter(Boolean),
        prize_info: $('ePrize').value.trim() || null
      };
      if (!row.name || !row.event_date || !row.classes.length) { err.textContent = 'Name, date and at least one class are needed.'; err.hidden = false; return; }
      const q = ev ? host.from('race_events').update(row).eq('id', ev.id).select().single() : host.from('race_events').insert(row).select().single();
      const { data, error } = await q;
      if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
      toast(ev ? 'Event saved' : 'Event created', 'ok');
      params.set('e', data.id); history.replaceState(null, '', 'race.html?' + params);
      await loadEvents(); await refresh();
    };
    const nb = $('eNew');
    if (nb) nb.onclick = () => { ev = null; renderHost(compute()); $('evForm').scrollIntoView({ behavior: 'smooth' }); };
  }

  // void (host) + car pop-ups + class chips
  document.addEventListener('click', async e => {
    const v = e.target.closest('[data-void]');
    if (v && isHost) {
      const reason = prompt(`Void race #${v.dataset.void}? It stays visible, struck through.\n\nReason:`); if (!reason) return;
      const { error } = await host.rpc('void_race', { p_seq: Number(v.dataset.void), p_reason: reason });
      if (error) return toast(errMsg(error), 'warn');
      toast('Race voided', 'ok'); return refresh();
    }
    const t = e.target.closest('[data-evstatus],[data-gotoev],[data-join],[data-leave],[data-joincar],[data-confirm],[data-slotwin],[data-reopen],[data-addslots],[data-slotview],[data-close],[data-toreg],[data-joinjump]');
    if (t) { if (t.dataset.joinjump !== undefined || t.dataset.toreg) e.preventDefault(); return slotAction(t); }
    const c = e.target.closest('[data-cls]');
    if (c) { cls = c.dataset.cls; renderBoard(compute()); return; }
    const so = e.target.closest('[data-sort]');
    if (so) { sortBy = so.dataset.sort; renderBoard(compute()); return; }
    const car = e.target.closest('[data-car]');
    if (car && !e.target.closest('a,button,select')) openCar(car.dataset.car, compute());
  });
  document.addEventListener('change', e => {
    const p = e.target.closest('[data-pick]');
    if (p) { (picks[p.dataset.slot] = picks[p.dataset.slot] || {})[p.dataset.pick] = p.value; return; }
    const f = e.target.closest('[data-fee]'); if (f) feeTick[f.dataset.fee] = f.checked;
  });
  async function slotAction(t) {
    const d = t.dataset, S = compute();
    const run = async (fn, args, ok) => {
      t.disabled = true;
      const { error } = await (fn.startsWith('race_slot_join') || fn === 'race_slot_leave' ? sb : host).rpc(fn, args);
      t.disabled = false;
      if (error) { toast(errMsg(error), 'warn'); return false; }
      if (ok) toast(ok, 'ok'); await refresh(); return true;
    };
    if (d.close !== undefined) { $('carDlg').close(); return; }
    if (d.toreg) { setNext({ slot: d.toreg, afterReg: true }); $('carDlg').close(); goRegister(); return; }
    if (d.joinjump !== undefined) return joinJump();
    if (d.slotview) { slotView = d.slotview; renderTracker(S); return; }
    if (d.join) {
      if (!Auth.user) { setNext({ slot: d.join }); toast('Sign in with Google to join — you\'ll come right back here', 'ok'); return signIn(location.href.split('#')[0]); }
      return openJoin(d.join);
    }
    if (d.joincar) { if (await run('race_slot_join', { p_slot: d.slot, p_entry: d.joincar }, 'You\'re in! The host will confirm the two cars.')) $('carDlg').close(); return; }
    if (d.leave) { if (confirm('Leave this race?')) await run('race_slot_leave', { p_slot: d.leave }, 'You left the race'); return; }
    if (!isHost) return;
    if (d.gotoev) { params.set('e', d.gotoev); history.replaceState(null, '', 'race.html?' + params); return refresh(); }
    if (d.evstatus) {
      const msg = d.evstatus === 'live'
        ? `Start "${ev.name}"?\n\nRacing goes live — you can record results. Registration and joining races stay open.`
        : `Finish "${ev.name}"?\n\nEverything is locked for good: no more races, joins or results. Then you can create the next event.`;
      if (!confirm(msg)) return;
      t.disabled = true;
      const { error } = await host.from('race_events').update({ status: d.evstatus }).eq('id', ev.id);
      t.disabled = false;
      if (error) return toast(errMsg(error), 'warn');
      toast(d.evstatus === 'live' ? 'Event started — racing is live 🏁' : 'Event finished — results locked 🔒', 'ok');
      await loadEvents(); return refresh();
    }
    if (d.addslots !== undefined) { await run('race_add_slots', { p_event: ev.id, p_count: 30 }, '30 more races added'); return; }
    if (d.confirm) {
      const pk = picks[d.confirm] || {};
      if (!pk.a || !pk.b) return toast('Pick both cars', 'warn'); if (pk.a === pk.b) return toast('Pick two different cars', 'warn');
      const A = S.byId[pk.a], B = S.byId[pk.b];
      if (A.class !== B.class && !confirm(`The cars are in different classes (${A.class} / ${B.class}). Confirm anyway?`)) return;
      if (await run('race_slot_set', { p_slot: d.confirm, p_a: pk.a, p_b: pk.b }, 'Race confirmed ✅')) delete picks[d.confirm];
      return;
    }
    if (d.reopen) { if (confirm('Open this race again? The two picked cars are cleared; requests stay.')) await run('race_slot_reopen', { p_slot: d.reopen }, 'Race re-opened'); return; }
    if (d.slotwin) {
      if (!feeTick[d.slotwin]) return toast('Tick "Both racers have paid the entry fee" first', 'warn');
      const sl = slots.find(x => x.id === d.slotwin), W = S.byId[d.w], L = S.byId[d.w === sl.lane_a ? sl.lane_b : sl.lane_a];
      if (!confirm(`Lock Race ${sl.slot_no}?\n\n🏆 #${W.number} ${W.car_name} (${W.racer_name}) beats #${L.number} ${L.car_name} (${L.racer_name})\n\nIt can't be edited afterwards.`)) return;
      if (await run('race_slot_result', { p_slot: d.slotwin, p_winner: d.w, p_fees_paid: true }, 'Result locked 🔒')) delete feeTick[d.slotwin];
    }
  }
  $('evPick').onchange = () => { params.set('e', $('evPick').value); history.replaceState(null, '', 'race.html?' + params); refresh(); };
  $('carDlg').addEventListener('click', e => { if (e.target === $('carDlg')) $('carDlg').close(); });

  // ---------------------------------------------------------------- go
  let busy = false;
  async function refresh() {
    if (busy) return; busy = true;
    try {
      await loadEvent();
      const S = compute();
      renderHeader(S); renderLast(S); renderBoard(S); renderOwners(S); renderStats(S);
      if (!TV) { renderTracker(S); renderLog(S); renderRegister(S); renderHost(S); }
    } catch (e) {
      $('board').innerHTML = /race_|relation|schema/i.test(e.message || '') ? '<div class="panel empty" style="grid-column:1/-1">GDX Racing is being set up — check back soon.</div>'
        : `<div class="panel empty" style="grid-column:1/-1">Couldn't load races. ${esc(errMsg(e))}</div>`;
    } finally { busy = false; }
  }
  async function checkHost() {
    if (!host || TV) return;
    try {
      const { data: s } = await host.auth.getSession();
      if (s && s.session) { const { data } = await host.rpc('is_admin'); isHost = data === true; }
    } catch (e) { isHost = false; }
  }

  function shrink(f) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src); c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.85);
      };
      img.onerror = rej; img.src = URL.createObjectURL(f);
    });
  }

  try { await Promise.all([loadEvents(), checkHost(), ready]); } catch (e) { events = events || []; }
  await refresh();
  resumeAfterLogin();
  // live updates: big screen every 5s, phones every 15s
  setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]') && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) refresh(); }, TV ? 5000 : 15000);
})();
