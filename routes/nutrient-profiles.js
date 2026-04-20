// routes/nutrient-profiles.js -- Nutrient profiles API + tank-sharing compatibility
//
// Serves the nutrient-profiles.json data and provides a compatibility check
// endpoint for validating whether crops can share a nutrient tank.

import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';

const router = Router();

let profilesCache = null;

function loadProfiles() {
  if (profilesCache) return profilesCache;
  try {
    const raw = readFileSync(path.resolve('./public/data/nutrient-profiles.json'), 'utf-8');
    profilesCache = JSON.parse(raw);
    return profilesCache;
  } catch {
    return null;
  }
}

// GET /api/nutrient-profiles -- all profiles + compatibility matrix
router.get('/', (req, res) => {
  const data = loadProfiles();
  if (!data) return res.status(404).json({ ok: false, error: 'nutrient-profiles.json not found' });
  res.json({ ok: true, ...data });
});

// GET /api/nutrient-profiles/:profileId -- single profile
router.get('/:profileId', (req, res) => {
  const data = loadProfiles();
  if (!data) return res.status(404).json({ ok: false, error: 'nutrient-profiles.json not found' });
  const profile = data.profiles?.[req.params.profileId];
  if (!profile) return res.status(404).json({ ok: false, error: 'profile not found' });
  res.json({ ok: true, profileId: req.params.profileId, ...profile });
});

// POST /api/nutrient-profiles/check-compatibility -- check if crops can share a tank
// Body: { crops: ["crop-id-1", "crop-id-2", ...] }
router.post('/check-compatibility', (req, res) => {
  const data = loadProfiles();
  if (!data) return res.status(404).json({ ok: false, error: 'nutrient-profiles.json not found' });

  const crops = req.body?.crops;
  if (!Array.isArray(crops) || crops.length < 2) {
    return res.status(400).json({ ok: false, error: 'Provide at least 2 crop IDs in { crops: [...] }' });
  }

  const profiles = data.profiles || {};
  const matrix = data.compatibility_matrix || {};
  const scores = data.scoring_coefficients?.compatibility_scores || {};

  // Map each crop to its profile
  const cropProfiles = crops.map(cropId => {
    for (const [profileId, profile] of Object.entries(profiles)) {
      if (profile.compatible_crops?.includes(cropId)) {
        return { cropId, profileId, profile };
      }
    }
    return { cropId, profileId: null, profile: null };
  });

  const unmatched = cropProfiles.filter(cp => !cp.profileId);

  // Check pairwise compatibility
  const uniqueProfiles = [...new Set(cropProfiles.filter(cp => cp.profileId).map(cp => cp.profileId))];
  let worstRating = 'perfect';
  let worstScore = 100;
  const pairResults = [];
  const ratingOrder = { perfect: 5, good: 4, acceptable: 3, poor: 2, incompatible: 1 };

  for (let i = 0; i < uniqueProfiles.length; i++) {
    for (let j = i + 1; j < uniqueProfiles.length; j++) {
      const a = uniqueProfiles[i];
      const b = uniqueProfiles[j];
      const rating = matrix[a]?.[b] || matrix[b]?.[a] || 'unknown';
      const score = scores[rating] ?? 50;
      pairResults.push({ profileA: a, profileB: b, rating, score });
      if ((ratingOrder[rating] || 0) < (ratingOrder[worstRating] || 0)) {
        worstRating = rating;
        worstScore = score;
      }
    }
  }

  // Compute blended EC/pH target from the profiles
  const activeProfiles = cropProfiles.filter(cp => cp.profile);
  const avgEc = activeProfiles.length > 0
    ? +(activeProfiles.reduce((s, cp) => s + cp.profile.ec_target, 0) / activeProfiles.length).toFixed(2)
    : null;
  const avgPh = activeProfiles.length > 0
    ? +(activeProfiles.reduce((s, cp) => s + cp.profile.ph_target, 0) / activeProfiles.length).toFixed(2)
    : null;

  res.json({
    ok: true,
    compatible: worstRating !== 'incompatible',
    overall_rating: worstRating,
    overall_score: worstScore,
    crop_profiles: cropProfiles.map(cp => ({ cropId: cp.cropId, profileId: cp.profileId })),
    pair_results: pairResults,
    unmatched_crops: unmatched.map(u => u.cropId),
    blended_targets: { ec: avgEc, ph: avgPh },
    recommendation: worstRating === 'incompatible'
      ? 'These crops should NOT share a tank. Separate into different reservoirs.'
      : worstRating === 'poor'
        ? 'Tank sharing is possible but suboptimal. Consider separating if yield matters.'
        : 'These crops can share a tank safely.'
  });
});

// POST /api/nutrient-profiles/reload -- force reload from disk
router.post('/reload', (req, res) => {
  profilesCache = null;
  const data = loadProfiles();
  res.json({ ok: true, profileCount: data ? Object.keys(data.profiles || {}).length : 0 });
});

export default router;
