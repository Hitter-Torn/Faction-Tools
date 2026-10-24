// ==UserScript==
// @name         Torn Faction Management Tools
// @namespace    torn-faction-management-tools
// @version      3.0.0
// @description  OC Delay Tracker + Armory Inspector. Two independent dashboards, one settings page.
// @author       Hitter / Faction Staff
// @match        https://www.torn.com/factions.php*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.torn.com
// @connect      script.google.com
// @connect      googleusercontent.com
// @connect      accounts.google.com
// ==/UserScript==

(() => {
  'use strict';

  // OC Tracker V2.2 connection and token storage: preserved exactly.
  const BASE_URL = "https://script.google.com/macros/s/AKfycbzoF7CHwC7Tg9lMVRhIOT7wkpTFygT0CM8FYdXN-IS0CEsIgjbBmjJoQs5xBfOmLwjo1g/exec";
  function getStoredToken() {
    try { return GM_getValue('faction_token', '') || ''; }
    catch (e) { return ''; }
  }
  function saveStoredToken(val) { GM_setValue('faction_token', val || ''); }
  function clearStoredToken() { GM_deleteValue('faction_token'); }
  function makeServerUrl() {
    const token = getStoredToken();
    return token ? `${BASE_URL}?token=${encodeURIComponent(token)}` : BASE_URL;
  }

  const APP = 'fai-v1-en';
  const API = 'https://api.torn.com/v2';
  const KEY_STORE = `${APP}:key`;
  const OVERRIDES_STORE = `${APP}:slots`;
  const TEMP_STORE = `${APP}:temporary`;
  const LIMIT = 100;
  const MAX_PAGES = 200;
  const SLOT_LABELS = {
    primary: 'Primary', secondary: 'Secondary', melee: 'Melee',
    temporary: 'Temporary', helmet: 'Helmet', body: 'Body Armor',
    pants: 'Pants', boots: 'Boots', gloves: 'Gloves', unknown: 'Unclassified'
  };
  const SLOT_ORDER = ['primary', 'secondary', 'melee', 'temporary', 'helmet', 'body', 'pants', 'boots', 'gloves', 'unknown'];
  const WEAPON_SLOTS = new Set(['primary', 'secondary', 'melee', 'temporary']);
  const ARMOR_SLOTS = new Set(['helmet', 'body', 'pants', 'boots', 'gloves']);
  const $ = (selector) => shadow?.querySelector(selector);
  const storeGet = (key, fallback) => { try { return GM_getValue(key, fallback); } catch (_) { return fallback; } };
  const storeSet = (key, value) => GM_setValue(key, value);
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (v) => Number(v || 0).toLocaleString('en-US');
  const time = (value) => value ? new Date(value).toLocaleString('en-GB', { dateStyle:'medium', timeStyle:'short' }) : '—';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const keyPresent = () => !!storeGet(KEY_STORE, '');
  const isOwnFactionPage = () => {
    const url = new URL(location.href);
    return url.pathname === '/factions.php' && url.searchParams.get('step') === 'your';
  };

  let host = null;
  let shadow = null;
  let observer = null;
  let mountTimeout = null;
  let runToken = 0;
  let overrides = storeGet(OVERRIDES_STORE, {});
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) overrides = {};

  const state = {
    page: 'oc_home', minimized: false, loading: false, phase: '',
    view: 'all', search: '', category: 'all', sort: 'risk',
    includeTemporary: !!storeGet(TEMP_STORE, false),
    players: [], entries: [], members: [], selectedId: null,
    messages: [], lastLoaded: null, inventoryStamp: null, inventoryStamps: [],
    progress: '', completeness: false, dataReady: false, categoriesDone: [],
    categoryPageCounts: {},
  };

  // The OC subsystem never reads or modifies armory state.
  const oc = {
    logs: [], loading: false, loaded: false, phase: 'idle',
    message: '', checkedAt: null, search: '', reason: '', crime: '',
    sort: 'newest', requestId: 0, history: [],
  };
  let lastModule = 'oc';

  const css = `
  :host { display:block; width:100%; clear:both; color-scheme: dark; }
  *, *::before, *::after { box-sizing:border-box; }
  #app { background:#111a29; border:1px solid #32445a; border-radius:13px; color:#ebf0f7;
    font:13px/1.5 Arial,Helvetica,sans-serif; margin:12px 0 18px; width:100%;
    box-shadow:0 10px 28px rgba(0,0,0,.22); overflow:hidden; text-align:left; }
  .top { padding:14px 16px; display:flex; justify-content:space-between; align-items:center; gap:12px;
    background:linear-gradient(115deg,#172e49,#122239 66%,#152b36); border-bottom:1px solid #334a63; }
  .branding { display:flex; align-items:center; gap:11px; min-width:0; }
  .logo { background:#1f91b0; color:#061827; border-radius:10px; min-width:37px; height:37px;
    font-weight:900; font-size:22px; display:grid; place-items:center; }
  .brandTitle { font-size:17px; font-weight:800; letter-spacing:.15px; line-height:1.25; }
  .sub { font-size:11px; color:#a6b7cc; }
  .topActions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; justify-content:flex-end; }
  button, input, select { font:inherit; }
  button { cursor:pointer; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid #65d0ef; outline-offset:2px; }
  .btn { border:1px solid #46617e; color:#ebf5fb; border-radius:8px; background:#20364e;
    padding:8px 12px; font-weight:700; white-space:nowrap; transition:background .12s; }
  .btn:hover:not(:disabled) { background:#2a4d67; }
  .btn.main { background:#16a1bd; color:#061a26; border-color:#48c9e3; }
  .btn.main:hover:not(:disabled) { background:#53c5df; }
  .btn.danger { border-color:#94545a; color:#ffb9bd; background:#48242c; }
  .btn.small { padding:5px 9px; font-size:11px; }
  .nav { display:flex; gap:3px; background:#131e2e; border-bottom:1px solid #304257; padding:7px 14px 0; overflow-x:auto; }
  .tab { background:transparent; border:0; border-bottom:3px solid transparent; color:#aabdd2; padding:9px 15px; font-weight:700; }
  .tab.active { color:#78d9ef; border-bottom-color:#27b4d1; }
  .tab:hover { color:white; }
  .content { padding:17px; }
  h2,h3,h4,p { margin:0; } h2 { font-size:20px; margin-bottom:6px; } h3 { font-size:15px; }
  .muted { color:#9eafc4; } .dim { font-size:11px; color:#9eafc4; }
  .intro { margin-bottom:14px; } .stack { display:grid; gap:13px; }
  .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
  .card { padding:14px; border:1px solid #32465e; background:#19293c; border-radius:11px; min-width:0; }
  .metric { font-size:25px; font-weight:800; margin-top:5px; line-height:1.2; }
  .cardTitle { color:#acbcd0; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; }
  .red { color:#ff838c !important; } .green { color:#6fe2ae !important; } .amber { color:#ffcf7a !important; }
  .badge { display:inline-flex; align-items:center; gap:4px; border-radius:999px; padding:3px 8px;
    font-size:11px; font-weight:800; color:#c4d2e1; border:1px solid #3b526c; background:#26384e; }
  .badge.bad { color:#ff9ba2; border-color:#8a414d; background:#412530; }
  .badge.good { color:#83eab6; border-color:#2f6959; background:#1c403c; }
  .badge.warn { color:#f7d195; border-color:#846a42; background:#423522; }
  .message { border-radius:9px; padding:10px 12px; border:1px solid #3f5b70; background:#1a2e40;
    overflow-wrap:anywhere; }
  .message.error { border-color:#a84c53; color:#ffd7d9; background:#40272e; }
  .message.warn { border-color:#8c7041; color:#ffe1a5; background:#3c3327; }
  .message.ok { border-color:#357962; color:#aaf4d5; background:#1e3a39; }
  .hint { padding:10px 12px; background:#18283b; border:1px dashed #476078; border-radius:9px; color:#b6c8d9; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .spread { display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
  .field { display:grid; gap:6px; } .field label { color:#c7d4e2; font-weight:700; }
  input[type=text], input[type=password], select { background:#0f1b2c; border:1px solid #47607b;
    color:#ebf3ff; min-height:35px; border-radius:8px; padding:8px 10px; max-width:100%; }
  input::placeholder { color:#8193a8; } .wide { width:min(410px,100%); }
  .toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .toolbar input { flex:1 1 175px; } .toolbar select { flex:0 1 145px; }
  .check { display:flex; gap:6px; align-items:center; cursor:pointer; }
  .check input { accent-color:#24b8d0; width:15px; height:15px; }
  .tableWrap { overflow:auto; border-radius:10px; border:1px solid #354a60; }
  table { border-collapse:collapse; width:100%; min-width:610px; }
  th { background:#23364c; font-size:11px; text-transform:uppercase; letter-spacing:.35px; color:#afc2d4; }
  td,th { text-align:left; padding:10px 12px; border-bottom:1px solid #304258; vertical-align:middle; }
  tbody tr { background:#172638; } tbody tr:nth-child(even) { background:#1b2b3e; }
  tbody tr:hover { background:#263b52; } tr:last-child td { border-bottom:0; }
  .linkbtn { border:0; background:transparent; font-weight:800; color:#83dcef; text-align:left; padding:0; }
  .linkbtn:hover { text-decoration:underline; }
  .qty { font-size:12px; color:#9daec4; }
  .split { display:grid; grid-template-columns:minmax(0,1fr) minmax(255px,1fr); gap:13px; }
  .loan { padding:9px 10px; background:#142436; border:1px solid #345069; border-radius:9px; }
  .loan.bad { background:#372630; border-color:#994d5b; }
  .loan.warn { background:#383123; border-color:#7d6538; }
  .loanName { font-weight:800; color:#e6eef9; } .loan.bad .loanName { color:#ff919b; }
  .miniTag { display:inline-block; font-size:10px; color:#91bfd2; font-weight:700; margin-right:6px; }
  .loanDetails { margin-top:5px; color:#91a8ba; font-size:11px; overflow-wrap:anywhere; }
  details { margin-top:3px; } summary { color:#88dbea; cursor:pointer; }
  .sectionTitle { display:flex; align-items:center; justify-content:space-between; margin:10px 0 7px; padding-bottom:5px; border-bottom:1px solid #324a60; }
  .playerList { max-height:525px; overflow:auto; }
  .playerBtn { width:100%; display:flex; justify-content:space-between; align-items:center; gap:7px;
    padding:11px; background:#1a2c40; border:1px solid #33495f; border-radius:8px; margin-bottom:6px;
    color:#e6edf4; text-align:left; }
  .playerBtn.active { background:#26445a; border-color:#30b5d0; }
  .playerBtn:hover { background:#2b435a; }
  .statLine { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
  .statUnit { background:#122234; padding:8px; border-radius:7px; text-align:center; }
  .statUnit b { display:block; font-size:17px; }
  .empty { text-align:center; padding:24px 12px; color:#a5b8c9; }
  .divider { height:1px; background:#31465e; margin:12px 0; }
  .progress { font-size:12px; color:#a3e2f1; margin-top:6px; }
  .diagnostic { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:11px;
    white-space:pre-wrap; overflow-wrap:anywhere; }
  .foot { padding:9px 16px; border-top:1px solid #2f435a; color:#879bb0;
    font-size:11px; display:flex; gap:10px; justify-content:space-between; flex-wrap:wrap; }
  .override { width:150px; font-size:11px; min-height:30px; padding:4px 7px; }
  @media (max-width:900px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .split { grid-template-columns:1fr; } .playerList { max-height:300px; } }
  @media (max-width:560px) { .top { padding:12px; } .topActions .btn.small { padding:5px; }
    .brandTitle { font-size:14px; } .content { padding:10px; } .grid { gap:6px; }
    .metric { font-size:20px; } .tab { padding:8px 10px; } }
  `;

  // Style extension for the OC pages and shared navigation.
  const suiteCss = `
    .secondaryNav { display:flex; gap:8px; flex-wrap:wrap; align-items:center;
      padding:8px 15px; background:#101a29; border-bottom:1px solid #2b3f54; }
    .subTab { padding:6px 13px; color:#adc2d5; border:1px solid transparent;
      background:transparent; border-radius:7px; font-weight:700; }
    .subTab:hover { background:#26374b; }
    .subTab.active { background:#243b50; border-color:#42708e; color:#8cddf2; }
    .ocType { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.45px; }
    .ocRow { border:1px solid #32475e; background:#152539; padding:11px;
      border-radius:9px; display:grid; grid-template-columns:minmax(150px,1fr) minmax(145px,1fr);
      gap:8px 14px; }
    .ocRow small { color:#a9b8ca; }
    .ocNote { display:grid; gap:6px; }
    .ocReason { color:#ffa1a8; font-weight:700; }
    .ocTop { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    .settingsHead { border-bottom:1px solid #34465b; padding-bottom:7px; margin-bottom:2px; }
    .ocReasonBar { display:grid; grid-template-columns:minmax(0,140px) minmax(0,1fr) 40px; gap:9px; align-items:center; }
    .ocTrack { height:8px; background:#101b2c; border-radius:999px; overflow:hidden; }
    .ocFill { display:block; height:100%; background:#dc808c; border-radius:999px; }
    @media(max-width:560px) { .ocRow { grid-template-columns:1fr; } }
  `;

  function note(level, title, detail = '') {
    const clean = String(detail).replace(/(ApiKey\s+|key=)[^\s&]+/gi, '$1[REDACTED]');
    state.messages.unshift({ level, title, detail: clean, at: Date.now() });
    state.messages = state.messages.slice(0, 12);
  }

  function slotFor(entry) {
    const custom = overrides[String(entry.id)];
    if (custom && SLOT_LABELS[custom]) return custom;
    if (entry.source === 'temporary') return 'temporary';
    if (entry.source === 'weapons') {
      const type = String(entry.type).toLowerCase();
      if (type === 'primary' || type === 'secondary' || type === 'melee') return type;
      if (type === 'temporary') return 'temporary';
      return 'unknown';
    }
    if (entry.source === 'armor') {
      const n = String(entry.name).toLowerCase();
      if (/\b(helmet|gas mask|face mask|respirator|visage)\b/.test(n)) return 'helmet';
      if (/\b(gloves|clawshields)\b/.test(n)) return 'gloves';
      if (/\b(boots|hooves)\b/.test(n)) return 'boots';
      if (/\b(pants|britches)\b/.test(n)) return 'pants';
      if (/\b(body|vest|jacket|apron|armor|armour|chain mail|lab coat|spathe|breastplate)\b/.test(n)) return 'body';
      return 'unknown';
    }
    return 'unknown';
  }

  function transformInventory(source, rows) {
    const entries = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      // The current API represents the borrower as { id, name } or null.
      const borrower = raw.loaned;
      if (!borrower || typeof borrower !== 'object' || !Number.isFinite(Number(borrower.id))) continue;
      const uids = Array.isArray(raw.uids) ? raw.uids.map(String) : [];
      const amount = Number(raw.amount);
      const qty = Math.max(1, Number.isFinite(amount) ? Math.floor(amount) : uids.length || 1);
      entries.push({
        id: String(raw.id ?? '?'), name: String(raw.name || `Item #${raw.id}`),
        type: String(raw.type || ''), source,
        borrowerId: String(borrower.id), borrowerName: String(borrower.name || `Player #${borrower.id}`),
        qty, uids, truncatedUids: qty > uids.length && uids.length === 250,
      });
    }
    return entries;
  }

  function rebuildPlayers() {
    const map = new Map();
    for (const member of state.members) {
      if (!member || !Number.isFinite(Number(member.id))) continue;
      const id = String(member.id);
      map.set(id, { id, name: String(member.name || `Player #${id}`),
        position: String(member.position || ''), items: [], outsideFaction: false });
    }
    for (const item of state.entries) {
      let player = map.get(item.borrowerId);
      if (!player) {
        player = { id:item.borrowerId, name:item.borrowerName, position:'Former / unlisted member',
          items:[], outsideFaction:true };
        map.set(player.id, player);
      }
      player.items.push({ ...item, slot:slotFor(item) });
    }
    state.players = [...map.values()].map(player => {
      const count = {};
      for (const item of player.items) count[item.slot] = (count[item.slot] || 0) + item.qty;
      player.items.forEach(item => item.flag = item.slot !== 'unknown' && count[item.slot] > 1);
      player.count = count;
      player.total = player.items.reduce((s, item) => s + item.qty, 0);
      player.flaggedSlots = SLOT_ORDER.filter(slot => slot !== 'unknown' && count[slot] > 1);
      player.unknownCount = count.unknown || 0;
      player.flagged = player.flaggedSlots.length > 0;
      return player;
    }).sort((a,b)=>a.name.localeCompare(b.name));
    if (state.selectedId && !map.has(state.selectedId)) state.selectedId = null;
  }

  const getStats = () => ({
    members: state.players.filter(p=>!p.outsideFaction).length,
    loans: state.players.reduce((n,p)=>n+p.total,0),
    flagged: state.players.filter(p=>p.flagged).length,
    unknown: state.players.reduce((n,p)=>n+p.unknownCount,0),
    borrowerCount: state.players.filter(p=>p.total>0).length,
  });

  function urlFor(path, query = {}) {
    const url = new URL(`${API}/${path}`);
    for (const [name,value] of Object.entries(query)) url.searchParams.set(name,String(value));
    url.searchParams.set('comment','ArmoryInspector');
    return url.toString();
  }

  function requestJSON(path, query, key) {
    const url = urlFor(path, query);
    return new Promise((resolve,reject) => {
      GM_xmlhttpRequest({
        method:'GET', url, timeout:25000,
        headers:{ 'Authorization':`ApiKey ${key}`, 'Accept':'application/json' },
        onload: response => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status} on ${path}. Check faction API permissions or Torn API status.`)); return;
          }
          let data;
          try { data = JSON.parse(response.responseText); }
          catch (_) { reject(new Error(`Invalid JSON response from ${path}.`)); return; }
          if (data?.error) {
            const code = data.error.code ?? '?';
            const msg = data.error.error || data.error.message || 'Unknown Torn error';
            reject(new Error(`Torn API ${code}: ${msg}`)); return;
          }
          resolve(data);
        },
        ontimeout: () => reject(new Error(`Request timed out on ${path} (25 seconds).`)),
        onerror: () => reject(new Error(`Connection failed on ${path}.`)),
      });
    });
  }

  async function fetchCategory(category, key, token) {
    let offset = 0;
    let rows = [];
    let inventoryStamp = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (token !== runToken) throw new Error('The previous loading operation was cancelled.');
      state.progress = `${category.toUpperCase()} • page ${page+1} • ${number(rows.length)} rows`;
      render();
      const res = await requestJSON('faction/inventory',{ cat:category, limit:LIMIT, offset },key);
      if (!Array.isArray(res.inventory)) throw new Error(`Inventory array is missing for ${category}.`);
      const pageRows = res.inventory;
      rows = rows.concat(pageRows);
      if (Number.isFinite(Number(res.inventory_timestamp))) inventoryStamp = Number(res.inventory_timestamp) * 1000;
      const total = Number(res._metadata?.total);
      const hasTotal = res._metadata?.total != null && Number.isFinite(total);
      offset += pageRows.length;
      if (!pageRows.length || pageRows.length < LIMIT || (hasTotal && offset >= total)) {
        return { rows, inventoryStamp, pages:page+1 };
      }
      await sleep(180);
    }
    throw new Error(`${category} exceeded the safe limit of ${MAX_PAGES} pages. Results are incomplete.`);
  }

  async function loadData() {
    if (state.loading) return;
    const key = String(storeGet(KEY_STORE, '')).trim();
    if (!key) { state.page = 'settings'; note('warn','API key required','Add your Limited API key in Settings.'); render(); return; }
    const token = ++runToken;
    state.loading = true; state.progress = 'Connecting to Torn API…';
    state.phase = 'loading';
    note('info','Refreshing data','Started a new faction inventory scan.');
    render();
    try {
      const res = await requestJSON('faction/members', {},key);
      if (!Array.isArray(res.members)) throw new Error('The API did not return a faction members array.');
      const members = res.members;
      const categories = ['weapons','armor',...(state.includeTemporary ? ['temporary'] : [])];
      const all = []; const stamps = []; const counts = {};
      for (const category of categories) {
        const result = await fetchCategory(category,key,token);
        all.push(...transformInventory(category,result.rows));
        counts[category] = result.pages;
        if (result.inventoryStamp) stamps.push(result.inventoryStamp);
        if (token !== runToken) return;
        await sleep(200);
      }
      // Only publish data after every required selection succeeds; no partial “all clear”.
      state.members = members;
      state.entries = all;
      state.inventoryStamps = stamps;
      state.inventoryStamp = stamps.length ? Math.min(...stamps) : null;
      state.categoriesDone = categories;
      state.categoryPageCounts = counts;
      state.lastLoaded = Date.now();
      state.completeness = true;
      state.dataReady = true;
      state.phase = 'ok';
      rebuildPlayers();
      note('ok','Scan completed',`${members.length} faction members, ${getStats().loans} loaned items. All pages were loaded.`);
    } catch (err) {
      if (token !== runToken) return;
      state.completeness = false;
      state.phase = 'error';
      // Keep previous snapshot but never present it as a freshly validated audit.
      note('error','Refresh failed',err.message);
    } finally {
      if (token === runToken) { state.loading = false; state.progress = ''; render(); }
    }
  }

  function shownPlayers() {
    let players = state.players.slice();
    if (state.view === 'flagged') players = players.filter(p=>p.flagged);
    if (state.view === 'borrowers') players = players.filter(p=>p.total>0);
    if (state.view === 'review') players = players.filter(p=>p.unknownCount>0);
    if (state.category !== 'all') players = players.filter(p=>p.items.some(i=>i.slot===state.category));
    const q = state.search.trim().toLowerCase();
    if (q) players = players.filter(p=>p.name.toLowerCase().includes(q) || p.id.includes(q) ||
      p.items.some(item=>item.name.toLowerCase().includes(q)));
    if (state.sort === 'risk') players.sort((a,b)=>Number(b.flagged)-Number(a.flagged)||
      b.flaggedSlots.length-a.flaggedSlots.length||b.total-a.total||a.name.localeCompare(b.name));
    if (state.sort === 'loans') players.sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
    if (state.sort === 'name') players.sort((a,b)=>a.name.localeCompare(b.name));
    return players;
  }

  function badge(player) {
    if (player.flagged) return `<span class="badge bad">⚑ ${player.flaggedSlots.length} slot${player.flaggedSlots.length===1?'':'s'}</span>`;
    if (player.unknownCount) return `<span class="badge warn">? Review</span>`;
    return `<span class="badge good">✓ OK</span>`;
  }

  function summaryCards() {
    const st = getStats();
    return `<div class="grid">
      <div class="card"><div class="cardTitle">Faction members</div><div class="metric">${number(st.members)}</div></div>
      <div class="card"><div class="cardTitle">Loaned items</div><div class="metric">${number(st.loans)}</div></div>
      <div class="card"><div class="cardTitle">Flagged players</div><div class="metric red">${number(st.flagged)}</div></div>
      <div class="card"><div class="cardTitle">Needs classification</div><div class="metric ${st.unknown?'amber':'green'}">${number(st.unknown)}</div></div>
    </div>`;
  }

  function statusBox() {
    if (!keyPresent()) return `<div class="message warn"><strong>API key not configured.</strong><br>Open Settings, enter a Limited API key, and click Save Key.</div>`;
    if (state.loading) return `<div class="message"><strong>⟳ Loading data…</strong><div class="progress">${html(state.progress)}</div></div>`;
    if (state.phase==='error') return `<div class="message error"><strong>⚠ Refresh failed — previous data does not count as a new successful scan.</strong><br>Check System Messages below or click Refresh.</div>`;
    if (!state.dataReady) return `<div class="message">Ready to load. Click <b>Load / Refresh</b> to read faction loans.</div>`;
    const age = state.inventoryStamp ? Math.max(0,Math.round((Date.now()-state.inventoryStamp)/60000)) : null;
    return `<div class="message ${state.completeness?'ok':'warn'}"><strong>${state.completeness?'✓ All inventory pages loaded':'⚠ Data could not be revalidated'}</strong><br>
      Last successful load: ${html(time(state.lastLoaded))} • Inventory cache: ${html(time(state.inventoryStamp))}
      ${age!==null?`(${age} min old)`:''}.<br><span class="dim">Torn caches faction inventory for about one hour. Refresh cannot bypass this cache.</span></div>`;
  }

  function messagesBox() {
    if (!state.messages.length) return `<div class="hint">No system messages.</div>`;
    return `<div class="stack">${state.messages.map(m=>`<div class="message ${m.level==='error'?'error':m.level==='warn'?'warn':m.level==='ok'?'ok':''}">
      <div class="spread"><strong>${html(m.title)}</strong><span class="dim">${html(time(m.at))}</span></div>${m.detail?`<div class="dim" style="margin-top:4px">${html(m.detail)}</div>`:''}</div>`).join('')}</div>`;
  }

  function homePage() {
    const st = getStats();
    return `<div class="stack">
      <div class="spread intro"><div><h2>Armory Overview</h2><p class="muted">Smart loan auditing by equipment slot.</p></div>
        <button class="btn main" data-action="refresh" ${state.loading?'disabled':''}>⟳ Load / Refresh</button></div>
      ${statusBox()}
      ${state.dataReady ? summaryCards() : ''}
      <div class="card"><div class="spread"><h3>Flagged preview</h3><button class="btn small" data-tab="armory_players" data-view="flagged">View all flagged →</button></div>
        ${!state.dataReady ? '<div class="empty">Load data to see flagged players.</div>' :
          st.flagged===0 ? '<div class="empty">No duplicate equipment slots found in the latest loaded data.</div>' :
          `<div class="stack" style="margin-top:10px">${state.players.filter(p=>p.flagged).sort((a,b)=>b.flaggedSlots.length-a.flaggedSlots.length).slice(0,8)
            .map(p=>`<div class="spread"><button class="linkbtn" data-open-player="${html(p.id)}">${html(p.name)}</button>
            <span class="badge bad">${html(p.flaggedSlots.map(s=>SLOT_LABELS[s]).join(', '))}</span></div>`).join('')}</div>`}
      </div>
      <div class="card"><h3 style="margin-bottom:10px">System messages</h3>${messagesBox()}</div>
      <div class="hint">ℹ️ Read-only tool: it does <b>not</b> return, move, or modify loaned items. A flag means multiple items in the same slot, not necessarily a faction rule violation.</div>
    </div>`;
  }

  function playerRow(player) {
    return `<tr><td><button class="linkbtn" data-open-player="${html(player.id)}">${html(player.name)}</button>
      <div class="dim">ID ${html(player.id)}${player.outsideFaction?' • Not in current member list':''}</div></td>
      <td>${number(player.total)}</td><td class="qty">${html(player.flaggedSlots.map(s=>SLOT_LABELS[s]).join(', ') || '—')}</td>
      <td>${badge(player)}</td><td><button class="btn small" data-open-player="${html(player.id)}">Details →</button></td></tr>`;
  }

  function tableRows() {
    const players = shownPlayers();
    if (!players.length) return `<tr><td colspan="5" class="empty">No players match these filters.</td></tr>`;
    return players.map(playerRow).join('');
  }

  function renderFilteredList() {
    const target = $('#playerRows');
    if (target) target.innerHTML = tableRows();
    const count = $('#visibleCount');
    if (count) count.textContent = `${shownPlayers().length} visible / ${state.players.length} total`;
  }

  function playersPage() {
    if (!state.dataReady) return `<div class="stack"><h2>Players & loans</h2>${statusBox()}
      <div class="card empty">Click Load / Refresh on Home to view faction members and loans.</div></div>`;
    const opts = [['all','All members'],['flagged','Flagged only'],['borrowers','Borrowers'],['review','Needs review']];
    return `<div class="stack">
      <div class="spread intro"><div><h2>Players & loans</h2><div class="muted">Click a player name to view detailed loaned equipment.</div></div>
        <button class="btn main" data-action="refresh" ${state.loading?'disabled':''}>⟳ Refresh</button></div>
      ${state.phase==='error' ? statusBox():''}
      <div class="card"><div class="toolbar">
        <input type="text" id="findPlayer" placeholder="Search player, ID or item…" value="${html(state.search)}" autocomplete="off" />
        <select id="viewFilter">${opts.map(([id,label])=>`<option value="${id}" ${id===state.view?'selected':''}>${label}</option>`).join('')}</select>
        <select id="slotFilter"><option value="all">All slots</option>${SLOT_ORDER.map(s=>`<option value="${s}" ${state.category===s?'selected':''}>${SLOT_LABELS[s]}</option>`).join('')}</select>
        <select id="sortFilter"><option value="risk" ${state.sort==='risk'?'selected':''}>Sort: Flagged first</option>
          <option value="loans" ${state.sort==='loans'?'selected':''}>Sort: Most loans</option>
          <option value="name" ${state.sort==='name'?'selected':''}>Sort: Name A–Z</option></select>
      </div></div>
      <div class="spread"><span class="dim" id="visibleCount">${shownPlayers().length} visible / ${state.players.length} total</span>
        <span class="dim">Click Details to inspect each slot</span></div>
      <div class="tableWrap"><table><thead><tr><th>Member</th><th>Items</th><th>Flagged slots</th><th>Result</th><th>Action</th></tr></thead>
      <tbody id="playerRows">${tableRows()}</tbody></table></div>
    </div>`;
  }

  function detailItem(item) {
    const status = item.flag ? 'bad' : item.slot==='unknown' ? 'warn' : '';
    const uidText = item.uids.length ? item.uids.join(', ') : 'UID unavailable';
    return `<div class="loan ${status}"><div class="spread"><div><span class="miniTag">#${html(item.id)} • ${html(item.type || item.source)}</span>
      <div class="loanName">${item.flag?'⚑ ':item.slot==='unknown'?'? ':''}${html(item.name)} ${item.qty>1?`<span class="badge ${status}">×${number(item.qty)}</span>`:''}</div></div>
      <span class="badge ${status}">${html(SLOT_LABELS[item.slot])}</span></div>
      <div class="loanDetails">${item.uids.length===1?`UID: ${html(item.uids[0])}`:
        `<details><summary>${item.uids.length} UID(s) — show list</summary><div>${html(uidText)}</div></details>`}
        ${item.truncatedUids?'<div class="amber">API UID list is capped at 250 for this row.</div>':''}
        ${item.slot==='unknown' ? `<div class="amber">Unknown slot — change it in Settings → Slot overrides, using Item ID ${html(item.id)}.</div>` : ''}
      </div></div>`;
  }

  function detailPage() {
    const player = state.players.find(p=>p.id===state.selectedId);
    if (!player) return `<div class="stack"><button class="btn small" data-tab="armory_players">← Back to players</button>
      <div class="message warn">Player not found. Try refreshing the data.</div></div>`;
    return `<div class="stack">
      <div class="spread"><button class="btn small" data-tab="armory_players">← Back to players</button>${badge(player)}</div>
      <div class="card"><div class="spread"><div><h2>${html(player.name)}</h2><div class="muted">User ID ${html(player.id)} ${player.position?`• ${html(player.position)}`:''}</div></div>
        <a class="btn small" href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(player.id)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open Torn profile ↗</a></div>
        <div class="divider"></div><div class="statLine">
          <div class="statUnit"><b>${number(player.total)}</b><span class="dim">Loaned pieces</span></div>
          <div class="statUnit"><b class="red">${number(player.flaggedSlots.length)}</b><span class="dim">Flagged slots</span></div>
          <div class="statUnit"><b class="${player.unknownCount?'amber':''}">${number(player.unknownCount)}</b><span class="dim">Unclassified</span></div>
        </div>
      </div>
      ${player.flagged?`<div class="message error"><strong>⚑ Duplicate equipment slots:</strong> ${html(player.flaggedSlots.map(s=>`${SLOT_LABELS[s]} (${player.count[s]})`).join(', '))}</div>`:
        '<div class="message ok">✓ No known duplicate equipment slots for this player.</div>'}
      ${player.unknownCount?'<div class="message warn">⚠ Some items have an unknown slot. The audit may be incomplete.</div>':''}
      ${player.items.length===0 ? '<div class="card empty">This player has no loans in the selected equipment categories.</div>' :
        SLOT_ORDER.filter(slot=>player.count[slot]).map(slot=>{
          const items = player.items.filter(item=>item.slot===slot);
          const flagged = player.count[slot]>1 && slot!=='unknown';
          return `<div class="card"><div class="sectionTitle"><h3 class="${flagged?'red':''}">${html(SLOT_LABELS[slot])}</h3>
             <span class="badge ${flagged?'bad':slot==='unknown'?'warn':'good'}">${number(player.count[slot])} items ${flagged?'• FLAGGED':''}</span></div>
             <div class="stack" style="gap:6px">${items.map(detailItem).join('')}</div></div>`;
        }).join('')}
      <div class="dim">Flags are based on loans, not on what the player is currently wearing or using.</div>
    </div>`;
  }

  // ===== ORGANIZED CRIME TRACKER (original Google Web App protocol) =====
  // The request URL, query parameter name, storage key, HTTP method, redirect
  // setting and JSON row fields intentionally match DOM OC TRACKER V2.2.
  function ocRefresh() {
    if (oc.loading) return;
    const id = ++oc.requestId;
    oc.loading = true;
    oc.phase = 'loading';
    oc.message = 'Connecting to the existing Google Sheets service…';
    render();

    GM_xmlhttpRequest({
      method: "GET",
      url: makeServerUrl(),
      redirect: "follow",
      onload: function (res) {
        if (id !== oc.requestId) return;
        oc.loading = false;
        if (res.status !== 200) {
          oc.phase = 'error';
          oc.message = `Server status ${res.status}. Verify the OC password and Google Apps Script deployment.`;
          oc.history.unshift({ level:'error', at:Date.now(), message:oc.message });
          render();
          return;
        }
        try {
          const data = JSON.parse(res.responseText);
          if (!Array.isArray(data)) throw new Error('Expected a JSON array from the OC service.');
          oc.logs = data; // Exact original array; do not modify server rows.
          oc.loaded = true;
          oc.phase = 'ok';
          oc.checkedAt = Date.now();
          oc.message = `${number(data.length)} historical log entries loaded successfully.`;
          oc.history.unshift({ level:'ok', at:Date.now(), message:oc.message });
        } catch (err) {
          oc.phase = 'error';
          oc.message = `JSON response error: ${err.message}`;
          oc.history.unshift({ level:'error', at:Date.now(), message:oc.message });
        }
        oc.history = oc.history.slice(0,10);
        render();
      },
      onerror: function () {
        if (id !== oc.requestId) return;
        oc.loading = false;
        oc.phase = 'error';
        oc.message = 'Could not connect to the Google Sheets server.';
        oc.history.unshift({ level:'error', at:Date.now(), message:oc.message });
        oc.history = oc.history.slice(0,10);
        render();
      }
    });
  }

  // V2.2 displayed server rows oldest-to-newest and reversed for recent entries.
  // Keep that display convention; search never alters the source array.
  function ocFilteredRows() {
    const p = oc.search.toLowerCase().trim();
    const r = oc.reason.toLowerCase().trim();
    const c = oc.crime.toLowerCase().trim();
    const rows = oc.logs.filter(row => row && typeof row === 'object' &&
      (!p || String(row.player || '').toLowerCase().includes(p)) &&
      (!r || String(row.reason || '').toLowerCase().includes(r)) &&
      (!c || String(row.crimeName || row.crime || '').toLowerCase().includes(c)));
    return oc.sort === 'oldest' ? rows : rows.reverse();
  }

  function ocSummary() {
    const players = new Set();
    const reasons = new Map();
    const crimes = new Set();
    for (const row of oc.logs) {
      if (!row || typeof row !== 'object') continue;
      if (row.player) players.add(String(row.player));
      if (row.crimeName || row.crime) crimes.add(String(row.crimeName || row.crime));
      const detail = String(row.reason || 'Unspecified');
      // A row may contain multiple comma-separated reasons.
      for (const reason of detail.split(',').map(x=>x.trim()).filter(Boolean)) {
        reasons.set(reason, (reasons.get(reason)||0)+1);
      }
    }
    return { count:oc.logs.length, players:players.size, crimes:crimes.size,
      reasons:[...reasons.entries()].sort((a,b)=>b[1]-a[1]) };
  }

  function ocStatusBox() {
    if (oc.loading) return `<div class="message"><strong>⟳ Loading OC delay logs…</strong><br>${html(oc.message)}</div>`;
    if (oc.phase === 'error') return `<div class="message error"><strong>⚠ OC Tracker connection failed.</strong><br>${html(oc.message)}
      ${oc.loaded?'<div class="dim">Previously loaded records remain visible, but are not freshly verified.</div>':''}</div>`;
    if (oc.loaded) return `<div class="message ok"><strong>✓ OC logs loaded.</strong><br>
      ${html(oc.message)} • Last refresh ${html(time(oc.checkedAt))}.</div>`;
    return `<div class="message">No OC logs loaded yet. Click <b>Load / Refresh</b> to connect to the existing Google Sheets service.</div>`;
  }

  function ocRecentRows() {
    // V2.2 home behavior: data.slice(-5).reverse().
    return oc.logs.slice(-5).reverse();
  }

  function ocReasonLabel(reason) {
    const text = String(reason || 'Unspecified');
    const critical = /hospital|jail|travel|missing item/i.test(text);
    return `<span class="badge ${critical?'bad':'warn'}">${html(text)}</span>`;
  }

  function ocHomePage() {
    const summary = ocSummary();
    const recent = ocRecentRows();
    const max = summary.reasons.length ? summary.reasons[0][1] : 1;
    return `<div class="stack">
      <div class="spread intro"><div><h2>OC Delay Tracker</h2>
        <p class="muted">Organized Crime delay records from the existing Google Sheets service.</p></div>
        <button class="btn main" data-action="oc-refresh" ${oc.loading?'disabled':''}>⟳ Load / Refresh</button>
      </div>
      ${ocStatusBox()}
      ${oc.loaded ? `<div class="grid">
        <div class="card"><div class="cardTitle">Historical delay logs</div><div class="metric">${number(summary.count)}</div></div>
        <div class="card"><div class="cardTitle">Players in logs</div><div class="metric">${number(summary.players)}</div></div>
        <div class="card"><div class="cardTitle">Recorded crimes</div><div class="metric">${number(summary.crimes)}</div></div>
        <div class="card"><div class="cardTitle">Reason categories</div><div class="metric">${number(summary.reasons.length)}</div></div>
      </div>` : ''}
      <div class="card stack">
        <div class="spread"><h3>Latest 5 delay records</h3>
          <button class="btn small" data-tab="oc_logs">View all logs →</button></div>
        ${!oc.loaded?'<div class="empty">Load the OC records to see recent delays.</div>':
          !recent.length?'<div class="empty">No logs available.</div>':
          `<div class="stack" style="gap:8px">${recent.map(row=>`<div class="ocRow">
            <div class="ocNote"><strong>${html(row.player||'(unknown player)')}</strong>
              <small>${html(row.timestamp||'—')}</small></div>
            <div class="ocNote"><strong>${html(row.crimeName||row.crime||'Unknown crime')}</strong>
              <div>${ocReasonLabel(row.reason)}</div></div>
          </div>`).join('')}</div>`}
      </div>
      ${oc.loaded?`<div class="card stack"><h3>Common delay reasons</h3>
        ${summary.reasons.length?summary.reasons.slice(0,8).map(([label,n])=>`<div class="ocReasonBar">
          <span class="dim" title="${html(label)}">${html(label)}</span>
          <div class="ocTrack"><span class="ocFill" style="width:${Math.round(n/max*100)}%"></span></div>
          <strong>${number(n)}</strong></div>`).join(''):'<div class="empty">No reasons recorded.</div>'}
      </div>`:''}
      <div class="card stack"><h3>OC Tracker messages</h3>
        ${!oc.history.length?'<div class="hint">No connection attempts yet.</div>':
          oc.history.map(m=>`<div class="message ${m.level==='error'?'error':'ok'}">
            <div class="spread"><span>${html(m.message)}</span><span class="dim">${html(time(m.at))}</span></div>
          </div>`).join('')}
      </div>
      <div class="hint">The counts above describe <b>historical delay records</b>, not the number of currently blocked organized crimes. This dashboard uses the existing OC backend unchanged.</div>
    </div>`;
  }

  function ocLogsTableRows() {
    const rows = ocFilteredRows();
    if (!rows.length) return '<tr><td colspan="4" class="empty">No matching OC delay records.</td></tr>';
    return rows.map(row=>`<tr>
      <td class="dim">${html(row.timestamp||'—')}</td>
      <td><strong>${html(row.crimeName||row.crime||'—')}</strong></td>
      <td>${html(row.player||'—')}</td>
      <td>${ocReasonLabel(row.reason)}</td>
    </tr>`).join('');
  }

  function ocRenderFilteredLogs() {
    const target = $('#ocLogRows');
    if (target) target.innerHTML = ocLogsTableRows();
    const count = $('#ocVisibleCount');
    if (count) count.textContent = `${number(ocFilteredRows().length)} shown / ${number(oc.logs.length)} total`;
  }

  function ocLogsPage() {
    return `<div class="stack">
      <div class="spread intro"><div><h2>OC Delay Logs</h2>
        <p class="muted">Search and review historical organized crime delays.</p></div>
        <button class="btn main" data-action="oc-refresh" ${oc.loading?'disabled':''}>⟳ Refresh Logs</button>
      </div>
      ${ocStatusBox()}
      ${oc.loaded?`<div class="card"><div class="toolbar">
        <input id="ocPlayerSearch" type="text" placeholder="Filter by player…" value="${html(oc.search)}" autocomplete="off" />
        <input id="ocReasonSearch" type="text" placeholder="Filter by reason…" value="${html(oc.reason)}" autocomplete="off" />
        <input id="ocCrimeSearch" type="text" placeholder="Filter by crime…" value="${html(oc.crime)}" autocomplete="off" />
        <select id="ocSort"><option value="newest" ${oc.sort==='newest'?'selected':''}>Newest first</option>
          <option value="oldest" ${oc.sort==='oldest'?'selected':''}>Oldest first</option></select>
        <button class="btn small" data-action="oc-clear-filters">Clear filters</button>
      </div></div>
      <div class="spread"><span class="dim" id="ocVisibleCount">${number(ocFilteredRows().length)} shown / ${number(oc.logs.length)} total</span>
        <span class="dim">Newest rows appear first by default</span></div>
      <div class="tableWrap"><table><thead><tr><th>Timestamp</th><th>Crime</th><th>Player</th><th>Reason</th></tr></thead>
        <tbody id="ocLogRows">${ocLogsTableRows()}</tbody></table></div>`:
      '<div class="card empty">Load OC delay records first.</div>'}
    </div>`;
  }

  function settingsPage() {
    const usedItemIds = [...new Map(state.entries.filter(e=>e.source==='armor'||e.source==='weapons')
      .map(e=>[e.id, e])).values()].sort((a,b)=>a.name.localeCompare(b.name));
    const overridden = Object.entries(overrides);
    const unknown = usedItemIds.filter(e=>slotFor(e)==='unknown');
    return `<div class="stack"><div class="intro"><h2>Settings</h2><p class="muted">One settings page • two independent connections</p></div>
      <div class="card stack"><div class="spread settingsHead"><h3>⏱ OC Delay Tracker Settings</h3>
        <span class="badge ${getStoredToken()?'good':'warn'}">${getStoredToken()?'Password saved':'Password not saved'}</span></div>
        <p class="muted">Password for the existing Google Sheets web service (stored using the original <code>faction_token</code> key).</p>
        <div class="row"><input id="ocPassword" class="wide" type="password" placeholder="Enter OC Tracker password" autocomplete="new-password" spellcheck="false" />
          <button class="btn small" data-action="toggle-oc-password">Show / Hide</button></div>
        <div class="row"><button class="btn main" data-action="save-oc-password">Save OC Password</button>
          <button class="btn danger" data-action="clear-oc-password" ${!getStoredToken()?'disabled':''}>Clear OC Password</button></div>
        <div class="hint">Existing Google Web App URL, GET request and token query parameter are unchanged. The password is saved locally in Tampermonkey.</div>
      </div>
      <div class="spread settingsHead"><h3>⚔ Armory Inspector Settings</h3><span class="dim">Torn API & slot rules</span></div>
      <div class="card stack"><div class="spread"><h3>🔑 Torn Limited API Key</h3>
        <span class="badge ${keyPresent()?'good':'warn'}">${keyPresent()?'Saved locally':'Not configured'}</span></div>
        <p class="muted">Enter your own Limited API key with the required faction API permissions.</p>
        <div class="row"><input id="apiInput" class="wide" type="password" placeholder="Paste NEW API key (not displayed after save)" autocomplete="new-password" spellcheck="false" />
        <button class="btn small" data-action="toggle-key">Show / Hide</button></div>
        <div class="row"><button class="btn main" data-action="save-key">Save Key</button>
          <button class="btn danger" data-action="delete-key" ${!keyPresent()?'disabled':''}>Remove saved key</button></div>
        <div class="hint">Your API key is stored locally in this browser via Tampermonkey. It is sent <b>only</b> to api.torn.com in an Authorization header, never in the URL.</div>
      </div>
      <div class="card stack"><h3>Inventory categories</h3>
        <label class="check"><input type="checkbox" id="includeTemp" ${state.includeTemporary?'checked':''}/>
          Include Temporary items (requires another paginated category request)</label>
        <p class="dim">Default: Weapons + Armor. Temporary can include stacked items; per-piece UIDs may be unavailable. Change takes effect after Refresh.</p>
      </div>
      <div class="card stack"><h3>Equipment slot overrides</h3>
        <p class="muted">Armor names are automatically mapped to Helmet / Body / Pants / Boots / Gloves. You can manually assign a slot to an unknown item ID. Overrides are saved locally.</p>
        <div class="row"><input id="overrideId" type="text" placeholder="Torn Item ID (e.g. 123)" style="width:200px" />
        <select id="overrideSlot" class="override">${SLOT_ORDER.map(s=>`<option value="${s}">${html(SLOT_LABELS[s])}</option>`).join('')}</select>
        <button class="btn main" data-action="add-override">Save override</button></div>
        <p class="dim">Unclassified observed items: <strong>${number(unknown.length)}</strong>${unknown.length?` • ${html(unknown.slice(0,8).map(i=>`${i.name} (#${i.id})`).join(', '))}`:''}</p>
        ${overridden.length?`<div class="tableWrap"><table style="min-width:300px"><thead><tr><th>Item ID</th><th>Assigned slot</th><th></th></tr></thead><tbody>
          ${overridden.map(([id,slot])=>`<tr><td>#${html(id)}</td><td>${html(SLOT_LABELS[slot]||slot)}</td>
          <td><button class="btn small danger" data-remove-override="${html(id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>`:
          '<div class="hint">No manual overrides.</div>'}
      </div>
      <div class="hint">Note: Torn caches faction inventory for about one hour. No keys or loan data are sent to Google Sheets, Discord, or any other third-party server.</div>
    </div>`;
  }

  function render() {
    if (!shadow) return;
    if (!isOwnFactionPage()) { host.style.display = 'none'; return; }
    host.style.display = '';
    const page = state.page;
    const ocPage = page==='oc_home' || page==='oc_logs';
    const armoryPage = page==='armory_home' || page==='armory_players' || page==='armory_detail';
    const pageBody = page==='oc_home'?ocHomePage():page==='oc_logs'?ocLogsPage():
      page==='armory_home'?homePage():page==='armory_players'?playersPage():
      page==='armory_detail'?detailPage():settingsPage();
    shadow.innerHTML = `<style>${css}${suiteCss}</style><div id="app">
      <header class="top"><div class="branding"><div class="logo">⚔</div>
        <div><div class="brandTitle">Faction Management Tools <span class="badge">v3.0</span></div>
          <div class="sub">OC Delay Tracker & Armory Inspector</div></div></div>
      <div class="topActions">
        <span class="badge ${ocPage?(oc.loading?'warn':oc.phase==='error'?'bad':oc.loaded?'good':''):
          armoryPage?(state.loading?'warn':state.phase==='error'?'bad':state.dataReady?'good':''):''}">
          ${ocPage?(oc.loading?'⟳ OC loading':oc.phase==='error'?'⚠ OC error':oc.loaded?'● OC loaded':'○ OC idle'):
          armoryPage?(state.loading?'⟳ Armory loading':state.phase==='error'?'⚠ Armory error':state.dataReady?'● Armory loaded':'○ Armory idle'):'⚙ Settings'}</span>
        <button class="btn small" data-action="minimize" title="${state.minimized?'Maximize':'Minimize'}">
          ${state.minimized?'▾ Expand':'▴ Minimize'}</button>
      </div></header>
      ${state.minimized?'':`<nav class="nav">
        <button class="tab ${ocPage?'active':''}" data-tab="oc_home">⏱ OC Tracker</button>
        <button class="tab ${armoryPage?'active':''}" data-tab="armory_home">⚔ Armory Inspector</button>
        <button class="tab ${page==='settings'?'active':''}" data-tab="settings">⚙ Settings</button>
      </nav>
      ${ocPage?`<nav class="secondaryNav">
        <button class="subTab ${page==='oc_home'?'active':''}" data-tab="oc_home">Overview</button>
        <button class="subTab ${page==='oc_logs'?'active':''}" data-tab="oc_logs">All Delay Logs</button>
        <span class="dim">Google Sheets</span>
      </nav>`:''}
      ${armoryPage?`<nav class="secondaryNav">
        <button class="subTab ${page==='armory_home'?'active':''}" data-tab="armory_home">Overview</button>
        <button class="subTab ${page==='armory_players'||page==='armory_detail'?'active':''}" data-tab="armory_players">Players & Loans</button>
        <span class="dim">Torn API v2</span>
      </nav>`:''}
      <main class="content">${pageBody}</main>
      <footer class="foot"><span>${ocPage?'OC Tracker • Historical logs':armoryPage?'Armory Inspector • Read-only':'Independent settings and credentials'}</span>
        <span>${ocPage?(oc.loaded?`Last OC load ${html(time(oc.checkedAt))}`:'OC not loaded'):
          armoryPage?(state.dataReady?`Last Armory load ${html(time(state.lastLoaded))}`:'Armory not loaded'):'Torn Faction Management Tools'}</span>
      </footer>`}
    </div>`;
  }

  function saveOverride() {
    const id = ($('#overrideId')?.value || '').trim();
    const slot = $('#overrideSlot')?.value;
    if (!/^\d+$/.test(id) || !SLOT_LABELS[slot]) { note('warn','Invalid override','Enter a numeric Item ID and a valid slot.'); render(); return; }
    overrides[id] = slot;
    storeSet(OVERRIDES_STORE, overrides);
    rebuildPlayers();
    note('ok','Slot override saved',`Item #${id} → ${SLOT_LABELS[slot]}.`);
    render();
  }

  function bindDelegatedEvents() {
    shadow.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'minimize') { state.minimized = !state.minimized; render(); return; }
      if (target.dataset.openPlayer) {
        state.selectedId = target.dataset.openPlayer; state.page = 'armory_detail'; render(); return;
      }
      if (target.dataset.tab) {
        state.page = target.dataset.tab;
        if (target.dataset.view) state.view = target.dataset.view;
        if ((state.page==='oc_home' || state.page==='oc_logs') && !oc.loaded && !oc.loading && oc.phase==='idle') {
          ocRefresh(); return;
        }
        render(); return;
      }
      if (action === 'oc-refresh') { ocRefresh(); return; }
      if (action === 'oc-clear-filters') {
        oc.search=''; oc.reason=''; oc.crime=''; oc.sort='newest'; render(); return;
      }
      if (action === 'toggle-oc-password') {
        const input = $('#ocPassword');
        if (input) input.type = input.type==='password' ? 'text' : 'password';
        return;
      }
      if (action === 'save-oc-password') {
        const value = ($('#ocPassword')?.value || '').trim();
        if (!value) {
          oc.history.unshift({ level:'error', at:Date.now(), message:'Enter an OC password before saving.' });
          render(); return;
        }
        // Legacy OC storage and method, unchanged.
        saveStoredToken(value);
        ++oc.requestId; oc.loading=false; oc.loaded=false; oc.logs=[];
        oc.phase='idle'; oc.checkedAt=null;
        oc.history.unshift({ level:'ok', at:Date.now(), message:'OC password saved locally.' });
        render(); return;
      }
      if (action === 'clear-oc-password') {
        clearStoredToken();
        ++oc.requestId; oc.loading=false; oc.loaded=false; oc.logs=[];
        oc.phase='idle'; oc.checkedAt=null;
        oc.history.unshift({ level:'ok', at:Date.now(), message:'OC password cleared.' });
        render(); return;
      }
      if (action === 'refresh') { loadData(); return; }
      if (action === 'toggle-key') { const input = $('#apiInput'); if (input) input.type=input.type==='password'?'text':'password'; return; }
      if (action === 'save-key') {
        const key = ($('#apiInput')?.value || '').trim();
        if (!/^[a-zA-Z0-9]{16}$/.test(key)) { note('warn','Invalid API key format','A standard Torn API key must be 16 letters or digits.'); render(); return; }
        const oldKey = String(storeGet(KEY_STORE, '')).trim();
        storeSet(KEY_STORE,key);
        if (oldKey !== key) {
          ++runToken; state.loading=false; state.dataReady=false; state.completeness=false;
          state.players=[]; state.entries=[]; state.members=[];
          state.lastLoaded=null; state.inventoryStamp=null; state.categoriesDone=[];
        }
        state.phase='idle';
        note('ok','API Key saved','The key was saved locally in Tampermonkey.'); render(); return;
      }
      if (action === 'delete-key') {
        GM_deleteValue(KEY_STORE); ++runToken; state.loading=false; state.dataReady=false; state.completeness=false;
        state.players=[]; state.entries=[]; state.members=[]; state.lastLoaded=null;
        state.inventoryStamp=null; state.categoriesDone=[];
        state.phase='idle'; note('ok','Key removed','The saved API key was removed.'); render(); return;
      }
      if (action === 'add-override') { saveOverride(); return; }
      if (target.dataset.removeOverride) {
        delete overrides[target.dataset.removeOverride]; storeSet(OVERRIDES_STORE,overrides);
        rebuildPlayers(); render(); return;
      }
    });
    shadow.addEventListener('input', event => {
      if (event.target.id === 'findPlayer') { state.search=event.target.value; renderFilteredList(); }
      if (event.target.id === 'ocPlayerSearch') { oc.search=event.target.value; ocRenderFilteredLogs(); }
      if (event.target.id === 'ocReasonSearch') { oc.reason=event.target.value; ocRenderFilteredLogs(); }
      if (event.target.id === 'ocCrimeSearch') { oc.crime=event.target.value; ocRenderFilteredLogs(); }
    });
    shadow.addEventListener('change', event => {
      const el = event.target;
      if (el.id === 'includeTemp') {
        state.includeTemporary=el.checked; storeSet(TEMP_STORE,el.checked);
        state.completeness=false;
        note('warn','Categories changed','Click Refresh to reload data using the new category setting.'); render();
      }
      if (el.id === 'viewFilter') { state.view=el.value; renderFilteredList(); }
      if (el.id === 'slotFilter') { state.category=el.value; renderFilteredList(); }
      if (el.id === 'sortFilter') { state.sort=el.value; renderFilteredList(); }
      if (el.id === 'ocSort') { oc.sort=el.value; ocRenderFilteredLogs(); }
    });
  }

  function locateAnchor() {
    return document.querySelector('.faction-tabs-wrap') ||
      document.querySelector('.faction-tabs') ||
      document.querySelector('[class*="factionTabs"]') ||
      document.querySelector('[class*="faction-tabs"]');
  }

  function attemptMount() {
    if (!isOwnFactionPage()) { if (host) host.style.display='none'; return; }
    const anchor = locateAnchor();
    if (!anchor) return;
    if (!host) {
      host = document.createElement('div');
      host.id='faction-management-tools-root';
      shadow = host.attachShadow({ mode:'open' });
      bindDelegatedEvents();
    }
    if (!host.isConnected || host.previousElementSibling !== anchor) {
      // Reattach when Torn replaces the faction tabs during client-side navigation.
      anchor.insertAdjacentElement('afterend',host);
    }
    render();
  }

  function start() {
    attemptMount();
    observer = new MutationObserver(() => {
      clearTimeout(mountTimeout);
      mountTimeout = setTimeout(() => {
        if (!isOwnFactionPage()) { if (host) host.style.display='none'; return; }
        // Avoid rewriting input on every Torn DOM mutation.
        if (!host?.isConnected || host?.previousElementSibling !== locateAnchor()) attemptMount();
        else if (host.style.display === 'none') render();
      }, 250);
    });
    observer.observe(document.body, { childList:true, subtree:true });
    window.addEventListener('popstate',attemptMount);
    window.addEventListener('hashchange',attemptMount);
  }

  start();
  if (isOwnFactionPage()) ocRefresh();
})();
