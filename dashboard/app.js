// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filters, sorting, and a per-protocol detail view with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('rows');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. Same constants as lib/model.ts MODEL (radar-2).
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    var breadth = 1 + model.breadth_per_chain * extra;
    var momentum = growth >= model.momentum_threshold ? model.momentum_up : growth <= -model.momentum_threshold ? model.momentum_down : 1;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth * momentum));
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.selected) p.set('p', state.selected);
    var h = p.toString();
    history.replaceState(null, '', h ? '#' + h : '#');
  }

  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
  }

  function filteredRows() {
    var rows = state.tab === 'live' ? DATA.live.slice() : DATA.rows.slice();
    var q = state.q.trim().toLowerCase();
    if (q) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.toLowerCase().indexOf(q) >= 0; });
    if (state.category !== 'all') rows = rows.filter(function (r) { return r.category === state.category; });
    if (state.chain !== 'all') rows = rows.filter(function (r) { return (r.chains || []).indexOf(state.chain) >= 0; });
    var dir = state.dir;
    var key = state.sort;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd || a.mcap_usd || 0; bv = b.implied_value_usd || b.mcap_usd || 0; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null || a.age_days === undefined ? -1 : a.age_days; bv = b.age_days === null || b.age_days === undefined ? -1 : b.age_days; }
      else { return a.name.localeCompare(b.name) * dir; }
      return (av - bv) * dir;
    });
    return rows;
  }

  function rowHtml(r) {
    var isLive = state.tab === 'live';
    var value = isLive ? r.mcap_usd : r.implied_value_usd;
    var change = r.change_7d;
    var changeCls = change === null ? '' : change >= 0 ? 'up' : 'down';
    var rankCell = isLive ? '<td class="rank">—</td>' : '<td class="rank">' + r.rank + '</td>';
    var watch = !isLive && isWatchlisted(r.slug)
      ? '<span class="badge">WATCHLIST</span>' : '';
    return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.selected === r.slug ? 'sel' : '') + '">' +
      rankCell +
      '<td><span class="nm">' + esc(r.name) + '</span>' + watch +
        '<br><span class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc((r.chains || []).slice(0, 3).join(', ') || '—') + '</span></td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num ' + changeCls + '">' + fmtPct(change) + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td class="num"><strong>' + fmtUsd(value) + '</strong><br><span class="sub">' + (isLive ? 'market cap' : 'implied') + '</span></td>' +
      '</tr>';
  }

  // Watchlist membership, recovered from the board's own figures: every board row is already
  // rankable (pre-token, not wrapped, staked, bridged or versioned), so a row at or above the
  // floor is on the watchlist and one below it is an early row the radar found.
  var watchlistSet = null;
  function isWatchlisted(slug) {
    if (!watchlistSet) {
      watchlistSet = {};
      DATA.rows.forEach(function (r) {
        if (r.tvl_usd >= DATA.floor_usd) watchlistSet[r.slug] = true;
      });
    }
    return !!watchlistSet[slug];
  }

  function render() {
    var rows = filteredRows();
    document.getElementById('count').textContent =
      rows.length + ' of ' + (state.tab === 'live' ? DATA.live_size : DATA.board_size) +
      (state.tab === 'live' ? ' live-token protocols by market cap' : ' pre-token protocols ranked by implied value');
    document.getElementById('empty').hidden = rows.length > 0;
    app.innerHTML = rows.map(rowHtml).join('');
    document.querySelectorAll('#board tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === state.tab);
    });
    renderDetail();
    writeHash();
  }

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function select(slug) {
    state.selected = slug;
    render();
    var d = document.getElementById('detail');
    if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderDetail() {
    var box = document.getElementById('detail');
    var r = state.selected ? findRow(state.selected) : null;
    if (!r) {
      box.innerHTML = '<p class="detail-hint">Click a row to open its detail view: the model\u2019s own numbers and the farm plan.</p>';
      return;
    }
    var check = impliedOf(r, DATA.model);
    var match = check === r.implied_value_usd ? 'matches the board' : 'differs from the board';
    var steps = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    box.innerHTML =
      '<button type="button" class="close" id="dclose" aria-label="Close detail">×</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="dsub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
        esc((r.chains || []).join(', ') || '—') + ' · tracked since ' + esc(r.listed_at || 'unknown') +
        (isWatchlisted(r.slug) ? ' · <span class="badge">WATCHLIST</span>' : '') + '</p>' +
      '<h3>Why it ranks here</h3>' +
      '<dl>' +
      '<dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + fmtPct(r.change_7d) + '</dd>' +
      '<dt>Age on record</dt><dd>' + fmtAge(r.age_days) + '</dd>' +
      '<dt>Growth ×</dt><dd>' + r.growth_multiplier.toFixed(4) + '</dd>' +
      '<dt>Maturity ×</dt><dd>' + r.maturity_multiplier.toFixed(4) + '</dd>' +
      '<dt>Breadth ×</dt><dd>' + r.breadth_multiplier.toFixed(4) + '</dd>' +
      '<dt>Momentum ×</dt><dd>' + r.momentum_multiplier.toFixed(2) + '</dd>' +
      '<dt>Implied value</dt><dd><strong>' + fmtUsd(r.implied_value_usd) + '</strong></dd>' +
      '</dl>' +
      '<p class="note">Recomputed in this page from the same figures: ' + fmtUsd(check) + ' — ' + match + '.</p>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol>' +
      '<p class="note">This protocol records no token in the snapshot. That is the record, not proof ' +
      'that none exists — check the protocol\u2019s own pages before you farm it.</p>';
    document.getElementById('dclose').addEventListener('click', function () { state.selected = null; render(); });
  }

  // Header, stats and footer from the data.
  var top = DATA.rows[0];
  document.getElementById('meta').innerHTML =
    'Snapshot <b>' + esc(DATA.as_of) + '</b><br>Model <b>' + esc(DATA.model_version) + '</b> · ' +
    'Watchlist floor <b>' + fmtUsd(DATA.floor_usd) + '</b>';
  document.getElementById('stats').innerHTML =
    '<div class="stat"><div class="n">' + DATA.board_size + '</div><div class="l">Pre-token rows ranked</div></div>' +
    '<div class="stat"><div class="n">' + DATA.watchlist_size + '</div><div class="l">Watchlist protocols covered</div></div>' +
    '<div class="stat"><div class="n">' + DATA.early_size + '</div><div class="l">Early rows below the floor</div></div>' +
    '<div class="stat"><div class="n">' + fmtUsd(top ? top.implied_value_usd : 0) + '</div><div class="l">Top implied value — ' + esc(top ? top.name : '—') + '</div></div>';
  document.getElementById('src').textContent = 'Source: ' + DATA.source + '.';

  var cats = [];
  var chains = [];
  DATA.rows.concat(DATA.live).forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  fillSelect('category', cats);
  fillSelect('chain', chains);

  // Controls.
  var qEl = document.getElementById('q');
  qEl.addEventListener('input', function () { state.q = qEl.value; state.selected = null; render(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; render(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; state.dir = -1; render(); });
  document.getElementById('clear').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.sort = 'implied'; state.selected = null;
    qEl.value = ''; document.getElementById('category').value = 'all';
    document.getElementById('chain').value = 'all'; document.getElementById('sort').value = 'implied';
    render();
  });
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); state.selected = null; render(); });
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      document.getElementById('sort').value = state.sort;
      render();
    });
  });

  readHash();
  qEl.value = state.q;
  document.getElementById('category').value = state.category;
  document.getElementById('chain').value = state.chain;
  document.getElementById('sort').value = state.sort;
  render();
})();
