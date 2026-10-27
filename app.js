/* Wardroom Bill — track wardroom meal charges and extras. Data is stored on this device (localStorage). */
(() => {
  'use strict';

  const KEY = 'wardroomBill.v1';
  const THEME_KEY = 'wardroomBill.theme';

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromStr = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = fromStr(s); d.setDate(d.getDate() + n); return toStr(d); };
  const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
  const dayLabel = s => fromStr(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  /* ---------- data ---------- */
  const defaults = () => ({
    currency: 'Tk',
    meals: ['Breakfast', 'Lunch', 'Dinner', 'Standeasy'].map(name => ({ id: uid(), name, price: 0 })),
    extras: [],
    log: {} // log[date][key] = { name, price, qty }   key: m:<id> | e:<id> | o:<id>
  });

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && Array.isArray(raw.meals)) return { ...defaults(), ...raw, extras: raw.extras || [], log: raw.log || {} };
    } catch (e) { /* ignore */ }
    return defaults();
  }
  let data = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { toast('Could not save on this device'); } };

  const money = n => `${data.currency ? data.currency + ' ' : ''}${nf.format(n)}`;

  /* ---------- state ---------- */
  const todayStr = toStr(new Date());
  const state = { tab: 'log', date: todayStr, month: todayStr.slice(0, 7) };
  let modal = null;

  /* ---------- calculations ---------- */
  const kindOf = key => key[0] === 'm' ? 'meal' : 'extra';

  function dayEntries(date) {
    return Object.entries(data.log[date] || {}).map(([key, e]) => ({ date, key, kind: kindOf(key), ...e }));
  }
  const dayTotal = date => dayEntries(date).reduce((s, e) => s + e.price * e.qty, 0);

  function monthEntries(month) {
    return Object.keys(data.log).filter(d => d.startsWith(month)).sort().flatMap(dayEntries);
  }
  function monthTotals(month) {
    let meals = 0, extras = 0;
    monthEntries(month).forEach(e => { if (e.kind === 'meal') meals += e.price * e.qty; else extras += e.price * e.qty; });
    return { meals, extras, total: meals + extras };
  }

  /* Rows shown for a day: every catalog item (qty 0 if untouched) + leftover entries */
  function dayRows(date) {
    const day = data.log[date] || {};
    const seen = new Set();
    const rows = [];
    const add = (prefix, kind, it) => {
      const key = prefix + it.id; seen.add(key);
      const e = day[key];
      rows.push({ key, kind, name: e ? e.name : it.name, price: e ? e.price : it.price, qty: e ? e.qty : 0 });
    };
    data.meals.forEach(m => add('m:', 'meal', m));
    data.extras.forEach(x => add('e:', 'extra', x));
    const others = Object.entries(day).filter(([k]) => !seen.has(k))
      .map(([key, e]) => ({ key, kind: 'other', name: e.name, price: e.price, qty: e.qty }));
    return { rows, others };
  }

  function adjust(date, key, delta) {
    const { rows, others } = dayRows(date);
    const row = [...rows, ...others].find(r => r.key === key);
    if (!row) return;
    const qty = Math.max(0, row.qty + delta);
    if (!data.log[date]) data.log[date] = {};
    if (qty === 0) {
      delete data.log[date][key];
      if (!Object.keys(data.log[date]).length) delete data.log[date];
    } else {
      data.log[date][key] = { name: row.name, price: row.price, qty };
    }
    save();
  }

  /* ---------- rendering ---------- */
  function stepperRow(r) {
    const sub = r.qty > 0
      ? `${esc(money(r.price))} × ${r.qty} = ${esc(money(r.price * r.qty))}`
      : esc(money(r.price));
    return `
      <div class="row ${r.qty > 0 ? 'active' : ''}">
        <div class="row-info">
          <div class="row-name">${esc(r.name)}</div>
          <div class="row-sub">${sub}</div>
        </div>
        <div class="stepper">
          <button data-act="dec" data-key="${esc(r.key)}" ${r.qty === 0 ? 'disabled' : ''} aria-label="Remove one ${esc(r.name)}">−</button>
          <span class="qty">${r.qty}</span>
          <button data-act="inc" data-key="${esc(r.key)}" aria-label="Add one ${esc(r.name)}">+</button>
        </div>
      </div>`;
  }

  function renderLog() {
    const { rows, others } = dayRows(state.date);
    const meals = rows.filter(r => r.kind === 'meal');
    const extras = rows.filter(r => r.kind === 'extra');
    const unpriced = data.meals.length && data.meals.every(m => !m.price);
    const isToday = state.date === todayStr;

    $('#view-log').innerHTML = `
      ${unpriced ? `<div class="hint">Your meal charges are all 0. <button class="link-btn" data-act="tab" data-tab="prices" style="padding:0">Set your rates in Prices →</button></div>` : ''}
      <div class="datebar">
        <button class="btn-sq" data-act="prev-day" aria-label="Previous day">‹</button>
        <div class="date-mid">
          <div class="big">${esc(dayLabel(state.date))}${isToday ? ' · Today' : ''}</div>
          <input type="date" id="date-input" value="${state.date}">
        </div>
        <button class="btn-sq" data-act="next-day" aria-label="Next day">›</button>
      </div>

      <div class="card total-card">
        <div class="label">Total for this day</div>
        <div class="amount">${esc(money(dayTotal(state.date)))}</div>
      </div>

      <div class="section-title">Meals</div>
      <div class="list">${meals.length ? meals.map(stepperRow).join('') : '<div class="empty">No meals yet. Add some in Prices.</div>'}</div>

      <div class="section-title">Extra items</div>
      <div class="list">${extras.length ? extras.map(stepperRow).join('') : '<div class="empty">No extra items yet. Add them in Prices, or use a one-off below.</div>'}</div>

      ${others.length ? `<div class="section-title">One-off / removed items</div><div class="list">${others.map(stepperRow).join('')}</div>` : ''}

      <div class="section-title">Add a one-off item</div>
      <div class="inline-form">
        <input type="text" id="oo-name" placeholder="Item name" maxlength="40" autocomplete="off">
        <input type="number" id="oo-price" placeholder="Charge" inputmode="decimal" min="0" step="any">
        <button class="btn btn-primary" data-act="add-oneoff">Add</button>
      </div>
      ${isToday ? '' : '<button class="btn btn-block" style="margin-top:14px" data-act="today">Jump to today</button>'}
    `;
  }

  function renderBill() {
    const entries = monthEntries(state.month);
    const t = monthTotals(state.month);

    // breakdown by item (name + price)
    const groups = new Map();
    entries.forEach(e => {
      const g = e.kind === 'meal' ? 'meal' : 'extra';
      const k = `${g}|${e.name}|${e.price}`;
      const cur = groups.get(k) || { g, name: e.name, price: e.price, qty: 0 };
      cur.qty += e.qty; groups.set(k, cur);
    });
    const list = [...groups.values()].sort((a, b) => (a.g === b.g ? a.name.localeCompare(b.name) : a.g === 'meal' ? -1 : 1));
    const groupHtml = g => {
      const items = list.filter(x => x.g === g);
      return items.length ? `<div class="list">${items.map(x => `
        <div class="row">
          <div class="row-info">
            <div class="row-name">${esc(x.name)}</div>
            <div class="row-sub">${x.qty} × ${esc(money(x.price))}</div>
          </div>
          <div class="row-end">${esc(money(x.qty * x.price))}</div>
        </div>`).join('')}</div>` : '<div class="list"><div class="empty">Nothing recorded</div></div>';
    };

    // per-day
    const dates = [...new Set(entries.map(e => e.date))].sort().reverse();
    const daysHtml = dates.map(d => {
      const es = entries.filter(e => e.date === d);
      return `<details>
        <summary><span>${esc(dayLabel(d))}</span><span class="d-total">${esc(money(dayTotal(d)))}</span></summary>
        <div class="d-body">
          ${es.map(e => `<div class="d-line"><span>${esc(e.name)} × ${e.qty}</span><span>${esc(money(e.price * e.qty))}</span></div>`).join('')}
          <button class="link-btn" data-act="goto-day" data-date="${d}">Open this day →</button>
        </div></details>`;
    }).join('');

    $('#view-bill').innerHTML = `
      <div class="datebar">
        <button class="btn-sq" data-act="prev-month" aria-label="Previous month">‹</button>
        <div class="date-mid"><div class="big">${esc(monthLabel(state.month))}</div></div>
        <button class="btn-sq" data-act="next-month" aria-label="Next month">›</button>
      </div>

      <div class="card total-card">
        <div class="label">Bill for the month</div>
        <div class="amount">${esc(money(t.total))}</div>
        <div class="stats">
          <div class="stat"><div class="s-label">Meals</div><div class="s-val">${esc(money(t.meals))}</div></div>
          <div class="stat"><div class="s-label">Extras</div><div class="s-val">${esc(money(t.extras))}</div></div>
        </div>
      </div>

      <div class="section-title">Meals</div>
      ${groupHtml('meal')}
      <div class="section-title">Extras</div>
      ${groupHtml('extra')}

      <div class="section-title">Day by day</div>
      ${daysHtml || '<div class="list"><div class="empty">No entries this month</div></div>'}

      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-primary" data-act="copy">Copy summary</button>
      </div>
      <button class="btn btn-danger btn-block" style="margin-top:10px" data-act="delete-month" ${dates.length ? '' : 'disabled'}>Delete ${esc(monthLabel(state.month))} data</button>
    `;
  }

  function priceRow(kind, it) {
    return `<div class="row" data-act="edit-item" data-kind="${kind}" data-id="${it.id}" style="cursor:pointer">
      <div class="row-info"><div class="row-name">${esc(it.name)}</div></div>
      <div class="row-end">${esc(money(it.price))}</div>
      <span class="muted">✎</span>
    </div>`;
  }

  function renderPrices() {
    $('#view-prices').innerHTML = `
      <div class="section-title">Meal charges</div>
      <div class="list">${data.meals.length ? data.meals.map(m => priceRow('meal', m)).join('') : '<div class="empty">No meals</div>'}</div>
      <button class="btn btn-block" style="margin-top:10px" data-act="add-item" data-kind="meal">+ Add meal</button>

      <div class="section-title">Extra items</div>
      <div class="list">${data.extras.length ? data.extras.map(x => priceRow('extra', x)).join('') : '<div class="empty">No extra items yet</div>'}</div>
      <button class="btn btn-block" style="margin-top:10px" data-act="add-item" data-kind="extra">+ Add extra item</button>

      <div class="section-title">Settings</div>
      <div class="card">
        <label for="currency" style="margin-top:0">Currency label</label>
        <input id="currency" type="text" maxlength="6" value="${esc(data.currency)}" placeholder="Tk">
        <div class="btn-row" style="margin-top:14px">
          <button class="btn" data-act="export">Export backup</button>
          <button class="btn" data-act="import">Import backup</button>
        </div>
        <button class="btn btn-danger btn-block" style="margin-top:10px" data-act="reset">Erase all data</button>
      </div>
      <p class="muted" style="font-size:.85rem;padding:0 4px">Tap an item to change its charge. Past entries keep the charge they were logged with — when you change a price you can choose to update this month's entries too.</p>
      <p class="devlop">Developed by: PIRATENAHID</p>
    `;
  }

  function render() {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    $('#view-log').hidden = state.tab !== 'log';
    $('#view-bill').hidden = state.tab !== 'bill';
    $('#view-prices').hidden = state.tab !== 'prices';
    if (state.tab === 'log') renderLog();
    if (state.tab === 'bill') renderBill();
    if (state.tab === 'prices') renderPrices();
    const cm = todayStr.slice(0, 7);
    $('#hdr-sub').textContent = `${monthLabel(cm)}: ${money(monthTotals(cm).total)}`;
  }

  /* ---------- modal ---------- */
  function openModal(kind, id) {
    modal = { kind, id: id || null };
    const list = kind === 'meal' ? data.meals : data.extras;
    const it = id ? list.find(x => x.id === id) : null;
    $('#m-title').textContent = it ? `Edit ${kind === 'meal' ? 'meal' : 'extra item'}` : `New ${kind === 'meal' ? 'meal' : 'extra item'}`;
    $('#m-name').value = it ? it.name : '';
    $('#m-price').value = it ? it.price : '';
    $('#m-delete').hidden = !it;
    $('#sheet').hidden = false;
    setTimeout(() => $('#m-name').focus(), 50);
  }
  const closeModal = () => { $('#sheet').hidden = true; modal = null; };

  function saveItem() {
    if (!modal) return;
    const name = $('#m-name').value.trim();
    const price = parseFloat($('#m-price').value);
    if (!name) return toast('Enter a name');
    if (isNaN(price) || price < 0) return toast('Enter a valid charge');
    const list = modal.kind === 'meal' ? data.meals : data.extras;
    const prefix = modal.kind === 'meal' ? 'm:' : 'e:';

    if (modal.id) {
      const it = list.find(x => x.id === modal.id);
      const key = prefix + it.id;
      const mon = state.date.slice(0, 7);
      const stale = [];
      Object.keys(data.log).filter(d => d.startsWith(mon)).forEach(d => {
        const e = data.log[d][key];
        if (e && (e.price !== price || e.name !== name)) stale.push(e);
      });
      it.name = name; it.price = price;
      if (stale.length && confirm(`Also update ${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} already logged in ${monthLabel(mon)} to the new name/charge?`)) {
        stale.forEach(e => { e.name = name; e.price = price; });
      }
    } else {
      list.push({ id: uid(), name, price });
    }
    save(); closeModal(); render();
  }

  function deleteItem() {
    if (!modal || !modal.id) return;
    if (!confirm('Delete this item? Entries already logged stay in your bill.')) return;
    const list = modal.kind === 'meal' ? data.meals : data.extras;
    const i = list.findIndex(x => x.id === modal.id);
    if (i >= 0) list.splice(i, 1);
    save(); closeModal(); render();
  }

  /* ---------- actions ---------- */
  function summaryText() {
    const t = monthTotals(state.month);
    const groups = new Map();
    monthEntries(state.month).forEach(e => {
      const k = `${e.kind}|${e.name}|${e.price}`;
      const cur = groups.get(k) || { kind: e.kind, name: e.name, price: e.price, qty: 0 };
      cur.qty += e.qty; groups.set(k, cur);
    });
    const lines = [...groups.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'meal' ? -1 : 1))
      .map(x => `${x.name} × ${x.qty} @ ${money(x.price)} = ${money(x.qty * x.price)}`);
    return [`Wardroom Bill — ${monthLabel(state.month)}`, '', ...lines, '',
      `Meals: ${money(t.meals)}`, `Extras: ${money(t.extras)}`, `TOTAL: ${money(t.total)}`].join('\n');
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Summary copied'); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Summary copied'); } catch (e2) { toast('Could not copy'); }
      ta.remove();
    }
  }

  function deleteMonth() {
    const month = state.month;
    const days = Object.keys(data.log).filter(d => d.startsWith(month));
    if (!days.length) return toast('Nothing to delete this month');
    const total = money(monthTotals(month).total);
    if (!confirm(`Delete all ${days.length} logged day${days.length === 1 ? '' : 's'} for ${monthLabel(month)} (${total})? This cannot be undone. Consider exporting a backup first.`)) return;
    days.forEach(d => delete data.log[d]);
    save(); render(); toast(`${monthLabel(month)} deleted`);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wardroom-bill-backup-${todayStr}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.meals) || typeof parsed.log !== 'object') throw new Error('bad');
        if (!confirm('Replace everything on this device with the backup?')) return;
        data = { ...defaults(), ...parsed, extras: parsed.extras || [] };
        save(); render(); toast('Backup restored');
      } catch (e) { toast('That file is not a Wardroom Bill backup'); }
    };
    reader.readAsText(file);
  }

  function addOneOff() {
    const name = $('#oo-name').value.trim();
    const price = parseFloat($('#oo-price').value);
    if (!name) return toast('Enter an item name');
    if (isNaN(price) || price < 0) return toast('Enter a valid charge');
    if (!data.log[state.date]) data.log[state.date] = {};
    data.log[state.date]['o:' + uid()] = { name, price, qty: 1 };
    save(); render();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#fdf6e3' : '#2d353b');
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  }

  /* ---------- events ---------- */
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    switch (act) {
      case 'tab': state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case 'inc': adjust(state.date, el.dataset.key, 1); render(); break;
      case 'dec': adjust(state.date, el.dataset.key, -1); render(); break;
      case 'prev-day': state.date = addDays(state.date, -1); render(); break;
      case 'next-day': state.date = addDays(state.date, 1); render(); break;
      case 'today': state.date = todayStr; render(); break;
      case 'prev-month': state.month = addMonths(state.month, -1); render(); break;
      case 'next-month': state.month = addMonths(state.month, 1); render(); break;
      case 'goto-day': state.date = el.dataset.date; state.tab = 'log'; render(); window.scrollTo(0, 0); break;
      case 'add-oneoff': addOneOff(); break;
      case 'add-item': openModal(el.dataset.kind); break;
      case 'edit-item': openModal(el.dataset.kind, el.dataset.id); break;
      case 'save-item': saveItem(); break;
      case 'delete-item': deleteItem(); break;
      case 'close-modal': closeModal(); break;
      case 'copy': copyText(summaryText()); break;
      case 'delete-month': deleteMonth(); break;
      case 'export': exportData(); break;
      case 'import': $('#import-file').click(); break;
      case 'reset':
        if (confirm('Erase ALL meals, prices and logged entries on this device?') && confirm('This cannot be undone. Erase everything?')) {
          data = defaults(); save(); render(); toast('All data erased');
        }
        break;
      case 'theme':
        setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); break;
    }
  });

  document.addEventListener('change', ev => {
    if (ev.target.id === 'date-input') {
      if (ev.target.value) { state.date = ev.target.value; render(); }
    } else if (ev.target.id === 'currency') {
      data.currency = ev.target.value.trim(); save(); render();
    } else if (ev.target.id === 'import-file') {
      const f = ev.target.files[0]; if (f) importData(f); ev.target.value = '';
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !$('#sheet').hidden && ev.target.closest('.sheet-body')) saveItem();
    if (ev.key === 'Escape' && !$('#sheet').hidden) closeModal();
    if (ev.key === 'Enter' && (ev.target.id === 'oo-name' || ev.target.id === 'oo-price')) addOneOff();
  });

  /* ---------- start ---------- */
  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  setTheme(savedTheme === 'light' ? 'light' : 'dark');
  render();
})();