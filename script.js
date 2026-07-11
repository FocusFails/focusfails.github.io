// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG — set USE_DUMMY_DATA = false and fill API
// credentials to connect to your real Google Sheet
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const USE_DUMMY_DATA = false;
const SHEET_ID       = '1yHCFV1fmjpgpk1ffSCr6_roEKPYU7SAhqUbqmE7oIa0';
const API_KEY        = 'AIzaSyBfk_bLcO2NilYhCoz-oJxmonlR7AlAkQA';

// ─── Runtime config — populated by fetchConfig() on startup.
//     All deployment-specific values (plant name, unit names,
//     capacities, contract periods) live in the Google Sheet
//     "Config Sheet" tab and are loaded fresh each refresh.
//     Nothing about a specific plant is hardcoded here.
let RUNTIME_CFG = {
  plantName:       'GEN Monitor',
  unit1Name:       'Unit 1 — Generator',
  unit2Name:       'Unit 2 — Generator',
  unit1MaxAbsKw:   9999,   // hardware nameplate ceiling (arc never overflows)
  unit2MaxAbsKw:   9999,
  periods:         [],     // [{month, startDay, endDay, contractKwh, maxPerGenKw}]
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function doLogin() {
  const u = document.getElementById('l-user').value.trim();
  const p = document.getElementById('l-pass').value;
  if (u === 'admin' && p === '@dm!n') {
    sessionStorage.setItem('auth', '1');
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    initDashboard();
  } else {
    const el = document.getElementById('l-err');
    el.textContent = '[ ACCESS DENIED ] Invalid credentials';
    setTimeout(() => { el.textContent = ''; }, 3200);
    document.getElementById('l-pass').value = '';
    document.getElementById('l-pass').focus();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const ls = document.getElementById('login-screen');
    if (ls.style.display !== 'none') doLogin();
  }
});

window.addEventListener('load', () => {
  if (sessionStorage.getItem('auth') === '1') {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    initDashboard();
  }
  document.getElementById('data-src-badge').textContent =
    USE_DUMMY_DATA ? 'DEMO' : 'LIVE';
  document.getElementById('data-src-badge').style.borderColor =
    USE_DUMMY_DATA ? 'rgba(255,170,0,0.2)' : 'rgba(0,229,160,0.2)';
  document.getElementById('data-src-badge').style.color =
    USE_DUMMY_DATA ? 'var(--amber)' : 'var(--green)';
  document.getElementById('data-src-badge').style.background =
    USE_DUMMY_DATA ? 'rgba(255,170,0,0.08)' : 'rgba(0,229,160,0.08)';
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DUMMY DATA GENERATOR
// Produces realistic 5-min readings for the current
// session. P2 offline 02:00–04:00 (maintenance demo).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateDummyData() {
  const rows = [];
  const pad = n => String(n).padStart(2, '0');

  // Month-start anchor (Jestha 1, 2083) — establishes monthly baseline
  rows.push({
    timestamp: '2026-05-14 00:00:00',
    nepaliYear: 2083, nepaliMonth: 'Jestha', nepaliDay: 1,
    p1: 1350, p2: 1200, e1: 5200000, e2: 4700000
  });

  // Today = Jestha 24, 2083 (June 7/8 2026 in Gregorian)
  const now = new Date();
  const midnight = new Date(now); midnight.setHours(0,0,0,0);
  const slots = Math.floor((now - midnight) / 300000); // 5-min slots

  let e1 = 5420000, e2 = 4870000;

  for (let i = 0; i <= slots; i++) {
    const t = new Date(midnight.getTime() + i * 300000);
    const h = t.getHours() + t.getMinutes() / 60;
    const rnd = () => (Math.random() - 0.5);

    // Simulate maintenance window 02:00–04:00 on Unit 2
    const u2off = h >= 2 && h < 4;

    const p1 = Math.max(0, Math.round(1348 + rnd() * 28 + Math.sin(h * 0.4) * 15));
    const p2 = u2off ? 0 : Math.max(0, Math.round(1193 + rnd() * 24 + Math.sin(h * 0.3 + 1) * 12));

    e1 += Math.round(p1 * 5 / 60);
    e2 += Math.round(p2 * 5 / 60);

    const ts = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())} `
             + `${pad(t.getHours())}:${pad(t.getMinutes())}:00`;

    rows.push({
      timestamp: ts,
      nepaliYear: 2083, nepaliMonth: 'Jestha', nepaliDay: 24,
      p1, p2, e1, e2
    });
  }
  return rows;
}

function getDummyRemarks() {
  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  const key = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  return [
    {
      date: key,
      remark: 'Unit 2 offline 02:00–04:00 for scheduled penstock valve maintenance. Normal operation confirmed at 04:08. No generation impact to daily target.'
    }
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SHEETS API FETCH (live mode)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchRange(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`
            + `/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body.slice(0,120)}`);
  }
  return (await res.json()).values || [];
}

async function fetchAllData() {
  if (USE_DUMMY_DATA) {
    return { rows: generateDummyData(), remarks: getDummyRemarks(), cfg: getDummyConfig() };
  }

  // Config is cached in sessionStorage — it never changes mid-session.
  // This saves one API call per refresh and helps avoid quota limits.
  let cfg;
  const cachedCfg = sessionStorage.getItem('_cfg');
  if (cachedCfg) {
    try { cfg = JSON.parse(cachedCfg); } catch { cfg = null; }
  }

  const fetches = [
    fetchRange('Raw Data Sheet!A2:H'),
    fetchRange('Remarks Sheet!A2:B'),
  ];
  if (!cfg) fetches.push(fetchRange('Config Sheet!A1:E50'));

  const results = await Promise.all(fetches);
  const [dataRaw, rmkRaw, cfgRaw] = cfg
    ? [results[0], results[1], null]
    : [results[0], results[1], results[2]];

  if (!cfg) {
    cfg = parseConfig(cfgRaw);
    sessionStorage.setItem('_cfg', JSON.stringify(cfg));
  }

  const rows = dataRaw
    .filter(r => r && r.length >= 1 && r[0])   // just needs a timestamp — trailing blank
                                                // cells (e.g. slave 2 offline) get trimmed
                                                // by the Sheets API and must not drop the row
    .map(r => {
      const isBlank = v => v === undefined || v === null || String(v).trim() === '';
      return {
        timestamp:   r[0] || '',
        nepaliYear:  parseInt(r[1])  || 0,
        nepaliMonth: (r[2] || '').trim(),
        nepaliDay:   parseInt(r[3])  || 0,
        p1: parseFloat(r[4]) || 0,
        p2: parseFloat(r[5]) || 0,
        e1: parseFloat(r[6]) || 0,
        e2: parseFloat(r[7]) || 0,
        p1Missing: isBlank(r[4]),
        p2Missing: isBlank(r[5]),
        e1Missing: isBlank(r[6]),
        e2Missing: isBlank(r[7]),
      };
    });

  const remarks = rmkRaw
    .filter(r => r.length >= 2)
    .map(r => ({ date: (r[0]||'').trim(), remark: (r[1]||'').trim() }));

  return { rows, remarks, cfg };
}

// ── Parse the Config sheet into RUNTIME_CFG
// Block 1: key-value pairs until blank row
// Block 2: contract periods table (header row then data rows)
function parseConfig(raw) {
  const result = {
    plantName:     'GEN Monitor',
    unit1Name:     'Unit 1 — Generator',
    unit2Name:     'Unit 2 — Generator',
    unit1MaxAbsKw: 9999,
    unit2MaxAbsKw: 9999,
    periods:       [],
  };

  let inPeriods = false;
  let periodHeaderFound = false;

  for (const row of raw) {
    // Skip genuinely empty rows — they act as block separators
    if (!row || row.every(c => !c || String(c).trim() === '')) {
      // Once we pass the blank row, next non-empty row is the periods header
      if (!inPeriods && result.plantName !== 'GEN Monitor' ||
          result.unit1Name !== 'Unit 1 — Generator') {
        inPeriods = true;
      }
      continue;
    }

    const c0 = String(row[0] || '').trim().toLowerCase();

    // Detect period table header row
    if (c0 === 'nepali_month' || c0 === 'nepali month') {
      inPeriods = true;
      periodHeaderFound = true;
      continue;
    }

    if (!inPeriods) {
      // Key-value block
      const key = c0;
      const val = String(row[1] || '').trim();
      if (key === 'plant_name')            result.plantName     = val;
      if (key === 'unit1_name')            result.unit1Name     = val;
      if (key === 'unit2_name')            result.unit2Name     = val;
      if (key === 'unit1_max_absolute_kw') result.unit1MaxAbsKw = parseFloat(val) || 9999;
      if (key === 'unit2_max_absolute_kw') result.unit2MaxAbsKw = parseFloat(val) || 9999;
    } else if (periodHeaderFound) {
      // Period data row: nepali_month | period_start_day | period_end_day | contract_kwh | max_per_gen_kw
      if (row.length < 5) continue;
      result.periods.push({
        month:        String(row[0]).trim(),
        startDay:     parseInt(row[1]) || 1,
        endDay:       parseInt(row[2]) || 32,
        contractKwh:  parseFloat(row[3]) || 0,
        maxPerGenKw:  parseFloat(row[4]) || 9999,
      });
    }
  }

  return result;
}

// ── Find the contract period that covers a given month + day
function findPeriod(cfg, month, day) {
  return cfg.periods.find(p =>
    p.month === month && day >= p.startDay && day <= p.endDay
  ) || null;
}

// ── Dummy config mirrors the real Config Sheet exactly
function getDummyConfig() {
  return {
    plantName:     'Marsyangdi HPP',
    unit1Name:     'Unit 1 — Generator',
    unit2Name:     'Unit 2 — Generator',
    unit1MaxAbsKw: 3751,
    unit2MaxAbsKw: 3751,
    periods: [
      { month: 'Baisakh',  startDay:  1, endDay: 31, contractKwh: 2141242, maxPerGenKw: 1683 },
      { month: 'Jestha',   startDay:  1, endDay: 15, contractKwh: 1973288, maxPerGenKw: 3205 },
      { month: 'Jestha',   startDay: 16, endDay: 31, contractKwh: 2104840, maxPerGenKw: 3205 },
      { month: 'Asadh',    startDay:  1, endDay: 32, contractKwh: 4926113, maxPerGenKw: 3751 },
      { month: 'Shrawan',  startDay:  1, endDay: 31, contractKwh: 4772172, maxPerGenKw: 3751 },
      { month: 'Bhadra',   startDay:  1, endDay: 31, contractKwh: 4772172, maxPerGenKw: 3751 },
      { month: 'Ashwin',   startDay:  1, endDay: 31, contractKwh: 4772172, maxPerGenKw: 3751 },
      { month: 'Kartik',   startDay:  1, endDay: 30, contractKwh: 4618231, maxPerGenKw: 3751 },
      { month: 'Mangsir',  startDay:  1, endDay: 15, contractKwh: 1704756, maxPerGenKw: 2769 },
      { month: 'Mangsir',  startDay: 16, endDay: 29, contractKwh: 1591105, maxPerGenKw: 2769 },
      { month: 'Poush',    startDay:  1, endDay: 30, contractKwh: 2408210, maxPerGenKw: 1956 },
      { month: 'Magh',     startDay:  1, endDay: 29, contractKwh: 1799647, maxPerGenKw: 1512 },
      { month: 'Falgun',   startDay:  1, endDay: 30, contractKwh: 1777426, maxPerGenKw: 1444 },
      { month: 'Chaitra',  startDay:  1, endDay: 30, contractKwh: 1650901, maxPerGenKw: 1341 },
    ],
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RING UPDATER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function updateRing(n, power, maxPower, energy, missing) {
  const running = !missing && power > 0;
  const card    = document.getElementById(`u${n}-card`);
  const badge   = document.getElementById(`u${n}-badge`);
  const arc     = document.getElementById(`u${n}-arc`);
  const scanner = document.getElementById(`u${n}-scanner`);
  const valEl   = document.getElementById(`u${n}-val`);
  const pctEl   = document.getElementById(`u${n}-pct`);
  const engEl   = document.getElementById(`u${n}-energy`);

  // Card state
  card.classList.toggle('running', running);
  card.classList.toggle('stopped', !running && !missing);
  card.classList.toggle('nodata', missing);
  badge.className = `unit-badge ${missing ? 'nodata' : (running ? 'running' : 'stopped')}`;
  badge.textContent = missing ? 'NO DATA' : (running ? 'RUNNING' : 'STOPPED');

  // Arc geometry  (r=68, circ≈427.26)
  const circ = 2 * Math.PI * 68;
  const pct  = missing ? 0 : Math.min(Math.max(power / maxPower, 0), 1);
  const fill = pct * circ;

  const color = missing ? '#ff8c00' : (running ? '#00e5a0' : '#ff4444');
  arc.setAttribute('stroke', color);
  arc.setAttribute('stroke-dasharray', `${fill.toFixed(2)} ${(circ-fill).toFixed(2)}`);
  arc.style.filter = running
    ? `drop-shadow(0 0 7px ${color}) drop-shadow(0 0 3px ${color})`
    : 'none';
  scanner.setAttribute('stroke', color);

  // Center text — X when the column is blank (comms failure), a real number otherwise
  valEl.textContent = missing ? 'X' : power.toLocaleString();
  valEl.setAttribute('fill', missing ? '#ff8c00' : (running ? '#bdd0e0' : '#ff4444'));
  pctEl.textContent = missing ? '—' : `${(pct*100).toFixed(1)}%`;
  pctEl.setAttribute('fill', missing ? '#ff8c00' : (running ? '#4a6278' : '#ff4444'));

  // Energy
  engEl.textContent = missing ? 'X' : energy.toLocaleString();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MONTHLY PROGRESS
// Uses the fetched config to find the correct period
// for the current month + day, then calculates energy
// generated since that period's start day.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function updateProgress(rows, month, year, day, cfg) {
  const period = findPeriod(cfg, month, day);
  if (!period) return;

  // All rows for this month and year, from the period's start day onward
  const periodRows = rows.filter(r =>
    r.nepaliMonth === month &&
    r.nepaliYear  === year  &&
    r.nepaliDay   >= period.startDay &&
    r.nepaliDay   <= period.endDay
  );
  if (!periodRows.length) return;

  const first   = periodRows[0];
  const last    = periodRows[periodRows.length - 1];

  // Energy generated = delta of cumulative counters since period start
  const genKwh  = (last.e1 - first.e1) + (last.e2 - first.e2);
  const target  = period.contractKwh;
  const pct     = target > 0 ? (genKwh / target * 100) : 0;

  // Days elapsed in this period (at least 1 to avoid division by zero)
  const daysDone  = Math.max(last.nepaliDay - period.startDay + 1, 1);
  const dailyAvg  = genKwh / daysDone;

  // Project to end of period
  const periodDays = period.endDay - period.startDay + 1;
  const proj       = dailyAvg * periodDays;

  const fmt = v => {
    if (v >= 1e6) return `${(v/1e6).toFixed(3)} MWh`;
    return `${Math.round(v).toLocaleString()} kWh`;
  };

  // Period label: if split month show day range, else just month
  const isSplit = cfg.periods.filter(p => p.month === month).length > 1;
  const periodLabel = isSplit
    ? `${month} ${period.startDay}–${period.endDay}  ${year} BS`
    : `${month}  ${year} BS`;

  document.getElementById('pp-month').textContent     = periodLabel;
  document.getElementById('pp-fill').style.width      = `${Math.min(pct, 100).toFixed(1)}%`;
  document.getElementById('pp-pct').textContent       = `${pct.toFixed(1)}%`;
  document.getElementById('pp-target-ax').textContent = `${(target/1e6).toFixed(2)} MWh`;
  document.getElementById('st-gen').textContent       = fmt(genKwh);
  document.getElementById('st-target').textContent    = fmt(target);
  document.getElementById('st-avg').textContent       = fmt(dailyAvg) + ' /day';

  const projEl = document.getElementById('st-proj');
  projEl.textContent = fmt(proj);
  projEl.className   = `st-val ${proj >= target ? 'g' : 'w'}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTICES  (ops remarks + comms-failure warnings)
// Re-evaluated on every refresh (not just page load) so a remark added
// or a comms fault appearing mid-session shows up on the next auto-refresh.
// A dismissed notice won't reappear on its own — only a *new* or *changed*
// notice (different key) reopens the banner.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let _lastBannerKey = null;

function applyNotices(remarks, u1Missing, u2Missing) {
  const banner  = document.getElementById('rmk-banner');
  const labelEl = banner.querySelector('.remark-label');
  const msgEl   = document.getElementById('rmk-msg');

  const missingUnits = [];
  if (u1Missing) missingUnits.push(1);
  if (u2Missing) missingUnits.push(2);

  let label, msg, bannerKey, isWarning = false;

  if (missingUnits.length) {
    // Comms failure takes priority over an ops remark
    isWarning = true;
    label = 'Comms Warning';
    msg = missingUnits.length === 2
      ? 'Data from Slave 1 and Slave 2 is not being read. Check meter wiring and power.'
      : `Data from Slave ${missingUnits[0]} is not being read. Check meter wiring and power.`;
    bannerKey = `warn:${missingUnits.join(',')}`;
  } else {
    const today = new Date();
    const pad   = n => String(n).padStart(2,'0');
    const key   = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
    const hit   = remarks.find(r => r.date === key);
    if (hit && hit.remark) {
      label = 'Ops Notice';
      msg = hit.remark;
      bannerKey = `remark:${key}:${hit.remark}`;
    }
  }

  if (!bannerKey) {
    // Nothing active right now — clear tracking so a future notice always shows
    _lastBannerKey = null;
    banner.classList.remove('show');
    return;
  }

  if (bannerKey !== _lastBannerKey) {
    labelEl.textContent = label;
    msgEl.textContent   = msg;
    banner.classList.toggle('warning', isWarning);
    banner.classList.add('show');
    _lastBannerKey = bannerKey;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHART
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let chart = null;

function buildChart() {
  const ctx = document.getElementById('pwr-chart').getContext('2d');
  Chart.defaults.color = '#4a6278';

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Unit 1',
          data: [], borderColor: '#00e5a0',
          backgroundColor: 'rgba(0,229,160,0.04)',
          borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3,
          tension: 0.35, fill: false,
        },
        {
          label: 'Unit 2',
          data: [], borderColor: '#ff8c00',
          backgroundColor: 'rgba(255,140,0,0.04)',
          borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3,
          tension: 0.35, fill: false,
        },
        {
          label: 'Total',
          data: [], borderColor: '#0099ff',
          backgroundColor: 'rgba(0,153,255,0.06)',
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
          tension: 0.35, fill: true,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d1117',
          borderColor: '#1c2a38',
          borderWidth: 1,
          titleColor: '#4a6278',
          bodyColor: '#bdd0e0',
          titleFont: { family: 'Share Tech Mono', size: 10 },
          bodyFont:  { family: 'Share Tech Mono', size: 11 },
          padding: 10,
          callbacks: {
            label: ctx =>
              `  ${ctx.dataset.label.padEnd(6)}: ${ctx.parsed.y.toLocaleString()} kW`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(28,42,56,0.8)' },
          border: { color: '#1c2a38' },
          ticks: {
            font: { family: 'Share Tech Mono', size: 9 },
            maxTicksLimit: 13, maxRotation: 0,
          }
        },
        y: {
          grid: { color: 'rgba(28,42,56,0.8)' },
          border: { color: '#1c2a38' },
          ticks: {
            font: { family: 'Share Tech Mono', size: 9 },
            callback: v => v.toLocaleString(),
          },
          min: 0,
        }
      }
    }
  });
}

function updateChart(rows) {
  if (!chart || !rows.length) return;

  // Chart shows ONLY today's Gregorian date, 00:00–24:00.
  // We match on the timestamp date string (YYYY-MM-DD) so we never
  // accidentally bleed yesterday's or tomorrow's rows into the chart.
  const todayStr = (() => {
    const n = new Date();
    const p = v => String(v).padStart(2, '0');
    return `${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())}`;
  })();

  const todayRs = rows.filter(r => r.timestamp.startsWith(todayStr));

  // Format time as H:MM (0:00 to 24:00 — no zero-padding on hour)
  const fmtTime = ts => {
    const m = ts.match(/(\d{1,2}):(\d{2})/);
    if (!m) return ts.slice(11, 16);
    return `${parseInt(m[1], 10)}:${m[2]}`;   // "0:00", "12:00", "23:55"
  };

  chart.data.labels           = todayRs.map(r => fmtTime(r.timestamp));
  chart.data.datasets[0].data = todayRs.map(r => r.p1);
  chart.data.datasets[1].data = todayRs.map(r => r.p2);
  chart.data.datasets[2].data = todayRs.map(r => r.p1 + r.p2);
  chart.update();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN REFRESH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function refreshData() {
  setSbText('FETCHING DATA…');
  try {
    const { rows, remarks, cfg } = await fetchAllData();
    if (!rows.length) { setSbText('NO DATA'); return; }

    // Apply plant name from config to header and login screen
    document.getElementById('hdr-name-text').textContent  = cfg.plantName;
    document.getElementById('login-plant-text').textContent = cfg.plantName;

    // Apply unit names to cards
    document.getElementById('u1-name-text').textContent = cfg.unit1Name;
    document.getElementById('u2-name-text').textContent = cfg.unit2Name;

    const latest = rows[rows.length - 1];

    // Find current period for maxPerGen — capped by hardware nameplate
    const period = findPeriod(cfg, latest.nepaliMonth, latest.nepaliDay);
    const maxPer1 = Math.min(period ? period.maxPerGenKw : 9999, cfg.unit1MaxAbsKw);
    const maxPer2 = Math.min(period ? period.maxPerGenKw : 9999, cfg.unit2MaxAbsKw);

    // Rings
    const u1Missing = latest.p1Missing || latest.e1Missing;
    const u2Missing = latest.p2Missing || latest.e2Missing;
    updateRing(1, latest.p1, maxPer1, latest.e1, u1Missing);
    updateRing(2, latest.p2, maxPer2, latest.e2, u2Missing);

    // Total panel
    const mwhFmt = v => `${(v/1e6).toFixed(3)} MWh`;
    document.getElementById('tc-power').textContent    = (u1Missing || u2Missing)
      ? 'X' : (latest.p1 + latest.p2).toLocaleString();
    document.getElementById('tc-e1').textContent       = u1Missing ? 'X' : mwhFmt(latest.e1);
    document.getElementById('tc-e2').textContent       = u2Missing ? 'X' : mwhFmt(latest.e2);
    document.getElementById('tc-combined').textContent = (u1Missing || u2Missing)
      ? 'X' : mwhFmt(latest.e1 + latest.e2);

    // Chart — today's data, 00:00 to 24:00 only
    updateChart(rows);

    // Progress — period-aware
    updateProgress(rows, latest.nepaliMonth, latest.nepaliYear, latest.nepaliDay, cfg);

    // Notices — re-evaluated every refresh so new remarks and comms
    // failures both surface without needing a full page reload
    applyNotices(remarks, u1Missing, u2Missing);

    // Status bar
    document.getElementById('sb-date').textContent =
      `${latest.nepaliMonth} ${latest.nepaliDay}, ${latest.nepaliYear} BS`;
    const runCount = [
      !u1Missing && latest.p1 > 0,
      !u2Missing && latest.p2 > 0,
    ].filter(Boolean).length;
    document.getElementById('sb-units').textContent = `RUNNING: ${runCount}/2`;

    // Last-updated timestamp
    const n   = new Date();
    const pad = v => String(v).padStart(2, '0');
    document.getElementById('upd-time').textContent =
      `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;

    setSbText('SYSTEM ACTIVE');
  } catch (err) {
    console.error(err);
    setSbText(`ERROR — ${err.message.slice(0,80)}`);
  }
}

function setSbText(t) {
  document.getElementById('sb-txt').textContent = t;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REFRESH BUTTON COOLDOWN
// Prevents hammering the API — 30 second lockout
// after each manual refresh. Shows countdown in button.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const REFRESH_COOLDOWN_S = 30;
let _refreshCooldownTimer = null;

function manualRefresh() {
  const btn = document.getElementById('hdr-refresh-btn');
  if (btn.disabled) return;

  refreshData();

  // Lock button for REFRESH_COOLDOWN_S seconds
  btn.disabled = true;
  let remaining = REFRESH_COOLDOWN_S;

  const tick = () => {
    btn.textContent = `REFRESH (${remaining}s)`;
    if (remaining <= 0) {
      btn.disabled = false;
      btn.textContent = 'REFRESH';
      clearInterval(_refreshCooldownTimer);
      _refreshCooldownTimer = null;
      return;
    }
    remaining--;
  };
  tick();
  _refreshCooldownTimer = setInterval(tick, 1000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initDashboard() {
  buildChart();
  refreshData();
  setInterval(refreshData, 5 * 60 * 1000); // 5-minute auto-refresh
}

// ── PWA: Register Service Worker ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] Registered, scope:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}
