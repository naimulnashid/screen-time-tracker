/*
  The project site's only script. It runs in <head>, so the theme is set
  before first paint, then draws the chart gallery once the DOM exists.

  Every chart is generated from a fixed seed: identical on every load, and
  nobody's usage. The shapes and rules follow the dashboard's own
  src/components/Charts.tsx, ActivityHeatmap.tsx and KindBar.tsx: one
  continuous trend line with an unrecorded day at zero, even heat-map steps,
  the top eight plus Other, the busiest hour drawn brighter, a callout per
  chart, and the phone's headline from screen-on time rather than its apps.
*/

/* ------------------------------------------------------------------ theme */

const THEME_KEY = 'stt-site-theme';

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch { return null; }
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4f5f7' : '#000000');
}

applyTheme(storedTheme() ?? systemTheme());

/* ------------------------------------------------------------------ data */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const END = new Date(Date.UTC(2026, 9, 13)); // the newest day with data
const DAY_MS = 86400000;
const MIN = 60000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const fmtDayLong = (d) => `${WEEKDAYS[d.getUTCDay()]}, ${fmtDay(d)}`;
const iso = (d) => d.toISOString().slice(0, 10);

/** Milliseconds -> the dashboard's "8h 12m", "24m 36s", "45s". */
function dur(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return sec && m < 10 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}
/** The same, split for a score card: [["8","h"],["12","m"]]. */
function durParts(ms) {
  return dur(ms).split(' ').map((p) => [p.replace(/[a-z]+$/, ''), p.replace(/^\d+/, '')]);
}
const count = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const hourLabel = (h) => (h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`);

/*
  Two invented devices with the demo's apps (scripts/seed-demo.ts) and their
  colours. `visit` is a typical visit in minutes, which turns time into opens.
  The phone's Launcher has no brand colour, so it takes the device accent,
  as in the dashboard.
*/
const DEVICES = {
  windows: {
    days: 100, seed: 20260923, missing: [61, 62, 63],
    total: [6.5, 10.5], // hours of active time on a working day
    apps: [
      { name: 'VS Code', color: '#0065a9', w: 3.2, visit: 24, peak: [10, 16] },
      { name: 'Google Chrome', color: '#fcd209', w: 2.3, visit: 19 },
      { name: 'Windows Terminal', color: '#ececf1', w: 1.2, visit: 17 },
      { name: 'File Explorer', color: '#ffc928', w: 0.7, visit: 9, kind: 'system' },
      { name: 'Spotify', color: '#1ed760', w: 0.55, visit: 15 },
      { name: 'Discord', color: '#5865f2', w: 0.5, visit: 16 },
      { name: 'Word', color: '#1146ac', w: 0.45, visit: 15 },
      { name: 'Firefox', color: '#ff7139', w: 0.32, visit: 17 },
      { name: 'Notepad', color: '#43afcf', w: 0.28, visit: 19 },
      { name: 'VLC', color: '#f48200', w: 0.26, visit: 15 },
      { name: 'Calculator', color: null, w: 0.004, visit: 1.5, sparse: 0.15 },
      { name: 'Snipping Tool', color: null, w: 0.003, visit: 1, sparse: 0.1 },
    ],
    hours: [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 3.3, 5.4, 7.6, 4.1, 3.9, 7.1, 7.6, 3.3, 5.2, 1.3, 0.1, 1.2, 4.9, 3.1, 0.2],
    detail: 'VS Code',
  },
  android: {
    days: 60, seed: 20260930, missing: [],
    total: [3.6, 7.8], // hours of screen-on time
    apps: [
      { name: 'YouTube', color: '#ff0033', w: 2.1, visit: 9 },
      { name: 'WhatsApp', color: '#23b33a', w: 1.5, visit: 2.6 },
      { name: 'Chrome', color: '#fcd209', w: 1.0, visit: 3.5 },
      { name: 'Spotify', color: '#1ed760', w: 0.6, visit: 6 },
      { name: 'Telegram', color: '#1d93d2', w: 0.5, visit: 2.4 },
      { name: 'Gmail', color: '#ea4335', w: 0.35, visit: 1.8 },
      { name: 'Maps', color: '#34a853', w: 0.3, visit: 4 },
      { name: 'Launcher', color: null, w: 0.28, visit: 0.4, home: true },
      { name: 'Duolingo', color: '#58cc02', w: 0.22, visit: 7 },
      { name: 'Calendar', color: '#4797ff', w: 0.012, visit: 0.8, sparse: 0.3 },
    ],
    hours: [0.3, 0.1, 0, 0, 0, 0, 6.7, 7.3, 11.1, 7.7, 7.9, 7.8, 9.1, 11.8, 14.8, 11.6, 9.4, 10.9, 10.8, 12.1, 15.7, 14.3, 10.6, 2],
    attributed: 0.75, // apps cover this share of screen-on, as measured
    detail: 'YouTube',
  },
};

function build(device) {
  const cfg = DEVICES[device];
  const rnd = mulberry32(cfg.seed);
  const n = cfg.days;
  const days = [];
  const apps = cfg.apps.map((a) => ({ ...a, time: [], opens: [], sessions: [] }));
  const wsum = cfg.apps.reduce((s, a) => s + a.w, 0);
  for (let i = 0; i < n; i++) {
    const date = new Date(END.getTime() - (n - 1 - i) * DAY_MS);
    if (cfg.missing.includes(i)) {
      apps.forEach((a) => { a.time.push(null); a.opens.push(null); });
      days.push({ date, total: null, unlocks: null });
      continue;
    }
    const weekend = date.getUTCDay() === 5 || date.getUTCDay() === 6;
    const hours = cfg.total[0] + rnd() * (cfg.total[1] - cfg.total[0]) - (device === 'windows' && weekend ? 2.5 : 0);
    const screen = Math.max(1, hours) * 60 * MIN;
    const appShare = device === 'android' ? cfg.attributed * (0.92 + rnd() * 0.16) : 1;
    let sum = 0;
    apps.forEach((a) => {
      let t = 0;
      const used = a.sparse ? rnd() < a.sparse : rnd() < Math.min(0.97, 0.55 + a.w * 0.35);
      if (used) t = (screen * appShare * a.w / wsum) * (0.45 + rnd() * 1.1);
      a.time.push(t);
      const o = t > 0 ? Math.max(1, Math.round(t / (a.visit * MIN) * (0.7 + rnd() * 0.6))) : 0;
      a.opens.push(o);
      sum += t;
    });
    // The laptop's total IS the sum of its apps (an exclusive timeline); the
    // phone's is screen-on, which its apps cover only part of.
    days.push({ date, total: device === 'windows' ? sum : screen, apps: sum, unlocks: Math.round(38 + rnd() * 20) });
  }
  for (const a of apps) {
    a.total = a.time.reduce((s, v) => s + (v ?? 0), 0);
    a.opensTotal = a.opens.reduce((s, v) => s + (v ?? 0), 0);
    a.days = a.time.filter((v) => v > 0).length;
  }
  apps.sort((a, b) => b.total - a.total);
  const recorded = days.filter((d) => d.total !== null);
  return {
    device, cfg, days, apps, recorded,
    total: recorded.reduce((s, d) => s + d.total, 0),
    appsTotal: recorded.reduce((s, d) => s + d.apps, 0),
  };
}

const DATA = { windows: build('windows'), android: build('android') };

/* ------------------------------------------------------------------ colour */

const SUPPORTS_RELATIVE = typeof CSS !== 'undefined' && CSS.supports('color', 'oklch(from #123456 l c h)');

/** The dashboard's ink(): an app colour clamped to the theme's lightness band. */
function ink(hex) {
  if (!hex) return 'var(--accent)';
  return SUPPORTS_RELATIVE ? `oklch(from ${hex} clamp(var(--ink-lo, 0), l, var(--ink-hi, 1)) c h)` : hex;
}
const OTHER = '#4b4b55';

const HEAT = {
  dark: {
    windows: ['#131519', '#241a5c', '#33228a', '#4c33bd', '#7c5cff', '#a795ff'],
    android: ['#131519', '#0d3a24', '#125234', '#1a7b4c', '#3ddc84', '#8af0b8'],
  },
  light: {
    windows: ['#e1e6ed', '#ddd5fd', '#bcaaf9', '#9479f1', '#6c4ce6', '#4a2bb8'],
    android: ['#e1e6ed', '#c3ead3', '#8dd6ad', '#4dba80', '#1f9457', '#0d6b3c'],
  },
};

/* ------------------------------------------------------------------ helpers */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/*
  Axes END AT THE DATA, as the dashboard's lib/axis.ts insists: the smallest
  round step that covers the peak in six ticks or fewer, so the top line sits
  just above the tallest point instead of a whole step beyond it.
*/
function timeAxis(peakMs) {
  const steps = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 600, 720, 1200, 1440, 2880, 6000, 12000, 24000];
  const peakMin = Math.max(1, peakMs / MIN);
  const step = steps.find((s) => Math.ceil(peakMin / s) <= 6) ?? Math.ceil(peakMin / 6);
  const ticks = Math.max(1, Math.ceil(peakMin / step));
  const label = (v) => (step >= 60 ? `${(v * step) / 60}h` : `${v * step}m`);
  return { max: ticks * step * MIN, ticks, label: (i) => (i === 0 ? '0' : label(i)) };
}
function countAxis(peak) {
  const raw = Math.max(1, peak) / 6;
  const p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const ticks = Math.max(1, Math.ceil(peak / step));
  return { max: ticks * step, ticks, label: (i) => count(i * step) };
}

function grid(axis, x0, x1, y0, y1) {
  let s = '';
  for (let i = 0; i <= axis.ticks; i++) {
    const y = y1 - ((y1 - y0) * i) / axis.ticks;
    s += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--grid)" />`;
    s += `<text x="${x0 - 8}" y="${y + 4}" text-anchor="end">${esc(axis.label(i))}</text>`;
  }
  return s;
}

function xDates(days, x, y, every) {
  return days.map((d, i) => (i % every === every - 1
    ? `<text x="${x(i)}" y="${y}" text-anchor="middle">${fmtDay(d.date)}</text>` : '')).join('');
}

function tipRow(color, label, value) {
  return `<div class="row"><i style="background:${color}"></i>${esc(label)} <span style="margin-left:auto;padding-left:10px">${esc(value)}</span></div>`;
}

function callout(label, date, value) {
  return `<div class="chart-top"><div class="callout"><span class="callout-label">${label}</span><span class="callout-date">${esc(date)}</span><div class="callout-value">${esc(value)}</div></div></div>`;
}

/** Monotone cubic (Fritsch-Carlson) through points, as Recharts draws type="monotone". */
function curve(pts, move = true) {
  const n = pts.length;
  if (n < 2) return n ? `${move ? 'M' : 'L'}${pts[0][0]},${pts[0][1]}` : '';
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const f = (v) => v.toFixed(1);
  let d = `${move ? 'M' : 'L'}${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i][0] + h)},${f(pts[i][1] + h * t[i])} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - h * t[i + 1])} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
}

/* Which measure each Time | Opens switch shows. */
const measure = { stack: 'time', hour: 'time', top: 'time', app: 'time' };

function wireMeasure(key) {
  const el = document.querySelector(`.mini-seg[data-for="${key}"]`);
  el.innerHTML = ['time', 'opens'].map((m) =>
    `<button type="button" role="radio" data-m="${m}" aria-checked="${measure[key] === m}">${m === 'time' ? 'Time' : 'Opens'}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    measure[key] = b.dataset.m;
    drawAll();
  };
}

/* ------------------------------------------------------------------ charts */

function statCard(label, value, sub, isDur) {
  const body = isDur
    ? durParts(value).map(([n, u]) => `<span data-count="${n}">${n}</span><span class="u">${u}</span>`).join('')
    : `<span data-count="${Math.round(value)}">${count(value)}</span>`;
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${body}</div><div class="stat-sub">${esc(sub)}</div></div>`;
}

function drawStats(d) {
  const latest = d.recorded[d.recorded.length - 1];
  const n = d.recorded.length;
  const listed = d.apps.filter((a) => a.total > 0).length;
  const el = document.getElementById('v-stats');
  const note = document.getElementById('v-stats-note');
  if (d.device === 'windows') {
    note.textContent = 'Active time: the sampler\'s exclusive timeline, so the apps add up to it.';
    el.className = 'stats stats-3';
    el.innerHTML = statCard('Latest day', latest.total, iso(latest.date), true)
      + statCard('Daily average', d.total / n, `over ${n} days with data`, true)
      + statCard('Range total', d.total, `${listed} apps`, true);
  } else {
    note.textContent = 'Screen-on time and unlocks, from screen events. Never a sum of the apps.';
    el.className = 'stats stats-6';
    const unlocks = d.recorded.reduce((s, x) => s + x.unlocks, 0);
    el.innerHTML = statCard('Latest day', latest.total, 'screen on', true)
      + statCard('Daily average', d.total / n, `over ${n} days of data`, true)
      + statCard('Total screen time', d.total, `${listed} apps`, true)
      + statCard('Unlocks, latest day', latest.unlocks, 'pick-ups')
      + statCard('Unlocks per day', unlocks / n, `over ${n} days of data`)
      + statCard('Total unlocks', unlocks, 'pick-ups in this range');
  }
  countUp(el.querySelectorAll('[data-count]'));
}

function countUp(nodes) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  nodes.forEach((el) => {
    const to = parseFloat(el.dataset.count.replace(/,/g, ''));
    const final = el.textContent;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      el.textContent = count(to * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step); else el.textContent = final;
    };
    requestAnimationFrame(step);
  });
}

function drawTrend(d) {
  const W = 1000, H = 270, L = 48, R = 8, T = 10, B = 26;
  const days = d.days;
  const peak = d.recorded.reduce((a, b) => (b.total > a.total ? b : a));
  const axis = timeAxis(peak.total);
  const x = (i) => L + ((W - L - R) * i) / (days.length - 1);
  const y = (v) => H - B - ((H - B - T) * v) / axis.max;
  // An unrecorded day is PLOTTED at zero so the line never breaks; the data
  // keeps the null, which is what the tooltip reads.
  const pts = days.map((dd, i) => [x(i), y(dd.total ?? 0)]);
  const line = curve(pts);
  const area = `${line}L${x(days.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const w = (W - L - R) / (days.length - 1);
  const hits = days.map((dd, i) => {
    const tip = `<b>${fmtDayLong(dd.date)}</b>${dd.total === null ? 'Not recorded' : `<span style="color:var(--accent-bright);font-weight:650;font-size:15px">${dur(dd.total)}</span>`}`;
    return `<rect x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - B - T}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }).join('');
  document.getElementById('v-trend').innerHTML =
    callout('Heaviest day', fmtDay(peak.date), dur(peak.total)) +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily ${d.device === 'windows' ? 'active time' : 'screen-on time'} over ${days.length} days, heaviest ${fmtDay(peak.date)} at ${dur(peak.total)}">
      <defs><linearGradient id="g-trend" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--accent)" stop-opacity="0.32"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid(axis, L, W - R, T, H - B)}
      <path d="${area}" fill="url(#g-trend)" class="fade"/>
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" class="fade"/>
      ${xDates(days, x, H - 6, 10)}${hits}
    </svg>`;
}

function drawHeat(d, expanded) {
  const theme = document.documentElement.dataset.theme;
  const ramp = HEAT[theme][d.device];
  const byDate = new Map(d.days.map((x) => [x.date.getTime(), x.total]));
  const first = d.days[0].date.getTime();
  const max = Math.max(...d.recorded.map((x) => x.total));
  // EVEN steps: a day of screen time cannot pass 24 hours, so the sibling's
  // low-skewed steps would put nearly every day in the top two shades.
  const step = (v) => (v <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil((v / max) * 5))));
  const satOf = (t) => t - ((new Date(t).getUTCDay() + 1) % 7) * DAY_MS;

  function block(startSat, hideBefore, label) {
    let cells = '<span></span>';
    let lastMonth = -1;
    for (let w = 0; w < 26; w++) {
      const m = new Date(startSat + w * 7 * DAY_MS).getUTCMonth();
      cells += `<span class="hm-month">${m !== lastMonth ? MONTHS[m] : ''}</span>`;
      lastMonth = m;
    }
    ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach((name, dow) => {
      cells += `<span class="hm-day">${name}</span>`;
      for (let w = 0; w < 26; w++) {
        const t = startSat + (w * 7 + dow) * DAY_MS;
        const date = new Date(t);
        const v = byDate.get(t);
        if (t > END.getTime() || t < hideBefore) cells += '<span></span>';
        else if (t < first || v === null || v === undefined) {
          cells += `<span class="hm-cell hm-none" data-tip="${esc(`<b>${fmtDayLong(date)}</b>Not recorded`)}"></span>`;
        } else {
          cells += `<span class="hm-cell fade" style="background:${ramp[step(v)]}" data-tip="${esc(`<b>${fmtDayLong(date)}</b>${dur(v)}`)}"></span>`;
        }
      }
    });
    return (label ? `<div class="hm-block-label">${label}</div>` : '')
      + `<div class="hm" role="img" aria-label="Activity heat map, ${label || 'the last 26 weeks'}">${cells}</div>`;
  }

  let html = '';
  if (!expanded) {
    html = block(satOf(END.getTime()) - 25 * 7 * DAY_MS, 0, '');
  } else {
    // From the first RECORDED day, six months to a row; the days before it
    // in its week are hidden, not outlined.
    for (let s0 = satOf(first); s0 <= END.getTime(); s0 += 26 * 7 * DAY_MS) {
      const a = new Date(Math.max(s0, first));
      const b = new Date(Math.min(s0 + (26 * 7 - 1) * DAY_MS, END.getTime()));
      html += block(s0, first, `${fmtDay(a)} to ${fmtDay(b)}, 2026`);
    }
  }
  html += `<div class="hm-foot"><span>${dur(d.total)} across ${d.recorded.length} active days</span>
    <button type="button" class="mini-btn" id="hm-toggle" aria-expanded="${expanded}">${expanded ? 'Back to 26 weeks' : 'Expand'}</button>
    <span class="hm-scale">Less <i class="none" title="Not recorded"></i>${ramp.map((c) => `<i style="background:${c}"></i>`).join('')} More</span></div>`;
  const el = document.getElementById('v-heat');
  el.innerHTML = html;
  el.querySelector('#hm-toggle').addEventListener('click', () => drawHeat(d, !expanded));
}

/** The top eight by the chosen measure, the rest folded into Other. */
function ranked(d, m) {
  // The phone's home screen is what you pass through between apps, not
  // something you open, so it is left out of the OPENS ranking only.
  const pool = d.apps.filter((a) => !(m === 'opens' && a.home));
  const key = m === 'time' ? 'total' : 'opensTotal';
  pool.sort((a, b) => b[key] - a[key]);
  return { top: pool.slice(0, 8), rest: pool.slice(8), left: d.apps.filter((a) => m === 'opens' && a.home) };
}

function drawStack(d) {
  const m = measure.stack;
  const W = 1000, H = 280, L = 48, R = 8, T = 10, B = 26;
  const { top, rest, left } = ranked(d, m);
  const field = m === 'time' ? 'time' : 'opens';
  const days = d.days;
  const series = top.map((a) => ({ name: a.name, color: ink(a.color), vals: a[field] }));
  series.push({ name: 'Other', color: OTHER, vals: days.map((_, i) => rest.reduce((s, a) => s + (a[field][i] ?? 0), 0)) });
  const totals = days.map((_, i) => series.reduce((s, se) => s + (se.vals[i] ?? 0), 0));
  const axis = m === 'time' ? timeAxis(Math.max(...totals)) : countAxis(Math.max(...totals));
  const x = (i) => L + ((W - L - R) * i) / (days.length - 1);
  const y = (v) => H - B - ((H - B - T) * v) / axis.max;
  const fmtV = m === 'time' ? dur : (v) => `${count(v)} opens`;

  let layers = '';
  const base = days.map(() => 0);
  series.forEach((se) => {
    const topv = days.map((_, i) => base[i] + (se.vals[i] ?? 0));
    const up = curve(days.map((_, i) => [x(i), y(topv[i])]));
    const down = curve(days.map((_, i) => [x(i), y(base[i])]).reverse(), false);
    layers += `<path d="${up}${down}Z" fill="${se.color}" fill-opacity="0.88" stroke="${se.color}" stroke-width="1" class="fade"/>`;
    topv.forEach((v, i) => (base[i] = v));
  });
  const w = (W - L - R) / (days.length - 1);
  const hits = days.map((dd, i) => {
    const tip = dd.total === null ? `<b>${fmtDayLong(dd.date)}</b>Not recorded`
      : `<b>${fmtDayLong(dd.date)}</b>` + series.map((se) => [se, se.vals[i] ?? 0]).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([se, v]) => tipRow(se.color, se.name, fmtV(v))).join('');
    return `<rect x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - B - T}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }).join('');
  const lead = top[0];
  document.getElementById('v-stack-title').textContent = m === 'time' ? 'Top apps by day' : 'Most opened by day';
  document.getElementById('v-stack-note').textContent = left.length
    ? `${left[0].name} is left out of opens: the home screen is what you pass through between apps, not something you open.` : '';
  document.getElementById('v-stack').innerHTML =
    callout(m === 'time' ? 'Top app' : 'Most opened', lead.name, m === 'time' ? dur(lead.total) : `${count(lead.opensTotal)} opens`) +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m === 'time' ? 'Time' : 'Opens'} per day by app, top eight stacked with the rest as Other">
      ${grid(axis, L, W - R, T, H - B)}${layers}${xDates(days, x, H - 6, 10)}${hits}</svg>`;
  document.getElementById('v-stack-legend').innerHTML =
    series.map((se) => `<span><i style="background:${se.color}"></i>${esc(se.name)}</span>`).join('');
}

/** Vertical bars with the peak lifted to the bright accent, as HourlyChart and DailyTrendChart draw. */
function bars(vals, labels, { axis, fmtV, tipLabel, W = 1000, H = 260, L = 48, every = 1, aria }) {
  const R = 6, T = 8, B = 24;
  const slot = (W - L - R) / vals.length;
  const bw = Math.max(2, slot * 0.72);
  const y = (v) => H - B - ((H - B - T) * v) / axis.max;
  const peak = Math.max(...vals.map((v) => v ?? 0));
  let s = grid(axis, L, W - R, T, H - B);
  vals.forEach((v, i) => {
    const bx = L + slot * i + (slot - bw) / 2;
    if (v) {
      s += `<rect class="draw" style="animation-delay:${Math.min(i * 12, 400)}ms" x="${bx}" y="${y(v)}" width="${bw}" height="${y(0) - y(v)}" rx="3"
        fill="${v === peak ? 'var(--accent-bright)' : 'var(--accent)'}" data-tip="${esc(`<b>${tipLabel(i)}</b>${fmtV(v)}`)}"/>`;
    }
    if (i % every === 0) s += `<text x="${L + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${s}</svg>`;
}

function drawHour(d) {
  const m = measure.hour;
  const total = m === 'time' ? d.total : d.apps.reduce((s, a) => s + (a.home ? 0 : a.opensTotal), 0);
  const shape = d.cfg.hours;
  const sum = shape.reduce((s, v) => s + v, 0);
  const vals = shape.map((v) => (total * v) / sum);
  const peakH = vals.indexOf(Math.max(...vals));
  const fmtV = m === 'time' ? dur : (v) => `${count(v)} opens`;
  document.getElementById('v-hour-title').textContent = m === 'time' ? 'Shape of the day' : 'When it gets opened';
  document.getElementById('v-hour').innerHTML =
    callout('Busiest hour', hourLabel(peakH), fmtV(vals[peakH])) +
    bars(vals, vals.map((_, h) => hourLabel(h)), {
      axis: m === 'time' ? timeAxis(vals[peakH]) : countAxis(vals[peakH]),
      fmtV, every: 3, tipLabel: (h) => `${hourLabel(h)} to ${hourLabel((h + 1) % 24)}`,
      aria: `${m === 'time' ? 'Time' : 'Opens'} by hour of day, busiest ${hourLabel(peakH)}`,
    });
}

function drawWhere(d) {
  const title = document.getElementById('v-where-title');
  const note = document.getElementById('v-where-note');
  if (d.device === 'windows') {
    title.textContent = 'Where the time went';
    note.textContent = 'Every millisecond the sampler accounted for. Asleep is the absence of a measurement, so the trend never draws it.';
    const active = d.total;
    const parts = [
      ['Active', active, 'var(--accent)'],
      ['Locked', active * 0.54, 'color-mix(in srgb, var(--accent) 34%, var(--bg-panel))'],
      ['Unattributed', active * 0.004, 'color-mix(in srgb, var(--text-dim) 55%, var(--bg-panel))'],
      ['Asleep', d.days.length * 24 * 60 * MIN - active * 1.544, 'color-mix(in srgb, var(--text-dim) 28%, var(--bg-panel))'],
    ];
    const all = parts.reduce((s, p) => s + p[1], 0);
    document.getElementById('v-where').innerHTML =
      `<div class="kind-bar" role="img" aria-label="${parts.map((p) => `${p[0]} ${pct(p[1] / all)}`).join(', ')}">${parts.map(([, v, c], i) =>
        `<span style="width:${(v / all) * 100}%;background:${c};animation-delay:${i * 80}ms" data-tip="${esc(`<b>${parts[i][0]}</b>${dur(v)}, ${pct(v / all)}`)}"></span>`).join('')}</div>
      <div class="kind-legend">${parts.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} <b>${dur(v)}</b></span>`).join('')}</div>`;
  } else {
    title.textContent = 'Attributed vs unaccounted';
    note.textContent = 'Screen-on time, and how much of it any app accounts for. The lock screen, the launcher between apps and system surfaces hold the rest.';
    const inApps = d.appsTotal, rest = d.total - inApps, share = inApps / d.total;
    document.getElementById('v-where').innerHTML =
      `<div class="kind-bar" role="img" aria-label="In an app ${pct(share)}, unaccounted ${pct(1 - share)}">
        <span style="width:${share * 100}%;background:var(--accent)" data-tip="${esc(`<b>In an app</b>${dur(inApps)}`)}"></span>
        <span style="width:${(1 - share) * 100}%;background:color-mix(in srgb, var(--text-dim) 40%, var(--bg-panel));animation-delay:120ms" data-tip="${esc(`<b>Unaccounted</b>${dur(rest)}`)}"></span></div>
      <div class="kind-legend"><span><i style="background:var(--accent)"></i>In an app <b>${dur(inApps)}</b> (${Math.round(share * 100)}%)</span>
        <span><i style="background:color-mix(in srgb, var(--text-dim) 40%, var(--bg-panel))"></i>Unaccounted <b>${dur(rest)}</b></span></div>
      <p class="half-sub" style="margin:12px 0 0">Measured here at <b>${share.toFixed(2)}×</b>. The headline therefore comes from screen-on events, never from summing the apps.</p>`;
  }
}

function drawTop(d) {
  const m = measure.top;
  const W = 1000, L = 180, R = 14, rowH = 34, T = 4;
  const apps = ranked(d, m).top;
  const val = (a) => (m === 'time' ? a.total : a.opensTotal);
  const H = T + apps.length * rowH + 24;
  const axis = m === 'time' ? timeAxis(val(apps[0])) : countAxis(val(apps[0]));
  const x = (v) => L + ((W - L - R) * v) / axis.max;
  let s = '';
  for (let i = 0; i <= axis.ticks; i++) {
    const gx = L + ((W - L - R) * i) / axis.ticks;
    s += `<line x1="${gx}" x2="${gx}" y1="${T}" y2="${H - 22}" stroke="var(--grid)"/>`;
    s += `<text x="${gx}" y="${H - 6}" text-anchor="middle">${esc(axis.label(i))}</text>`;
  }
  const sum = d.apps.reduce((t, a) => t + val(a), 0);
  apps.forEach((a, i) => {
    const by = T + i * rowH + 5, bh = rowH - 10;
    const tip = `<b>${esc(a.name)}</b>${dur(a.total)}, ${pct(a.total / d.appsTotal)}<br>${count(a.opensTotal)} opens<div style="margin-top:4px;color:var(--text-faint)">Click to open its detail page</div>`;
    s += `<text x="${L - 8}" y="${by + bh / 2 + 4}" text-anchor="end">${esc(a.name)}</text>`;
    s += `<rect class="draw-x" style="animation-delay:${i * 40}ms;cursor:pointer" x="${L}" y="${by}" width="${Math.max(2, x(val(a)) - L)}" height="${bh}" rx="3" fill="${ink(a.color)}" data-tip="${esc(tip)}" data-open="detail"/>`;
  });
  document.getElementById('v-top-title').textContent = m === 'time' ? 'Top apps' : 'Most opened';
  document.getElementById('v-top').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m === 'time' ? 'Apps ranked by time' : 'Apps ranked by opens'}, ${pct(val(apps[0]) / sum)} for the first">${s}</svg>`;
}

function drawApp(d) {
  const m = measure.app;
  const app = d.apps.find((a) => a.name === d.cfg.detail);
  const span = 30;
  const days = d.days.slice(-span);
  const vals = (m === 'time' ? app.time : app.opens).slice(-span);
  const peakI = vals.reduce((b, v, i) => ((v ?? 0) > (vals[b] ?? 0) ? i : b), 0);
  const fmtV = m === 'time' ? dur : (v) => `${count(v)} opens`;
  const visit = app.total / Math.max(1, app.opensTotal);
  document.getElementById('v-app-title').textContent = `One app, day by day: ${app.name}`;
  document.getElementById('v-app-stats').className = 'stats';
  document.getElementById('v-app-stats').innerHTML =
    statCard('Total', app.total, `across ${app.days} days`, true)
    + statCard('Opens', app.opensTotal, 'times brought to the foreground')
    + statCard('Typical session', visit * 0.86, 'median, not mean', true)
    + statCard('Longest', visit * 3.8, 'single unbroken session', true);
  document.getElementById('v-app').innerHTML =
    callout(m === 'time' ? 'Heaviest day' : 'Most opens', fmtDay(days[peakI].date), fmtV(vals[peakI])) +
    bars(vals, days.map((x) => fmtDay(x.date)), {
      axis: m === 'time' ? timeAxis(vals[peakI]) : countAxis(vals[peakI]),
      fmtV, every: 3, tipLabel: (i) => fmtDayLong(days[i].date),
      aria: `${app.name}, ${m === 'time' ? 'time' : 'opens'} per day over ${span} days`,
    });
}

let showAll = false;
function drawTable(d) {
  // lib/app-list.ts: 10 minutes or more, OR 30+ opens across 5+ days.
  const listed = (a) => a.total >= 10 * MIN || (a.opensTotal >= 30 && a.days >= 5);
  const all = d.apps.filter((a) => a.total > 0);
  const main = all.filter(listed);
  const folded = all.filter((a) => !listed(a));
  const rows = showAll ? all : main;
  const body = rows.map((a) => `<tr><td><span class="app-cell"><span class="initial" style="${a.color ? `color:${ink(a.color)}` : ''}">${esc(a.name[0])}</span>${esc(a.name)}${a.kind ? ` <span class="badge">${a.kind}</span>` : ''}</span></td>
      <td class="num">${dur(a.total)}</td><td class="num">${pct(a.total / d.appsTotal)}</td><td class="num">${count(a.opensTotal)}</td><td class="num">${a.days}</td></tr>`).join('');
  const foldTime = folded.reduce((s, a) => s + a.total, 0);
  const el = document.getElementById('v-table');
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>App</th><th class="num">Time</th><th class="num">Share</th><th class="num">Opens</th><th class="num">Days</th></tr></thead><tbody>${body}</tbody></table></div>`
    + (folded.length ? `<div class="fold"><button type="button" class="mini-btn" id="fold-btn">${showAll ? 'Show fewer apps' : `Show all ${all.length} apps`}</button>
       <span>${showAll ? '' : `${folded.length} more, ${dur(foldTime)} between them, below the bar for a row of their own.`}</span></div>` : '');
  const btn = el.querySelector('#fold-btn');
  if (btn) btn.onclick = () => { showAll = !showAll; drawTable(d); };
}

let device = 'windows';
function drawAll() {
  const d = DATA[device];
  ['stack', 'hour', 'top', 'app'].forEach(wireMeasure);
  drawStats(d); drawTrend(d); drawHeat(d, false); drawStack(d); drawHour(d);
  drawWhere(d); drawTop(d); drawApp(d); drawTable(d);
}

/* ------------------------------------------------------------------ wiring */

function wireTooltip() {
  const tip = document.getElementById('tip');
  const hide = () => { tip.hidden = true; };
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return hide();
    tip.innerHTML = t.getAttribute('data-tip');
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + 14, top = e.clientY + 14;
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  });
  document.addEventListener('scroll', hide, { passive: true });
}

/* The tour: one device, one page. `npm run demo:shots` writes each twice, from one seed: dark, and `-light`. */
const tour = { device: 'laptop', page: '1-overview' };

function shotSrc() {
  const light = document.documentElement.dataset.theme === 'light' ? '-light' : '';
  return `screenshots/tour/${tour.device}-${tour.page}${light}.png`;
}

function showShot() {
  document.querySelectorAll('[data-tour-device]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tourDevice === tour.device)));
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === tour.page)));
  const img = document.getElementById('shot-img');
  img.src = shotSrc();
  const page = document.querySelector(`.tabs [data-page="${tour.page}"]`).textContent;
  img.alt = `The ${tour.device}'s ${page} page, full height`;
  document.querySelector('.shot-scroll').scrollTop = 0;
  // The phone's pages are in the phone's accent; the controls follow it.
  document.getElementById('tour').dataset.device = tour.device === 'phone' ? 'android' : 'windows';
}

/** The heat-map ramp and the screenshots are per theme; nothing else needs redrawing. */
function retheme() {
  drawAll();
  document.getElementById('shot-img').src = shotSrc();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private window: still switches */ }
    retheme();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!storedTheme()) { applyTheme(systemTheme()); retheme(); }
  });

  document.querySelectorAll('[data-tour-device]').forEach((b) => b.addEventListener('click', () => { tour.device = b.dataset.tourDevice; showShot(); }));
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => b.addEventListener('click', () => { tour.page = b.dataset.page; showShot(); }));
  showShot();

  const pickDevice = (b) => {
    device = b.dataset.device;
    document.querySelectorAll('.charts-head [role="radio"]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    document.getElementById('gallery').dataset.device = device;
  };
  document.querySelectorAll('.charts-head [role="radio"]').forEach((b) => b.addEventListener('click', () => { pickDevice(b); drawAll(); }));
  // ?device=android opens the gallery on the phone, so either view can be linked.
  if (new URLSearchParams(location.search).get('device') === 'android') {
    pickDevice(document.querySelector('.charts-head [data-device="android"]'));
  }

  document.getElementById('gallery').addEventListener('click', (e) => {
    if (!e.target.closest('[data-open="detail"]')) return;
    tour.device = device === 'android' ? 'phone' : 'laptop';
    tour.page = '3-app-detail';
    showShot();
    document.getElementById('tour').scrollIntoView();
  });

  wireTooltip();
  drawAll();
});
