require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 600 });
const PORT = process.env.PORT || 3000;
const api = axios.create({ timeout: 12000 });

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000' }));
app.use(express.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Rate limit exceeded.' } });
app.use(limiter);
app.use(express.static('public'));

app.get('/ping', (req, res) => res.json({ ok: true }));

// ─── Debug: raw API response for one exercise ────────────────────────────────
app.get('/api/debug/exercise', async (req, res) => {
  try {
    const r = await api.get(
      'https://exercisedb.p.rapidapi.com/exercises/bodyPart/shoulders?limit=1&offset=0',
      { headers: exerciseHeaders() }
    );
    res.json(r.data[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ExerciseDB headers ───────────────────────────────────────────────────────
const exerciseHeaders = () => ({
  'X-RapidAPI-Key': process.env.RAPIDAPI_KEY || '',
  'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com'
});

// ─── Daily workout schedule (by day of week) ─────────────────────────────────
const SCHEDULE = {
  0: { focus: 'Rest Day',       bodyPart: null,         description: 'Recovery is just as important as training. Rest up today!' },
  1: { focus: 'Chest Day',      bodyPart: 'chest',      description: 'Build a stronger chest. Push hard and feel the burn!' },
  2: { focus: 'Back Day',       bodyPart: 'back',       description: 'Strengthen your back and improve your posture.' },
  3: { focus: 'Leg Day',        bodyPart: 'upper legs', description: 'No skipping leg day! Power up your lower body.' },
  4: { focus: 'Shoulder Day',   bodyPart: 'shoulders',  description: 'Broaden your shoulders and improve stability.' },
  5: { focus: 'Arms Day',       bodyPart: 'upper arms', description: 'Sculpt your biceps and triceps today.' },
  6: { focus: 'Core Day',       bodyPart: 'waist',      description: 'A strong core powers everything. Crush it!' }
};

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function getSetsReps(bodyPart) {
  if (bodyPart === 'waist') return { sets: 3, reps: '15-20', rest: '45 sec' };
  if (bodyPart === 'upper legs') return { sets: 4, reps: '10-15', rest: '90 sec' };
  return { sets: 4, reps: '8-12', rest: '60 sec' };
}

// ─── Haversine distance (km) ──────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1));
}

// ─── Route: Body parts list ───────────────────────────────────────────────────
app.get('/api/exercises/bodyparts', async (req, res) => {
  const cached = cache.get('bodyparts');
  if (cached) return res.json(cached);
  try {
    const r = await api.get('https://exercisedb.p.rapidapi.com/exercises/bodyPartList', { headers: exerciseHeaders() });
    cache.set('bodyparts', r.data);
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch body parts.' });
  }
});

// ─── Route: Exercises by body part ───────────────────────────────────────────
app.get('/api/exercises/list', async (req, res) => {
  const { bodyPart, limit = 10 } = req.query;
  if (!bodyPart) return res.status(400).json({ error: 'Body part required.' });

  const cacheKey = `list_${bodyPart}_${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await api.get(
      `https://exercisedb.p.rapidapi.com/exercises/bodyPart/${encodeURIComponent(bodyPart)}?limit=${limit}&offset=0`,
      { headers: exerciseHeaders() }
    );
    cache.set(cacheKey, r.data);
    res.json(r.data);
  } catch (err) {
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Request timed out.' });
    res.status(500).json({ error: 'Failed to fetch exercises.' });
  }
});

// ─── Route: Search exercises by name ─────────────────────────────────────────
app.get('/api/exercises/search', async (req, res) => {
  const { name, limit = 12 } = req.query;
  if (!name || name.length < 2) return res.status(400).json({ error: 'Search term must be at least 2 characters.' });

  const cacheKey = `search_${name.toLowerCase()}_${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await api.get(
      `https://exercisedb.p.rapidapi.com/exercises/name/${encodeURIComponent(name.toLowerCase())}?limit=${limit}&offset=0`,
      { headers: exerciseHeaders() }
    );
    cache.set(cacheKey, r.data);
    res.json(r.data);
  } catch (err) {
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Request timed out.' });
    res.status(500).json({ error: 'Search failed.' });
  }
});

// ─── Route: Today's workout ───────────────────────────────────────────────────
app.get('/api/exercises/daily', async (req, res) => {
  const day = new Date().getDay();
  const schedule = SCHEDULE[day];

  if (!schedule.bodyPart) {
    return res.json({ focus: schedule.focus, description: schedule.description, exercises: [], isRestDay: true, day, dayName: DAY_NAMES[day] });
  }

  const cacheKey = `daily_${day}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await api.get(
      `https://exercisedb.p.rapidapi.com/exercises/bodyPart/${encodeURIComponent(schedule.bodyPart)}?limit=6&offset=0`,
      { headers: exerciseHeaders() }
    );

    const setsReps = getSetsReps(schedule.bodyPart);
    const exercises = r.data.map(ex => ({
      ...ex,
      secondaryMuscles: ex.secondaryMuscles || [],
      instructions: (ex.instructions || []).slice(0, 5),
      sets: setsReps.sets,
      reps: setsReps.reps,
      rest: setsReps.rest
    }));

    const result = { focus: schedule.focus, description: schedule.description, bodyPart: schedule.bodyPart, exercises, isRestDay: false, day, dayName: DAY_NAMES[day] };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (err) {
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Request timed out.' });
    res.status(500).json({ error: 'Failed to load daily workout.' });
  }
});

// ─── Route: Weekly plan ───────────────────────────────────────────────────────
app.get('/api/exercises/weekly', (req, res) => {
  const today = new Date().getDay();
  const plan = Object.entries(SCHEDULE).map(([d, info]) => ({
    day: parseInt(d),
    dayName: DAY_NAMES[parseInt(d)],
    focus: info.focus,
    bodyPart: info.bodyPart,
    description: info.description,
    isToday: parseInt(d) === today,
    isRestDay: !info.bodyPart
  }));
  res.json(plan);
});

// ─── Route: Nearby gyms (OpenStreetMap Overpass API) ─────────────────────────
app.get('/api/gyms', async (req, res) => {
  const lat = parseFloat(req.query.lat) || -1.9441;  // Default: Kigali center
  const lng = parseFloat(req.query.lng) || 30.0619;

  const cacheKey = `gyms_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const query = `[out:json][timeout:25];
(
  node["leisure"="fitness_centre"](around:15000,${lat},${lng});
  node["leisure"="sports_centre"](around:15000,${lat},${lng});
  node["sport"="fitness"](around:15000,${lat},${lng});
  way["leisure"="fitness_centre"](around:15000,${lat},${lng});
  way["leisure"="sports_centre"](around:15000,${lat},${lng});
);
out body center;`;

  try {
    const r = await api.post('https://overpass-api.de/api/interpreter', query, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 20000
    });

    const gyms = (r.data.elements || [])
      .filter(el => el.tags)
      .map(el => {
        const elLat = el.lat || el.center?.lat;
        const elLon = el.lon || el.center?.lon;
        return {
          id: el.id,
          name: el.tags.name || el.tags['name:en'] || 'Fitness Center',
          address: [el.tags['addr:street'], el.tags['addr:suburb'], el.tags['addr:city']].filter(Boolean).join(', ') || 'Kigali, Rwanda',
          phone: el.tags.phone || el.tags['contact:phone'] || null,
          website: el.tags.website || el.tags['contact:website'] || null,
          openingHours: el.tags.opening_hours || null,
          lat: elLat,
          lon: elLon,
          distance: elLat && elLon ? getDistance(lat, lng, elLat, elLon) : null
        };
      })
      .filter(g => g.lat && g.lon)
      .sort((a, b) => (a.distance || 999) - (b.distance || 999))
      .slice(0, 15);

    const result = { total: gyms.length, gyms, searchLat: lat, searchLng: lng };
    cache.set(cacheKey, result, 1800);
    res.json(result);
  } catch (err) {
    console.error('Gyms error:', err.message);
    res.status(500).json({ error: 'Failed to fetch nearby gyms. Please try again.' });
  }
});

// ─── Route: Home workout (body weight only) ──────────────────────────────────
app.get('/api/exercises/home', async (req, res) => {
  const { bodyPart, limit = 6 } = req.query;
  if (!bodyPart) return res.status(400).json({ error: 'Body part required.' });

  const cacheKey = `home_${bodyPart}_${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await api.get(
      `https://exercisedb.p.rapidapi.com/exercises/bodyPart/${encodeURIComponent(bodyPart)}?limit=50&offset=0`,
      { headers: exerciseHeaders() }
    );

    // Try body weight first, then expand to other no-gym equipment progressively
    const noGymEquipment = ['body weight', 'band', 'resistance band', 'dumbbell', 'kettlebell', 'medicine ball'];
    let results = r.data.filter(ex => ex.equipment === 'body weight');
    if (results.length < 3) {
      results = r.data.filter(ex => ['body weight', 'band', 'resistance band'].includes(ex.equipment));
    }
    if (results.length < 3) {
      results = r.data.filter(ex => noGymEquipment.includes(ex.equipment));
    }
    if (results.length < 3) {
      results = r.data; // fallback: return any exercises for this body part
    }

    const setsReps = getSetsReps(bodyPart);
    const exercises = results.slice(0, parseInt(limit)).map(ex => ({
      ...ex,
      secondaryMuscles: ex.secondaryMuscles || [],
      instructions: (ex.instructions || []).slice(0, 5),
      sets: setsReps.sets,
      reps: setsReps.reps,
      rest: setsReps.rest
    }));

    cache.set(cacheKey, exercises);
    res.json(exercises);
  } catch (err) {
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Request timed out.' });
    res.status(500).json({ error: 'Failed to fetch home exercises.' });
  }
});

app.listen(PORT, () => console.log(`ExercisePal server running on port ${PORT}`));
