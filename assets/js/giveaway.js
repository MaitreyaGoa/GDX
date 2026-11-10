// GDX Giveaways — spin wheel over every Google-signed-in member.
// The winner is chosen by the database (draw_giveaway); the wheel only animates to it.
(function () {
  const { C, sb, esc, toast, errMsg, Auth, ready, googleButton } = window.MHC;
  const $ = id => document.getElementById(id);
  const canvas = $('wheel'), ctx = canvas.getContext('2d');
  const SIZE = canvas.width, R = SIZE / 2;
  const MAX_SLICES = 40;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Admin session lives in this tab only (same as the admin panel)
  const admin = window.supabase && C.SUPABASE_URL ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
            storage: window.sessionStorage, storageKey: 'mhc-admin-auth' }
  }) : null;

  let pool = [];          // all names from the database
  let slices = [];        // names on the wheel right now
  let angle = 0, spinning = false, idleRaf = 0;

  // ---------------------------------------------------------------- drawing
  const PALETTE = [
    { bg: '#B8F219', fg: '#0A0D03' },
    { bg: '#0E120A', fg: '#E9F5CF' },
    { bg: '#8FCB00', fg: '#0A0D03' },
    { bg: '#1D2414', fg: '#D4FF4F' }
  ];
  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    const n = Math.max(slices.length, 1), seg = (Math.PI * 2) / n;
    ctx.save(); ctx.translate(R, R); ctx.rotate(angle);
    for (let i = 0; i < n; i++) {
      // last slice must not match the first one (they touch)
      const c = PALETTE[n > 1 && i === n - 1 && i % PALETTE.length === 0 ? 2 : i % PALETTE.length];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R - 2, i * seg, (i + 1) * seg); ctx.closePath();
      ctx.fillStyle = c.bg; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
      // name along the slice
      ctx.save(); ctx.rotate(i * seg + seg / 2);
      ctx.fillStyle = c.fg; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const fs = Math.max(16, Math.min(40, Math.floor(seg * R * 0.55)));
      ctx.font = `700 ${fs}px "Space Grotesk", "Geist", system-ui, sans-serif`;
      let label = slices[i] || 'GDX';
      const maxW = R * 0.62;
      while (ctx.measureText(label).width > maxW && label.length > 3) label = label.slice(0, -2) + '…';
      ctx.fillText(label, R - 34, 0);
      ctx.restore();
    }
    ctx.restore();
    // studs on the rim
    for (let i = 0; i < n; i++) {
      const a = angle + i * seg;
      ctx.beginPath(); ctx.arc(R + Math.cos(a) * (R - 14), R + Math.sin(a) * (R - 14), 5, 0, Math.PI * 2);
      ctx.fillStyle = '#F2F6E9'; ctx.fill();
    }
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function pickSlices() {
    slices = pool.length ? shuffle(pool.slice()).slice(0, MAX_SLICES) : ['GDX', 'Spin', '&', 'Win', 'GDX', 'Goa', 'Diecast', 'Exchange'];
    if (slices.length === 1) slices = [slices[0], slices[0]];
    draw();
  }

  function idle() {
    if (reduceMotion || spinning) return;
    cancelAnimationFrame(idleRaf);
    let last = performance.now();
    const step = t => {
      if (spinning) return;
      angle += (t - last) * 0.00008; last = t; draw();
      idleRaf = requestAnimationFrame(step);
    };
    idleRaf = requestAnimationFrame(step);
  }

  // Land the pointer (top of the wheel) on slice `idx`
  function spinTo(idx, ms = 7000) {
    return new Promise(resolve => {
      spinning = true; cancelAnimationFrame(idleRaf);
      const n = slices.length, seg = (Math.PI * 2) / n;
      const jitter = (Math.random() - 0.5) * seg * 0.6;
      const target = -Math.PI / 2 - (idx * seg + seg / 2) - jitter;   // slice centre under the pointer
      const base = angle % (Math.PI * 2);
      let delta = (target - base) % (Math.PI * 2); if (delta < 0) delta += Math.PI * 2;
      const turns = reduceMotion ? 0 : 7;
      const start = angle, total = delta + turns * Math.PI * 2, t0 = performance.now();
      const dur = reduceMotion ? 400 : ms;
      const ease = t => 1 - Math.pow(1 - t, 4);
      const step = t => {
        const k = Math.min(1, (t - t0) / dur);
        angle = start + total * ease(k); draw();
        if (k < 1) requestAnimationFrame(step);
        else { spinning = false; resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  // ---------------------------------------------------------------- data
  async function loadPool() {
    if (!sb) { $('countLine').textContent = 'Connect the database to load members.'; pickSlices(); return; }
    try {
      const { data, error } = await sb.rpc('giveaway_entrants', { p_exclude_past: false });
      if (error) throw error;
      pool = (data || []).map(r => r.name).filter(Boolean);
      $('countLine').innerHTML = pool.length
        ? `<b>${pool.length.toLocaleString('en-IN')}</b> member${pool.length > 1 ? 's' : ''} on the wheel${pool.length > MAX_SLICES ? ` · showing ${MAX_SLICES} at a time` : ''}`
        : 'No members yet — be the first to sign in!';
    } catch (e) {
      pool = [];
      $('countLine').textContent = "Members couldn't load right now.";
    }
    pickSlices();
  }

  async function loadWinners() {
    const box = $('winners');
    try {
      const { data, error } = await sb.rpc('giveaway_winners', { p_limit: 30 });
      if (error) throw error;
      if (!data || !data.length) { box.innerHTML = '<li class="muted small" style="grid-template-columns:1fr">No giveaways yet — the first one is coming soon.</li>'; return; }
      box.innerHTML = data.map(w => `
        <li class="${w.is_me ? 'me' : ''}">
          <span class="gv-trophy">🏆</span>
          <span><b>${esc(w.winner_name)}${w.is_me ? ' (you!)' : ''}</b>
            <small>${esc(w.title)}${w.prize ? ' · ' + esc(w.prize) : ''} · ${new Date(w.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${Number(w.entrants)} in the draw</small></span>
          ${isAdmin ? `<button class="gv-del" data-del="${esc(w.id)}" title="Delete this draw (e.g. a test)">✕</button>` : '<span></span>'}
        </li>`).join('');
    } catch (e) {
      box.innerHTML = `<li class="muted small" style="grid-template-columns:1fr">Winners couldn't load. ${esc(errMsg(e))}</li>`;
    }
  }

  // ---------------------------------------------------------------- member box
  async function renderJoin() {
    await ready;
    const box = $('joinAction');
    if (Auth.user) {
      const name = (Auth.profile && Auth.profile.full_name) || Auth.user.email;
      $('joinBox').querySelector('h2').textContent = "You're on the wheel";
      $('joinBox').querySelector('p').textContent = `Signed in as ${name}. You're in every draw — good luck!`;
      box.innerHTML = '<span class="gv-in">✓ Entered</span>';
    } else {
      box.innerHTML = googleButton('Sign in with Google to enter');
    }
  }

  // ---------------------------------------------------------------- admin
  let isAdmin = false;
  async function checkAdmin() {
    if (!admin) return;
    try {
      const { data: s } = await admin.auth.getSession();
      if (!s || !s.session) return;
      const { data } = await admin.rpc('is_admin');
      isAdmin = data === true;
    } catch (e) { isAdmin = false; }
    $('adminBox').hidden = !isAdmin;
    $('adminHint').hidden = isAdmin;
    if (isAdmin) loadWinners();
  }

  $('adminBox').addEventListener('submit', async e => {
    e.preventDefault();
    if (spinning) return;
    const err = $('gError'); err.hidden = true;
    const title = $('gTitle').value.trim(), prize = $('gPrize').value.trim();
    if (!title) { err.textContent = 'Give this giveaway a title.'; err.hidden = false; $('gTitle').focus(); return; }
    const btn = $('spinBtn'); btn.disabled = true; btn.textContent = 'Picking a winner…';
    try {
      const { data, error } = await admin.rpc('draw_giveaway', { p_title: title, p_prize: prize || null, p_exclude_past: $('gExclude').checked });
      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      // make sure the winner's name is on the wheel, then land on it
      let idx = slices.indexOf(res.winner_name);
      if (idx < 0) { idx = Math.floor(Math.random() * slices.length); slices[idx] = res.winner_name; draw(); }
      btn.textContent = 'Spinning…';
      await spinTo(idx);
      celebrate(title, res.winner_name, prize);
      $('gTitle').value = ''; $('gPrize').value = '';
      loadWinners();
    } catch (x) {
      err.textContent = errMsg(x); err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = '🎡 Spin the wheel';
      setTimeout(idle, 4000);
    }
  });

  $('winners').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]'); if (!b || !isAdmin) return;
    if (!confirm('Delete this draw from the winners list?')) return;
    const { error } = await admin.rpc('delete_giveaway', { p_id: b.dataset.del });
    if (error) return toast(errMsg(error), 'warn');
    toast('Draw deleted', 'ok'); loadWinners();
  });

  // ---------------------------------------------------------------- celebration
  function celebrate(title, name, prize) {
    $('winTitle').textContent = title + ' — winner';
    $('winName').textContent = name;
    $('winPrize').textContent = prize ? `Wins: ${prize}` : 'Congratulations!';
    $('winDlg').showModal();
    if (!reduceMotion) confetti();
  }
  function confetti() {
    const cv = $('confetti'), c = cv.getContext('2d');
    cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
    c.scale(devicePixelRatio, devicePixelRatio);
    const cols = ['#B8F219', '#D4FF4F', '#FFFFFF', '#8FCB00', '#25D366'];
    const ps = Array.from({ length: 180 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight / 3,
      vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4, r: Math.random() * 6 + 3,
      c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6, va: (Math.random() - .5) * .3
    }));
    const t0 = performance.now();
    const step = t => {
      c.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach(p => {
        p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.fillStyle = p.c; c.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); c.restore();
      });
      if (t - t0 < 4500) requestAnimationFrame(step); else c.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- go
  pickSlices(); idle();
  document.fonts && document.fonts.ready.then(draw);
  loadPool().then(idle);
  loadWinners();
  renderJoin();
  checkAdmin();
})();
