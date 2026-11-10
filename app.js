'use strict';
(() => {
  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const nf = new Intl.NumberFormat('vi-VN');
  const money = (n) => nf.format(Math.round(n)) + ' ₫';
  const trim1 = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
  const compact = (n) => (n >= 1e9 ? trim1(n / 1e9) + ' tỷ' : n >= 1e6 ? trim1(n / 1e6) + 'tr' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
  const parseAmt = (s) => Number(String(s).replace(/\D/g, '')) || 0;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => dstr(new Date());
  const monthOf = (s) => s.slice(0, 7);
  function shiftMonth(m, delta) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  const monthLabel = (m) => { const [y, mo] = m.split('-'); return `Tháng ${+mo}, ${y}`; };
  function dateLabel(s) {
    if (s === todayStr()) return 'Hôm nay';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (s === dstr(y)) return 'Hôm qua';
    const [Y, M, D] = s.split('-').map(Number);
    const wd = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][new Date(Y, M - 1, D).getDay()];
    return `${wd}, ${pad(D)}/${pad(M)}`;
  }

  /* ---------- categories ---------- */
  const CATS = {
    expense: [
      { id: 'food', name: 'Ăn uống', color: '#ff6129' },
      { id: 'move', name: 'Di chuyển', color: '#fc3b00' },
      { id: 'home', name: 'Nhà ở', color: '#ff8f66' },
      { id: 'shop', name: 'Mua sắm', color: '#ffb899' },
      { id: 'fun', name: 'Giải trí', color: '#ffffff' },
      { id: 'health', name: 'Sức khỏe', color: '#e8c9bb' },
      { id: 'learn', name: 'Học tập', color: '#b59f96' },
      { id: 'tool', name: 'Phần mềm & tool', color: '#7e6e67' },
      { id: 'other', name: 'Khác', color: '#4f4540' },
    ],
    income: [
      { id: 'salary', name: 'Lương', color: '#ffffff' },
      { id: 'freelance', name: 'Freelance', color: '#f2d5c7' },
      { id: 'bonus', name: 'Thưởng', color: '#cdb6ab' },
      { id: 'inc_other', name: 'Khác', color: '#8a7b74' },
    ],
  };
  const CAT_MAP = {};
  Object.values(CATS).flat().forEach((c) => (CAT_MAP[c.id] = c));
  const catOf = (id) => CAT_MAP[id] || { id, name: 'Khác', color: '#8a7b74' };

  /* ---------- storage (IndexedDB) ---------- */
  let dbp;
  function openDB() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('dong-tien', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('txs', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function run(mode, fn) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const t = db.transaction('txs', mode);
      const req = fn(t.objectStore('txs'));
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  const dbAll = () => run('readonly', (s) => s.getAll());
  const dbPut = (r) => run('readwrite', (s) => s.put(r));
  const dbDel = (id) => run('readwrite', (s) => s.delete(id));
  const dbDelMany = (ids) => run('readwrite', (s) => { ids.forEach((id) => s.delete(id)); });
  const dbClear = () => run('readwrite', (s) => s.clear());
  const dbBulk = (arr) => run('readwrite', (s) => { arr.forEach((r) => s.put(r)); });

  const LB_KEY = 'dong-tien:last-backup';
  const getLastBackup = () => { try { return Number(localStorage.getItem(LB_KEY)) || 0; } catch { return 0; } };
  const setLastBackup = () => { try { localStorage.setItem(LB_KEY, String(Date.now())); } catch { /* ignore */ } };

  /* ---------- state ---------- */
  const state = { txs: [], month: monthOf(todayStr()), tab: 'home', filter: 'all', q: '' };
  const monthTxs = () => state.txs.filter((t) => t.date.startsWith(state.month));
  function sums(list) {
    let i = 0, e = 0;
    for (const t of list) t.type === 'income' ? (i += t.amount) : (e += t.amount);
    return { i, e, net: i - e };
  }

  /* ---------- dot-matrix numerals (5x7) ---------- */
  const GLYPH = {
    '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '.': ['0', '0', '0', '0', '0', '0', '1'],
    '-': ['0000', '0000', '0000', '1111', '0000', '0000', '0000'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
    '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  };
  const glyphCols = (text) => {
    let x = 0;
    for (const ch of text) { const g = GLYPH[ch]; x += g ? g[0].length + 1 : 3; }
    return Math.max(1, x - 1);
  };
  function dotCircles(text, off) {
    let x = off || 0, c = '';
    for (const ch of text) {
      const g = GLYPH[ch];
      if (!g) { x += 3; continue; }
      g.forEach((row, y) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') c += `<circle cx="${x + i + 0.5}" cy="${y + 0.5}" r="0.4"/>`; });
      x += g[0].length + 1;
    }
    return c;
  }
  // key + target: số này sẽ được đếm từ giá trị đang hiển thị tới target
  function dm(text, unit, neg, key, target, suf) {
    const w = glyphCols(text);
    const data = key ? ` data-key="${key}" data-t="${target}" data-suf="${suf || ''}" data-u="${unit}" data-w="${w}"` : '';
    return `<svg class="dm${neg ? ' neg' : ''}" viewBox="0 0 ${w} 7" style="width:${(w * unit).toFixed(0)}px;aspect-ratio:${w}/7" fill="currentColor" role="img" aria-label="${esc(text)}"${data}>${dotCircles(text, 0)}</svg>`;
  }
  // tiles dùng đơn vị nghìn để số đủ to, dễ đọc
  function dmK(v, unit, key) {
    const k = v >= 1000;
    const n = Math.round(k ? v / 1000 : v);
    return { svg: dm(nf.format(n), unit, false, key, n), unit: k ? 'nghìn ₫' : '₫' };
  }

  /* ---------- motion ---------- */
  const MOTION_KEY = 'dong-tien:motion';
  const motionPref = () => { try { return localStorage.getItem(MOTION_KEY) || 'auto'; } catch { return 'auto'; } };
  const reducedOS = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const motionOn = () => { const p = motionPref(); return p === 'on' ? true : p === 'off' ? false : !reducedOS(); };
  const applyMotion = () => { document.documentElement.dataset.motion = motionOn() ? 'on' : 'off'; };
  const shown = new Map();

  function runCounters() {
    const els = $$('.dm[data-key]');
    if (!motionOn()) { els.forEach((el) => shown.set(el.dataset.key, +el.dataset.t)); return; }
    els.forEach((el) => {
      const key = el.dataset.key, to = +el.dataset.t, suf = el.dataset.suf || '';
      const u = +el.dataset.u, W = +el.dataset.w;
      const from = shown.has(key) ? shown.get(key) : 0;
      shown.set(key, to);
      if (from === to) return;
      const fmt = (v) => (v < 0 ? '-' : '') + nf.format(Math.abs(Math.round(v))) + suf;
      const Wm = Math.max(glyphCols(fmt(from)), W);
      el.setAttribute('viewBox', `0 0 ${Wm} 7`);
      el.style.width = (Wm * u).toFixed(0) + 'px';
      el.style.aspectRatio = `${Wm}/7`;
      const draw = (v) => { const t = fmt(v); el.innerHTML = dotCircles(t, Wm - glyphCols(t)); };
      const t0 = performance.now(), dur = 850;
      draw(from);
      const step = (now) => {
        if (!el.isConnected) return;
        const p = Math.min(1, (now - t0) / dur);
        draw(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) { requestAnimationFrame(step); return; }
        el.setAttribute('viewBox', `0 0 ${W} 7`);
        el.style.width = (W * u).toFixed(0) + 'px';
        el.style.aspectRatio = `${W}/7`;
        el.innerHTML = dotCircles(fmt(to), 0);
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------- views ---------- */
  const ico = (d) => `<svg class="i" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const gridIcon = `<svg class="i fill" viewBox="0 0 24 24">${[6, 12, 18].map((y) => [6, 12, 18].map((x) => `<circle cx="${x}" cy="${y}" r="1.6"/>`).join('')).join('')}</svg>`;
  const calIcon = `<svg class="i" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>`;

  function header(title) {
    const left = `<button class="cbtn ${state.tab === 'settings' ? 'on' : ''}" data-act="toggle-data" aria-label="Dữ liệu và backup">${gridIcon}</button>`;
    if (title) return `<header class="top">${left}<div class="mcap glass solo"><span class="month">${title}</span></div><span></span></header>`;
    return `<header class="top">${left}
      <div class="mcap glass">
        <button class="icon-btn" data-act="prev" aria-label="Tháng trước">${ico('M15 6l-6 6 6 6')}</button>
        <div class="month">${monthLabel(state.month)}</div>
        <button class="icon-btn" data-act="next" aria-label="Tháng sau">${ico('M9 6l6 6-6 6')}</button>
      </div>
      <button class="cbtn" data-act="today" aria-label="Về tháng này">${calIcon}</button></header>`;
  }

  function monthInfo() {
    const [y, m] = state.month.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const cur = monthOf(todayStr());
    const elapsed = state.month === cur ? new Date().getDate() : state.month < cur ? dim : 0;
    return { dim, elapsed };
  }

  function backupNotice() {
    if (state.txs.length < 5) return '';
    const days = (Date.now() - getLastBackup()) / 864e5;
    if (getLastBackup() && days < 14) return '';
    const msg = getLastBackup() ? `Chưa backup ${Math.floor(days)} ngày.` : 'Chưa backup lần nào.';
    return `<div class="notice glass"><span>${msg} Data chỉ nằm trong trình duyệt này.</span><button data-act="goto-settings">Backup</button></div>`;
  }

  // đường luỹ kế trong tháng, marker phát sáng + đường chấm như ref
  function lineChart(list) {
    const { dim, elapsed } = monthInfo();
    let lastTx = 0;
    const net = Array(dim).fill(0);
    for (const t of list) {
      const d = +t.date.slice(8, 10);
      lastTx = Math.max(lastTx, d);
      net[d - 1] += t.type === 'income' ? t.amount : -t.amount;
    }
    const last = Math.max(elapsed, lastTx);
    if (!list.length || !last) return '<div class="empty-sm">Chưa có giao dịch</div>';
    const cum = [];
    let run = 0;
    for (let i = 0; i < last; i++) { run += net[i]; cum.push(run); }
    const W = 340, H = 170, pl = 6, pr = 6, top = 22, bot = 24;
    const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum), span = hi - lo || 1;
    const X = (i) => pl + i * ((W - pl - pr) / (dim - 1));
    const Y = (v) => top + ((hi - v) / span) * (H - top - bot);
    const pts = cum.map((v, i) => [X(i), Y(v)]);
    const line = 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    const base = H - bot;
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${base} L${pts[0][0].toFixed(1)} ${base} Z`;
    const [mx, my] = pts[pts.length - 1];
    const v = cum[cum.length - 1];
    const lx = Math.min(W - 22, Math.max(22, mx));
    const marks = [...new Set([1, 8, 15, 22, dim])].filter((d) => d === dim || dim - d >= 3);
    const labels = marks.map((d) => `<text x="${X(d - 1).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dòng tiền luỹ kế trong tháng">
      <defs><linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6129" stop-opacity=".38"/><stop offset="1" stop-color="#ff6129" stop-opacity="0"/></linearGradient></defs>
      <line class="axis" x1="0" x2="${W}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke-dasharray="3 4"/>
      <path class="ar" d="${area}" fill="url(#cumFill)"/>
      <path class="ln" pathLength="1" d="${line}" fill="none" stroke="#ff6129" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="mkl" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${my.toFixed(1)}" y2="${base}" stroke="#fff" stroke-opacity=".55" stroke-dasharray="2 3"/>
      <circle class="pulse" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="10" fill="#ff6129" fill-opacity=".35"/>
      <circle class="mk" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.6" fill="#fff"/>
      <text class="val mkt" x="${lx.toFixed(1)}" y="${Math.max(11, my - 14).toFixed(1)}" text-anchor="middle">${v < 0 ? '-' : ''}${compact(Math.abs(v))}</text>
      ${labels}</svg>`;
  }

  // cột mảnh: thu (trắng) hướng lên, chi (cam) hướng xuống
  function flowChart(list) {
    const { dim: n } = monthInfo();
    const inc = Array(n).fill(0), exp = Array(n).fill(0);
    for (const t of list) (t.type === 'income' ? inc : exp)[+t.date.slice(8, 10) - 1] += t.amount;
    const max = Math.max(...inc, ...exp);
    if (!max) return '<div class="empty-sm">Chưa có giao dịch</div>';
    const W = 340, H = 156, mid = 74, half = 58, px = 4;
    const step = (W - px * 2) / n;
    const bw = Math.max(2.6, step * 0.46);
    const isCur = state.month === monthOf(todayStr());
    const today = new Date().getDate();
    let bars = '';
    for (let i = 0; i < n; i++) {
      const x = (px + i * step + (step - bw) / 2).toFixed(1);
      if (inc[i]) {
        const h = Math.max(3, (inc[i] / max) * half);
        bars += `<rect class="bar up" style="--d:${Math.min(i * 16, 640) + 80}ms" x="${x}" y="${(mid - h - 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${(bw / 2).toFixed(1)}" fill="var(--in)" fill-opacity=".9"/>`;
      }
      if (exp[i]) {
        const h = Math.max(3, (exp[i] / max) * half);
        bars += `<rect class="bar dn" style="--d:${Math.min(i * 16, 640) + 80}ms" x="${x}" y="${mid + 1}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${(bw / 2).toFixed(1)}" fill="var(--out)"/>`;
      }
    }
    const marks = [...new Set([1, 8, 15, 22, n])].filter((d) => d === n || n - d >= 3);
    const labels = marks.map((d) => {
      const x = px + (d - 1) * step + step / 2;
      const hot = isCur && d === today;
      return `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle"${hot ? ' style="fill:var(--orange)"' : ''}>${d}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ thu chi theo ngày">
      <text x="${px}" y="10">${compact(max)}</text>
      <line class="axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>
      ${bars}${labels}</svg>`;
  }

  function catBreakdown(list, total) {
    const m = {};
    for (const t of list) if (t.type === 'expense') m[t.cat] = (m[t.cat] || 0) + t.amount;
    const rows = Object.entries(m).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<div class="empty-sm">Chưa có khoản chi</div>';
    const stack = rows.map(([id, v], k) => `<i style="width:${(v / total) * 100}%;background:${catOf(id).color};--d:${k * 70}ms"></i>`).join('');
    const rws = rows.map(([id, v], k) => {
      const c = catOf(id);
      return `<div class="crow" style="--d:${220 + k * 60}ms"><span class="dot" style="background:${c.color}"></span><span>${esc(c.name)}</span><span class="num">${money(v)}</span><span class="pct num">${Math.round((v / total) * 100)}%</span></div>`;
    }).join('');
    return `<div class="stack">${stack}</div><div>${rws}</div>`;
  }

  function viewHome() {
    const list = monthTxs(), s = sums(list);
    const { elapsed } = monthInfo();
    const nIn = list.filter((t) => t.type === 'income').length, nOut = list.length - nIn;
    const neg = s.net < 0;
    const tIn = dmK(s.i, 4.4, 'in'), tOut = dmK(s.e, 4.4, 'out');
    const avg = elapsed ? dmK(s.e / elapsed, 4.4, 'avg') : { svg: dm('0', 4.4, false, 'avg', 0), unit: '₫' };
    const rate = s.i > 0 ? Math.round((s.net / s.i) * 100) : null;
    return `${header()}
      <section class="hero">
        <h1 class="thin">Dòng tiền</h1>
        <i class="tick"></i>
        <div class="hero-meta"><span class="label">Ròng tháng này</span><span class="tag"><i class="dot ${neg ? 'out' : 'in'}"></i>${neg ? 'Thâm hụt' : 'Thặng dư'}</span></div>
        <div class="bigrow">${dm((neg ? '-' : '') + nf.format(Math.abs(s.net)), 8, neg, 'hero', s.net)}<span class="unit">₫</span></div>
      </section>
      <div class="tiles">
        <div class="tile glass"><div class="label">Thu</div><i class="tick"></i><div class="bigrow">${tIn.svg}<span class="unit">${tIn.unit}</span></div><div class="sub">${nIn} khoản</div></div>
        <div class="tile glass"><div class="label">Chi</div><i class="tick"></i><div class="bigrow">${tOut.svg}<span class="unit">${tOut.unit}</span></div><div class="sub">${nOut} khoản</div></div>
      </div>
      ${backupNotice()}
      <section class="card glass"><h2><span>Luỹ kế trong tháng</span></h2>${lineChart(list)}</section>
      <div class="tiles">
        <div class="tile glass"><div class="label">Chi TB mỗi ngày</div><i class="tick"></i><div class="bigrow">${avg.svg}<span class="unit">${avg.unit}</span></div><div class="sub">${elapsed} ngày tính</div></div>
        <div class="tile glass"><div class="label">Tiết kiệm</div><i class="tick"></i><div class="bigrow">${rate === null ? dm('-', 4.4, false) : dm(rate + '%', 4.4, rate < 0, 'rate', rate, '%')}</div><div class="sub">${rate === null ? 'Chưa có thu' : 'trên tổng thu'}</div></div>
      </div>
      <section class="card glass"><h2><span>Thu chi theo ngày</span><span class="legend"><span class="dot in"></span>Thu<span class="dot out"></span>Chi</span></h2>${flowChart(list)}</section>
      <section class="card glass"><h2><span>Chi theo danh mục</span></h2>${catBreakdown(list, s.e)}</section>`;
  }

  function viewList() {
    const f = (k, l) => `<button data-f="${k}" class="${state.filter === k ? 'on' : ''}">${l}</button>`;
    return `${header()}
      <div class="tools">
        <div class="seg glass">${f('all', 'Tất cả')}${f('expense', 'Chi')}${f('income', 'Thu')}</div>
        <input class="search glass" id="q" type="search" placeholder="Tìm theo ghi chú hoặc danh mục" value="${esc(state.q)}" autocomplete="off">
      </div>
      <div id="list-body"></div>`;
  }

  function renderListBody() {
    const body = $('#list-body');
    if (!body) return;
    let list = monthTxs();
    if (state.filter !== 'all') list = list.filter((t) => t.type === state.filter);
    const q = state.q.trim().toLowerCase();
    if (q) list = list.filter((t) => (t.note || '').toLowerCase().includes(q) || catOf(t.cat).name.toLowerCase().includes(q));
    if (!list.length) {
      body.innerHTML = '<div class="empty">Không có giao dịch.<br>Bấm nút + để thêm.</div>';
      return;
    }
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const groups = new Map();
    for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
    let html = '';
    for (const [date, items] of groups) {
      const net = sums(items).net;
      html += `<section class="group"><div class="ghead"><span>${dateLabel(date)}</span><span class="num">${net >= 0 ? '+' : '-'}${money(Math.abs(net))}</span></div><div class="items glass">`;
      for (const t of items) {
        const c = catOf(t.cat);
        const isIn = t.type === 'income';
        html += `<button class="item" data-id="${esc(t.id)}">
          <span class="dot" style="background:${c.color}"></span>
          <span class="mid"><span class="t">${esc(t.note || c.name)}</span>${t.note ? `<span class="s">${esc(c.name)}</span>` : ''}</span>
          <span class="a num ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${money(t.amount)}</span></button>`;
      }
      html += '</div></section>';
    }
    body.innerHTML = html;
  }

  function viewSettings() {
    const lb = getLastBackup();
    const lbText = lb ? `${dateLabel(dstr(new Date(lb)))}, ${pad(new Date(lb).getHours())}:${pad(new Date(lb).getMinutes())}` : 'Chưa có';
    return `${header('Dữ liệu')}
      <h1 class="thin sm">Backup &amp; dữ liệu</h1><i class="tick"></i>
      <section class="card glass" style="margin-top:0">
        <div class="kv"><span>Số giao dịch</span><b class="num">${state.txs.length}</b></div>
        <div class="kv"><span>Backup gần nhất</span><b>${lbText}</b></div>
        <div class="kv"><span>Lưu trữ bền vững</span><b id="persist">...</b></div>
      </section>
      <section class="card glass">
        <button class="set-row" data-act="export-json"><span>Backup (JSON)<small>Toàn bộ dữ liệu, dùng để chuyển sang máy khác</small></span></button>
        <button class="set-row" data-act="import"><span>Khôi phục từ JSON<small>Gộp vào dữ liệu hiện tại, trùng ID thì ghi đè</small></span></button>
        <button class="set-row" data-act="export-csv"><span>Xuất CSV<small>Mở bằng Excel hoặc Google Sheets</small></span></button>
      </section>
      <section class="card glass">${(() => { const n = state.txs.filter((t) => t.demo).length; return n
        ? `<button class="set-row" data-act="demo-clear"><span>Xoá dữ liệu mẫu<small>${n} giao dịch mẫu, không ảnh hưởng dữ liệu thật</small></span></button>`
        : '<button class="set-row" data-act="demo-add"><span>Nạp dữ liệu mẫu<small>Thêm giao dịch giả của tháng này để xem giao diện và animation</small></span></button>'; })()}</section>
      <section class="card glass"><button class="set-row" data-act="toggle-motion"><span>Chuyển động<small>${reducedOS() && motionPref() === 'auto' ? 'Máy đang bật Giảm chuyển động nên hiệu ứng đang tắt. Bấm để ép bật' : 'Nền động, số đếm, biểu đồ vẽ dần. Tắt nếu máy giật'}</small></span><b>${motionOn() ? 'Bật' : 'Tắt'}</b></button></section>
      <section class="card glass"><button class="set-row danger" data-act="wipe"><span>Xoá toàn bộ dữ liệu</span></button></section>
      <section class="card glass"><div class="label">Cài lên màn hình chính. iOS: Safari &gt; Chia sẻ &gt; Thêm vào MH chính. Android: Chrome &gt; menu &gt; Cài đặt ứng dụng. Cài rồi thì iOS không tự dọn dữ liệu.</div></section>`;
  }

  // đổi tab: trang cũ mờ đi (ease-in) rồi trang mới trượt vào lần lượt (ease-in-out); đổi dữ liệu thì vẽ lại ngay
  let lastTab = null, swapTimer;
  function render() {
    const app = $('#app');
    const tabChanged = lastTab !== null && lastTab !== state.tab;
    lastTab = state.tab;
    $$('.dock [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    clearTimeout(swapTimer);
    if (tabChanged && motionOn()) {
      app.classList.remove('enter'); app.classList.add('leave');
      swapTimer = setTimeout(() => {
        paint(); window.scrollTo(0, 0);
        app.classList.remove('leave'); void app.offsetWidth; app.classList.add('enter');
      }, 240);
      return;
    }
    app.classList.remove('leave', 'enter');
    paint();
  }

  function paint() {
    $('#app').innerHTML = state.tab === 'home' ? viewHome() : state.tab === 'list' ? viewList() : viewSettings();
    if (state.tab === 'list') renderListBody();
    if (state.tab === 'home') runCounters();
    if (state.tab === 'settings') {
      const el = $('#persist');
      if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then((p) => { if (el) el.textContent = p ? 'Có' : 'Chưa'; });
      else if (el) el.textContent = 'Không hỗ trợ';
    }
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg, label, fn) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>` + (label ? `<button>${esc(label)}</button>` : '');
    if (label) el.querySelector('button').onclick = () => { el.classList.remove('show'); fn(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), label ? 5000 : 2200);
  }

  /* ---------- sheet ---------- */
  const sheet = { editing: null, type: 'expense', cat: 'food' };

  function renderSheetCats() {
    $('#f-cats').innerHTML = CATS[sheet.type].map((c) =>
      `<button type="button" class="cat ${c.id === sheet.cat ? 'on' : ''}" data-cat="${c.id}" style="--c:${c.color}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('');
  }
  function syncType() {
    $$('#f-type button').forEach((b) => b.classList.toggle('on', b.dataset.type === sheet.type));
    const a = $('#f-amount');
    a.classList.toggle('expense', sheet.type === 'expense');
    a.classList.toggle('income', sheet.type === 'income');
    if (!CATS[sheet.type].some((c) => c.id === sheet.cat)) sheet.cat = CATS[sheet.type][0].id;
    renderSheetCats();
  }
  function openSheet(t) {
    sheet.editing = t || null;
    sheet.type = t ? t.type : 'expense';
    sheet.cat = t ? t.cat : CATS.expense[0].id;
    $('#sh-title').textContent = t ? 'Sửa giao dịch' : 'Thêm giao dịch';
    $('#f-amount').value = t ? nf.format(t.amount) : '';
    $('#f-note').value = t ? t.note || '' : '';
    $('#f-date').value = t ? t.date : todayStr();
    $('#f-del').hidden = !t;
    syncType();
    const el = $('#sheet');
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');
    if (!t) setTimeout(() => $('#f-amount').focus(), 60);
  }
  function closeSheet() {
    const el = $('#sheet');
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lock');
    if (document.activeElement) document.activeElement.blur();
  }

  async function save() {
    const amount = parseAmt($('#f-amount').value);
    const date = $('#f-date').value;
    if (!amount) { toast('Nhập số tiền'); $('#f-amount').focus(); return; }
    if (!date) { toast('Chọn ngày'); return; }
    const old = sheet.editing;
    const rec = { id: old ? old.id : uid(), type: sheet.type, amount, cat: sheet.cat, note: $('#f-note').value.trim(), date, createdAt: old ? old.createdAt : Date.now() };
    try {
      await dbPut(rec);
    } catch { toast('Không lưu được, kiểm tra bộ nhớ trình duyệt'); return; }
    const i = state.txs.findIndex((t) => t.id === rec.id);
    if (i >= 0) state.txs[i] = rec; else state.txs.push(rec);
    state.month = monthOf(date);
    closeSheet();
    render();
    toast(old ? 'Đã cập nhật' : 'Đã lưu');
  }

  async function removeTx() {
    const t = sheet.editing;
    if (!t) return;
    await dbDel(t.id);
    state.txs = state.txs.filter((x) => x.id !== t.id);
    closeSheet();
    render();
    toast('Đã xoá', 'Hoàn tác', async () => { await dbPut(t); state.txs.push(t); render(); });
  }

  /* ---------- demo data (gắn cờ demo, xoá được) ---------- */
  function demoTxs() {
    const t = todayStr(), mo = monthOf(t), last = +t.slice(8, 10);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const out = [];
    const mk = (type, amount, cat, note, d) => out.push({ id: 'demo-' + out.length, type, amount, cat, note, date: `${mo}-${pad(d)}`, createdAt: 1000 + out.length, demo: true });
    mk('income', 18000000, 'salary', 'Lương tháng', Math.min(5, last));
    if (last >= 3) mk('income', 6500000, 'freelance', 'Branding project', last - 2);
    const cats = ['food', 'food', 'food', 'move', 'home', 'shop', 'fun', 'health', 'learn', 'tool', 'other'];
    const notes = { food: ['Cơm trưa', 'Cà phê', 'Trà sữa'], move: ['Grab', 'Xăng'], home: ['Tiền điện'], shop: ['Font license'], fun: ['Xem phim'], health: ['Thuốc'], learn: ['Khoá học'], tool: ['Adobe CC', 'Figma'], other: [''] };
    const amts = [25, 35, 45, 60, 120, 250, 480, 1200, 3000].map((x) => x * 1000);
    for (let d = 1; d <= last; d++) for (let k = (rnd() * 4) | 0; k > 0; k--) { const c = pick(cats); mk('expense', pick(amts), c, pick(notes[c]), d); }
    return out;
  }

  /* ---------- export / import ---------- */
  async function saveFile(name, mime, text) {
    const file = new File([text], name, { type: mime });
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  }
  async function exportJSON() {
    const data = { app: 'dong-tien', version: 1, exportedAt: new Date().toISOString(), transactions: state.txs };
    if (await saveFile(`dong-tien-${todayStr()}.json`, 'application/json', JSON.stringify(data, null, 2))) {
      setLastBackup(); render(); toast('Đã xuất backup');
    }
  }
  async function exportCSV() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [...state.txs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
      .map((t) => [t.date, t.type === 'income' ? 'thu' : 'chi', q(catOf(t.cat).name), t.amount, q(t.note || '')].join(','));
    await saveFile(`dong-tien-${todayStr()}.csv`, 'text/csv', '﻿ngay,loai,danh_muc,so_tien,ghi_chu\n' + rows.join('\n'));
  }
  const validTx = (t) => t && typeof t.id === 'string' && (t.type === 'income' || t.type === 'expense') &&
    Number.isFinite(+t.amount) && +t.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
  const normTx = (t) => ({
    id: t.id, type: t.type, amount: Math.round(+t.amount),
    cat: CAT_MAP[t.cat] ? t.cat : (t.type === 'income' ? 'inc_other' : 'other'),
    note: String(t.note || '').slice(0, 200), date: t.date, createdAt: +t.createdAt || Date.now(),
    ...(t.demo ? { demo: true } : {}),
  });
  async function importJSON(file) {
    try {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : data.transactions;
      const ok = (arr || []).filter(validTx).map(normTx);
      if (!ok.length) throw new Error('empty');
      await dbBulk(ok);
      state.txs = await dbAll();
      render();
      toast(`Đã nhập ${ok.length} giao dịch`);
    } catch { toast('File không hợp lệ'); }
  }

  /* ---------- events ---------- */
  const ACTIONS = {
    prev: () => { state.month = shiftMonth(state.month, -1); render(); },
    next: () => { state.month = shiftMonth(state.month, 1); render(); },
    add: () => openSheet(),
    'toggle-data': () => { state.tab = state.tab === 'settings' ? 'home' : 'settings'; render(); window.scrollTo(0, 0); },
    'demo-add': async () => {
      await dbBulk(demoTxs()); state.txs = await dbAll(); state.month = monthOf(todayStr()); state.tab = 'home';
      render(); window.scrollTo(0, 0); toast('Đã nạp dữ liệu mẫu');
    },
    'demo-clear': async () => {
      await dbDelMany(state.txs.filter((t) => t.demo).map((t) => t.id)); state.txs = await dbAll();
      render(); toast('Đã xoá dữ liệu mẫu');
    },
    'toggle-motion': () => { try { localStorage.setItem(MOTION_KEY, motionOn() ? 'off' : 'on'); } catch { /* ignore */ } applyMotion(); render(); },
    today: () => { state.month = monthOf(todayStr()); render(); },
    close: closeSheet,
    save,
    delete: removeTx,
    'goto-settings': () => { state.tab = 'settings'; render(); window.scrollTo(0, 0); },
    'export-json': exportJSON,
    'export-csv': exportCSV,
    import: () => $('#f-import').click(),
    wipe: async () => {
      if (!confirm('Xoá toàn bộ giao dịch? Không khôi phục được nếu chưa backup.')) return;
      await dbClear(); state.txs = []; render(); toast('Đã xoá hết');
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act],[data-tab],[data-id],[data-f],[data-type],[data-add],[data-mul],[data-cat]');
    if (!el) return;
    const d = el.dataset;
    if (d.act) return ACTIONS[d.act] && ACTIONS[d.act]();
    if (d.tab) { state.tab = d.tab; render(); window.scrollTo(0, 0); return; }
    if (d.id) { const t = state.txs.find((x) => x.id === d.id); if (t) openSheet(t); return; }
    if (d.f) { state.filter = d.f; render(); return; }
    if (d.type) { sheet.type = d.type; syncType(); return; }
    if (d.cat) { sheet.cat = d.cat; renderSheetCats(); return; }
    if (d.add || d.mul) {
      const cur = parseAmt($('#f-amount').value);
      const next = d.add ? cur + Number(d.add) : cur * Number(d.mul);
      $('#f-amount').value = next ? nf.format(Math.min(next, 999999999999)) : '';
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'f-amount') {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
      e.target.value = digits ? nf.format(Number(digits)) : '';
    } else if (e.target.id === 'q') {
      state.q = e.target.value;
      renderListBody();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  $('#f-import').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJSON(f); });

  /* ---------- boot ---------- */
  // icon dock dạng dot-matrix 7x7: ô sáng = '#', ô tắt vẫn vẽ mờ để ra cảm giác lưới chấm
  const DOCK_ICONS = {
    home: ['...#...', '..###..', '.#####.', '#######', '.##.##.', '.##.##.', '.##.##.'],
    add:  ['.......', '...#...', '...#...', '.#####.', '...#...', '...#...', '.......'],
    list: ['.......', '.#####.', '.......', '.#####.', '.......', '.###...', '.......'],
  };
  function dotIcon(rows) {
    let c = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const d = Math.hypot(x - 3, y - 3).toFixed(2);
      c += `<circle class="${ch === '#' ? 'on' : 'off'}" cx="${x + 0.5}" cy="${y + 0.5}" r="0.36" style="--d:${d}"/>`;
    }));
    return `<svg class="dotic" viewBox="0 0 7 7" fill="currentColor" aria-hidden="true">${c}</svg>`;
  }
  function initDock() {
    const map = { home: $('.dock [data-tab="home"]'), add: $('.dock [data-act="add"]'), list: $('.dock [data-tab="list"]') };
    Object.entries(map).forEach(([k, btn]) => { btn.innerHTML = dotIcon(DOCK_ICONS[k]); });
    $('.dock').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.dk'); if (!b) return;
      b.classList.remove('rip'); void b.offsetWidth; b.classList.add('rip');
    });
    $('.dock').addEventListener('animationend', (e) => { const b = e.target.closest('.dk'); if (b && e.target.tagName === 'circle') b.classList.remove('rip'); });
  }

  (async function boot() {
    applyMotion();
    initDock();
    try { state.txs = await dbAll(); } catch { toast('Không mở được bộ nhớ trình duyệt'); }
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const had = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
})();
