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

  // Sponsor count
  (async () => {
    try {
      const { count } = await sb.from('sponsors').select('id', { count: 'exact', head: true }).eq('is_active', true);
      if (count) $('sponsorNote').textContent = `${count} partner${count > 1 ? 's' : ''} backing Goa's diecast scene — see them all`;
    } catch (e) {}
  })();
})();
