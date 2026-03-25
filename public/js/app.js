// ── Theme (dark / light) ───────────────────────────────────
const themeToggle = document.getElementById('themeToggle');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';
  localStorage.setItem('drugspal_theme', theme);
}

// Load saved preference, fall back to OS preference
const savedTheme = localStorage.getItem('drugspal_theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
});

// ── Hamburger menu ─────────────────────────────────────────
const hamburgerBtn = document.getElementById('hamburgerBtn');
const mainNav      = document.getElementById('mainNav');

hamburgerBtn.addEventListener('click', () => {
  hamburgerBtn.classList.toggle('open');
  mainNav.classList.toggle('open');
});

// Close nav when a tab is clicked on mobile
mainNav.addEventListener('click', () => {
  hamburgerBtn.classList.remove('open');
  mainNav.classList.remove('open');
});

// ── Tab switching ──────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'cabinet') renderCabinet();
    if (tab.dataset.tab === 'insights') renderInsights();
  });
});

// ── Helpers ────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function loading(msg = 'Fetching data…') {
  return `<div class="loading"><div class="spinner"></div>${msg}</div>`;
}
function error(msg) {
  return `<div class="error-msg">⚠ ${msg}</div>`;
}
function truncate(text) {
  if (!text) return null;
  return text;
}

// ── Medicine Cabinet (localStorage) ───────────────────────
function getCabinet() {
  try { return JSON.parse(localStorage.getItem('drugspal_cabinet') || '[]'); }
  catch { return []; }
}
function saveCabinet(items) {
  localStorage.setItem('drugspal_cabinet', JSON.stringify(items));
  updateCabinetBadge();
}
function addToCabinet(drug) {
  const cabinet = getCabinet();
  const idx = cabinet.findIndex(d => d.brand_name.toLowerCase() === drug.brand_name.toLowerCase());
  if (idx === -1) {
    cabinet.unshift({ ...drug, saved_at: new Date().toISOString(), search_count: 1 });
  } else {
    cabinet[idx] = { ...cabinet[idx], ...drug, search_count: (cabinet[idx].search_count || 1) + 1 };
  }
  saveCabinet(cabinet);
}
function removeFromCabinet(brandName) {
  const cabinet = getCabinet().filter(d => d.brand_name !== brandName);
  saveCabinet(cabinet);
  renderCabinet();
}
function updateCabinetBadge() {
  const badge = document.getElementById('cabinetBadge');
  const count = getCabinet().length;
  badge.textContent = count > 0 ? count : '';
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}
function renderCabinet() {
  const content = document.getElementById('cabinetContent');
  const cabinet = getCabinet();
  if (cabinet.length === 0) {
    content.innerHTML = `
      <div class="cabinet-empty">
        <div class="cabinet-empty-icon"></div>
        <p>Your cabinet is empty.</p>
        <p style="font-size:0.88rem;color:var(--muted);margin-top:6px">Search for a drug and click <strong>Save to Cabinet</strong> to add it here.</p>
      </div>`;
    return;
  }
  content.innerHTML = `
    <p style="color:var(--muted);font-size:0.88rem;margin-bottom:20px">${cabinet.length} saved medication${cabinet.length > 1 ? 's' : ''} · Stored locally in your browser</p>
    <div class="cabinet-grid">
      ${cabinet.map(drug => `
        <div class="cabinet-card">
          <div class="cabinet-card-top">
            <div>
              <div class="cabinet-drug-name">${escapeHtml(drug.brand_name)}</div>
              <div class="cabinet-drug-generic">${escapeHtml(drug.generic_name || 'N/A')}</div>
              <div class="cabinet-drug-mfr">${escapeHtml(drug.manufacturer || 'N/A')}</div>
            </div>
            <button class="cabinet-remove" onclick="removeFromCabinet('${escapeHtml(drug.brand_name)}')" title="Remove from cabinet">✕</button>
          </div>
          <div class="cabinet-saved-date">Saved ${new Date(drug.saved_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
          <div class="cabinet-actions">
            <button class="cabinet-btn" onclick="cabinetSearch('${escapeHtml(drug.brand_name)}')"> Details</button>
            <button class="cabinet-btn" onclick="cabinetInteraction('${escapeHtml(drug.brand_name)}')"> Interactions</button>
            <button class="cabinet-btn" onclick="cabinetRecall('${escapeHtml(drug.brand_name)}')"> Recalls</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function cabinetSearch(name) {
  document.querySelector('[data-tab="search"]').click();
  document.getElementById('drugSearchInput').value = name;
  searchDrug();
}
function cabinetInteraction(name) {
  sendToInteractions(name);
}
function cabinetRecall(name) {
  document.querySelector('[data-tab="recalls"]').click();
  document.getElementById('recallInput').value = name;
  checkRecalls();
}

// ── Chart helpers ──────────────────────────────────────────
const _charts = {};
function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const CHART_PALETTE = [
  '#00e5a0','#0077ff','#ff4c6a','#ffb547','#9b7fe8',
  '#00c9e8','#ff7c5c','#4ddc8c','#ff5fcb','#7ce8ff'
];

function classifyDrug(drug) {
  const text = [(drug.purpose||''),(drug.generic_name||''),(drug.indications||'')].join(' ').toLowerCase();
  if (/pain|fever|analgesic|ibuprofen|acetaminophen|aspirin|naproxen/.test(text)) return 'Pain & Fever';
  if (/antibiotic|bacteria|infection|amoxicillin|azithromycin|penicillin/.test(text)) return 'Antibiotics';
  if (/diabet|metformin|insulin|glucose|hypoglycemic/.test(text)) return 'Diabetes';
  if (/blood pressure|hypertension|lisinopril|amlodipine|losartan/.test(text)) return 'Blood Pressure';
  if (/cholesterol|statin|atorvastatin|simvastatin|lipid/.test(text)) return 'Cholesterol';
  if (/depress|anxiety|ssri|sertraline|fluoxetine|antidepressant/.test(text)) return 'Mental Health';
  if (/vitamin|supplement|mineral|omega|probiotic|calcium/.test(text)) return 'Supplements';
  if (/allerg|antihistamine|cetirizine|loratadine|diphenhydramine/.test(text)) return 'Allergy';
  if (/acid|reflux|heartburn|omeprazole|pantoprazole|antacid/.test(text)) return 'Digestive';
  if (/thyroid|levothyroxine/.test(text)) return 'Thyroid';
  if (/heart|cardiac|cardio|warfarin|digoxin|arrhythmia/.test(text)) return 'Cardiovascular';
  return 'Other';
}

const SIDE_EFFECT_TERMS = [
  'nausea','headache','dizziness','fatigue','vomiting','diarrhea',
  'constipation','rash','insomnia','drowsiness','dry mouth','swelling',
  'fever','anxiety','cough','bleeding','itching','weakness','pain','depression'
];
function parseSideEffects(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return SIDE_EFFECT_TERMS.filter(t => lower.includes(t)).slice(0, 8);
}

function renderInsights() {
  const cabinet = getCabinet();
  const content = document.getElementById('insightsContent');
  if (cabinet.length === 0) {
    content.innerHTML = `
      <div class="cabinet-empty">
        <p>No data yet.</p>
        <p style="font-size:0.88rem;color:var(--muted);margin-top:6px">Search for drugs to build your medication insights.</p>
      </div>`;
    return;
  }

  ['insightPie','insightBar'].forEach(destroyChart);

  const typeCount = {};
  cabinet.forEach(d => { const t = classifyDrug(d); typeCount[t] = (typeCount[t] || 0) + 1; });
  const pieLabels = Object.keys(typeCount);
  const pieData   = Object.values(typeCount);
  const sorted    = [...cabinet].sort((a,b) => (b.search_count||1) - (a.search_count||1)).slice(0, 10);

  content.innerHTML = `
    <div class="insights-grid">
      <div class="chart-card">
        <h3 class="chart-title">Drug Type Distribution</h3>
        <p class="chart-subtitle">${cabinet.length} saved medication${cabinet.length > 1 ? 's' : ''} · by category</p>
        <div class="chart-container"><canvas id="insightPie"></canvas></div>
      </div>
      <div class="chart-card">
        <h3 class="chart-title">Search Frequency</h3>
        <p class="chart-subtitle">Times each drug was looked up</p>
        <div class="chart-container"><canvas id="insightBar"></canvas></div>
      </div>
    </div>`;

  const textC   = cssVar('--text');
  const mutedC  = cssVar('--muted');
  const borderC = cssVar('--border');
  const bg2C    = cssVar('--bg2');

  _charts['insightPie'] = new Chart(document.getElementById('insightPie'), {
    type: 'doughnut',
    data: {
      labels: pieLabels,
      datasets: [{ data: pieData, backgroundColor: CHART_PALETTE.slice(0, pieLabels.length), borderColor: bg2C, borderWidth: 2, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: textC, padding: 12, font: { size: 12 }, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} drug${ctx.raw > 1 ? 's' : ''}` } }
      }
    }
  });

  _charts['insightBar'] = new Chart(document.getElementById('insightBar'), {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.brand_name),
      datasets: [{
        label: 'Searches',
        data: sorted.map(d => d.search_count || 1),
        backgroundColor: sorted.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length] + '99'),
        borderColor: sorted.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
        borderWidth: 1, borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Searched ${ctx.raw} time${ctx.raw > 1 ? 's' : ''}` } }
      },
      scales: {
        x: { ticks: { color: mutedC, stepSize: 1 }, grid: { color: borderC } },
        y: { ticks: { color: textC }, grid: { display: false } }
      }
    }
  });
}

function renderSideEffectsChart(text) {
  const canvas = document.getElementById('sideEffectsChart');
  if (!canvas) return;
  const effects = parseSideEffects(text);
  if (!effects.length) { canvas.closest('.chart-container-sm')?.remove(); return; }

  destroyChart('sideEffectsChart');
  const textC = cssVar('--text');
  const bg2C  = cssVar('--bg2');

  _charts['sideEffectsChart'] = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: effects,
      datasets: [{ data: effects.map(() => 1), backgroundColor: CHART_PALETTE.slice(0, effects.length), borderColor: bg2C, borderWidth: 2, hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: textC, padding: 10, font: { size: 11 }, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label} (mentioned in label)` } }
      }
    }
  });
}

function renderInteractionRadar(interactions) {
  const canvas = document.getElementById('interactionRadar');
  if (!canvas || !interactions.length) return;

  destroyChart('interactionRadar');

  const high = interactions.filter(i => /high/i.test(i.severity)).length;
  const mod  = interactions.filter(i => /moderate/i.test(i.severity)).length;
  const low  = interactions.filter(i => /low/i.test(i.severity) && !/moderate/i.test(i.severity)).length;
  const score = pat => interactions.filter(i => pat.test(i.description || '')).length;
  const cns       = score(/cns|neuro|sedati|seizure|serotonin|psychi|drowsi/i);
  const cardio    = score(/cardiac|heart|blood pressure|arrhythmia|qt|vasoconstrict/i);
  const bleeding  = score(/bleed|hemorrhage|anticoagul|platelet|thrombos/i);
  const metabolic = score(/hepat|liver|metaboli|cyp|enzyme|inhibit/i);

  const maxVal = Math.max(high, mod, low, cns, cardio, bleeding, metabolic, 1);
  const textC   = cssVar('--text');
  const mutedC  = cssVar('--muted');
  const borderC = cssVar('--border');

  _charts['interactionRadar'] = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: ['High Severity','Moderate','Low Severity','CNS / Neuro','Cardiovascular','Bleeding','Metabolic'],
      datasets: [{
        label: 'Risk Profile',
        data: [high, mod, low, cns, cardio, bleeding, metabolic],
        backgroundColor: '#ff4c6a22', borderColor: '#ff4c6a',
        pointBackgroundColor: '#ff4c6a', pointBorderColor: '#ff4c6a',
        borderWidth: 2, pointRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        r: {
          min: 0, max: Math.max(maxVal, 3),
          ticks: { stepSize: 1, color: mutedC, backdropColor: 'transparent' },
          grid: { color: borderC },
          angleLines: { color: borderC },
          pointLabels: { color: textC, font: { size: 11 } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw} interaction${ctx.raw !== 1 ? 's' : ''} flagged` } }
      }
    }
  });
}

// ── Drug Search ────────────────────────────────────────────
const drugSearchInput = document.getElementById('drugSearchInput');
const drugSearchBtn   = document.getElementById('drugSearchBtn');
const drugResult      = document.getElementById('drugResult');

async function searchDrug() {
  const name = drugSearchInput.value.trim();
  if (!name || name.length < 2) return;

  drugResult.innerHTML = loading(`Looking up <strong>${escapeHtml(name)}</strong>…`);
  drugSearchBtn.disabled = true;

  try {
    const res = await fetch(`/api/drug/search?name=${encodeURIComponent(name)}`);
    const data = await res.json();

    if (!res.ok) { drugResult.innerHTML = error(data.error); return; }

    // Auto-save every successful search to cabinet
    addToCabinet(data);

    const sections = [
      { key: 'purpose',           label: 'Purpose',            icon: '', cls: 'icon-purpose' },
      { key: 'indications',       label: 'Uses & Indications',  icon: '', cls: 'icon-dosage' },
      { key: 'dosage',            label: 'Dosage',              icon: '', cls: 'icon-dosage' },
      { key: 'warnings',          label: 'Warnings',            icon: '', cls: 'icon-warnings' },
      { key: 'side_effects',      label: 'Side Effects',        icon: '', cls: 'icon-side-fx' },
      { key: 'contraindications', label: 'Contraindications',   icon: '', cls: 'icon-contra' },
    ];

    const sectionHTML = sections
      .filter(s => data[s.key])
      .map(s => `
        <div class="drug-section" onclick="toggleSection(this)">
          <div class="section-header">
            <span class="section-label">
              <span class="section-icon ${s.cls}">${s.icon}</span>
              ${s.label}
            </span>
            <span class="chevron">▾</span>
          </div>
          <div class="section-body">
            <p class="section-text">${escapeHtml(truncate(data[s.key]))}</p>
            ${s.key === 'side_effects' ? '<div class="chart-container-sm"><canvas id="sideEffectsChart"></canvas></div>' : ''}
          </div>
        </div>
      `).join('');

    drugResult.innerHTML = `
      <div class="drug-card">
        <div class="drug-card-header">
          <div class="drug-name">${escapeHtml(data.brand_name)}</div>
          <div class="drug-generic">Generic: ${escapeHtml(data.generic_name)}</div>
          <div class="drug-manufacturer">Manufacturer: ${escapeHtml(data.manufacturer)}</div>
          <div class="drug-header-actions">
            ${data.rxcui ? `
              <button class="btn-send-interaction" data-drug="${escapeHtml(data.brand_name)}" onclick="sendToInteractions(this.dataset.drug)">
                ➕ Add to Interaction Checker
              </button>` : ''}
            <button class="btn-save-cabinet saved" id="saveCabinetBtn" disabled>
              ✓ Saved to Cabinet
            </button>
          </div>
        </div>
        <div class="sort-bar">
          <span style="color:var(--muted);font-size:0.82rem">Sort sections:</span>
          <button class="filter-btn active" onclick="sortSections('default', this)">Default</button>
          <button class="filter-btn" onclick="sortSections('az', this)">A → Z</button>
          <button class="filter-btn" onclick="sortSections('za', this)">Z → A</button>
        </div>
        <div class="drug-sections" id="drugSections">${sectionHTML}</div>
      </div>
    `;
    window._drugSections = sections.filter(s => data[s.key]).map(s => ({ ...s, content: data[s.key] }));
    window._currentDrugData = data;
  } catch (e) {
    drugResult.innerHTML = error('Network error. Please check your connection.');
  } finally {
    drugSearchBtn.disabled = false;
  }
}

function toggleCabinetSave(btn, dataJson) {
  const data = JSON.parse(dataJson);
  const cabinet = getCabinet();
  const exists = cabinet.some(d => d.brand_name.toLowerCase() === data.brand_name.toLowerCase());
  if (exists) {
    removeFromCabinet(data.brand_name);
    btn.textContent = 'Save to Cabinet';
    btn.classList.remove('saved');
  } else {
    addToCabinet(data);
    btn.textContent = '✓ Saved to Cabinet';
    btn.classList.add('saved');
  }
}

function toggleSection(el) {
  el.classList.toggle('open');
  if (el.classList.contains('open')) {
    const canvas = el.querySelector('#sideEffectsChart');
    if (canvas && !_charts['sideEffectsChart'] && window._currentDrugData?.side_effects) {
      requestAnimationFrame(() => renderSideEffectsChart(window._currentDrugData.side_effects));
    }
  }
}

function sortSections(order, btn) {
  document.querySelectorAll('.sort-bar .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const container = document.getElementById('drugSections');
  if (!container || !window._drugSections) return;
  let sorted = [...window._drugSections];
  if (order === 'az') sorted.sort((a, b) => a.label.localeCompare(b.label));
  if (order === 'za') sorted.sort((a, b) => b.label.localeCompare(a.label));
  destroyChart('sideEffectsChart');
  container.innerHTML = sorted.map(s => `
    <div class="drug-section" onclick="toggleSection(this)">
      <div class="section-header">
        <span class="section-label">
          <span class="section-icon ${s.cls}">${s.icon}</span>
          ${s.label}
        </span>
        <span class="chevron">▾</span>
      </div>
      <div class="section-body">
        <p class="section-text">${escapeHtml(truncate(s.content))}</p>
        ${s.key === 'side_effects' ? '<div class="chart-container-sm"><canvas id="sideEffectsChart"></canvas></div>' : ''}
      </div>
    </div>
  `).join('');
}

function sendToInteractions(drugName) {
  if (!drugList.includes(drugName)) {
    drugList.push(drugName);
    renderTags();
  }
  document.querySelector('[data-tab="interactions"]').click();
}

drugSearchBtn.addEventListener('click', searchDrug);
drugSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchDrug(); });

// ── Drug Interactions ──────────────────────────────────────
const interactionInput     = document.getElementById('interactionInput');
const checkInteractionsBtn = document.getElementById('checkInteractionsBtn');
const interactionResult    = document.getElementById('interactionResult');
const drugTagsEl           = document.getElementById('drugTags');
let drugList = [];

function renderTags() {
  drugTagsEl.innerHTML = drugList.map((d, i) => `
    <span class="tag">${escapeHtml(d)}<button onclick="removeTag(${i})" title="Remove">×</button></span>
  `).join('');
}

function removeTag(i) {
  drugList.splice(i, 1);
  renderTags();
}

interactionInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = interactionInput.value.trim();
    if (!val) return;
    if (drugList.length >= 5) { document.getElementById('tagError').textContent = 'Maximum 5 drugs.'; return; }
    if (!drugList.some(d => d.toLowerCase() === val.toLowerCase())) drugList.push(val);
    interactionInput.value = '';
    document.getElementById('tagError').textContent = '';
    renderTags();
  }
});

async function checkInteractions() {
  if (drugList.length < 2) {
    interactionResult.innerHTML = error('Please add at least 2 drugs.');
    return;
  }

  interactionResult.innerHTML = loading('Checking interactions…');
  checkInteractionsBtn.disabled = true;

  try {
    const res = await fetch(`/api/drug/interactions?drugs=${encodeURIComponent(drugList.join(','))}`);
    const data = await res.json();

    if (!res.ok) { interactionResult.innerHTML = error(data.error); return; }

    if (!data.interactions || data.interactions.length === 0) {
      interactionResult.innerHTML = `
        <div class="interaction-summary summary-safe">
          No known interactions found between: ${(data.drugs || []).map(d => escapeHtml(d)).join(', ')}
        </div>
        <p style="color:var(--muted);font-size:0.88rem">This does not guarantee safety. Always consult a healthcare provider.</p>
      `;
      return;
    }

    const hasHigh = data.interactions.some(i => /high/i.test(i.severity));
    const hasMod  = data.interactions.some(i => /moderate/i.test(i.severity));
    const summaryClass = hasHigh ? 'summary-danger' : hasMod ? 'summary-warn' : 'summary-safe';
    const summaryIcon  = hasHigh ? '' : hasMod ? '' : '';

    interactionResult.innerHTML = `
      <div class="interaction-summary ${summaryClass}">
        ${summaryIcon} Found <strong>${data.total}</strong> interaction${data.total > 1 ? 's' : ''} between ${data.drugs.map(d => escapeHtml(d)).join(', ')}
      </div>
      ${data.unresolved?.length ? `
      <div class="unresolved-warning">
        ⚠ Could not resolve the following drug name${data.unresolved.length > 1 ? 's' : ''} — interactions may be incomplete:
        ${data.unresolved.map(d => `<span class="drug-pill">${escapeHtml(d)}</span>`).join(' ')}
      </div>` : ''}
      <div class="chart-card chart-card-interaction">
        <h3 class="chart-title">Interaction Risk Profile</h3>
        <p class="chart-subtitle">Severity &amp; risk category signals across checked drugs</p>
        <div class="chart-container" style="height:260px"><canvas id="interactionRadar"></canvas></div>
      </div>
      <div class="filter-bar">
        <button class="filter-btn active" onclick="filterInteractions('all', this)">All (${data.total})</button>
        <button class="filter-btn" onclick="filterInteractions('high', this)">High (${data.interactions.filter(i => /high/i.test(i.severity)).length})</button>
        <button class="filter-btn" onclick="filterInteractions('moderate', this)">Moderate (${data.interactions.filter(i => /moderate/i.test(i.severity)).length})</button>
        <button class="filter-btn" onclick="filterInteractions('low', this)">Low (${data.interactions.filter(i => /low/i.test(i.severity) && !/moderate/i.test(i.severity)).length})</button>
      </div>
      <div class="interaction-list" id="interactionList">
        ${renderInteractions(data.interactions)}
      </div>
    `;
    window._interactions = data.interactions;
    renderInteractionRadar(data.interactions);
  } catch (e) {
    interactionResult.innerHTML = error('Network error. Please check your connection.');
  } finally {
    checkInteractionsBtn.disabled = false;
  }
}

function renderInteractions(list) {
  if (!list.length) return `<p style="color:var(--muted)">No interactions match this filter.</p>`;
  return list.map(i => {
    const sev = (i.severity || 'unknown').toLowerCase();
    const sevClass = sev.includes('high') ? 'sev-high'
                   : sev.includes('moderate') ? 'sev-moderate'
                   : sev.includes('low') ? 'sev-low' : 'sev-unknown';
    return `
      <div class="interaction-card">
        <div class="interaction-drugs">
          <span class="drug-pill">${escapeHtml(i.drug1)}</span>
          <span class="plus">+</span>
          <span class="drug-pill">${escapeHtml(i.drug2)}</span>
          <span class="severity-badge ${sevClass}">${escapeHtml(i.severity || 'unknown')}</span>
        </div>
        <p class="interaction-desc">${escapeHtml(i.description)}</p>
      </div>
    `;
  }).join('');
}

function filterInteractions(level, btn) {
  if (!window._interactions) return;
  interactionResult.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = level === 'all'
    ? window._interactions
    : window._interactions.filter(i => (i.severity || '').toLowerCase().includes(level));
  document.getElementById('interactionList').innerHTML = renderInteractions(filtered);
}

checkInteractionsBtn.addEventListener('click', checkInteractions);

// ── Recalls ────────────────────────────────────────────────
const recallInput  = document.getElementById('recallInput');
const recallBtn    = document.getElementById('recallBtn');
const recallResult = document.getElementById('recallResult');

async function checkRecalls() {
  const name = recallInput.value.trim();
  if (!name || name.length < 2) return;

  recallResult.innerHTML = loading(`Checking recall records for <strong>${escapeHtml(name)}</strong>…`);
  recallBtn.disabled = true;

  try {
    const res = await fetch(`/api/drug/recalls?name=${encodeURIComponent(name)}`);
    const data = await res.json();

    if (!res.ok) { recallResult.innerHTML = error(data.error); return; }

    if (data.total === 0) {
      recallResult.innerHTML = `<div class="no-recalls"> No recall records found for <strong>${escapeHtml(name)}</strong>.</div>`;
      return;
    }

    window._recalls = data.recalls;

    recallResult.innerHTML = `
      <p style="color:var(--muted);margin-bottom:16px;font-size:0.9rem">Showing <span id="recallCount">${data.total}</span> recall record(s)</p>
      <div class="filter-bar" style="margin-bottom:12px">
        <input type="text" id="recallSearchFilter" class="filter-input" placeholder="Filter by keyword…" oninput="filterRecalls()" />
        <button class="filter-btn active" onclick="filterByClass('all', this)">All</button>
        <button class="filter-btn" onclick="filterByClass('Class I', this)">Class I</button>
        <button class="filter-btn" onclick="filterByClass('Class II', this)">Class II</button>
        <button class="filter-btn" onclick="filterByClass('Class III', this)">Class III</button>
      </div>
      <div id="recallList">${renderRecalls(data.recalls)}</div>
    `;
  } catch (e) {
    recallResult.innerHTML = error('Network error. Please check your connection.');
  } finally {
    recallBtn.disabled = false;
  }
}

recallBtn.addEventListener('click', checkRecalls);
recallInput.addEventListener('keydown', e => { if (e.key === 'Enter') checkRecalls(); });

let activeRecallClass = 'all';

function renderRecalls(list) {
  if (!list.length) return `<p style="color:var(--muted)">No recalls match this filter.</p>`;
  return list.map(r => {
    const cls = r.classification === 'Class I' ? 'class-i'
              : r.classification === 'Class II' ? 'class-ii' : 'class-iii';
    const date = r.date ? r.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : 'N/A';
    return `
      <div class="recall-card">
        <div class="recall-header">
          <span class="recall-brand">${escapeHtml(r.brand || '—')}</span>
          <span class="recall-class ${cls}">${escapeHtml(r.classification || 'Unknown')}</span>
        </div>
        <p class="recall-reason">${escapeHtml(r.reason || 'No reason provided.')}</p>
        <div class="recall-meta">Date: ${escapeHtml(date)} · Status: ${escapeHtml(r.status || 'N/A')} · Qty: ${escapeHtml(r.quantity || 'N/A')}</div>
      </div>
    `;
  }).join('');
}

function filterRecalls() {
  if (!window._recalls) return;
  const keyword = (document.getElementById('recallSearchFilter')?.value || '').toLowerCase();
  const filtered = window._recalls.filter(r => {
    const matchClass   = activeRecallClass === 'all' || r.classification === activeRecallClass;
    const matchKeyword = !keyword
      || (r.reason || '').toLowerCase().includes(keyword)
      || (r.brand  || '').toLowerCase().includes(keyword);
    return matchClass && matchKeyword;
  });
  document.getElementById('recallList').innerHTML = renderRecalls(filtered);
  const countEl = document.getElementById('recallCount');
  if (countEl) countEl.textContent = filtered.length;
}

function filterByClass(cls, btn) {
  activeRecallClass = cls;
  recallResult.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterRecalls();
}

// ── Init ───────────────────────────────────────────────────
updateCabinetBadge();
