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
      { id: 'tip', name: 'Tip', color: '#ffc9b0' },
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
        const r = indexedDB.open('dong-tien', 2);
        r.onupgradeneeded = () => {
          ['txs', 'debts', 'pays'].forEach((n) => { if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: 'id' }); });
        };
        r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); };
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function run(mode, fn, store = 'txs') {
    const db = await openDB();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
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
  // store khác (debts, pays)
  const dbAllS = (st) => run('readonly', (s) => s.getAll(), st);
  const dbPutS = (st, r) => run('readwrite', (s) => s.put(r), st);
  const dbDelS = (st, id) => run('readwrite', (s) => s.delete(id), st);
  const dbDelManyS = (st, ids) => run('readwrite', (s) => { ids.forEach((id) => s.delete(id)); }, st);
  const dbBulkS = (st, arr) => run('readwrite', (s) => { arr.forEach((r) => s.put(r)); }, st);
  const dbClearS = (st) => run('readwrite', (s) => s.clear(), st);

  const LB_KEY = 'dong-tien:last-backup';
  const getLastBackup = () => { try { return Number(localStorage.getItem(LB_KEY)) || 0; } catch { return 0; } };
  const setLastBackup = () => { try { localStorage.setItem(LB_KEY, String(Date.now())); } catch { /* ignore */ } };

  /* ---------- state ---------- */
  const state = { txs: [], debts: [], pays: [], month: monthOf(todayStr()), tab: 'home', filter: 'all', q: '' };
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

  function runCounters(root = document) {
    const els = $$('.dm[data-key]', root);
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

  // so sánh luỹ kế ròng của tháng đang chọn với 2 tháng trước, cùng trục ngày
  const CUMVIEW_KEY = 'dong-tien:cumview';
  const cumView = () => { try { return localStorage.getItem(CUMVIEW_KEY) === 'compare' ? 'compare' : 'cum'; } catch { return 'cum'; } };
  // đường mảnh Ròng 6 tháng, điểm cuối (tháng đang xem) màu cam phát sáng
  function netSpark(vals) {
    const W = 124, H = 54, p = 7;
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const X = (i) => p + (i * (W - p * 2)) / (vals.length - 1);
    const Y = (v) => p + ((hi - v) / span) * (H - p * 2);
    const pts = vals.map((v, i) => [X(i), Y(v)]);
    const line = 'M' + pts.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L');
    const [mx, my] = pts[pts.length - 1];
    const area = `${line} L${mx.toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
    return `<svg class="chart spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Xu hướng Ròng 6 tháng gần nhất">
      <defs><linearGradient id="spkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6129" stop-opacity=".3"/><stop offset="1" stop-color="#ff6129" stop-opacity="0"/></linearGradient></defs>
      <path class="ar" d="${area}" fill="url(#spkFill)"/>
      <path class="ln" pathLength="1" d="${line}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      <circle class="pulse" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="8" fill="#ff6129" fill-opacity=".35"/>
      <circle class="mk" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.4" fill="#ff6129"/></svg>`;
  }

  // chênh lệch cả tháng so với tháng trước: ròng, thu, chi
  function cumCompare() {
    const pm = shiftMonth(state.month, -1);
    const prev = state.txs.filter((t) => t.date.startsWith(pm));
    if (!prev.length) return '<div class="empty-sm">Chưa có dữ liệu tháng trước để so sánh</div>';
    const a = sums(monthTxs()), b = sums(prev);
    const tl = (m) => 'T' + +m.slice(5);
    const sg = (v) => (v > 0 ? '+' : v < 0 ? '-' : '');
    const cn = (v) => (v < 0 ? '-' : '') + compact(Math.abs(v));
    const dNet = a.net - b.net;
    const trend = monthsEnding(6).map((m) => sums(state.txs.filter((t) => t.date.startsWith(m))).net);
    const pct = (x, y) => (y > 0 ? ` (${sg(x - y)}${Math.abs(Math.round(((x - y) / y) * 100))}%)` : '');
    // thu tăng là tốt, chi tăng là xấu (cam)
    const row = (name, x, y, goodUp) => {
      const d = x - y, bad = goodUp ? d < 0 : d > 0;
      return `<div class="cmp-row"><span class="cmp-n">${name}</span><span class="cmp-v">${cn(x)}<i> / ${cn(y)}</i></span><span class="cmp-d${d === 0 ? '' : bad ? ' bad' : ' ok'}">${d === 0 ? '0' : sg(d) + compact(Math.abs(d))}${pct(x, y)}</span></div>`;
    };
    return `<div class="cmp">
      <div class="cmp-hero"><div><span class="label">Ròng ${tl(state.month)} so với ${tl(pm)}</span>
        <div class="cmp-big${dNet < 0 ? ' bad' : ''}">${dNet === 0 ? '0' : sg(dNet) + compact(Math.abs(dNet))}<small>₫</small></div>
        <div class="cmp-sub">${tl(state.month)}: ${cn(a.net)} · ${tl(pm)}: ${cn(b.net)}</div></div>
        ${netSpark(trend)}</div>
      ${row('Thu', a.i, b.i, true)}${row('Chi', a.e, b.e, false)}
      <div class="cmp-note">Tính cả tháng. Số mờ là ${tl(pm)}</div></div>`;
  }
  function cumCard() {
    const v = cumView();
    return `<section class="card glass" data-cumcard><h2><span>Luỹ kế trong tháng</span>
      <span class="tipseg"><button data-cumview="cum" class="${v === 'cum' ? 'on' : ''}">Tháng này</button><button data-cumview="compare" class="${v === 'compare' ? 'on' : ''}">So sánh</button></span></h2>
      <div class="cumbody">${v === 'cum' ? lineChart(monthTxs()) : cumCompare()}</div></section>`;
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
        <div class="tile glass in"><div class="label">Thu</div><i class="tick"></i><div class="bigrow">${tIn.svg}<span class="unit">${tIn.unit}</span></div><div class="sub">${nIn} khoản</div></div>
        <div class="tile glass out"><div class="label">Chi</div><i class="tick"></i><div class="bigrow">${tOut.svg}<span class="unit">${tOut.unit}</span></div><div class="sub">${nOut} khoản</div></div>
      </div>
      ${todayNotice()}${backupNotice()}
      ${cumCard()}
      <div class="tiles">
        <div class="tile glass"><div class="label">Chi TB mỗi ngày</div><i class="tick"></i><div class="bigrow">${avg.svg}<span class="unit">${avg.unit}</span></div><div class="sub">${elapsed} ngày tính</div></div>
        <div class="tile glass"><div class="label">Tiết kiệm</div><i class="tick"></i><div class="bigrow">${rate === null ? dm('-', 4.4, false) : dm(rate + '%', 4.4, rate < 0, 'rate', rate, '%')}</div><div class="sub">${rate === null ? 'Chưa có thu' : 'trên tổng thu'}</div></div>
      </div>
      <section class="card glass"><h2><span>Thu chi theo ngày</span><span class="legend"><span class="dot in"></span>Thu<span class="dot out"></span>Chi</span></h2>${flowChart(list)}</section>
      ${tipCard()}
      <section class="card glass"><h2><span>Chi theo danh mục</span></h2>${catBreakdown(list, s.e)}</section>`;
  }

  /* ---------- nợ ---------- */
  const livePays = () => { const ids = new Set(state.debts.map((d) => d.id)); return state.pays.filter((p) => ids.has(p.debtId)); };
  function debtStats() {
    const pays = livePays();
    const per = state.debts.map((d) => {
      const paid = pays.filter((p) => p.debtId === d.id).reduce((a, p) => a + p.amount, 0);
      return { d, paid, rem: Math.max(0, d.total - paid), pct: d.total ? Math.min(100, Math.round((paid / d.total) * 100)) : 0 };
    });
    const total = per.reduce((a, x) => a + x.d.total, 0);
    const remaining = per.reduce((a, x) => a + x.rem, 0);
    const monthPaid = pays.filter((p) => p.date.startsWith(state.month)).reduce((a, p) => a + p.amount, 0);
    return { per, total, remaining, monthPaid, pays, pct: total ? Math.round(((total - remaining) / total) * 100) : null };
  }
  const monthsEnding = (n) => Array.from({ length: n }, (_, i) => shiftMonth(state.month, i - (n - 1)));

  // cột theo tháng (dùng cho trả nợ và tip), tháng đang chọn màu cam
  function monthBarChart(ms, vals, aria, emptyMsg) {
    const max = Math.max(...vals);
    if (!max) return `<div class="empty-sm">${emptyMsg}</div>`;
    const W = 340, H = 170, top = 22, bot = 24, px = 6;
    const step = (W - px * 2) / ms.length, bw = Math.min(34, step * 0.56);
    let g = '';
    ms.forEach((m, i) => {
      const x = px + i * step + (step - bw) / 2, cx = x + bw / 2, sel = m === state.month;
      const h = vals[i] ? Math.max(4, (vals[i] / max) * (H - top - bot)) : 0;
      const y = H - bot - h;
      if (h) g += `<rect class="bar up" style="--d:${i * 70 + 80}ms" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(8, bw / 2).toFixed(1)}" fill="${sel ? 'var(--orange)' : 'var(--in)'}" fill-opacity="${sel ? 1 : 0.55}"/>`
        + `<text class="val mkt" x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${compact(vals[i])}</text>`;
      g += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle"${sel ? ' style="fill:var(--orange)"' : ''}>T${+m.slice(5)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}"><line class="axis" x1="0" x2="${W}" y1="${H - bot}" y2="${H - bot}"/>${g}</svg>`;
  }
  function debtBarChart(st) {
    const ms = monthsEnding(6);
    const vals = ms.map((m) => st.pays.filter((p) => p.date.startsWith(m)).reduce((a, p) => a + p.amount, 0));
    return monthBarChart(ms, vals, 'Số nợ đã trả theo tháng', 'Chưa trả khoản nào trong 6 tháng này');
  }

  /* ---------- tip ---------- */
  const TIPVIEW_KEY = 'dong-tien:tipview';
  const tipView = () => { try { return localStorage.getItem(TIPVIEW_KEY) === 'compare' ? 'compare' : 'chart'; } catch { return 'chart'; } };
  const tipByMonth = (ms) => ms.map((m) => state.txs.filter((t) => t.type === 'income' && t.cat === 'tip' && t.date.startsWith(m)).reduce((a, t) => a + t.amount, 0));
  const tipMonthName = (m) => `Tháng ${+m.slice(5)}${m.slice(0, 4) !== state.month.slice(0, 4) ? ' ' + m.slice(0, 4) : ''}`;

  // cột dạng ma trận chấm: mỗi tháng một cột 4 chấm ngang, cao tối đa 15 chấm, chấm to và đậm ở đáy, nhỏ và mờ dần lên đỉnh
  function tipDotChart(ms, vals) {
    const W = 340, H = 170, bot = 24, cell = 8, cols = 4, rows = 15, base = H - bot;
    const max = Math.max(...vals), step = (W - 12) / ms.length;
    let g = '';
    ms.forEach((m, i) => {
      const x0 = 6 + i * step + (step - cols * cell) / 2, sel = m === state.month;
      const fill = vals[i] ? Math.max(1, Math.round((vals[i] / max) * rows)) : 0;
      for (let r = 0; r < rows; r++) {
        const rad = (3.7 - 2.7 * (r / (rows - 1))).toFixed(2), on = r < fill, fade = (1 - 0.84 * (r / (rows - 1))).toFixed(2); // càng lên cao càng mờ
        for (let c = 0; c < cols; c++) {
          const cx = (x0 + (c + 0.5) * cell).toFixed(1), cy = (base - (r + 0.5) * cell).toFixed(1);
          g += `<circle class="tdot ${on ? (sel ? 'hot' : 'on') : 'off'}" cx="${cx}" cy="${cy}" r="${rad}"${on ? ` style="--d:${r * 28 + i * 60 + 60}ms;fill-opacity:${fade}"` : ''}/>`;
        }
      }
      const cx = x0 + (cols * cell) / 2;
      if (fill) g += `<text class="val mkt" x="${cx.toFixed(1)}" y="${Math.max(11, base - fill * cell - 6).toFixed(1)}" text-anchor="middle">${compact(vals[i])}</text>`;
      g += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle"${sel ? ' style="fill:var(--orange)"' : ''}>T${+m.slice(5)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tip theo tháng">${g}</svg>`;
  }
  // thanh xếp hạng dạng hàng chấm
  function dotBar(frac, d) {
    const N = 46, on = frac > 0 ? Math.max(1, Math.round(frac * N)) : 0;
    let c = '';
    for (let i = 0; i < N; i++) c += `<circle class="tdot ${i < on ? 'bar' : 'off'}" cx="${i * 6 + 3}" cy="3" r="2.1"${i < on ? ` style="--d:${d + i * 12}ms"` : ''}/>`;
    return `<svg class="dotbar" viewBox="0 0 ${N * 6} 6" aria-hidden="true">${c}</svg>`;
  }

  function tipBody() {
    const ms = monthsEnding(6), vals = tipByMonth(ms);
    if (!Math.max(...vals)) return '<div class="empty-sm">Chưa có tip. Thêm khoản thu và chọn danh mục Tip</div>';
    if (tipView() === 'chart') return tipDotChart(ms, vals);
    // xếp hạng: tháng nhiều tip nhất đứng đầu, thanh so với tháng đứng đầu
    const rows = ms.map((m, i) => ({ m, v: vals[i], i })).sort((a, b) => b.v - a.v || b.i - a.i);
    const max = rows[0].v, selRank = rows.findIndex((r) => r.m === state.month) + 1, selV = vals[ms.indexOf(state.month)];
    const sum = selV ? `${tipMonthName(state.month)} đứng hạng ${selRank}/${rows.length}` : `${tipMonthName(state.month)} chưa có tip`;
    return `<div class="rsum">${sum}</div>` + rows.map((r, k) => `
      <div class="rrow${r.m === state.month ? ' sel' : ''}${r.v ? '' : ' zero'}" style="--d:${k * 60}ms">
        <span class="rk num">${k + 1}</span><span class="rl">${tipMonthName(r.m)}</span>
        <span class="ra num">${r.v ? money(r.v) : '—'}</span><span class="rp num">${r.v ? Math.round((r.v / max) * 100) + '%' : ''}</span>
        ${dotBar(r.v / max, k * 60 + 80)}
      </div>`).join('');
  }
  function tipCard() {
    const v = tipView();
    return `<section class="card glass" data-tipcard><h2><span>Tip</span>
      <span class="tipseg"><button data-tipview="chart" class="${v === 'chart' ? 'on' : ''}">Biểu đồ</button><button data-tipview="compare" class="${v === 'compare' ? 'on' : ''}">So sánh</button></span></h2>
      <div class="tipbody">${tipBody()}</div></section>`;
  }

  // dư nợ cuối mỗi tháng = tổng nợ hiện tại trừ số đã trả tới hết tháng đó
  function debtLineChart(st) {
    const ms = monthsEnding(6);
    const rem = ms.map((m) => Math.max(0, st.total - st.pays.filter((p) => monthOf(p.date) <= m).reduce((a, p) => a + p.amount, 0)));
    const W = 340, H = 150, pl = 14, pr = 14, top = 24, bot = 24, hi = Math.max(...rem, 1);
    const X = (i) => pl + i * ((W - pl - pr) / (ms.length - 1));
    const Y = (v) => top + ((hi - v) / hi) * (H - top - bot);
    const pts = rem.map((v, i) => [X(i), Y(v)]);
    const line = 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    const base = H - bot;
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${base} L${pts[0][0].toFixed(1)} ${base} Z`;
    const [mx, my] = pts[pts.length - 1];
    const labels = ms.map((m, i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle"${m === state.month ? ' style="fill:var(--orange)"' : ''}>T${+m.slice(5)}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dư nợ còn lại theo tháng">
      <defs><linearGradient id="debtFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6129" stop-opacity=".38"/><stop offset="1" stop-color="#ff6129" stop-opacity="0"/></linearGradient></defs>
      <line class="axis" x1="0" x2="${W}" y1="${base}" y2="${base}" stroke-dasharray="3 4"/>
      <path class="ar" d="${area}" fill="url(#debtFill)"/>
      <path class="ln" pathLength="1" d="${line}" fill="none" stroke="#ff6129" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle class="pulse" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="10" fill="#ff6129" fill-opacity=".35"/>
      <circle class="mk" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.6" fill="#fff"/>
      <text class="val mkt" x="${Math.min(W - 22, Math.max(22, mx)).toFixed(1)}" y="${Math.max(11, my - 14).toFixed(1)}" text-anchor="middle">${compact(rem[rem.length - 1])}</text>
      ${labels}</svg>`;
  }

  function viewDebt() {
    const st = debtStats();
    const mT = dmK(st.monthPaid, 4.4, 'dmonth');
    const clean = state.debts.length > 0 && st.remaining === 0;
    const open = st.per.filter((x) => x.rem > 0).length;
    const tag = !state.debts.length ? 'Chưa có khoản nợ' : clean ? 'Sạch nợ' : `${open} khoản đang nợ`;
    const cards = [...st.per].sort((a, b) => (a.rem === 0) - (b.rem === 0) || b.rem - a.rem).map((x, k) => `
      <section class="card glass dcard">
        <button class="dtop" data-dedit="${esc(x.d.id)}"><span class="dn">${esc(x.d.name)}</span><span class="dr num">${x.rem ? money(x.rem) : 'Đã tất toán'}</span></button>
        <div class="dprog"><i style="width:${x.pct}%;--d:${k * 80}ms"></i></div>
        <div class="dmeta"><span class="num">Đã trả ${money(x.paid)} / ${money(x.d.total)}</span><span class="num">${x.pct}%</span></div>
        ${x.rem ? `<button class="btn ghost dpay" data-dpay="${esc(x.d.id)}">Trả nợ</button>` : ''}
      </section>`).join('');
    const names = new Map(state.debts.map((d) => [d.id, d.name]));
    const mp = st.pays.filter((p) => p.date.startsWith(state.month)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const hist = mp.length
      ? `<div class="items glass">${mp.map((p) => `<button class="item" data-pid="${esc(p.id)}"><span class="dot" style="background:var(--orange)"></span><span class="mid"><span class="t">${esc(names.get(p.debtId))}</span><span class="s">${dateLabel(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</span></span><span class="a num in">${money(p.amount)}</span></button>`).join('')}</div>`
      : '<div class="empty-sm">Chưa trả khoản nào trong tháng này</div>';
    return `${header()}
      <section class="hero">
        <h1 class="thin">Nợ</h1>
        <i class="tick"></i>
        <div class="hero-meta"><span class="label">Còn phải trả</span><span class="tag"><i class="dot ${clean ? 'in' : 'out'}"></i>${tag}</span></div>
        <div class="bigrow">${dm(nf.format(st.remaining), 8, false, 'dremain', st.remaining)}<span class="unit">₫</span></div>
      </section>
      <div class="tiles">
        <div class="tile glass"><div class="label">Trả tháng này</div><i class="tick"></i><div class="bigrow">${mT.svg}<span class="unit">${mT.unit}</span></div><div class="sub">${mp.length} lần trả</div></div>
        <div class="tile glass"><div class="label">Tiến độ</div><i class="tick"></i><div class="bigrow">${st.pct === null ? dm('-', 4.4, false) : dm(st.pct + '%', 4.4, false, 'dprog', st.pct, '%')}</div><div class="sub">${st.pct === null ? 'Chưa có nợ' : 'đã trả trên tổng nợ'}</div></div>
      </div>
      ${state.debts.length ? `<section class="card glass"><h2><span>Trả nợ theo tháng</span></h2>${debtBarChart(st)}</section>
      <section class="card glass"><h2><span>Dư nợ còn lại</span><span class="legend">cuối mỗi tháng</span></h2>${debtLineChart(st)}</section>` : '<div class="empty">Chưa có khoản nợ nào.<br>Bấm nút + hoặc nút bên dưới để thêm.</div>'}
      <div class="group-title">Các khoản nợ</div>
      ${cards}
      <button class="btn ghost dnew" data-act="debt-new">+ Khoản nợ mới</button>
      <div class="group-title">Lịch sử trả ${monthLabel(state.month).toLowerCase()}</div>
      ${hist}`;
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

  function renderListBody(root = document) {
    const body = $('#list-body', root);
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
        <div class="kv"><span>Số khoản nợ</span><b class="num">${state.debts.length}</b></div>
        <div class="kv"><span>Backup gần nhất</span><b>${lbText}</b></div>
        <div class="kv"><span>Lưu trữ bền vững</span><b id="persist">...</b></div>
      </section>
      <section class="card glass">
        <button class="set-row" data-act="export-json"><span>Backup (JSON)<small>Toàn bộ dữ liệu, dùng để chuyển sang máy khác</small></span></button>
        <button class="set-row" data-act="import"><span>Khôi phục từ JSON<small>Gộp vào dữ liệu hiện tại, trùng ID thì ghi đè</small></span></button>
        <button class="set-row" data-act="export-csv"><span>Xuất CSV<small>Mở bằng Excel hoặc Google Sheets</small></span></button>
      </section>
      <section class="card glass">${(() => { const n = state.txs.filter((t) => t.demo).length + state.debts.filter((t) => t.demo).length; return n
        ? `<button class="set-row" data-act="demo-clear"><span>Xoá dữ liệu mẫu<small>${n} mục mẫu (giao dịch và nợ), không ảnh hưởng dữ liệu thật</small></span></button>`
        : '<button class="set-row" data-act="demo-add"><span>Nạp dữ liệu mẫu<small>Thêm giao dịch và khoản nợ giả để xem giao diện và animation</small></span></button>'; })()}</section>
      <section class="card glass"><button class="set-row" data-act="push-toggle"><span>Thông báo nhắc 19:00<small>${pushOn() ? 'Mỗi tối 19:00 nhắc ghi thu chi, kèm icon Dòng Tiền' : 'Cần iOS 16.4 trở lên và app cài ở Home Screen. Bấm để bật'}</small></span><b>${pushOn() ? 'Bật' : 'Tắt'}</b></button></section>
      <section class="card glass"><button class="set-row" data-act="toggle-motion"><span>Chuyển động<small>${reducedOS() && motionPref() === 'auto' ? 'Máy đang bật Giảm chuyển động nên hiệu ứng đang tắt. Bấm để ép bật' : 'Nền động, số đếm, biểu đồ vẽ dần. Tắt nếu máy giật'}</small></span><b>${motionOn() ? 'Bật' : 'Tắt'}</b></button></section>
      <section class="card glass"><button class="set-row" data-act="lock-toggle"><span>Khóa app bằng mẫu chấm<small>${getLock() ? 'Chạm 5 chấm khi mở app và khi quay lại sau 30 giây. Đây là khóa màn hình, không mã hóa dữ liệu' : 'Chưa bật. Chạm 5 chấm trên lưới 3x3 để vào app'}</small></span><b>${getLock() ? 'Bật' : 'Tắt'}</b></button>${getLock() ? `<button class="set-row" data-act="lock-change"><span>Đổi mẫu mở khóa</span></button><button class="set-row" data-act="face-toggle"><span>Mở khóa bằng Face ID<small>Tự hiện khi mở app, không được thì dùng mẫu chấm</small></span><b>${getFace() ? 'Bật' : 'Tắt'}</b></button>` : ''}</section>
      <section class="card glass"><button class="set-row danger" data-act="wipe"><span>Xoá toàn bộ dữ liệu</span></button></section>
      <section class="card glass"><div class="label">Cài lên màn hình chính. iOS: Safari &gt; Chia sẻ &gt; Thêm vào MH chính. Android: Chrome &gt; menu &gt; Cài đặt ứng dụng. Cài rồi thì iOS không tự dọn dữ liệu.</div></section>`;
  }

  // đổi tab: trang cũ mờ đi (ease-in) rồi trang mới trượt vào lần lượt (ease-in-out); đổi dữ liệu thì vẽ lại ngay
  let lastTab = null, lastMonth = null, swapTimer, enterTimer;
  // đổi nội dung body của card toggle, pill trượt nhờ giữ nguyên phần tử, body có hiệu ứng vào nhẹ
  function swapBody(el, html) {
    if (!el) return;
    el.innerHTML = html;
    el.classList.remove('swapin'); void el.offsetWidth; el.classList.add('swapin');
  }
  function render() {
    const app = $('#app');
    const tabChanged = lastTab !== null && lastTab !== state.tab;
    const stagger = motionOn() && !tabChanged && (lastTab === null || lastMonth !== state.month);
    lastTab = state.tab; lastMonth = state.month;
    syncDock();
    clearTimeout(swapTimer);
    if (tabChanged && motionOn()) {
      app.classList.remove('enter'); app.classList.add('leave');
      swapTimer = setTimeout(() => {
        paint(); window.scrollTo(0, 0);
        app.classList.remove('leave'); void app.offsetWidth; app.classList.add('enter');
        clearTimeout(enterTimer); enterTimer = setTimeout(() => app.classList.remove('enter'), 1400);
      }, 240);
      return;
    }
    app.classList.remove('leave', 'enter');
    paint();
    if (stagger) { void app.offsetWidth; app.classList.add('enter'); clearTimeout(enterTimer); enterTimer = setTimeout(() => app.classList.remove('enter'), 1400); }
  }

  const viewFor = (tab) => (tab === 'home' ? viewHome() : tab === 'list' ? viewList() : tab === 'debt' ? viewDebt() : viewSettings());
  const syncDock = () => $$('.dock [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));

  // card nằm dưới màn hình: giữ animation biểu đồ ở trạng thái chờ tới khi cuộn tới
  let revealIO = null;
  function armReveal() {
    if (revealIO) revealIO.disconnect();
    if (!motionOn() || !('IntersectionObserver' in window)) return;
    revealIO = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.remove('rv'); revealIO.unobserve(en.target); } });
    }, { threshold: 0.15 });
    $$('#app .card').forEach((c) => {
      if (c.getBoundingClientRect().top < innerHeight - 60) return;
      c.classList.add('rv'); revealIO.observe(c);
    });
  }

  function paint() {
    $('#app').innerHTML = viewFor(state.tab);
    armReveal();
    if (state.tab === 'list') renderListBody();
    if (state.tab === 'home' || state.tab === 'debt') runCounters();
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

  /* ---------- chọn ngày: chip nhanh + lịch tự vẽ (tuần bắt đầu thứ Hai, tính bằng Date nên đúng năm nhuận) ---------- */
  const cal = { m: monthOf(todayStr()) };
  const yesterdayStr = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dstr(d); };
  function setDate(s) {
    $('#f-date').value = s;
    const isT = s === todayStr(), isY = s === yesterdayStr();
    $$('#f-dline [data-dq]').forEach((b) => b.classList.toggle('on', (b.dataset.dq === '0' && isT) || (b.dataset.dq === '1' && isY)));
    const pick = $('#f-dpick');
    pick.classList.toggle('on', !isT && !isY);
    const [Y, M, D] = s.split('-').map(Number);
    const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(Y, M - 1, D).getDay()];
    $('#f-dlabel').textContent = isT || isY ? 'Chọn ngày' : `${wd}, ${pad(D)}/${pad(M)}${Y !== new Date().getFullYear() ? '/' + Y : ''}`;
    if ($('#cal').classList.contains('open')) renderCal();
  }
  function renderCal() {
    const [Y, M] = cal.m.split('-').map(Number);
    $('#cal-title').textContent = `Tháng ${M}, ${Y}`;
    const first = (new Date(Y, M - 1, 1).getDay() + 6) % 7;
    const days = new Date(Y, M, 0).getDate();
    const sel = $('#f-date').value, today = todayStr();
    let h = '';
    for (let i = 0; i < first; i++) h += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const s = `${Y}-${pad(M)}-${pad(d)}`;
      h += `<button type="button" class="cd${s === sel ? ' on' : ''}${s === today ? ' today' : ''}" data-cday="${s}">${d}</button>`;
    }
    $('#cal-grid').innerHTML = h;
  }
  function toggleCal(open) {
    const el = $('#cal');
    const want = open === undefined ? !el.classList.contains('open') : open;
    if (want) { cal.m = monthOf($('#f-date').value || todayStr()); renderCal(); }
    el.classList.toggle('open', want);
    $('#f-dpick').classList.toggle('open', want);
  }

  function renderSheetCats() {
    $('#f-cats').innerHTML = CATS[sheet.type].map((c, i) =>
      `<button type="button" class="cat ${c.id === sheet.cat ? 'on' : ''}" data-cat="${c.id}" style="--c:${c.color};--i:${i}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('');
  }
  function syncType(first) {
    $$('#f-type button').forEach((b) => b.classList.toggle('on', b.dataset.type === sheet.type));
    const a = $('#f-amount');
    a.classList.toggle('expense', sheet.type === 'expense');
    a.classList.toggle('income', sheet.type === 'income');
    if (!CATS[sheet.type].some((c) => c.id === sheet.cat)) sheet.cat = CATS[sheet.type][0].id;
    renderSheetCats();
    if (first === true) return;
    // animation đổi Thu/Chi: số tiền nảy nhẹ, danh mục trượt vào lần lượt
    const wrap = $('.amount-wrap', $('#sheet'));
    wrap.classList.remove('flip'); void wrap.offsetWidth; wrap.classList.add('flip');
    const cats = $('#f-cats');
    cats.classList.remove('restage'); void cats.offsetWidth; cats.classList.add('restage');
  }
  function openSheet(t) {
    sheet.editing = t || null;
    sheet.type = t ? t.type : 'expense';
    sheet.cat = t ? t.cat : CATS.expense[0].id;
    $('#sh-title').textContent = t ? 'Sửa giao dịch' : 'Thêm giao dịch';
    $('#f-amount').value = t ? nf.format(t.amount) : '';
    $('#f-note').value = t ? t.note || '' : '';
    toggleCal(false);
    setDate(t ? t.date : todayStr());
    $('#f-del').hidden = !t;
    syncType(true);
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

  /* ---------- sheet nợ ---------- */
  const dsheet = { mode: 'pay', editing: null, debtId: null };
  const remainingOf = (id) => { const d = state.debts.find((x) => x.id === id); if (!d) return 0; return Math.max(0, d.total - livePays().filter((p) => p.debtId === id).reduce((a, p) => a + p.amount, 0)); };

  function renderDChips() {
    $('#d-debts').innerHTML = state.debts.map((d) =>
      `<button type="button" class="cat ${d.id === dsheet.debtId ? 'on' : ''}" data-dsel="${esc(d.id)}"><span class="dot" style="background:var(--orange)"></span>${esc(d.name)}</button>`).join('');
  }
  function openDSheet(mode, rec, debtId) {
    dsheet.mode = mode; dsheet.editing = rec || null;
    const isPay = mode === 'pay';
    $('#d-title').textContent = isPay ? (rec ? 'Sửa khoản trả' : 'Trả nợ') : (rec ? 'Sửa khoản nợ' : 'Khoản nợ mới');
    $('#d-namewrap').style.display = isPay ? 'none' : 'block';
    $('#d-debts').style.display = isPay ? 'flex' : 'none';
    $('#d-row2').style.display = isPay ? 'grid' : 'none';
    $('#d-amount').placeholder = '0';
    $('#d-amount').setAttribute('aria-label', isPay ? 'Số tiền trả' : 'Tổng nợ');
    $('#d-amountlbl').textContent = isPay ? 'Số tiền trả' : 'Tổng nợ ban đầu';
    $('#d-amount').value = rec ? nf.format(isPay ? rec.amount : rec.total) : '';
    $('#d-name').value = !isPay && rec ? rec.name : '';
    $('#d-note').value = isPay && rec ? rec.note || '' : '';
    $('#d-date').value = isPay && rec ? rec.date : todayStr();
    $('#d-del').hidden = !rec;
    $('#d-del').textContent = isPay ? 'Xoá khoản trả' : 'Xoá khoản nợ';
    if (isPay) {
      const open = state.debts.find((d) => remainingOf(d.id) > 0);
      dsheet.debtId = rec ? rec.debtId : (debtId || (open || state.debts[0] || {}).id);
      renderDChips();
    }
    const el = $('#dsheet');
    el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');
    if (!rec) setTimeout(() => (isPay ? $('#d-amount') : $('#d-name')).focus(), 60);
  }
  function closeDSheet() {
    const el = $('#dsheet');
    el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
    if (!$('#sheet').classList.contains('open')) document.body.classList.remove('lock');
    if (document.activeElement) document.activeElement.blur();
  }
  async function saveD() {
    const amount = parseAmt($('#d-amount').value);
    const old = dsheet.editing;
    try {
      if (dsheet.mode === 'debt') {
        const name = $('#d-name').value.trim();
        if (!name) { toast('Nhập tên khoản nợ'); $('#d-name').focus(); return; }
        if (!amount) { toast('Nhập tổng nợ'); $('#d-amount').focus(); return; }
        const rec = { id: old ? old.id : uid(), name: name.slice(0, 60), total: amount, createdAt: old ? old.createdAt : Date.now() };
        await dbPutS('debts', rec);
        const i = state.debts.findIndex((d) => d.id === rec.id);
        if (i >= 0) state.debts[i] = rec; else state.debts.push(rec);
      } else {
        const date = $('#d-date').value;
        if (!dsheet.debtId || !state.debts.some((d) => d.id === dsheet.debtId)) { toast('Chọn khoản nợ'); return; }
        if (!amount) { toast('Nhập số tiền trả'); $('#d-amount').focus(); return; }
        if (!date) { toast('Chọn ngày'); return; }
        const rec = { id: old ? old.id : uid(), debtId: dsheet.debtId, amount, date, note: $('#d-note').value.trim().slice(0, 200), createdAt: old ? old.createdAt : Date.now() };
        await dbPutS('pays', rec);
        const i = state.pays.findIndex((p) => p.id === rec.id);
        if (i >= 0) state.pays[i] = rec; else state.pays.push(rec);
        state.month = monthOf(date);
      }
    } catch { toast('Không lưu được, kiểm tra bộ nhớ trình duyệt'); return; }
    closeDSheet(); render(); toast(old ? 'Đã cập nhật' : 'Đã lưu');
  }
  async function removeD() {
    const old = dsheet.editing;
    if (!old) return;
    if (dsheet.mode === 'pay') {
      await dbDelS('pays', old.id);
      state.pays = state.pays.filter((p) => p.id !== old.id);
      closeDSheet(); render();
      toast('Đã xoá', 'Hoàn tác', async () => { await dbPutS('pays', old); state.pays.push(old); render(); });
    } else {
      const gone = state.pays.filter((p) => p.debtId === old.id);
      await dbDelS('debts', old.id); await dbDelManyS('pays', gone.map((p) => p.id));
      state.debts = state.debts.filter((d) => d.id !== old.id);
      state.pays = state.pays.filter((p) => p.debtId !== old.id);
      closeDSheet(); render();
      toast(`Đã xoá khoản nợ${gone.length ? ` và ${gone.length} lần trả` : ''}`, 'Hoàn tác', async () => {
        await dbPutS('debts', old); await dbBulkS('pays', gone);
        state.debts.push(old); state.pays.push(...gone); render();
      });
    }
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

  function demoDebts() {
    const t = todayStr(), cur = monthOf(t), last = +t.slice(8, 10);
    const debts = [
      { id: 'demo-d1', name: 'Thẻ tín dụng', total: 24000000, createdAt: 1, demo: true },
      { id: 'demo-d2', name: 'Vay bạn Nam', total: 10000000, createdAt: 2, demo: true },
    ];
    const plan = [[-4, 'demo-d1', 3000000], [-3, 'demo-d1', 4000000], [-2, 'demo-d1', 3500000], [-2, 'demo-d2', 2000000], [-1, 'demo-d1', 4500000], [-1, 'demo-d2', 2000000], [0, 'demo-d1', 3000000]];
    const pays = plan.filter(([off]) => off < 0 || last >= 2).map(([off, debtId, amount], i) => {
      const m = shiftMonth(cur, off);
      return { id: 'demo-p' + i, debtId, amount, date: `${m}-${pad(off === 0 ? Math.min(2, last) : 5 + (i % 3) * 7)}`, note: i % 2 ? 'Chuyển khoản' : '', createdAt: 100 + i, demo: true };
    });
    return { debts, pays };
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
    const data = { app: 'dong-tien', version: 2, exportedAt: new Date().toISOString(), transactions: state.txs, debts: state.debts, payments: state.pays };
    if (await saveFile(`dong-tien-${todayStr()}.json`, 'application/json', JSON.stringify(data, null, 2))) {
      setLastBackup(); render(); toast('Đã xuất backup');
    }
  }
  // sau 19:00 mà hôm nay chưa ghi khoản nào thì nhắc ngay trong app
  function todayNotice() {
    if (state.month !== monthOf(todayStr()) || new Date().getHours() < 19) return '';
    const t = todayStr();
    if (state.txs.some((x) => x.date === t)) return '';
    return '<div class="notice glass"><span>Hôm nay chưa ghi khoản nào.</span><button data-act="add">Thêm</button></div>';
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
  const validDebt = (d) => d && typeof d.id === 'string' && typeof d.name === 'string' && Number.isFinite(+d.total) && +d.total > 0;
  const validPay = (p) => p && typeof p.id === 'string' && typeof p.debtId === 'string' && Number.isFinite(+p.amount) && +p.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date);
  async function importJSON(file) {
    try {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : data.transactions;
      const ok = (arr || []).filter(validTx).map(normTx);
      const dOk = (data.debts || []).filter(validDebt).map((d) => ({ id: d.id, name: d.name.slice(0, 60), total: Math.round(+d.total), createdAt: +d.createdAt || Date.now(), ...(d.demo ? { demo: true } : {}) }));
      const pOk = (data.payments || []).filter(validPay).map((p) => ({ id: p.id, debtId: p.debtId, amount: Math.round(+p.amount), date: p.date, note: String(p.note || '').slice(0, 200), createdAt: +p.createdAt || Date.now(), ...(p.demo ? { demo: true } : {}) }));
      if (!ok.length && !dOk.length && !pOk.length) throw new Error('empty');
      if (ok.length) await dbBulk(ok);
      if (dOk.length) await dbBulkS('debts', dOk);
      if (pOk.length) await dbBulkS('pays', pOk);
      state.txs = await dbAll(); state.debts = await dbAllS('debts'); state.pays = await dbAllS('pays');
      render();
      toast(`Đã nhập ${ok.length} giao dịch${dOk.length ? `, ${dOk.length} khoản nợ, ${pOk.length} lần trả` : ''}`);
    } catch { toast('File không hợp lệ'); }
  }

  /* ---------- events ---------- */
  const ACTIONS = {
    prev: () => { state.month = shiftMonth(state.month, -1); render(); },
    next: () => { state.month = shiftMonth(state.month, 1); render(); },
    add: () => (state.tab === 'debt' ? (state.debts.length ? openDSheet('pay') : openDSheet('debt')) : openSheet()),
    'debt-new': () => openDSheet('debt'),
    'lock-toggle': () => (getLock()
      ? openLock('verify', { cancel: true, onOk: () => { try { localStorage.removeItem(LOCK_KEY); localStorage.removeItem(FACE_KEY); } catch { /* ignore */ } render(); toast('Đã tắt khóa'); } })
      : openLock('setup1', { cancel: true, onOk: () => { render(); toast('Đã bật khóa'); } })),
    'lock-change': () => openLock('verify', { cancel: true, onOk: () => openLock('setup1', { cancel: true, onOk: () => toast('Đã đổi mẫu') }) }),
    'face-toggle': () => { if (getFace()) { try { localStorage.removeItem(FACE_KEY); } catch { /* ignore */ } render(); toast('Đã tắt Face ID'); } else faceEnroll(); },
    'lock-face': tryFace,
    'lock-cancel': () => { lk.onOk = null; closeLock(); },
    'lock-forgot': forgotLock,
    dclose: closeDSheet,
    dsave: saveD,
    ddel: removeD,
    'toggle-data': () => { state.tab = state.tab === 'settings' ? 'home' : 'settings'; render(); window.scrollTo(0, 0); },
    'demo-add': async () => {
      const dd = demoDebts();
      await dbBulk(demoTxs()); await dbBulkS('debts', dd.debts); await dbBulkS('pays', dd.pays);
      state.txs = await dbAll(); state.debts = await dbAllS('debts'); state.pays = await dbAllS('pays'); state.month = monthOf(todayStr()); state.tab = 'home';
      render(); window.scrollTo(0, 0); toast('Đã nạp dữ liệu mẫu');
    },
    'demo-clear': async () => {
      await dbDelMany(state.txs.filter((t) => t.demo).map((t) => t.id));
      await dbDelManyS('debts', state.debts.filter((t) => t.demo).map((t) => t.id)); await dbDelManyS('pays', state.pays.filter((t) => t.demo).map((t) => t.id));
      state.txs = await dbAll(); state.debts = await dbAllS('debts'); state.pays = await dbAllS('pays');
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
    cal: () => toggleCal(),
    'push-toggle': () => (pushOn() ? pushDisable() : pushEnable()),
    import: () => $('#f-import').click(),
    wipe: async () => {
      if (!confirm('Xoá toàn bộ giao dịch và khoản nợ? Không khôi phục được nếu chưa backup.')) return;
      await dbClear(); await dbClearS('debts'); await dbClearS('pays'); state.txs = []; state.debts = []; state.pays = []; render(); toast('Đã xoá hết');
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-cumview],[data-tipview],[data-act],[data-tab],[data-id],[data-f],[data-type],[data-add],[data-mul],[data-cat],[data-dedit],[data-dpay],[data-pid],[data-dsel],[data-dadd],[data-dmul],[data-dq],[data-cday],[data-cnav]');
    if (!el) return;
    const d = el.dataset;
    if (d.act) return ACTIONS[d.act] && ACTIONS[d.act]();
    if (d.tab) { state.tab = d.tab; render(); window.scrollTo(0, 0); return; }
    if (d.cumview) {
      try { localStorage.setItem(CUMVIEW_KEY, d.cumview); } catch { /* ignore */ }
      const card = $('[data-cumcard]');
      if (card) {
        $$('.tipseg button', card).forEach((b) => b.classList.toggle('on', b.dataset.cumview === d.cumview));
        swapBody($('.cumbody', card), d.cumview === 'compare' ? cumCompare() : lineChart(monthTxs()));
      }
      return;
    }
    if (d.tipview) {
      try { localStorage.setItem(TIPVIEW_KEY, d.tipview); } catch { /* ignore */ }
      const card = $('[data-tipcard]');
      if (card) {
        $$('.tipseg button', card).forEach((b) => b.classList.toggle('on', b.dataset.tipview === d.tipview));
        swapBody($('.tipbody', card), tipBody());
      }
      return;
    }
    if (d.dq !== undefined) { const t = d.dq === '0' ? todayStr() : yesterdayStr(); setDate(t); toggleCal(false); return; }
    if (d.cday) { setDate(d.cday); toggleCal(false); return; }
    if (d.cnav) { cal.m = shiftMonth(cal.m, Number(d.cnav)); renderCal(); return; }
    if (d.dedit) { const x = state.debts.find((y) => y.id === d.dedit); if (x) openDSheet('debt', x); return; }
    if (d.dpay) { openDSheet('pay', null, d.dpay); return; }
    if (d.pid) { const x = state.pays.find((y) => y.id === d.pid); if (x) openDSheet('pay', x); return; }
    if (d.dsel) { dsheet.debtId = d.dsel; renderDChips(); return; }
    if (d.dadd || d.dmul) {
      const cur = parseAmt($('#d-amount').value);
      const next = d.dadd ? cur + Number(d.dadd) : cur * Number(d.dmul);
      $('#d-amount').value = next ? nf.format(Math.min(next, 999999999999)) : '';
      return;
    }
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
    if (e.target.id === 'f-amount' || e.target.id === 'd-amount') {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
      e.target.value = digits ? nf.format(Number(digits)) : '';
    } else if (e.target.id === 'q') {
      state.q = e.target.value;
      renderListBody();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); closeDSheet(); } });

  /* ---------- vuốt ngang: 2 trang dính nhau trượt cùng ngón tay (Tổng quan > Nợ > Giao dịch) ---------- */
  const TAB_ORDER = ['home', 'debt', 'list'];
  const EASE = 'cubic-bezier(0.22, 0.8, 0.3, 1)';
  const swipe = { on: false, drag: false, x0: 0, y0: 0, t0: 0, dx: 0, busy: false, ghost: null, ghostDir: 0 };
  const swipeNeighbor = (dir) => TAB_ORDER[TAB_ORDER.indexOf(state.tab) + dir];
  const viewW = () => document.documentElement.clientWidth;
  const clearAppStyle = () => { const a = $('#app'); a.style.transition = a.style.transform = a.style.opacity = ''; };
  function killGhost() { if (swipe.ghost) swipe.ghost.remove(); swipe.ghost = null; swipe.ghostDir = 0; }

  // trang kế được vẽ sẵn ngay khi bắt đầu kéo, nằm sát bên cạnh trang hiện tại
  function makeGhost(dir) {
    killGhost();
    const tab = swipeNeighbor(dir), g = document.createElement('main');
    g.className = 'pageghost'; g.innerHTML = viewFor(tab);
    g.style.transform = `translateX(${dir * viewW()}px)`;
    $('#app').before(g);
    if (tab === 'list') renderListBody(g);
    runCounters(g);
    swipe.ghost = g; swipe.ghostDir = dir;
  }

  function swipeCommit(dir) {
    const app = $('#app'), g = swipe.ghost, W = viewW(), next = swipeNeighbor(dir);
    const dur = motionOn() ? 0.42 : 0.01, tr = `transform ${dur}s ${EASE}`;
    swipe.busy = true;
    app.style.transition = g.style.transition = tr;
    app.style.transform = `translateX(${-dir * W}px)`; g.style.transform = 'translateX(0)';
    setTimeout(() => {
      // ghost trở thành #app luôn, không vẽ lại nên không bị giật hay replay animation
      state.tab = next; lastTab = next;
      window.scrollTo(0, 0);
      app.remove(); g.classList.remove('pageghost'); g.id = 'app'; g.removeAttribute('style');
      swipe.ghost = null; swipe.ghostDir = 0; swipe.busy = false;
      syncDock();
    }, dur * 1000 + 30);
  }
  function swipeCancel() {
    const app = $('#app'), g = swipe.ghost;
    swipe.busy = true;
    const tr = `transform 0.35s ${EASE}`;
    app.style.transition = tr; app.style.transform = '';
    if (g) { g.style.transition = tr; g.style.transform = `translateX(${swipe.ghostDir * viewW()}px)`; }
    setTimeout(() => { clearAppStyle(); killGhost(); swipe.busy = false; }, 380);
  }

  document.addEventListener('touchstart', (e) => {
    swipe.on = false; swipe.drag = false;
    if (swipe.busy || e.touches.length !== 1 || !TAB_ORDER.includes(state.tab) || document.body.classList.contains('lock')) return;
    if (e.target.closest('input, textarea, .overlay, .dock, #lock')) return;
    const t = e.touches[0];
    if (t.clientX < 16 || t.clientX > innerWidth - 16) return; // chừa mép màn hình cho cử chỉ của hệ điều hành
    Object.assign(swipe, { on: true, x0: t.clientX, y0: t.clientY, t0: performance.now(), dx: 0 });
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!swipe.on) return;
    const t = e.touches[0], W = viewW();
    const dx = Math.max(-W, Math.min(W, t.clientX - swipe.x0)), dy = t.clientY - swipe.y0;
    if (!swipe.drag) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe.on = false; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      swipe.drag = true;
    }
    const dir = dx < 0 ? 1 : -1;
    swipe.dx = dx;
    const app = $('#app');
    app.style.transition = 'none';
    if (swipeNeighbor(dir)) {
      if (swipe.ghostDir !== dir) makeGhost(dir);
      app.style.transform = `translateX(${dx.toFixed(1)}px)`;
      swipe.ghost.style.transition = 'none';
      swipe.ghost.style.transform = `translateX(${(dir * W + dx).toFixed(1)}px)`;
    } else {
      killGhost();
      app.style.transform = `translateX(${(dx * 0.22).toFixed(1)}px)`; // hết trang thì kéo nặng tay như dây thun
    }
  }, { passive: true });

  const swipeEnd = () => {
    if (!swipe.on || !swipe.drag) { swipe.on = false; return; }
    swipe.on = false; swipe.drag = false;
    const dx = swipe.dx, v = Math.abs(dx) / Math.max(1, performance.now() - swipe.t0), dir = dx < 0 ? 1 : -1;
    if (swipe.ghost && swipe.ghostDir === dir && (Math.abs(dx) > 80 || (Math.abs(dx) > 30 && v > 0.5))) swipeCommit(dir);
    else swipeCancel();
  };
  document.addEventListener('touchend', swipeEnd, { passive: true });
  document.addEventListener('touchcancel', () => { if (swipe.drag) swipeCancel(); swipe.on = swipe.drag = false; }, { passive: true });
  $('#f-import').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJSON(f); });

  /* ---------- thông báo đẩy 19:00 (Web Push qua Cloudflare Worker, xem worker/push-worker.js) ---------- */
  const VAPID_PUB = 'BJ_Sf9WImBuh7U6hQ7gB-zeuT3OL_lj2QRmUd2LWgTepf8GhXNWYnCqIRQz7arjo4cY4iwz-TT26sCQXtgyxSPI';
  const PUSH_URL_KEY = 'dong-tien:pushurl', PUSH_ON_KEY = 'dong-tien:pushon';
  const pushOn = () => { try { return localStorage.getItem(PUSH_ON_KEY) === '1'; } catch { return false; } };
  async function pushEnable() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      return toast('Máy chưa hỗ trợ. Cần iOS 16.4 trở lên và mở app từ Home Screen');
    }
    let url = '';
    try { url = localStorage.getItem(PUSH_URL_KEY) || ''; } catch { /* ignore */ }
    if (!url) {
      url = (prompt('Dán địa chỉ Worker (dạng https://ten.tai-khoan.workers.dev)') || '').trim().replace(/\/+$/, '');
      if (!/^https:\/\/[^\s]+$/.test(url)) return;
    }
    let perm;
    try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; }
    if (perm !== 'granted') return toast('Chưa được cấp quyền thông báo');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(VAPID_PUB) });
      const r = await fetch(url + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      if (!r.ok) throw new Error('subscribe ' + r.status);
      localStorage.setItem(PUSH_URL_KEY, url); localStorage.setItem(PUSH_ON_KEY, '1');
      render(); toast('Đã bật thông báo 19:00');
    } catch { toast('Không bật được. Kiểm tra địa chỉ Worker'); }
  }
  async function pushDisable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const url = localStorage.getItem(PUSH_URL_KEY);
        if (url) { try { await fetch(url + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch { /* ignore */ } }
        await sub.unsubscribe();
      }
    } catch { /* ignore */ }
    try { localStorage.removeItem(PUSH_ON_KEY); } catch { /* ignore */ }
    render(); toast('Đã tắt thông báo');
  }

  /* ---------- Face ID (WebAuthn, xác thực nền tảng) ---------- */
  const FACE_KEY = 'dong-tien:faceid';
  const getFace = () => { try { return JSON.parse(localStorage.getItem(FACE_KEY) || 'null'); } catch { return null; } };
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (t) => { t = t.replace(/-/g, '+').replace(/_/g, '/'); t += '='.repeat((4 - (t.length % 4)) % 4); return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); };
  const faceSupported = async () => {
    try { return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
  };
  // chữ ký WebAuthn là DER, WebCrypto cần r||s dạng thô 64 byte
  function derToRaw(der) {
    let o = 2;
    if (der[1] & 0x80) o = 2 + (der[1] & 0x7f);
    const part = () => {
      o++; const len = der[o++]; let v = der.slice(o, o + len); o += len;
      while (v.length > 32 && v[0] === 0) v = v.slice(1);
      const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
    };
    const r = part(), sg = part(), raw = new Uint8Array(64);
    raw.set(r, 0); raw.set(sg, 32); return raw;
  }
  async function faceEnroll() {
    if (!(await faceSupported())) return toast('Máy hoặc chế độ mở app này không hỗ trợ Face ID');
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Dòng Tiền' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'sty', displayName: 'STY' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        attestation: 'none', timeout: 60000,
      } });
      const pub = cred && cred.response.getPublicKey && cred.response.getPublicKey();
      if (!pub) throw new Error('no key');
      localStorage.setItem(FACE_KEY, JSON.stringify({ id: b64u(cred.rawId), pub: b64u(pub) }));
      render(); toast('Đã bật Face ID');
    } catch { toast('Không bật được Face ID'); }
  }
  async function faceVerify() {
    const cfg = getFace();
    if (!cfg) return false;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.get({ publicKey: {
      challenge, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: unb64u(cfg.id), transports: ['internal'] }],
    } });
    if (!cred) return false;
    const r = cred.response;
    const cd = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
    if (cd.type !== 'webauthn.get' || cd.challenge !== b64u(challenge)) return false;
    const ad = new Uint8Array(r.authenticatorData);
    if (!(ad[32] & 0x04)) return false; // cờ UV: đã xác thực sinh trắc
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', r.clientDataJSON));
    const data = new Uint8Array(ad.length + 32); data.set(ad); data.set(hash, ad.length);
    const key = await crypto.subtle.importKey('spki', unb64u(cfg.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(new Uint8Array(r.signature)), data);
  }
  async function tryFace() {
    if (!getFace() || !$('#lock').classList.contains('show') && !document.documentElement.classList.contains('locked')) return;
    const tok = ++lk.faceTok;
    $('#lk-msg').textContent = 'Đang xác thực Face ID';
    let ok = false;
    try { ok = await faceVerify(); } catch { ok = false; }
    if (tok !== lk.faceTok || lk.mode !== 'verify') return;
    if (ok) return lockSuccess();
    if (Date.now() >= lk.until) $('#lk-msg').textContent = 'Face ID không được. Thử lại hoặc vẽ mẫu';
  }

  /* ---------- khóa app bằng mẫu 9 chấm (khóa màn hình, không mã hóa dữ liệu) ---------- */
  const LOCK_KEY = 'dong-tien:lock', RELOCK_MS = 30000;
  const LOCK_LEN = 5;
  // v2 = chạm đúng 5 chấm. Khóa kiểu cũ (vuốt, v1) bị gỡ để không bị kẹt không mở được
  const getLock = () => {
    try {
      const c = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
      if (c && c.v !== 2) { localStorage.removeItem(LOCK_KEY); localStorage.removeItem('dong-tien:faceid'); return null; }
      return c;
    } catch { return null; }
  };
  async function hashSeq(seq, salt) {
    const text = salt + ':' + seq;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57; // dự phòng khi không có crypto.subtle
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    return String(h1 >>> 0) + String(h2 >>> 0);
  }
  const lk = { mode: 'verify', first: null, onOk: null, boot: false, seq: [], drawing: false, fails: 0, faceTok: 0, until: 0, tail: null, timer: null, hiddenAt: 0 };
  const NODE = (i) => ({ x: 50 + (i % 3) * 100, y: 50 + Math.floor(i / 3) * 100 });

  function buildLockGrid() {
    const g = $('#lk-grid');
    if (g.dataset.built) return;
    g.dataset.built = '1';
    let c = '';
    for (let i = 0; i < 9; i++) { const n = NODE(i); c += `<circle class="lkd" data-i="${i}" cx="${n.x}" cy="${n.y}" r="12"/>`; }
    g.innerHTML = c;
    const logo = ['111', '111', '100'];
    $('#lk-logo').innerHTML = `<svg viewBox="0 0 30 30">${logo.map((row, y) => [...row].map((ch, x) => `<circle cx="${5 + x * 10}" cy="${5 + y * 10}" r="3.6" fill="#fff" fill-opacity="${ch === '1' ? 1 : 0.2}"/>`).join('')).join('')}</svg>`;
    g.addEventListener('pointerdown', lockTap);
  }
  function lockDraw() {
    $$('#lk-grid .lkd').forEach((d, i) => {
      const on = lk.seq.includes(i);
      if (on && !d.classList.contains('on')) { d.classList.remove('on'); void d.getBoundingClientRect(); }
      d.classList.toggle('on', on);
    });
  }
  // chạm từng chấm theo thứ tự, đủ LOCK_LEN chấm thì tự xác nhận
  function lockTap(e) {
    if (lk.busy || Date.now() < lk.until) return;
    e.preventDefault();
    const g = $('#lk-grid'), r = g.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 300, py = ((e.clientY - r.top) / r.height) * 300;
    let best = -1, bd = 46;
    for (let i = 0; i < 9; i++) { const n = NODE(i), d = Math.hypot(px - n.x, py - n.y); if (d < bd) { bd = d; best = i; } }
    if (best < 0 || lk.seq.includes(best)) return;
    g.classList.remove('err');
    lk.seq.push(best); lockDraw();
    if (lk.seq.length === LOCK_LEN) { lk.busy = true; setTimeout(lockSubmit, 160); }
  }
  async function lockSubmit() {
    const seq = lk.seq.join('-');
    if (lk.mode === 'verify') {
      const cfg = getLock();
      if (cfg && (await hashSeq(seq, cfg.salt)) === cfg.hash) return lockSuccess();
      lk.fails++;
      if (lk.fails >= 5) { lk.fails = 0; lk.until = Date.now() + 30000; lockCountdown(); return lockFail('', true); }
      return lockFail('Sai mẫu', true);
    }
    if (lk.mode === 'setup1') {
      lk.first = seq; lk.mode = 'setup2';
      lockText('Xác nhận mẫu', `Chạm lại ${LOCK_LEN} chấm vừa rồi`);
      lk.seq = []; lockDraw(); lk.busy = false; return;
    }
    if (seq === lk.first) {
      const salt = uid();
      try { localStorage.setItem(LOCK_KEY, JSON.stringify({ v: 2, salt, hash: await hashSeq(seq, salt) })); } catch { toast('Không lưu được khóa'); return closeLock(); }
      return lockSuccess();
    }
    lk.mode = 'setup1'; lk.first = null;
    lockText('Mẫu mới', 'Không khớp. Chạm lại từ đầu');
    lockFail('Không khớp. Chạm lại từ đầu', false);
  }
  function lockText(title, msg) { $('#lk-title').textContent = title; $('#lk-msg').textContent = msg; }
  function lockFail(msg, shake) {
    if (msg) $('#lk-msg').textContent = msg;
    const g = $('#lk-grid');
    g.classList.remove('err'); void g.getBoundingClientRect(); g.classList.add('err');
    setTimeout(() => { lk.seq = []; lockDraw(); g.classList.remove('err'); lk.busy = false; }, 650);
  }
  function lockCountdown() {
    clearInterval(lk.timer);
    const tick = () => {
      const left = Math.ceil((lk.until - Date.now()) / 1000);
      if (left <= 0) { clearInterval(lk.timer); $('#lk-msg').textContent = `Chạm ${LOCK_LEN} chấm để vào app`; return; }
      $('#lk-msg').textContent = `Sai nhiều lần. Thử lại sau ${left} giây`;
    };
    tick(); lk.timer = setInterval(tick, 500);
  }
  function lockSuccess() {
    const f = lk.onOk; lk.onOk = null;
    lk.fails = 0;
    setTimeout(() => { closeLock(); lk.seq = []; lockDraw(); if (f) f(); }, 220);
  }
  function closeLock() { lk.faceTok++; document.documentElement.classList.remove('locked'); $('#lock').classList.remove('show'); lk.busy = false; }

  // mode: verify | setup1. opts: { cancel, boot, onOk }
  function openLock(mode, opts = {}) {
    buildLockGrid();
    lk.mode = mode; lk.first = null; lk.onOk = opts.onOk || null; lk.boot = !!opts.boot; lk.seq = []; lk.busy = false;
    lockDraw();
    $('#lk-grid').classList.remove('err');
    if (mode === 'verify') lockText('Mở khóa', `Chạm ${LOCK_LEN} chấm để vào app`); else lockText('Mẫu mới', `Chạm ${LOCK_LEN} chấm để đặt mẫu`);
    $('#lk-cancel').hidden = !opts.cancel;
    $('#lk-forgot').hidden = !(mode === 'verify' && opts.boot);
    $('#lock').classList.add('show');
    const face = mode === 'verify' && opts.boot && getFace();
    $('#lk-face').hidden = !face;
    if (Date.now() < lk.until) lockCountdown();
    else if (face) { if (document.documentElement.classList.contains('intro')) document.addEventListener('intro-done', tryFace, { once: true }); else tryFace(); }
  }
  function lockNow() {
    closeSheet(); closeDSheet();
    document.documentElement.classList.add('locked');
    openLock('verify', { boot: true, onOk: () => { shown.clear(); render(); replayEnter(); } });
  }
  async function forgotLock() {
    if (!confirm('Quên mẫu sẽ XOÁ TOÀN BỘ dữ liệu trong app (giao dịch, nợ) và tắt khóa. Không khôi phục được nếu chưa backup JSON. Tiếp tục?')) return;
    await dbClear(); await dbClearS('debts'); await dbClearS('pays');
    try { localStorage.removeItem(LOCK_KEY); localStorage.removeItem(FACE_KEY); } catch { /* ignore */ }
    state.txs = []; state.debts = []; state.pays = []; lk.onOk = null;
    closeLock(); shown.clear(); render(); toast('Đã xoá dữ liệu và tắt khóa');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { lk.hiddenAt = Date.now(); return; }
    if (getLock() && lk.hiddenAt && Date.now() - lk.hiddenAt > RELOCK_MS && !document.documentElement.classList.contains('locked')) lockNow();
  });

  /* ---------- boot ---------- */
  // icon dock dạng dot-matrix 7x7: ô sáng = '#', ô tắt vẫn vẽ mờ để ra cảm giác lưới chấm
  const DOCK_ICONS = {
    home: ['...#...', '..###..', '.#####.', '#######', '.##.##.', '.##.##.', '.##.##.'],
    add:  ['.......', '...#...', '...#...', '.#####.', '...#...', '...#...', '.......'],
    list: ['.......', '.#####.', '.......', '.#####.', '.......', '.###...', '.......'],
    debt: ['.......', '.#.....', '.#.....', '.#.#...', '.#.#...', '.#.#.#.', '#######'],
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
    const map = { home: $('.dock [data-tab="home"]'), add: $('.dock [data-act="add"]'), list: $('.dock [data-tab="list"]'), debt: $('.dock [data-tab="debt"]') };
    Object.entries(map).forEach(([k, btn]) => { btn.innerHTML = dotIcon(DOCK_ICONS[k]); });
    $('.dock').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.dk'); if (!b) return;
      b.classList.remove('rip'); void b.offsetWidth; b.classList.add('rip');
    });
    $('.dock').addEventListener('animationend', (e) => { const b = e.target.closest('.dk'); if (b && e.target.tagName === 'circle') b.classList.remove('rip'); });
  }

  /* ---------- intro: chấm bay vào hình chữ P, chạy khi mở app mới ---------- */
  function replayEnter() {
    if (!motionOn()) return;
    const app = $('#app');
    app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter');
    clearTimeout(enterTimer); enterTimer = setTimeout(() => app.classList.remove('enter'), 1400);
  }
  function runIntro() {
    const root = document.documentElement, el = $('#intro');
    if (!el) { root.classList.remove('intro'); return; }
    const logo = $('#in-logo'), pat = ['111', '111', '100'];
    let h = '';
    const rnd = (a, b) => a + Math.random() * (b - a);
    const vw = Math.max(innerWidth, 360), vh = Math.max(innerHeight, 640);
    pat.forEach((row, y) => [...row].forEach((ch, x) => {
      const a = rnd(0, 6.283), r = rnd(Math.min(vw, vh) * 0.35, Math.max(vw, vh) * 0.5);
      const lit = ch === '1';
      h += `<i class="in-dot${lit ? ' lit' : ''}" style="left:${12 + x * 48}px;top:${12 + y * 48}px;--x0:${(Math.cos(a) * r).toFixed(0)}px;--y0:${(Math.sin(a) * r).toFixed(0)}px;--o:${lit ? 1 : 0.2};--d:${(0.1 + (y * 3 + x) * 0.055).toFixed(2)}s"></i>`;
    }));
    logo.innerHTML = h;
    let done = false;
    const lockSet = !!getLock();
    if (lockSet) $('#lock').classList.add('hold'); // giấu lưới chấm của màn khóa tới lúc match cut
    const finish = () => {
      $('#lock').classList.remove('hold');
      el.remove();
      document.dispatchEvent(new Event('intro-done'));
    };
    const end = (skipped) => {
      if (done) return; done = true;
      clearTimeout(auto);
      const grid = $('#lk-grid');
      // match cut: 9 chấm của intro trượt và co giãn đúng vào 9 chấm của màn khóa rồi đổi chỗ không thấy khớp nối
      if (skipped !== true && lockSet && grid && grid.dataset.built && el.animate) {
        const box = grid.getBoundingClientRect(), sc = box.width / 300, lr = logo.getBoundingClientRect();
        const anims = $$('.in-dot', el).map((d, k) => {
          const x = k % 3, y = Math.floor(k / 3);
          const cx = lr.left + 12 + x * 48, cy = lr.top + 12 + y * 48;
          const tx = box.left + (50 + 100 * x) * sc, ty = box.top + (50 + 100 * y) * sc;
          const cs = getComputedStyle(d);
          return d.animate([
            { transform: 'translate(0px, 0px) scale(1)', boxShadow: cs.boxShadow, opacity: +cs.opacity },
            { transform: `translate(${(tx - cx).toFixed(1)}px, ${(ty - cy).toFixed(1)}px) scale(${sc.toFixed(3)})`, boxShadow: '0 0 0 0 rgba(255, 255, 255, 0)', opacity: 0.34 },
          ], { duration: 720, delay: k * 22, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' }).finished;
        });
        const word = $('.in-word', el);
        if (word) word.animate([{ opacity: +getComputedStyle(word).opacity }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
        el.classList.add('morph');
        setTimeout(() => root.classList.remove('intro'), 250);
        Promise.all(anims).catch(() => {}).then(() => { root.classList.remove('intro'); finish(); });
        return;
      }
      el.classList.add('out'); root.classList.remove('intro');
      if (!root.classList.contains('locked')) replayEnter();
      setTimeout(finish, 600);
    };
    const auto = setTimeout(end, 2400);
    el.addEventListener('pointerdown', () => end(true), { once: true });
  }

  (async function boot() {
    if (document.documentElement.classList.contains('intro')) runIntro();
    applyMotion();
    initDock();
    if (getLock()) openLock('verify', { boot: true, onOk: () => { shown.clear(); render(); replayEnter(); } });
    try { state.txs = await dbAll(); state.debts = await dbAllS('debts'); state.pays = await dbAllS('pays'); } catch { toast('Không mở được bộ nhớ trình duyệt'); }
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const had = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; try { sessionStorage.setItem('dt-skip-intro', '1'); } catch { /* ignore */ } location.reload(); } });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
})();
