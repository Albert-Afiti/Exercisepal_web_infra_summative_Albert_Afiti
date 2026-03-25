require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 600 }); // Increased to 10 mins
const PORT = process.env.PORT || 3000;

// Create an Axios instance with a timeout to prevent hanging
const api = axios.create({ timeout: 8000 });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000' }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Rate limit exceeded.' }
});
app.use('/api', limiter);
app.use(express.static('public'));

// ─── Helper: Smarter RxCUI Lookup ───────────────────────────────────────────
async function getRxCUI(drugName) {
  if (!drugName) return null;
  const cacheKey = `rxcui_${drugName.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Try exact match first
    let res = await api.get(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drugName)}`);
    let rxcui = res.data?.idGroup?.rxnormId?.[0];

    // If no exact match, try approximate matching (much more user friendly)
    if (!rxcui) {
      const approxRes = await api.get(`https://rxnav.nlm.nih.gov/REST/approximateMatch.json?name=${encodeURIComponent(drugName)}&maxEntries=1`);
      rxcui = approxRes.data?.approximateGroup?.candidate?.[0]?.rxcui;
    }

    if (rxcui) cache.set(cacheKey, rxcui);
    return rxcui;
  } catch (err) {
    console.error(`RxCUI Error for ${drugName}:`, err.message);
    return null;
  }
}

const fdaApiKey = () => process.env.FDA_API_KEY ? `&api_key=${process.env.FDA_API_KEY}` : '';

// ─── Route: Search drug info (Parallelized) ──────────────────────────────────
app.get('/api/drug/search', async (req, res) => {
  const name = req.query.name?.trim();
  if (!name || name.length < 2) return res.status(400).json({ error: 'Valid drug name required.' });

  const cacheKey = `drug_${name.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    // Fire both API requests simultaneously; use allSettled so RxCUI result is kept even if FDA fails
    const [fdaResult, rxcuiResult] = await Promise.allSettled([
      api.get(`https://api.fda.gov/drug/label.json?search=(openfda.brand_name:"${encodeURIComponent(name)}"+openfda.generic_name:"${encodeURIComponent(name)}")&limit=1${fdaApiKey()}`),
      getRxCUI(name)
    ]);

    if (fdaResult.status === 'rejected') {
      if (fdaResult.reason?.response?.status === 404) return res.status(404).json({ error: 'Drug not found in FDA database.' });
      return res.status(500).json({ error: 'Search failed.' });
    }

    const drug = fdaResult.value.data.results?.[0];
    if (!drug) return res.status(404).json({ error: 'Drug not found in FDA database.' });
    const rxcui = rxcuiResult.status === 'fulfilled' ? rxcuiResult.value : null;

    const result = {
      brand_name: drug.openfda?.brand_name?.[0] || name,
      generic_name: drug.openfda?.generic_name?.[0] || 'N/A',
      manufacturer: drug.openfda?.manufacturer_name?.[0] || 'N/A',
      purpose: drug.purpose?.[0] || null,
      warnings: drug.warnings?.[0] || drug.boxed_warning?.[0] || null,
      indications: drug.indications_and_usage?.[0] || null,
      dosage: drug.dosage_and_administration?.[0] || null,
      side_effects: drug.adverse_reactions?.[0] || null,
      contraindications: drug.contraindications?.[0] || null,
      rxcui // Now resolved in parallel
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ error: 'Drug not found in FDA database.' });
    res.status(500).json({ error: 'Search failed.' });
  }
});

// ─── Route: Interactions (Batch Resolved) ────────────────────────────────────
app.get('/api/drug/interactions', async (req, res) => {
  const { drugs } = req.query;
  if (!drugs) return res.status(400).json({ error: 'Drug list required.' });

  const drugList = [...new Set(drugs.split(',').map(d => d.trim()).filter(Boolean))];
  if (drugList.length < 2) return res.status(400).json({ error: 'Please provide at least 2 distinct drug names.' });
  if (drugList.length > 5) return res.status(400).json({ error: 'Maximum 5 drugs allowed.' });
  if (drugList.some(d => d.length < 2)) return res.status(400).json({ error: 'Each drug name must be at least 2 characters.' });

  const cacheKey = `interactions_${[...drugList].sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    // Resolve all RxCUIs in parallel
    const resolvedResults = await Promise.all(drugList.map(async (name) => ({
      name,
      rxcui: await getRxCUI(name)
    })));

    const validRxCUIs = resolvedResults.filter(r => r.rxcui);
    const unresolved = resolvedResults.filter(r => !r.rxcui).map(r => r.name);
    if (validRxCUIs.length < 2) {
      return res.status(400).json({ error: 'Could not resolve enough drug IDs.', unresolved });
    }

    const rxcuiString = validRxCUIs.map(r => r.rxcui).join('+');
    const interactionRes = await api.get(
      `https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis=${rxcuiString}`,
      { validateStatus: s => s < 500 }
    );

    // RxNorm returns 404 plain text when no interactions exist — treat as empty
    if (interactionRes.status === 404) {
      const result = { total: 0, drugs: validRxCUIs.map(r => r.name), unresolved, interactions: [] };
      cache.set(cacheKey, result);
      return res.json(result);
    }

    // Simplified extraction logic
    const interactions = [];
    const groups = interactionRes.data?.fullInteractionTypeGroup || [];
    groups.forEach(g => g.fullInteractionType?.forEach(fit => fit.interactionPair?.forEach(p => {
      interactions.push({
        drug1: p.interactionConcept?.[0]?.minConceptItem?.name || 'Unknown',
        drug2: p.interactionConcept?.[1]?.minConceptItem?.name || 'Unknown',
        severity: p.severity,
        description: p.description
      });
    })));

    const seen = new Set();
    const unique = interactions.filter(i => {
      const key = [i.drug1, i.drug2].sort().join('|');
      return seen.has(key) ? false : seen.add(key);
    });

    const result = { total: unique.length, drugs: validRxCUIs.map(r => r.name), unresolved, interactions: unique };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Interaction error:', err.message, err.code, err.response?.status);
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Request timed out. Try again.' });
    res.status(500).json({ error: 'Interaction check failed.' });
  }
});

// ─── Route: Recalls ──────────────────────────────────────────────────────────
app.get('/api/drug/recalls', async (req, res) => {
  const name = req.query.name?.trim();
  if (!name || name.length < 2) return res.status(400).json({ error: 'Valid drug name required.' });

  const cacheKey = `recalls_${name.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const response = await api.get(`https://api.fda.gov/drug/enforcement.json?search=product_description:"${encodeURIComponent(name)}"&limit=10${fdaApiKey()}`);
    const recalls = (response.data.results || []).map(r => ({
      brand: r.product_description,
      classification: r.classification,
      reason: r.reason_for_recall,
      status: r.status,
      date: r.recall_initiation_date,
      quantity: r.product_quantity
    }));
    const result = { total: recalls.length, recalls };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    if (err.response?.status === 404) return res.json({ total: 0, recalls: [] });
    res.status(500).json({ error: 'Recall lookup failed.' });
  }
});

app.listen(PORT, () => console.log(`Server on ${PORT}`));
