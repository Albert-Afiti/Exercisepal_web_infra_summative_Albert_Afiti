// ── Exercise images by body part / target ────────────────────────────────────
const EXERCISE_IMAGES = {
  'chest':      'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&q=80',
  'back':       'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=400&q=80',
  'shoulders':  'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?w=400&q=80',
  'upper arms': 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=400&q=80',
  'lower arms': 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=400&q=80',
  'upper legs': 'https://images.unsplash.com/photo-1434682881908-b43d0467b798?w=400&q=80',
  'lower legs': 'https://images.unsplash.com/photo-1434682881908-b43d0467b798?w=400&q=80',
  'waist':      'https://images.unsplash.com/photo-1571019613576-2b22c76fd955?w=400&q=80',
  'cardio':     'https://images.unsplash.com/photo-1538805060514-97d9cc17730c?w=400&q=80',
  'neck':       'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400&q=80',
};
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&q=80';

function exerciseImageURL(ex) {
  return EXERCISE_IMAGES[ex.bodyPart] || EXERCISE_IMAGES[ex.target] || FALLBACK_IMG;
}

// ── State ─────────────────────────────────────────────────────────────────────
let completedExercises = new Set();
let currentWorkout = null;
let weeklyLoaded = false;
let currentMode = 'gym'; // 'gym' or 'home'

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupTheme();
  setupHamburger();
  loadDaily();
  loadBodyParts();
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
  if (tab === 'weekly' && !weeklyLoaded) loadWeekly();
  // Close hamburger menu on mobile after selecting a tab
  document.getElementById('hamburger-btn').classList.remove('open');
  document.getElementById('tab-nav').classList.remove('open');
}

// ── Hamburger ─────────────────────────────────────────────────────────────────
function setupHamburger() {
  const btn = document.getElementById('hamburger-btn');
  const nav = document.getElementById('tab-nav');
  btn.addEventListener('click', () => {
    btn.classList.toggle('open');
    nav.classList.toggle('open');
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function setupTheme() {
  const btn = document.getElementById('theme-btn');
  if (localStorage.getItem('exercisepal_theme') === 'light') {
    document.body.classList.add('light');
    btn.innerHTML = '<i class="fas fa-moon"></i> Dark Mode';
  }
  btn.addEventListener('click', () => {
    document.body.classList.toggle('light');
    const isLight = document.body.classList.contains('light');
    localStorage.setItem('exercisepal_theme', isLight ? 'light' : 'dark');
    btn.innerHTML = isLight
      ? '<i class="fas fa-moon"></i> Dark Mode'
      : '<i class="fas fa-sun"></i> Light Mode';
  });
}

// ── Mode Toggle (Gym / Home) ──────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  document.getElementById('gym-btn').classList.toggle('active', mode === 'gym');
  document.getElementById('home-btn').classList.toggle('active', mode === 'home');
  loadDaily();
}

// ── Daily Workout ─────────────────────────────────────────────────────────────
async function loadDaily() {
  const el = document.getElementById('daily-content');
  el.innerHTML = loadingHTML('Loading today\'s workout…');

  try {
    // Get schedule info first
    const schedRes = await fetch('/api/exercises/daily');
    const schedData = await schedRes.json();
    if (!schedRes.ok) { el.innerHTML = errorHTML(schedData.error); return; }

    if (schedData.isRestDay) {
      el.innerHTML = restDayHTML();
      return;
    }

    // Fetch exercises based on mode
    let exercises = [];
    if (currentMode === 'home') {
      const homeRes = await fetch(`/api/exercises/home?bodyPart=${encodeURIComponent(schedData.bodyPart)}&limit=6`);
      const homeData = await homeRes.json();
      if (homeRes.ok && homeData.length) {
        exercises = homeData.map(ex => ({
          ...ex,
          sets: schedData.exercises[0]?.sets || 3,
          reps: schedData.exercises[0]?.reps || '12-15',
          rest: schedData.exercises[0]?.rest || '45 sec'
        }));
      } else {
        exercises = schedData.exercises;
      }
    } else {
      exercises = schedData.exercises;
    }

    currentWorkout = { ...schedData, exercises };
    completedExercises.clear();

    const modeLabel = currentMode === 'home'
      ? '<div class="home-badge"><i class="fas fa-house"></i> Home Workout — No Equipment Needed</div>'
      : '';

    el.innerHTML = `
      <div class="workout-header">
        <div class="workout-day">${escapeHTML(schedData.dayName)}</div>
        <h2 class="workout-title">${escapeHTML(schedData.focus)}</h2>
        <p class="workout-desc">${escapeHTML(schedData.description)}</p>
        ${modeLabel}
        <div class="progress-bar-bg" style="margin-top:16px">
          <div class="progress-bar" id="workout-progress" style="width:0%"></div>
        </div>
        <div class="progress-text">
          <span id="completed-count">0</span>/${exercises.length} exercises completed
        </div>
      </div>
      <div class="exercise-grid">
        ${exercises.map((ex, i) => exerciseCardHTML(ex, i, true)).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = errorHTML('Network error. Please check your connection.');
  }
}

function toggleDone(i) {
  const card = document.getElementById(`card-${i}`);
  const btn = card.querySelector('.btn-done');
  if (completedExercises.has(i)) {
    completedExercises.delete(i);
    card.classList.remove('done');
    btn.innerHTML = '<i class="fas fa-check"></i> Mark as Done';
  } else {
    completedExercises.add(i);
    card.classList.add('done');
    btn.innerHTML = '<i class="fas fa-check"></i> Done!';
  }
  const total = currentWorkout?.exercises?.length || 0;
  const pct = total > 0 ? (completedExercises.size / total * 100) : 0;
  document.getElementById('workout-progress').style.width = pct + '%';
  document.getElementById('completed-count').textContent = completedExercises.size;
}

// ── Exercise Library ──────────────────────────────────────────────────────────
async function loadBodyParts() {
  try {
    const res = await fetch('/api/exercises/bodyparts');
    const parts = await res.json();
    if (!res.ok) return;
    const select = document.getElementById('bodypart-filter');
    parts.forEach(part => {
      const opt = document.createElement('option');
      opt.value = part;
      opt.textContent = part.charAt(0).toUpperCase() + part.slice(1);
      select.appendChild(opt);
    });
  } catch (_) {}
}

const DIFFICULTY_ORDER = { beginner: 1, intermediate: 2, expert: 3 };

async function searchExercises() {
  const name = document.getElementById('exercise-search').value.trim();
  const bodyPart = document.getElementById('bodypart-filter').value;
  const sort = document.getElementById('sort-filter').value;
  const el = document.getElementById('library-results');

  if (name.length < 2 && !bodyPart) {
    el.innerHTML = errorHTML('Enter an exercise name (min 2 chars) or select a body part.');
    return;
  }

  el.innerHTML = loadingHTML('Searching exercises…');

  try {
    const url = name.length >= 2
      ? `/api/exercises/search?name=${encodeURIComponent(name)}&limit=12`
      : `/api/exercises/list?bodyPart=${encodeURIComponent(bodyPart)}&limit=12`;

    const res = await fetch(url);
    let data = await res.json();

    if (!res.ok) { el.innerHTML = errorHTML(data.error); return; }
    if (!data.length) { el.innerHTML = errorHTML('No exercises found. Try a different search.'); return; }

    // Sort
    if (sort === 'name-asc')        data = [...data].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'name-desc')  data = [...data].sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === 'difficulty-asc')  data = [...data].sort((a, b) => (DIFFICULTY_ORDER[a.difficulty] || 9) - (DIFFICULTY_ORDER[b.difficulty] || 9));
    else if (sort === 'difficulty-desc') data = [...data].sort((a, b) => (DIFFICULTY_ORDER[b.difficulty] || 9) - (DIFFICULTY_ORDER[a.difficulty] || 9));
    else if (sort === 'equipment')  data = [...data].sort((a, b) => (a.equipment || '').localeCompare(b.equipment || ''));

    el.innerHTML = `<div class="exercise-grid">${data.map((ex, i) => exerciseCardHTML(ex, i, false)).join('')}</div>`;
  } catch (err) {
    el.innerHTML = errorHTML('Network error. Please try again.');
  }
}

// ── Weekly Plan ───────────────────────────────────────────────────────────────
async function loadWeekly() {
  const el = document.getElementById('weekly-content');
  el.innerHTML = loadingHTML('Loading weekly plan…');
  try {
    const res = await fetch('/api/exercises/weekly');
    const plan = await res.json();

    el.innerHTML = `
      <div class="weekly-grid">
        ${plan.map(day => `
          <div class="day-card ${day.isRestDay ? 'rest-card' : ''} ${day.isToday ? 'today' : ''}">
            <div class="day-name">${escapeHTML(day.dayName)}</div>
            ${day.isToday ? '<div class="today-badge">Today</div>' : ''}
            <div class="day-focus">${escapeHTML(day.focus)}</div>
            <div class="day-desc">${escapeHTML(day.description)}</div>
            <div class="day-footer">
              ${day.isRestDay
                ? '<div class="rest-icon-sm"><i class="fas fa-bed"></i></div>'
                : `<div class="day-options">
                    <button class="day-opt-btn" onclick="loadDayExercises('${day.bodyPart}', '${day.focus}', 'gym')">
                      <i class="fas fa-dumbbell"></i> Gym
                    </button>
                    <button class="day-opt-btn" onclick="loadDayExercises('${day.bodyPart}', '${day.focus}', 'home')">
                      <i class="fas fa-house"></i> Home
                    </button>
                  </div>`
              }
            </div>
          </div>
        `).join('')}
      </div>
      <div id="day-exercises"></div>
    `;
    weeklyLoaded = true;
  } catch (err) {
    el.innerHTML = errorHTML('Network error. Please try again.');
  }
}

async function loadDayExercises(bodyPart, focus, mode) {
  const el = document.getElementById('day-exercises');
  const modeLabel = mode === 'home' ? 'Home' : 'Gym';
  el.innerHTML = loadingHTML(`Loading ${focus} — ${modeLabel} exercises…`);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Highlight the clicked button
  document.querySelectorAll('.day-opt-btn').forEach(b => b.classList.remove('active'));

  try {
    const url = mode === 'home'
      ? `/api/exercises/home?bodyPart=${encodeURIComponent(bodyPart)}&limit=6`
      : `/api/exercises/list?bodyPart=${encodeURIComponent(bodyPart)}&limit=6`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || !data.length) { el.innerHTML = errorHTML('No exercises found.'); return; }

    const icon = mode === 'home'
      ? '<i class="fas fa-house"></i>'
      : '<i class="fas fa-dumbbell"></i>';

    el.innerHTML = `
      <h3 class="section-title">${icon} ${escapeHTML(focus)} — ${modeLabel} Exercises</h3>
      <div class="exercise-grid">${data.map((ex, i) => exerciseCardHTML(ex, i, false)).join('')}</div>
    `;
  } catch (err) {
    el.innerHTML = errorHTML('Network error. Please try again.');
  }
}

// ── Nearby Gyms ───────────────────────────────────────────────────────────────
async function findGyms(useLocation) {
  const el = document.getElementById('gyms-list');
  el.innerHTML = loadingHTML('Finding gyms near you…');

  if (useLocation && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => fetchGyms(pos.coords.latitude, pos.coords.longitude),
      ()  => fetchGyms(-1.9441, 30.0619)
    );
  } else {
    await fetchGyms(-1.9441, 30.0619);
  }
}

async function fetchGyms(lat, lng) {
  const el = document.getElementById('gyms-list');
  try {
    const res = await fetch(`/api/gyms?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    if (!res.ok) { el.innerHTML = errorHTML(data.error); return; }

    if (!data.gyms.length) {
      el.innerHTML = errorHTML('No gyms found in this area. Data may not be complete for this location.');
      return;
    }

    el.innerHTML = `
      <p class="results-count">
        <i class="fas fa-location-dot"></i>
        ${data.total} gym${data.total !== 1 ? 's' : ''} found near Kigali
      </p>
      <div class="gym-list">
        ${data.gyms.map(gym => gymCardHTML(gym)).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = errorHTML('Network error. Please try again.');
  }
}

// ── HTML Builders ─────────────────────────────────────────────────────────────
function exerciseCardHTML(ex, i, showDone) {
  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' exercise tutorial')}`;
  return `
    <div class="exercise-card" id="card-${i}">
      <div class="exercise-gif-wrap">
        <img
          src="${exerciseImageURL(ex)}"
          alt="${escapeHTML(ex.name)}"
          loading="lazy"
          class="exercise-gif"
          onerror="this.src='${FALLBACK_IMG}'"
        >
        ${ex.difficulty ? `<div class="difficulty-badge difficulty-${escapeHTML(ex.difficulty)}">${escapeHTML(ex.difficulty)}</div>` : ''}
      </div>
      <div class="exercise-info">
        <h3 class="exercise-name">${escapeHTML(ex.name)}</h3>
        <div class="exercise-tags">
          <span class="tag target"><i class="fas fa-bullseye"></i>${escapeHTML(ex.target || '')}</span>
          <span class="tag equipment"><i class="fas fa-toolbox"></i>${escapeHTML(ex.equipment || '')}</span>
        </div>
        ${ex.description ? `<p class="exercise-desc">${escapeHTML(ex.description)}</p>` : ''}
        ${ex.sets ? `
          <div class="sets-reps">
            <i class="fas fa-fire"></i>
            ${ex.sets} sets &times; ${ex.reps} reps &nbsp;&middot;&nbsp; Rest ${ex.rest}
          </div>` : ''}
        ${ex.secondaryMuscles?.length ? `
          <div class="exercise-tags" style="margin-bottom:12px">
            ${ex.secondaryMuscles.slice(0,3).map(m => `<span class="tag secondary"><i class="fas fa-circle-dot"></i>${escapeHTML(m)}</span>`).join('')}
          </div>` : ''}
        ${ex.instructions?.length ? `
          <details class="instructions">
            <summary><i class="fas fa-list-ol"></i> Step-by-step instructions</summary>
            <ol>${ex.instructions.map(s => `<li>${escapeHTML(s)}</li>`).join('')}</ol>
          </details>` : ''}
        <div class="card-actions">
          <a href="${ytUrl}" target="_blank" rel="noopener" class="btn-youtube">
            <i class="fab fa-youtube"></i> Watch Tutorial
          </a>
          ${showDone ? `
            <button class="btn-done" onclick="toggleDone(${i})">
              <i class="fas fa-check"></i> Mark as Done
            </button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function gymCardHTML(gym) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${gym.lat},${gym.lon}`;
  return `
    <div class="gym-card">
      <div class="gym-header">
        <div>
          <div class="gym-name">${escapeHTML(gym.name)}</div>
          <div class="gym-address">
            <i class="fas fa-location-dot"></i>
            ${escapeHTML(gym.address)}
          </div>
        </div>
        ${gym.distance ? `<div class="gym-distance">${gym.distance} km</div>` : ''}
      </div>
      <div class="gym-details">
        ${gym.phone ? `<div class="gym-detail"><i class="fas fa-phone"></i>${escapeHTML(gym.phone)}</div>` : ''}
        ${gym.openingHours ? `<div class="gym-detail"><i class="fas fa-clock"></i>${escapeHTML(gym.openingHours)}</div>` : ''}
        ${gym.website ? `<div class="gym-detail"><i class="fas fa-globe"></i><a href="${escapeHTML(gym.website)}" target="_blank" rel="noopener">${escapeHTML(gym.website)}</a></div>` : ''}
      </div>
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="btn-maps">
        <i class="fas fa-map-location-dot"></i> Open in Google Maps
      </a>
    </div>
  `;
}

function restDayHTML() {
  return `
    <div class="rest-day">
      <div class="rest-photo-wrap">
        <img
          src="https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=600&q=80"
          alt="Rest and recovery"
          class="rest-photo"
          onerror="this.style.display='none'"
        >
        <div class="rest-photo-overlay">
          <i class="fas fa-bed rest-photo-icon"></i>
          <h2>Rest Day</h2>
        </div>
      </div>
      <p>Recovery is just as important as training. Your muscles grow while you rest!</p>
      <ul class="rest-tips">
        <li><i class="fas fa-person-walking"></i> Light stretching or yoga</li>
        <li><i class="fas fa-shoe-prints"></i> A gentle 20-minute walk</li>
        <li><i class="fas fa-droplet"></i> Drink plenty of water</li>
        <li><i class="fas fa-moon"></i> Aim for 7–9 hours of sleep</li>
        <li><i class="fas fa-bowl-food"></i> Eat nutritious food to fuel recovery</li>
        <li><i class="fas fa-bolt"></i> Come back stronger tomorrow!</li>
      </ul>
      <a href="https://www.youtube.com/results?search_query=rest+day+recovery+stretching+routine"
         target="_blank" rel="noopener" class="btn-youtube btn-youtube-lg">
        <i class="fab fa-youtube"></i> Watch Recovery Stretching Routine
      </a>
    </div>
  `;
}

function loadingHTML(msg) {
  return `<div class="loading"><div class="spinner"></div><p>${escapeHTML(msg)}</p></div>`;
}

function errorHTML(msg) {
  return `<div class="error-msg"><i class="fas fa-triangle-exclamation"></i>${escapeHTML(msg)}</div>`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
