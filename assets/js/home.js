// GDX home — live numbers, newest cars on the Sales tile, auction countdown.
(function () {
  const { sb, esc, money, cover } = window.MHC;
  const $ = id => document.getElementById(id);
  if (!sb) return;

  const fmtLeft = ms => {
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return `${d}d ${h % 24}h`;
    if (h >= 1) return `${h}h ${m % 60}m`;
    const s = Math.floor(ms / 1000) % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  // Live numbers (one call)
  (async () => {
    try {
      const { data, error } = await sb.rpc('home_stats');
      if (error || !data) throw error;
      document.querySelectorAll('#stats [data-k]').forEach(b => {
        const v = Number(data[b.dataset.k] || 0); b.textContent = v.toLocaleString('en-IN');
      });
      $('aucCount').textContent = Number(data.auctions || 0);
      if (data.next_auction_end) {
        const end = new Date(data.next_auction_end).getTime();
        const tick = () => { $('aucNext').textContent = fmtLeft(end - Date.now()); };
        tick(); setInterval(tick, 1000);
      } else $('aucNext').textContent = '—';
    } catch (e) {
      document.getElementById('stats').hidden = true;
    }
  })();

  // Newest three cars on the Sales tile
  (async () => {
    try {
      const { data, error } = await sb.from('products').select('id,name,price,images,stock')
        .eq('is_active', true).gt('stock', 0).order('created_at', { ascending: false }).limit(3);
      if (error || !data || !data.length) return;
      $('shelf').innerHTML = data.map(p =>
        `<div class="shelf-car"><img src="${esc(cover(p))}" alt="${esc(p.name)}" loading="lazy"><span>${money(p.price)}</span></div>`).join('') +
        Array.from({ length: 3 - data.length }, () => '<div class="shelf-car is-empty">🏁</div>').join('');
    } catch (e) { /* keep the placeholders */ }
  })();

  // Racing tile — latest race night, open races, top car
  (async () => {
    try {
      const ev = await sb.from('race_events').select('id,name,event_date,status').order('event_date', { ascending: false }).order('created_at', { ascending: false }).limit(1);
      const e = ev.data && ev.data[0]; if (ev.error || !e) return;
      $('raceEvent').textContent = e.name;
      $('raceDate').textContent = new Date(e.event_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) +
        ' · ' + ({ open: 'registration open', live: 'racing live', closed: 'finished' }[e.status] || '');
      $('raceLabel').textContent = { open: 'Registration open', live: 'Racing live', closed: 'GDX Racing' }[e.status] || 'GDX Racing';
      if (e.status === 'live') $('raceDot').classList.add('live');
      const [sl, rc, en] = await Promise.all([
        sb.from('race_slots').select('status').eq('event_id', e.id).limit(2000),
        sb.from('races').select('winner,voided').eq('event_id', e.id).limit(5000),
        sb.from('race_entries').select('id,car_name,racer_name').eq('event_id', e.id).limit(2000)]);
      $('raceOpen').textContent = sl.data ? sl.data.filter(x => x.status === 'open').length : '—';
      const live = (rc.data || []).filter(r => !r.voided);
      $('raceDone').textContent = live.length;
      const wins = {}; live.forEach(r => { wins[r.winner] = (wins[r.winner] || 0) + 1; });
      const top = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
      const car = top && (en.data || []).find(x => x.id === top[0]);
      if (car) $('raceLeader').textContent = `${car.car_name} · ${top[1]} won`;
    } catch (e) { /* keep the placeholders */ }
  })();

  // Sponsor count
  (async () => {
    try {
      const { data } = await sb.from('sponsors').select('id,name,logo_url,tier,offer').eq('is_active', true).order('sort');
      const list = data || [];
      if (list.length) {
        const offers = list.filter(s => s.offer).length;
        $('sponsorNote').textContent = `${list.length} partner${list.length > 1 ? 's' : ''} backing Goa's diecast scene${offers ? ` · ${offers} member offer${offers > 1 ? 's' : ''}` : ''} — see them all`;
        const feat = list.filter(s => s.tier === 'featured' && s.logo_url).concat(list.filter(s => s.tier !== 'featured' && s.logo_url)).slice(0, 5);
        $('sponsorLogos').innerHTML = feat.map(s => `<img src="${esc(s.logo_url)}" alt="${esc(s.name)}" title="${esc(s.name)}" loading="lazy">`).join('');
      }
    } catch (e) {}
  })();
})();
