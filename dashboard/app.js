// Beacon dashboard. Reads window.RADAR (emitted beside dashboard/ by main.ts). No network, no framework:
// every byte shown is in data.js. The board sorts and filters; each row opens a detail drawer that shows
// the same comps decomposition main.ts used, plus the protocol's concrete farm plan.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  var S = { q: '', cat: 'all', tab: 'pre', sort: 'implied', dir: -1, sel: null };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function mult(n) { return (n === null || n === undefined) ? 'n/a' : Number(n).toFixed(2) + 'x'; }
  function age(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function cat(p) { return p.category || 'Other'; }
  function chains(p) { return p.chains && p.chains.length ? p.chains.slice(0, 2).join(', ') : 'an unnamed chain'; }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else if (typeof c === 'string' || typeof c === 'number') n.appendChild(document.createTextNode(String(c)));
      else n.appendChild(c);
    }
    return n;
  }

  function hashRead() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) S.q = p.get('q');
    if (p.get('c')) S.cat = p.get('c');
    if (p.get('p')) S.sel = p.get('p');
    if (p.get('t')) S.tab = p.get('t');
  }
  function hashWrite() {
    var p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    if (S.cat !== 'all') p.set('c', S.cat);
    if (S.tab !== 'pre') p.set('t', S.tab);
    if (S.sel) p.set('p', S.sel);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname);
  }

  function visible() {
    var q = S.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (S.cat !== 'all' && r.category !== S.cat) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var k = S.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -1e18 : a.change_7d; bv = b.change_7d === null ? -1e18 : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? 1e18 : a.age_days; bv = b.age_days === null ? 1e18 : b.age_days; }
      else if (k === 'rank') { av = -a.rank; bv = -b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -S.dir;
      if (av > bv) return S.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topbar() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, 'Beacon', el('small', { text: 'token launch radar' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', {}, 'SNAPSHOT ', el('b', { text: D.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', {}, 'MODEL ', el('b', { text: D.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', {},
        el('div', { class: 'eyebrow', text: 'Pre-token opportunity board' }),
        el('h1', {}, D.watchlist_size + ' watchlist protocols, ', el('em', { text: 'ranked by implied value' })),
        el('p', { text: 'Beacon reads one sealed snapshot of every DefiLlama protocol. It keeps apart the protocols whose token already trades, then values those still to come against what their sector’s listed peers are worth per dollar of TVL. Implied value is a model-driven estimate, not a prediction or a promise of a launch.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact accent' }, el('span', { text: 'Watchlist covered' }), el('b', { text: D.watchlist_size + ' / ' + D.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows scored' }), el('b', { text: String(D.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early signals below floor' }), el('b', { text: String(D.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live tokens set aside' }), el('b', { text: String(D.live_size) }))
      )
    );
  }

  function controls() {
    var cats = [];
    D.rows.forEach(function (r) { if (cats.indexOf(cat(r)) < 0) cats.push(cat(r)); });
    cats.sort();
    var q = el('input', { type: 'search', id: 'q', placeholder: 'Search name, chain or category', value: S.q, 'aria-label': 'Search the board' });
    q.addEventListener('input', function () { S.q = q.value; hashWrite(); render(); });
    var sel = el('select', { id: 'cat', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All sectors' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === S.cat ? 'selected' : null }); })
    );
    sel.addEventListener('change', function () { S.cat = sel.value; hashWrite(); render(); });
    var pre = el('button', { class: 'tab', type: 'button', 'aria-pressed': S.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { S.tab = 'pre'; hashWrite(); render(); } });
    var live = el('button', { class: 'tab', type: 'button', 'aria-pressed': S.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { S.tab = 'live'; hashWrite(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Find' }), q),
      el('div', { class: 'field' }, el('label', { for: 'cat', text: 'Sector' }), sel),
      el('div', { class: 'field' }, el('span', { class: 'sublabel', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: S.tab === 'pre' ? visible().length + ' of ' + D.board_size + ' rows' : D.live.length + ' live protocols' })
    );
  }

  function th(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (S.sort === key) S.dir = -S.dir; else { S.sort = key; S.dir = -1; } render(); } },
        label, S.sort === key ? el('span', { 'aria-hidden': 'true', text: S.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function board() {
    var list = sorted(visible());
    if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches' }),
      el('p', { text: 'Clear the search or choose another sector.' }),
      el('button', { class: 'button', type: 'button', text: 'Reset filters', onclick: function () { S.q = ''; S.cat = 'all'; hashWrite(); render(); } })
    ));
    var max = list[0].implied_value_usd || 1;
    var tb = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d;
      var gc = g === null ? '' : g >= 0 ? 'up' : 'down';
      tb.appendChild(el('tr', {
        'data-selected': S.sel === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { detail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); detail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', { class: 'pname' }, el('b', { text: r.name }), el('span', { text: cat(r) + ' · ' + chains(r) })),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: pct(g) }),
        el('td', { class: 'num', text: age(r.age_days) }),
        el('td', {}, el('span', { class: 'tag chip', text: mult(r.comp_used) })),
        el('td', {}, el('div', { class: 'implied' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(r.implied_value_usd / max * 100)) + '%' })),
          el('b', { text: usd(r.implied_value_usd) })
        )),
        el('td', {}, el('span', { class: 'status', text: 'no token' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Every watchlist protocol plus the strongest pre-token protocols below the floor. Select a row to see its valuation decomposition and farm plan.' }),
          el('thead', null, el('tr', null,
            th('rank', '#'), th('name', 'Protocol'), th('tvl', 'TVL'), th('growth', '7d'), th('age', 'Age'), th('implied', 'Comp'), th('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tb
        )
      )
    );
  }

  function liveTable() {
    var tb = el('tbody');
    D.live.forEach(function (r) {
      tb.appendChild(el('tr', null,
        el('td', { class: 'num rank', text: '—' }),
        el('td', { class: 'pname' }, el('b', { text: r.name }), el('span', { text: cat(r) + ' · ' + chains(r) })),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }),
        el('td', { class: 'num', text: usd(r.mcap_usd) }),
        el('td', {}, el('span', { class: 'tag chip', text: mult(r.mcap_over_tvl) })),
        el('td', {}, el('span', { class: 'status live', text: 'trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'These protocols already have a trading token: the market cap is a observed fact, not a model. Their mcap/TVL multiples are the comparables that calibrate the pre-token board, and they are excluded from its ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap/TVL' }), el('th', { scope: 'col', text: 'Token' })
          )),
          tb
        )
      )
    );
  }

  function modelPanel() {
    var m = D.model;
    var comps = D.comps.slice().sort(function (a, b) { return b.comp_used - a.comp_used; }).slice(0, 12);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is built' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot alone. The sector comparable is the median mcap/TVL of that sector’s listed tokens, shrunk toward the cross-sector median and clamped; then TVL, seven-day momentum, time without a token and chain breadth are applied.' }),
      el('div', { class: 'formula', text: 'implied = round( TVL × comp(sector) × (1 + clamp(7d,' + m.growth_floor + ',' + m.growth_cap + ')/100 × ' + m.growth_weight + ') × (' + m.tenure_floor + ' + min(age,' + m.tenure_days + ')/' + m.tenure_days + ' × ' + m.tenure_span + ') × (1 + extraChains × ' + m.chain_step + ') )' }),
      el('p', { class: 'sub', text: 'Cross-sector median comp ' + mult(D.global_comp) + '. Categories without a listed peer inherit that median. Comp is capped at ' + m.comp_ceiling + '× and floored at ' + m.comp_floor + '× so one outlier cannot dominate. Shown: the twelve highest sector comps actually used.' }),
      el('div', { class: 'comptable' }, comps.map(function (c) {
        return el('div', { class: 'compcell', title: c.category + ': ' + c.peer_count + ' listed peers, raw ' + c.comp_raw.toFixed(2) },
          el('span', { text: c.category + ' (' + c.peer_count + ')' }), el('b', { text: mult(c.comp_used) })
        );
      }))
    );
  }

  var dlg = el('dialog', { class: 'detail', id: 'detail', 'aria-label': 'Protocol detail' });
  dlg.addEventListener('close', function () { S.sel = null; hashWrite(); });

  function detail(slug) {
    var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    S.sel = slug; hashWrite();
    dlg.textContent = '';
    dlg.appendChild(el('div', { class: 'detail-head' },
      el('div', {},
        el('div', { class: 'kicker', text: 'RANK ' + r.rank + ' OF ' + D.board_size + ' · ' + cat(r).toUpperCase() }),
        el('h2', { id: 'detail-title', text: r.name }),
        el('span', { class: 'sub', text: cat(r) + ' · ' + (r.chains || []).join(', ') })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dlg.close(); } })
    ));
    dlg.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Valuation decomposition' }),
      el('div', { class: 'equation' },
        el('div', {}, el('span', { text: 'TVL' }), el('b', { text: usd(r.tvl_usd) })),
        el('div', {}, el('span', { text: 'Sector comp (' + (r.category_peers || 0) + ' peers)' }), el('b', { text: mult(r.comp_used) })),
        el('div', {}, el('span', { text: '7-day TVL change' }), el('b', { class: r.change_7d >= 0 ? 'up' : 'down', text: pct(r.change_7d) })),
        el('div', {}, el('span', { text: 'Growth multiplier' }), el('b', { text: mult(r.growth_multiplier) })),
        el('div', {}, el('span', { text: 'Time without a token' }), el('b', { text: age(r.age_days) })),
        el('div', {}, el('span', { text: 'Tenure multiplier' }), el('b', { text: mult(r.tenure_multiplier) })),
        el('div', {}, el('span', { text: 'Chain breadth multiplier' }), el('b', { text: mult(r.chain_multiplier) })),
        el('div', { class: 'hl' }, el('span', { text: 'Implied value' }), el('b', { text: usd(r.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'The snapshot records no token for this protocol; it may still have one. Age is measured from its first listing date. This is a model estimate, not a price target.' })
    ));
    dlg.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How to farm it — ' + r.farm.length + ' concrete steps' }),
      el('ol', { class: 'steps' }, r.farm.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
    else dlg.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' },
      topbar(), lede(), controls(),
      S.tab === 'pre' ? board() : liveTable(),
      S.tab === 'pre' ? modelPanel() : null,
      el('footer', { text: 'Beacon · sealed DefiLlama snapshot ' + D.as_of + ' · ' + D.board_size + ' pre-token rows · comps-calibrated model ' + D.model_version + ' · estimates, not advice' })
    );
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dlg.isConnected) app.appendChild(dlg);
    if (S.sel) detail(S.sel);
  }

  hashRead();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg.open) dlg.close(); });
})();
