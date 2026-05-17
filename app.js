/* ═══════════════════════════════════════════════════════════
   Estudos Concurso — PWA com sincronização via Firebase
   ─────────────────────────────────────────────────────────── */

// ── Firebase SDK (modular CDN) ─────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  collection, query, orderBy, onSnapshot, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// ── Firebase config ─────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDdVRkMdH4ijDCq_NOh1zeGr0G8uBhrtXc",
  authDomain: "estudos-concursos-diego.firebaseapp.com",
  projectId: "estudos-concursos-diego",
  storageBucket: "estudos-concursos-diego.firebasestorage.app",
  messagingSenderId: "576202326573",
  appId: "1:576202326573:web:8365bca49bcf8266862ea4",
  measurementId: "G-8YT372TT87"
};

const fbApp = initializeApp(firebaseConfig);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(fbApp);

// ── Constants ──────────────────────────────────────────────
// SM-2 markers: D+7, D+15, e D+30 a D+540 (de 30 em 30 dias) = 20 marcos
const MARKERS = [7, 15].concat(Array.from({length: 18}, (_, i) => 30 + i * 30));
const FASE_LEITURA = '📖 Leitura';
const FASE_QUESTOES = '❓ Questões';
const FASE_REVISAO = (n) => `🔄 D+${n}`;
const ALL_FASES = [FASE_LEITURA, FASE_QUESTOES, ...MARKERS.map(FASE_REVISAO)];

// ═══════════════════════════════════════════════════════════
// Auth state
// ═══════════════════════════════════════════════════════════
let currentUser = null;
let unsubscribers = []; // active onSnapshot listeners

function userCol(store) {
  return collection(db, 'users', currentUser.uid, store);
}

function userDoc(store, id) {
  return doc(db, 'users', currentUser.uid, store, String(id));
}

// ═══════════════════════════════════════════════════════════
// Firestore wrappers (compatible API with old IndexedDB layer)
// ═══════════════════════════════════════════════════════════
async function dbGet(store, key) {
  const snap = await getDoc(userDoc(store, key));
  return snap.exists() ? { ...snap.data(), id: snap.id } : null;
}

async function dbGetAll(store) {
  const snap = await getDocs(userCol(store));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

// dbPut behavior depends on the store's primary key:
//   - config: keyPath='key'      → use `value.key` as doc id
//   - matters: auto-increment    → if `value.id` exists, update; else add
//   - log: auto-increment        → same as matters
//   - folgas: keyPath='data'     → use `value.data` as doc id
async function dbPut(store, value) {
  if (store === 'config') {
    const { key, ...rest } = value;
    await setDoc(userDoc(store, key), rest);
    return key;
  }
  if (store === 'folgas') {
    await setDoc(userDoc(store, value.data), value);
    return value.data;
  }
  // log or matters
  if (value.id) {
    const { id, ...rest } = value;
    await setDoc(userDoc(store, id), rest);
    return id;
  }
  const docRef = await addDoc(userCol(store), {
    ...value,
    createdAt: Date.now()
  });
  return docRef.id;
}

async function dbDelete(store, key) {
  await deleteDoc(userDoc(store, key));
}

async function dbClear(store) {
  const snap = await getDocs(userCol(store));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// ═══════════════════════════════════════════════════════════
// Config helpers
// ═══════════════════════════════════════════════════════════
async function getConfig(key, defaultVal) {
  const row = await dbGet('config', key);
  return row ? row.value : defaultVal;
}

async function setConfig(key, value) {
  return dbPut('config', { key, value });
}

async function initIfFirstRun() {
  const inicio = await getConfig('inicio', null);
  if (!inicio) {
    const today = new Date();
    await setConfig('inicio', toISO(today));
    await setConfig('schedule', { 0: 2.5, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 2.5 });
    await setConfig('notif_time', '08:00');
    await setConfig('notif_enabled', false);

    const defaults = [
      { name: 'Português', total: 16 },
      { name: 'RLM', total: 20 },
      { name: 'Contabilidade', total: 22 },
      { name: 'Dir. Constitucional', total: 17 },
      { name: 'Dir. Administrativo', total: 15 },
      { name: 'Dir. Tributário', total: 21 },
    ];
    for (const m of defaults) await dbPut('matters', m);
  }
}

// ═══════════════════════════════════════════════════════════
// Date helpers (no time zone confusion)
// ═══════════════════════════════════════════════════════════
function toISO(d) {
  if (typeof d === 'string') return d;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayISO() {
  return toISO(new Date());
}

function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function diffDays(a, b) {
  const da = fromISO(a);
  const db = fromISO(b);
  return Math.round((da - db) / 86400000);
}

function fmtBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function fmtBRFull(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function dayOfWeek(iso) {
  return fromISO(iso).getDay();
}

function dayName(iso) {
  return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][dayOfWeek(iso)];
}

function startOfWeekISO(iso) {
  const d = fromISO(iso);
  const dow = d.getDay();
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

function startOfMonthISO(iso) {
  const d = fromISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

function endOfMonthISO(iso) {
  const d = fromISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

// ═══════════════════════════════════════════════════════════
// Business logic — derive state from Log
// ═══════════════════════════════════════════════════════════

async function loadAll() {
  return {
    config: {
      inicio: await getConfig('inicio', todayISO()),
      schedule: await getConfig('schedule', {0:2.5,1:4,2:4,3:4,4:4,5:4,6:2.5}),
    },
    matters: await dbGetAll('matters'),
    log: await dbGetAll('log'),
    folgas: await dbGetAll('folgas'),
  };
}

function metaForDay(iso, schedule, folgas) {
  if (folgas.some(f => f.data === iso)) return 0;
  return schedule[dayOfWeek(iso)] || 0;
}

function hoursForDay(iso, log) {
  return log
    .filter(e => e.data === iso)
    .reduce((sum, e) => sum + (e.tempo || 0), 0) / 60;
}

function getAulasCompletas(log) {
  const aulas = new Map();
  for (const e of log) {
    if (e.fase === FASE_QUESTOES) {
      const key = `${e.matter}|${e.aula}`;
      if (!aulas.has(key)) {
        aulas.set(key, { matter: e.matter, aula: e.aula, dataInicio: e.data });
      } else {
        const existing = aulas.get(key);
        if (e.data < existing.dataInicio) existing.dataInicio = e.data;
      }
    }
  }
  return Array.from(aulas.values());
}

function getMarkerStates(aula, log, today) {
  return MARKERS.map(off => {
    const date = addDays(aula.dataInicio, off);
    const fase = FASE_REVISAO(off);
    const isDone = log.some(e =>
      e.matter === aula.matter && e.aula === aula.aula && e.fase === fase
    );
    let state;
    if (isDone) state = 'done';
    else if (date < today) state = 'overdue';
    else if (date === today) state = 'today';
    else state = 'future';
    return { off, date, fase, state };
  });
}

function getAulaStatus(markers) {
  const allDone = markers.every(m => m.state === 'done');
  if (allDone) return 'concluida';
  const hasOverdue = markers.some(m => m.state === 'overdue');
  if (hasOverdue) return 'atrasada';
  const anyDone = markers.some(m => m.state === 'done');
  if (anyDone) return 'em-revisao';
  return 'nova';
}

function getProxData(markers) {
  const next = markers.find(m => m.state !== 'done');
  return next ? next.date : null;
}

function getAllOverdue(data) {
  const aulas = getAulasCompletas(data.log);
  const today = todayISO();
  const overdue = [];
  for (const aula of aulas) {
    const markers = getMarkerStates(aula, data.log, today);
    for (const m of markers) {
      if (m.state === 'overdue') {
        overdue.push({
          matter: aula.matter,
          aula: aula.aula,
          dataInicio: aula.dataInicio,
          off: m.off,
          date: m.date,
          dias: diffDays(today, m.date),
        });
      }
    }
  }
  overdue.sort((a, b) => b.dias - a.dias);
  return overdue;
}

function getFazerHoje(data) {
  const aulas = getAulasCompletas(data.log);
  const today = todayISO();
  const items = [];
  for (const aula of aulas) {
    const markers = getMarkerStates(aula, data.log, today);
    for (const m of markers) {
      if (m.state === 'overdue' || m.state === 'today') {
        items.push({
          matter: aula.matter,
          aula: aula.aula,
          dataInicio: aula.dataInicio,
          off: m.off,
          date: m.date,
          state: m.state,
          dias: m.state === 'overdue' ? diffDays(today, m.date) : 0,
        });
      }
    }
  }
  items.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'overdue' ? -1 : 1;
    return b.dias - a.dias;
  });
  return items;
}

function getStreak(data) {
  const today = todayISO();
  let streak = 0;
  let cursor = today;
  while (true) {
    const meta = metaForDay(cursor, data.config.schedule, data.folgas);
    const horas = hoursForDay(cursor, data.log);
    if (meta === 0) {
      cursor = addDays(cursor, -1);
      if (cursor < data.config.inicio) break;
      continue;
    }
    if (horas >= meta) {
      streak++;
      cursor = addDays(cursor, -1);
      if (cursor < data.config.inicio) break;
    } else {
      break;
    }
  }
  return streak;
}

function getAdesao(data) {
  const today = todayISO();
  let attempted = 0, hit = 0;
  let cursor = data.config.inicio;
  while (cursor <= today) {
    const meta = metaForDay(cursor, data.config.schedule, data.folgas);
    if (meta > 0) {
      attempted++;
      if (hoursForDay(cursor, data.log) >= meta) hit++;
    }
    cursor = addDays(cursor, 1);
  }
  return attempted === 0 ? 0 : hit / attempted;
}

function getMetaSemanal(data) {
  const today = todayISO();
  const weekStart = startOfWeekISO(today);
  let horas = 0, meta = 0;
  let cursor = weekStart;
  while (cursor <= today) {
    horas += hoursForDay(cursor, data.log);
    meta += metaForDay(cursor, data.config.schedule, data.folgas);
    cursor = addDays(cursor, 1);
  }
  return { horas, meta, pct: meta === 0 ? 0 : horas / meta };
}

function getProgressoMaterias(data) {
  return data.matters.map(m => {
    const concluidas = getAulasCompletas(data.log)
      .filter(a => a.matter === m.name).length;
    return {
      name: m.name,
      total: m.total,
      concluidas,
      pct: m.total === 0 ? 0 : concluidas / m.total,
    };
  });
}

function getHistorico(data, days = 30) {
  const today = todayISO();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const iso = addDays(today, -i);
    const meta = metaForDay(iso, data.config.schedule, data.folgas);
    const horas = hoursForDay(iso, data.log);
    let status;
    const isFolga = data.folgas.some(f => f.data === iso);
    if (isFolga || meta === 0) status = 'folga';
    else if (horas >= meta) status = 'batido';
    else if (iso > today) status = 'futuro';
    else status = 'falhado';
    out.push({ iso, status, horas, meta });
  }
  return out;
}

function getDiasUteisMes(data) {
  const today = todayISO();
  const start = startOfMonthISO(today);
  const end = endOfMonthISO(today);
  return countDiasUteis(start, end, data);
}

function getDiasUteisTotal(data) {
  const today = todayISO();
  return countDiasUteis(data.config.inicio, today, data);
}

function countDiasUteis(startIso, endIso, data) {
  let count = 0;
  let cursor = startIso;
  while (cursor <= endIso) {
    if (metaForDay(cursor, data.config.schedule, data.folgas) > 0) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

function availableFases(matter, aula, log) {
  const used = new Set(
    log
      .filter(e => e.matter === matter && e.aula === aula)
      .map(e => e.fase)
  );
  const out = [FASE_LEITURA];
  const hasQuestoes = used.has(FASE_QUESTOES);
  if (!hasQuestoes) out.push(FASE_QUESTOES);
  if (hasQuestoes) {
    for (const off of MARKERS) {
      const fase = FASE_REVISAO(off);
      if (!used.has(fase)) out.push(fase);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// UI rendering
// ═══════════════════════════════════════════════════════════
let appData = null;

async function refreshAll() {
  if (!currentUser) return;
  appData = await loadAll();
  renderHome();
  renderLog();
  renderRevisoes();
  renderConfig();
}

// Debounce refresh to avoid floods from snapshot listeners
let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshAll, 80);
}

function renderHome() {
  const today = todayISO();
  document.getElementById('topbar-date').textContent = fmtBRFull(today);

  document.getElementById('kpi-streak').textContent = getStreak(appData);
  const hoje = hoursForDay(today, appData.log);
  document.getElementById('kpi-hoje').textContent = hoje.toFixed(1);
  const meta = metaForDay(today, appData.config.schedule, appData.folgas);
  document.getElementById('kpi-meta').textContent = meta.toFixed(1);
  const pct = meta === 0 ? 0 : hoje / meta;
  document.getElementById('kpi-pct').textContent = `${Math.round(pct * 100)}%`;

  const sem = getMetaSemanal(appData);
  document.getElementById('meta-semanal-val').textContent =
    `${sem.horas.toFixed(1)}h / ${sem.meta.toFixed(1)}h (${Math.round(sem.pct * 100)}%)`;
  const card = document.getElementById('meta-semanal-card');
  card.classList.remove('green', 'orange', 'red');
  if (sem.pct >= 1) card.classList.add('green');
  else if (sem.pct >= 0.7) card.classList.add('orange');
  else card.classList.add('red');

  const adesao = getAdesao(appData);
  document.getElementById('adesao-val').textContent = `${Math.round(adesao * 100)}%`;

  const fazer = getFazerHoje(appData);
  const fazerEl = document.getElementById('fazer-hoje-list');
  if (fazer.length === 0) {
    fazerEl.innerHTML = '<div class="empty">— sem revisões hoje —</div>';
  } else {
    fazerEl.innerHTML = fazer.slice(0, 10).map(item => {
      const badgeClass = item.state === 'overdue' ? 'red' : 'blue';
      const subText = item.state === 'overdue' ? `${item.dias}d atrasada` : 'hoje';
      return `
        <div class="list-item clickable" data-matter="${escHtml(item.matter)}" data-aula="${item.aula}" data-fase="${FASE_REVISAO(item.off)}">
          <div class="item-main">
            <div class="item-title">${escHtml(item.matter)} · Aula ${item.aula}</div>
            <div class="item-sub">D+${item.off} · ${subText}</div>
          </div>
          <span class="badge ${badgeClass}">Registrar</span>
        </div>
      `;
    }).join('');
    fazerEl.querySelectorAll('.list-item').forEach(el => {
      el.addEventListener('click', () => {
        openAddModalPrefilled(el.dataset.matter, +el.dataset.aula, el.dataset.fase);
      });
    });
  }

  const atrasadas = getAllOverdue(appData);
  document.getElementById('atrasadas-total').textContent = atrasadas.length;
  const atrEl = document.getElementById('atrasadas-list');
  if (atrasadas.length === 0) {
    atrEl.innerHTML = '<div class="empty">— sem atrasadas ✅ —</div>';
  } else {
    atrEl.innerHTML = atrasadas.slice(0, 10).map(item => `
      <div class="list-item">
        <div class="item-main">
          <div class="item-title">${escHtml(item.matter)} · Aula ${item.aula}</div>
          <div class="item-sub">D+${item.off}</div>
        </div>
        <div class="item-right">
          <span class="badge red">${item.dias}d</span>
        </div>
      </div>
    `).join('');
  }

  const hist = getHistorico(appData, 28);
  const histEl = document.getElementById('historico-list');
  histEl.innerHTML = hist.map(d => {
    const [_, m, day] = d.iso.split('-');
    const icon = d.status === 'batido' ? '✓' : d.status === 'falhado' ? '✗' : d.status === 'folga' ? '💤' : '';
    const isToday = d.iso === today;
    return `
      <div class="hist-cell ${d.status}${isToday ? ' hoje' : ''}" title="${fmtBR(d.iso)} - ${d.horas.toFixed(1)}h / ${d.meta.toFixed(1)}h">
        <div class="h-icon">${icon}</div>
        <div class="h-date">${day}/${m}</div>
      </div>
    `;
  }).join('');

  const prog = getProgressoMaterias(appData);
  const progEl = document.getElementById('progresso-list');
  progEl.innerHTML = prog.map(p => `
    <div class="list-item">
      <div class="item-main">
        <div class="item-title">${escHtml(p.name)}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${(p.pct * 100).toFixed(0)}%"></div></div>
      </div>
      <div class="item-right">
        <strong>${p.concluidas}/${p.total}</strong><br>
        <span class="badge blue">${Math.round(p.pct * 100)}%</span>
      </div>
    </div>
  `).join('');

  document.getElementById('dias-mes').textContent = getDiasUteisMes(appData);
  document.getElementById('dias-total').textContent = getDiasUteisTotal(appData);
}

function renderLog() {
  const matterFilter = document.getElementById('log-filter-matter');
  const faseFilter = document.getElementById('log-filter-fase');
  const matterVal = matterFilter.value;
  const faseVal = faseFilter.value;

  matterFilter.innerHTML = '<option value="">Todas as matérias</option>' +
    appData.matters.map(m => `<option value="${escHtml(m.name)}"${m.name === matterVal ? ' selected' : ''}>${escHtml(m.name)}</option>`).join('');
  faseFilter.innerHTML = '<option value="">Todas as fases</option>' +
    ALL_FASES.map(f => `<option value="${escHtml(f)}"${f === faseVal ? ' selected' : ''}>${escHtml(f)}</option>`).join('');

  let log = [...appData.log].sort((a, b) =>
    b.data.localeCompare(a.data) ||
    (b.createdAt || 0) - (a.createdAt || 0)
  );
  if (matterVal) log = log.filter(e => e.matter === matterVal);
  if (faseVal) log = log.filter(e => e.fase === faseVal);

  const listEl = document.getElementById('log-list');
  if (log.length === 0) {
    listEl.innerHTML = '<div class="empty">— sem entradas no log —</div>';
    return;
  }
  listEl.innerHTML = log.map(e => `
    <div class="list-item log-item clickable" data-id="${e.id}">
      <div class="item-main">
        <div class="log-date">${fmtBR(e.data)} · ${dayName(e.data)}</div>
        <div class="log-matter">${escHtml(e.matter)} <span class="log-aula">· Aula ${e.aula}</span></div>
        <div class="log-fase">${escHtml(e.fase)}</div>
      </div>
      <div class="item-right log-time">${e.tempo}min</div>
    </div>
  `).join('');

  listEl.querySelectorAll('.log-item').forEach(el => {
    el.addEventListener('click', () => promptDeleteLog(el.dataset.id));
  });
}

function renderRevisoes() {
  const aulas = getAulasCompletas(appData.log);
  aulas.sort((a, b) => a.dataInicio.localeCompare(b.dataInicio) || a.matter.localeCompare(b.matter) || a.aula - b.aula);
  const today = todayISO();
  const listEl = document.getElementById('revisoes-list');

  if (aulas.length === 0) {
    listEl.innerHTML = '<div class="empty">— nenhuma aula em ciclo de revisão —<br>(registre ❓ Questões no Log para iniciar)</div>';
    return;
  }

  listEl.innerHTML = aulas.map(aula => {
    const markers = getMarkerStates(aula, appData.log, today);
    const status = getAulaStatus(markers);
    const prox = getProxData(markers);
    const statusLabels = {
      'nova': '🆕 Nova',
      'em-revisao': '🔄 Em revisão',
      'atrasada': '⚠️ Atrasada',
      'concluida': '✅ Concluída'
    };
    return `
      <div class="rev-row">
        <div class="rev-header">
          <div class="rev-title">${escHtml(aula.matter)} · Aula ${aula.aula}</div>
          <span class="rev-status ${status}">${statusLabels[status]}</span>
        </div>
        <div class="item-sub">Início: ${fmtBR(aula.dataInicio)}${prox ? ` · Próx: ${fmtBR(prox)}` : ''}</div>
        <div class="rev-markers">
          ${markers.map(m => `<div class="marker-cell ${m.state}" title="${fmtBR(m.date)}">D+${m.off}</div>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderConfig() {
  document.getElementById('cfg-inicio').value = appData.config.inicio;
  const sched = appData.config.schedule;
  document.querySelectorAll('.schedule-grid input').forEach(inp => {
    const day = +inp.dataset.day;
    inp.value = sched[day] || 0;
  });

  const mEl = document.getElementById('matters-list');
  if (appData.matters.length === 0) {
    mEl.innerHTML = '<div class="empty">— nenhuma matéria cadastrada —</div>';
  } else {
    mEl.innerHTML = appData.matters.map(m => `
      <div class="list-item clickable" data-id="${m.id}">
        <div class="item-main">
          <div class="item-title">${escHtml(m.name)}</div>
        </div>
        <div class="item-right"><strong>${m.total}</strong> aulas</div>
      </div>
    `).join('');
    mEl.querySelectorAll('.list-item').forEach(el => {
      el.addEventListener('click', () => openMatterModal(el.dataset.id));
    });
  }

  const fEl = document.getElementById('folgas-list');
  if (appData.folgas.length === 0) {
    fEl.innerHTML = '<div class="empty">— nenhuma folga registrada —</div>';
  } else {
    const sorted = [...appData.folgas].sort((a, b) => a.data.localeCompare(b.data));
    fEl.innerHTML = sorted.map(f => `
      <div class="list-item clickable" data-data="${f.data}">
        <div class="item-main">
          <div class="item-title">${fmtBR(f.data)} · ${dayName(f.data)}</div>
          ${f.motivo ? `<div class="item-sub">${escHtml(f.motivo)}</div>` : ''}
        </div>
        <div class="item-right">
          <button class="btn-small btn-secondary" data-delete-folga="${f.data}">Remover</button>
        </div>
      </div>
    `).join('');
    fEl.querySelectorAll('[data-delete-folga]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Remover esta folga?')) {
          await dbDelete('folgas', btn.dataset.deleteFolga);
          toast('Folga removida', 'success');
        }
      });
    });
  }

  // User email
  if (currentUser) {
    document.getElementById('user-email').textContent = currentUser.email || '—';
  }

  updateNotifStatus();
}

// ═══════════════════════════════════════════════════════════
// Modals
// ═══════════════════════════════════════════════════════════
function openAddModal() {
  document.getElementById('add-data').value = todayISO();
  document.getElementById('add-aula').value = '';
  document.getElementById('add-tempo').value = '';

  const matterSel = document.getElementById('add-matter');
  matterSel.innerHTML = '<option value="">— escolha —</option>' +
    appData.matters.map(m => `<option value="${escHtml(m.name)}">${escHtml(m.name)}</option>`).join('');

  const faseSel = document.getElementById('add-fase');
  faseSel.innerHTML = '<option value="">— escolha matéria e aula primeiro —</option>';
  document.getElementById('fase-hint').textContent = '';

  document.getElementById('add-modal').classList.add('active');
}

function openAddModalPrefilled(matter, aula, fase) {
  openAddModal();
  document.getElementById('add-matter').value = matter;
  document.getElementById('add-aula').value = aula;
  updateFaseOptions();
  setTimeout(() => {
    const faseSel = document.getElementById('add-fase');
    if ([...faseSel.options].some(o => o.value === fase)) {
      faseSel.value = fase;
    }
  }, 50);
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('active');
}

function updateFaseOptions() {
  const matter = document.getElementById('add-matter').value;
  const aula = +document.getElementById('add-aula').value;
  const faseSel = document.getElementById('add-fase');
  const hint = document.getElementById('fase-hint');

  if (!matter || !aula) {
    faseSel.innerHTML = '<option value="">— escolha matéria e aula primeiro —</option>';
    hint.textContent = '';
    return;
  }

  const avail = availableFases(matter, aula, appData.log);
  faseSel.innerHTML = '<option value="">— escolha —</option>' +
    avail.map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('');

  const done = appData.log
    .filter(e => e.matter === matter && e.aula === aula)
    .map(e => e.fase);
  if (done.length === 0) {
    hint.textContent = 'Nenhum registro para esta aula ainda.';
  } else {
    hint.textContent = `Já registrado: ${done.join(', ')}`;
  }
}

async function saveLogEntry() {
  const data = document.getElementById('add-data').value;
  const matter = document.getElementById('add-matter').value;
  const aula = +document.getElementById('add-aula').value;
  const fase = document.getElementById('add-fase').value;
  const tempo = +document.getElementById('add-tempo').value;

  if (!data || !matter || !aula || !fase || !tempo) {
    toast('Preencha todos os campos', 'error');
    return;
  }

  if (fase.startsWith('🔄 ')) {
    const hasQ = appData.log.some(e =>
      e.matter === matter && e.aula === aula && e.fase === FASE_QUESTOES
    );
    if (!hasQ) {
      toast('Você precisa registrar ❓ Questões antes de começar as revisões', 'error');
      return;
    }
  }

  await dbPut('log', { data, matter, aula, fase, tempo });
  closeAddModal();
  toast('Registro salvo ✓', 'success');
}

async function promptDeleteLog(id) {
  if (confirm('Excluir este registro?')) {
    await dbDelete('log', id);
    toast('Registro excluído', 'success');
  }
}

let editingMatterId = null;
function openMatterModal(id) {
  editingMatterId = id;
  const modal = document.getElementById('matter-modal');
  const titleEl = document.getElementById('matter-modal-title');
  const deleteBtn = document.getElementById('matter-delete');
  if (id) {
    const m = appData.matters.find(x => x.id === id);
    titleEl.textContent = 'Editar Matéria';
    document.getElementById('matter-name').value = m.name;
    document.getElementById('matter-total').value = m.total;
    deleteBtn.style.display = 'block';
  } else {
    titleEl.textContent = 'Nova Matéria';
    document.getElementById('matter-name').value = '';
    document.getElementById('matter-total').value = '';
    deleteBtn.style.display = 'none';
  }
  modal.classList.add('active');
}

function closeMatterModal() {
  document.getElementById('matter-modal').classList.remove('active');
}

async function saveMatter() {
  const name = document.getElementById('matter-name').value.trim();
  const total = +document.getElementById('matter-total').value;
  if (!name || !total) {
    toast('Preencha nome e total', 'error');
    return;
  }
  const data = { name, total };
  if (editingMatterId) data.id = editingMatterId;
  await dbPut('matters', data);
  closeMatterModal();
  toast('Matéria salva ✓', 'success');
}

async function deleteMatter() {
  if (!editingMatterId) return;
  const m = appData.matters.find(x => x.id === editingMatterId);
  const has = appData.log.some(e => e.matter === m.name);
  if (has) {
    if (!confirm(`A matéria "${m.name}" tem registros no Log. Excluir mesmo assim? Os registros NÃO serão apagados.`)) return;
  } else {
    if (!confirm(`Excluir "${m.name}"?`)) return;
  }
  await dbDelete('matters', editingMatterId);
  closeMatterModal();
  toast('Matéria excluída', 'success');
}

function openFolgaModal() {
  document.getElementById('folga-data').value = todayISO();
  document.getElementById('folga-motivo').value = '';
  document.getElementById('folga-modal').classList.add('active');
}

function closeFolgaModal() {
  document.getElementById('folga-modal').classList.remove('active');
}

async function saveFolga() {
  const data = document.getElementById('folga-data').value;
  const motivo = document.getElementById('folga-motivo').value.trim();
  if (!data) {
    toast('Selecione a data', 'error');
    return;
  }
  await dbPut('folgas', { data, motivo });
  closeFolgaModal();
  toast('Folga registrada ✓', 'success');
}

async function saveInicio() {
  const val = document.getElementById('cfg-inicio').value;
  if (val) await setConfig('inicio', val);
}

async function saveSchedule() {
  const sched = {};
  document.querySelectorAll('.schedule-grid input').forEach(inp => {
    sched[+inp.dataset.day] = parseFloat(inp.value) || 0;
  });
  await setConfig('schedule', sched);
}

// ═══════════════════════════════════════════════════════════
// Backup / Restore
// ═══════════════════════════════════════════════════════════
async function exportData() {
  const data = await loadAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `estudos_backup_${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Backup exportado ✓', 'success');
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.config || !data.matters || !data.log) {
      throw new Error('Arquivo inválido');
    }

    if (!confirm('Isso vai SUBSTITUIR todos os dados na nuvem. Continuar?')) return;

    await dbClear('config');
    await dbClear('matters');
    await dbClear('log');
    await dbClear('folgas');

    if (data.config.inicio) await setConfig('inicio', data.config.inicio);
    if (data.config.schedule) await setConfig('schedule', data.config.schedule);
    for (const m of data.matters) {
      const copy = { ...m };
      delete copy.id;
      await dbPut('matters', copy);
    }
    for (const e of data.log) {
      const copy = { ...e };
      delete copy.id;
      await dbPut('log', copy);
    }
    for (const f of data.folgas) {
      await dbPut('folgas', f);
    }

    toast('Dados importados ✓', 'success');
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
  }
}

async function resetAll() {
  if (!confirm('⚠️ Isso vai APAGAR TUDO da nuvem. Tem certeza?')) return;
  if (!confirm('Última chance. Confirma apagar todos os dados?')) return;
  await dbClear('config');
  await dbClear('matters');
  await dbClear('log');
  await dbClear('folgas');
  await initIfFirstRun();
  toast('Dados resetados', 'success');
}

// Demo simulation — 1 month of realistic study
async function loadDemo() {
  if (!confirm('Isso vai SUBSTITUIR todos os dados atuais por uma simulação de 30 dias. Continuar?')) return;

  await dbClear('config');
  await dbClear('matters');
  await dbClear('log');
  await dbClear('folgas');

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 29);
  const startISO = toISO(startDate);

  await setConfig('inicio', startISO);
  await setConfig('schedule', { 0: 2.5, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 2.5 });
  await setConfig('notif_time', '08:00');
  await setConfig('notif_enabled', false);

  const demoMatters = [
    { name: 'Português', total: 16 },
    { name: 'RLM', total: 20 },
    { name: 'Contabilidade', total: 22 },
    { name: 'Dir. Constitucional', total: 17 },
    { name: 'Dir. Administrativo', total: 15 },
    { name: 'Dir. Tributário', total: 21 },
  ];
  for (const m of demoMatters) await dbPut('matters', m);

  const folgaDate1 = toISO(addDaysDate(startDate, 9));
  const folgaDate2 = toISO(addDaysDate(startDate, 21));
  await dbPut('folgas', { data: folgaDate1, motivo: 'Feriado' });
  await dbPut('folgas', { data: folgaDate2, motivo: 'Compromisso pessoal' });
  const folgaSet = new Set([folgaDate1, folgaDate2]);

  const subjectNames = demoMatters.map(m => m.name);
  const state = {};
  for (const sn of subjectNames) {
    state[sn] = {
      aula: 1, leituraDone: 0,
      leituraNeeded: 3 + Math.floor(Math.random() * 2),
    };
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const logEntries = [];
  const questoesDone = [];

  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const dayDate = addDaysDate(startDate, dayOffset);
    const dayISOStr = toISO(dayDate);
    if (folgaSet.has(dayISOStr)) continue;
    if (dayISOStr > toISO(today)) break;

    const dow = dayDate.getDay();
    let todaySubjects;
    if (dow >= 1 && dow <= 5) {
      todaySubjects = [
        subjectNames[dayOffset % 6],
        subjectNames[(dayOffset + 2) % 6],
        subjectNames[(dayOffset + 4) % 6],
      ];
    } else {
      todaySubjects = [subjectNames[dayOffset % 6]];
    }

    for (const subj of todaySubjects) {
      const st = state[subj];
      const total = demoMatters.find(m => m.name === subj).total;
      if (st.aula > total) continue;

      if (st.leituraDone < st.leituraNeeded) {
        const tempo = pick([60, 75, 75, 90]);
        logEntries.push({ data: dayISOStr, matter: subj, aula: st.aula, fase: FASE_LEITURA, tempo });
        st.leituraDone++;
      } else {
        const tempo = pick([45, 60, 60]);
        logEntries.push({ data: dayISOStr, matter: subj, aula: st.aula, fase: FASE_QUESTOES, tempo });
        questoesDone.push({ matter: subj, aula: st.aula, data: dayISOStr });
        st.aula++;
        st.leituraDone = 0;
        st.leituraNeeded = 3 + Math.floor(Math.random() * 2);
      }
    }
  }

  const todayISOStr = toISO(today);
  let overdueLeft = 6;

  for (const q of questoesDone) {
    for (const off of MARKERS) {
      const revDateObj = addDaysDate(fromISO(q.data), off);
      const revISO = toISO(revDateObj);
      if (revISO > todayISOStr) break;

      const shouldLeave = (overdueLeft > 0) && (Math.random() < 0.20);
      if (shouldLeave) { overdueLeft--; continue; }

      const jitter = pick([-1, 0, 0, 0, 1]);
      let actualDateObj = addDaysDate(revDateObj, jitter);
      let actualISO = toISO(actualDateObj);
      if (actualISO > todayISOStr) actualISO = todayISOStr;
      if (folgaSet.has(actualISO)) {
        actualDateObj = addDaysDate(actualDateObj, 1);
        actualISO = toISO(actualDateObj);
        if (actualISO > todayISOStr) actualISO = todayISOStr;
      }
      const tempo = pick([30, 45, 45, 60]);
      logEntries.push({ data: actualISO, matter: q.matter, aula: q.aula, fase: FASE_REVISAO(off), tempo });
    }
  }

  logEntries.sort((a, b) =>
    a.data.localeCompare(b.data) ||
    a.matter.localeCompare(b.matter) ||
    a.aula - b.aula
  );

  // Batch writes for performance
  const batchEntries = writeBatch(db);
  for (const e of logEntries) {
    const docRef = doc(userCol('log'));
    batchEntries.set(docRef, { ...e, createdAt: Date.now() });
  }
  await batchEntries.commit();

  toast(`Simulação carregada: ${logEntries.length} registros ✓`, 'success');
}

function addDaysDate(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ═══════════════════════════════════════════════════════════
// Notifications
// ═══════════════════════════════════════════════════════════
async function enableNotifications() {
  if (!('Notification' in window)) {
    toast('Seu navegador não suporta notificações', 'error');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    await setConfig('notif_enabled', true);
    await setConfig('notif_time', document.getElementById('cfg-notif-time').value);
    scheduleNextNotif();
    toast('Notificações ativadas ✓', 'success');
  } else {
    toast('Permissão negada', 'error');
  }
  updateNotifStatus();
}

async function updateNotifStatus() {
  const statusEl = document.getElementById('notif-status');
  if (!('Notification' in window)) {
    statusEl.textContent = 'Não suportado';
    return;
  }
  const enabled = await getConfig('notif_enabled', false);
  const time = await getConfig('notif_time', '08:00');
  document.getElementById('cfg-notif-time').value = time;
  if (Notification.permission === 'granted' && enabled) {
    statusEl.textContent = `Ativo · ${time}`;
    statusEl.className = 'info-value green';
  } else {
    statusEl.textContent = 'Desativado';
    statusEl.className = 'info-value secondary';
  }
}

let notifTimerId = null;
async function scheduleNextNotif() {
  if (notifTimerId) clearTimeout(notifTimerId);
  const enabled = await getConfig('notif_enabled', false);
  if (!enabled || Notification.permission !== 'granted') return;

  const time = await getConfig('notif_time', '08:00');
  const [hh, mm] = time.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next - now;
  notifTimerId = setTimeout(() => {
    fireNotif();
    scheduleNextNotif();
  }, delay);
}

async function fireNotif() {
  const data = await loadAll();
  const fazer = getFazerHoje(data);
  const atrasadas = getAllOverdue(data);

  let body;
  if (fazer.length === 0) {
    body = 'Nenhuma revisão pendente hoje. 💪';
  } else if (atrasadas.length > 0) {
    body = `${fazer.length} revisão(ões) para hoje, ${atrasadas.length} atrasada(s).`;
  } else {
    body = `Você tem ${fazer.length} revisão(ões) para fazer hoje.`;
  }

  if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Estudos Concurso', {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'daily-reminder'
    });
  } else {
    new Notification('Estudos Concurso', { body, icon: './icon-192.png' });
  }
}

// ═══════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

let toastTimer = null;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ═══════════════════════════════════════════════════════════
// Auth flow
// ═══════════════════════════════════════════════════════════
function showAuthScreen() {
  document.getElementById('auth-overlay').classList.add('active');
}

function hideAuthScreen() {
  document.getElementById('auth-overlay').classList.remove('active');
}

async function handleSignIn() {
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    // onAuthStateChanged will handle the rest
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      // Try redirect as fallback
      try {
        await signInWithRedirect(auth, new GoogleAuthProvider());
      } catch (e2) {
        errEl.textContent = `Erro: ${e2.message}`;
      }
    } else {
      errEl.textContent = `Erro: ${e.message}`;
    }
  }
}

async function handleSignOut() {
  if (!confirm('Sair da conta? Os dados ficam salvos na nuvem.')) return;
  // Unsubscribe Firestore listeners
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  await signOut(auth);
  appData = null;
  currentUser = null;
}

function subscribeToChanges() {
  // Real-time sync: when any device writes, others receive update
  const stores = ['config', 'matters', 'log', 'folgas'];
  for (const store of stores) {
    const unsub = onSnapshot(userCol(store), () => {
      scheduleRefresh();
    }, (err) => {
      console.warn(`Snapshot error on ${store}:`, err);
    });
    unsubscribers.push(unsub);
  }
}

// ═══════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════
function attachUIHandlers() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      window.scrollTo(0, 0);
    });
  });

  document.getElementById('fab-add').addEventListener('click', openAddModal);

  document.getElementById('modal-close').addEventListener('click', closeAddModal);
  document.getElementById('modal-save').addEventListener('click', saveLogEntry);
  document.getElementById('add-matter').addEventListener('change', updateFaseOptions);
  document.getElementById('add-aula').addEventListener('input', updateFaseOptions);

  document.getElementById('log-filter-matter').addEventListener('change', renderLog);
  document.getElementById('log-filter-fase').addEventListener('change', renderLog);

  document.getElementById('cfg-inicio').addEventListener('change', saveInicio);
  document.querySelectorAll('.schedule-grid input').forEach(inp => {
    inp.addEventListener('change', saveSchedule);
  });

  document.getElementById('add-matter-btn').addEventListener('click', () => openMatterModal(null));
  document.getElementById('matter-modal-close').addEventListener('click', closeMatterModal);
  document.getElementById('matter-save').addEventListener('click', saveMatter);
  document.getElementById('matter-delete').addEventListener('click', deleteMatter);

  document.getElementById('add-folga-btn').addEventListener('click', openFolgaModal);
  document.getElementById('folga-modal-close').addEventListener('click', closeFolgaModal);
  document.getElementById('folga-save').addEventListener('click', saveFolga);

  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('reset-btn').addEventListener('click', resetAll);
  document.getElementById('demo-btn').addEventListener('click', loadDemo);

  document.getElementById('cfg-notif-enable').addEventListener('click', enableNotifications);
  document.getElementById('cfg-notif-time').addEventListener('change', async () => {
    await setConfig('notif_time', document.getElementById('cfg-notif-time').value);
    scheduleNextNotif();
    updateNotifStatus();
  });

  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('active');
    });
  });

  // Auth buttons
  document.getElementById('auth-signin-btn').addEventListener('click', handleSignIn);
  document.getElementById('signout-btn').addEventListener('click', handleSignOut);
}

async function onSignedIn(user) {
  currentUser = user;
  hideAuthScreen();

  await initIfFirstRun();
  subscribeToChanges();
  await refreshAll();
  scheduleNextNotif();
}

function onSignedOut() {
  showAuthScreen();
}

async function init() {
  attachUIHandlers();

  // Handle redirect result (if user came back from signInWithRedirect)
  try {
    await getRedirectResult(auth);
  } catch (e) {
    console.warn('Redirect result error:', e);
  }

  // Listen to auth state changes
  onAuthStateChanged(auth, (user) => {
    if (user) {
      onSignedIn(user);
    } else {
      onSignedOut();
    }
  });

  // Service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('SW register failed', e);
    }
  }

  // Refresh once a minute to keep date-sensitive UI fresh
  setInterval(() => {
    if (currentUser && document.getElementById('tab-home').classList.contains('active')) {
      refreshAll();
    }
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
