// GDX Partners — sponsors, stores, online shops, display garages, services, patrons
(async function () {
  const { sb, esc, waLink, C } = window.MHC;
  const $ = id => document.getElementById(id);
  const KIND = {
    sponsor: ['Sponsor', '⭐'], store: ['Offline store', '🏪'], online: ['Online shop / site', '🌐'],
    garage: ['Display & storage', '🏁'], service: ['Customizer / service', '🛠️'], patron: ['Patron', '🤝']
  };
  const people = C.CONTACTS || [];
  const advMsg = 'Hi! I would like to advertise / become a partner on GDX — Goa Diecast Exchange. My business: ';
  $('advCta').innerHTML = people.map(p =>
    `<a class="btn ${p === people[0] ? 'btn-primary' : 'btn-ghost'}" href="${esc(waLink('91' + p.phone, advMsg))}" target="_blank" rel="noopener">💬 WhatsApp ${esc(p.name)}</a>`).join('');

  let all = [], kind = new URLSearchParams(location.search).get('k') || '';
  const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
  const igUrl = v => { v = String(v || '').trim(); if (!v) return ''; if (/^https?:\/\//i.test(v)) return v; return 'https://instagram.com/' + v.replace(/^@/, ''); };
  const phone = s => String(s.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');

  function links(s) {
    const ph = phone(s), out = [];
    if (ph.length === 10) out.push(`<a data-click="${esc(s.id)}" href="${esc(waLink('91' + ph, `Hi ${s.name}! I found you on GDX — Goa Diecast Exchange. `))}" target="_blank" rel="noopener">💬 WhatsApp</a>`,
                                   `<a data-click="${esc(s.id)}" href="tel:+91${esc(ph)}">📞 Call</a>`);
    if (safeUrl(s.website)) out.push(`<a data-click="${esc(s.id)}" href="${esc(s.website)}" target="_blank" rel="noopener">🌐 Website</a>`);
    if (igUrl(s.instagram)) out.push(`<a data-click="${esc(s.id)}" href="${esc(igUrl(s.instagram))}" target="_blank" rel="noopener">📸 Instagram</a>`);
    if (safeUrl(s.map_url)) out.push(`<a data-click="${esc(s.id)}" href="${esc(s.map_url)}" target="_blank" rel="noopener">🗺️ Directions</a>`);
    return out.join('');
  }
  function card(s, big) {
    const k = KIND[s.kind] || KIND.sponsor;
    return `
      <article class="panel sp-card pt-card${big ? ' pt-big' : ''}${s.tier === 'featured' ? ' is-featured' : ''}">
        ${s.tier === 'featured' ? '<span class="pt-badge">⭐ Featured partner</span>' : ''}
        <div class="sp-head">
          <div class="sp-logo">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="${esc(s.name)} logo" loading="lazy">` : k[1]}</div>
          <div><div class="sp-kind">${k[0]}</div><h3>${esc(s.name)}</h3></div>
        </div>
        ${s.offer ? `<div class="pt-offer">🎁 <b>GDX member offer:</b> ${esc(s.offer)}</div>` : ''}
        ${s.about ? `<p>${esc(s.about)}</p>` : ''}
        ${s.address ? `<p class="pt-addr">📍 ${esc(s.address)}</p>` : ''}
        <div class="sp-links">${links(s)}</div>
      </article>`;
  }
  function empty() {
    return `<div class="panel sp-empty" style="grid-column:1/-1">
      <div class="big">${kind ? (KIND[kind] || ['', '🤝'])[1] : '🤝'}</div>
      <h2>${kind ? 'Be the first ' + esc((KIND[kind] || ['partner'])[0].toLowerCase()) + ' here' : 'Partner with GDX'}</h2>
      <p>This spot is open. Get your brand in front of every collector on GDX.</p>
      <a class="btn btn-primary" href="#advertise">📣 Advertise with GDX</a></div>`;
  }
  function render() {
    document.querySelectorAll('#tabs .chip').forEach(x => x.classList.toggle('active', x.dataset.k === kind));
    try { history.replaceState(null, '', 'partners.html' + (kind ? '?k=' + kind : '')); } catch (e) {}
    const rows = all.filter(s => !kind || s.kind === kind);
    const feat = rows.filter(s => s.tier === 'featured'), rest = rows.filter(s => s.tier !== 'featured');
    $('featured').hidden = !feat.length;
    $('featured').innerHTML = feat.map(s => card(s, true)).join('');
    $('list').innerHTML = rows.length ? rest.map(s => card(s, false)).join('') : empty();
  }
  $('tabs').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; kind = b.dataset.k; render(); });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-click]');
    if (a) try { sb.rpc('partner_click', { p_id: a.dataset.click }); } catch (x) {}
  });

  try {
    const { data, error } = await sb.from('sponsors').select('*').eq('is_active', true).order('sort').order('created_at');
    if (error) throw error;
    all = (data || []).sort((x, y) => (x.tier === 'featured' ? 0 : 1) - (y.tier === 'featured' ? 0 : 1));
  } catch (e) { all = []; }
  render();
  if (all.length) try { sb.rpc('partner_views', { p_ids: all.map(s => s.id) }); } catch (e) {}
})();
