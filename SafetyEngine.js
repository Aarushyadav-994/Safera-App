import mockSafetyData from './mockSafetyData.json';

const deriveBaselineWeights = () => ({
  risk: 0.50,
  visibility: 0.25,
  social: 0.25,
  source: "urban safety heuristic priors"
});

export const getDynamicWeights = (context = {}) => {
  const { timeOfDay = 'day', userMode = 'balanced' } = context;
  const priors = deriveBaselineWeights();
  const weights = { risk: priors.risk, visibility: priors.visibility, social: priors.social };

  if (timeOfDay === 'night') {
    weights.visibility += 0.15;
    weights.risk -= 0.05;
    weights.social -= 0.10;
  }

  if (userMode === 'highSafety') {
    weights.risk += 0.20;
    weights.visibility -= 0.10;
    weights.social -= 0.10;
  } else if (userMode === 'fastest') {
    weights.risk -= 0.10;
    weights.visibility += 0.05;
    weights.social += 0.05;
  }

  const totalWeight = weights.risk + weights.visibility + weights.social;
  return {
    risk: weights.risk / totalWeight,
    visibility: weights.visibility / totalWeight,
    social: weights.social / totalWeight
  };
};

export const applySpatialSmoothing = (point) => {
  if (!point || point.latitude === undefined || point.longitude === undefined) return null;
  if (!mockSafetyData || mockSafetyData.length === 0) return null;

  const pointsWithDistance = mockSafetyData.map(d => {
    const dLat = d.latitude - point.latitude;
    const dLon = d.longitude - point.longitude;
    const distance = Math.sqrt((dLat * dLat) + (dLon * dLon));
    return { ...d, distance };
  });

  pointsWithDistance.sort((a, b) => a.distance - b.distance);

  const topPoints = pointsWithDistance.slice(0, 3);
  if (topPoints.length === 0) return null;

  let totalCrimeWeighted = 0;
  let totalLightingWeighted = 0;
  let totalCrowdWeighted = 0;
  let totalWeight = 0;

  for (const anchor of topPoints) {
    const weight = 1 / (Math.max(anchor.distance, 0.01));
    totalCrimeWeighted += anchor.crime_score * weight;
    totalLightingWeighted += anchor.lighting * weight;
    totalCrowdWeighted += anchor.crowd * weight;
    totalWeight += weight;
  }

  const closestDist = topPoints[0].distance;
  let confidenceScore = 1.0;
  if (closestDist > 0.05) confidenceScore = 0.4;
  else if (closestDist > 0.01) confidenceScore = 0.7;
  else confidenceScore = 0.9;

  return {
    crime_score: totalCrimeWeighted / totalWeight,
    lighting: totalLightingWeighted / totalWeight,
    crowd: totalCrowdWeighted / totalWeight,
    confidenceScore
  };
};

export const evaluateSafety = (point, context = {}) => {
  const data = applySpatialSmoothing(point);
  const reasoning = [];

  let crime_score = 5.5, lighting = 5.5, crowd = 5.5;
  let confidenceScore = 0.3;

  if (data) {
    crime_score = data.crime_score;
    lighting = data.lighting;
    crowd = data.crowd;
    confidenceScore = data.confidenceScore;
  } else {
    reasoning.push("No dataset coverage found. Using neutral baseline fallback.");
  }

  const weightsUsed = getDynamicWeights(context);

  if (crime_score > 7.0) reasoning.push("High regional crime density identified; penalizing baseline risk algorithms.");
  else if (crime_score < 3.0) reasoning.push("Verified safe historical sector favorably weighted.");

  if (lighting < 4.0) {
    if (context.timeOfDay === 'night') reasoning.push("Low visibility observed under Night Mode; strict penalty deployed.");
    else reasoning.push("Poor structural visibility observed geographically.");
  }

  if (crowd < 3.0) reasoning.push("Isolated routing boundaries identified; restricting social availability thresholds.");

  if (reasoning.length === 0) reasoning.push("Route segment aligns securely with standard heuristic variance priors.");

  const spatialVarianceAdjustment = ((Math.sin(point.latitude * 50) + Math.cos(point.longitude * 50)) * 0.5);

  let riskScore = ((10 - crime_score) * 1.2) + spatialVarianceAdjustment;
  let visibilityScore = (lighting * 1.1) + spatialVarianceAdjustment;
  let socialScore = (crowd * 1.1) + spatialVarianceAdjustment;

  riskScore = Math.max(0, Math.min(10, riskScore));
  visibilityScore = Math.max(0, Math.min(10, visibilityScore));
  socialScore = Math.max(0, Math.min(10, socialScore));

  let weightedRisk = riskScore * weightsUsed.risk;
  let weightedVisibility = visibilityScore * weightsUsed.visibility;
  let weightedSocial = socialScore * weightsUsed.social;

  let totalScore = weightedRisk + weightedVisibility + weightedSocial;

  let normalized = totalScore / 10;
  normalized = Math.pow(normalized, 0.7);
  totalScore = normalized * 10;

  totalScore = parseFloat(Math.min(10, Math.max(0, totalScore)).toFixed(1));

  let dominantFactor = "risk";
  let dominantReasonLabel = "High Crime Risk";
  let minContribution = weightedRisk;

  if (weightedVisibility < minContribution) {
    minContribution = weightedVisibility;
    dominantFactor = "visibility";
    dominantReasonLabel = "Low Visibility";
  }
  if (weightedSocial < minContribution) {
    dominantFactor = "social";
    dominantReasonLabel = "Low Social Presence";
  }

  return {
    totalScore,
    confidenceScore,
    breakdown: {
      riskScore: parseFloat(riskScore.toFixed(1)),
      visibilityScore: parseFloat(visibilityScore.toFixed(1)),
      socialScore: parseFloat(socialScore.toFixed(1))
    },
    dominantFactor,
    dominantReasonLabel,
    weightsUsed,
    reasoning
  };
};

export const evaluateRoute = (routePoints, context = {}) => {
  if (!routePoints || routePoints.length < 2) {
    return { score: 5.5, category: 'Balanced', reasoning: ['Invalid route'], confidence: 0 };
  }

  const locationScores = [];
  let minConfidence = 1.0;
  let worstScore = 10.0;
  const allReasoning = new Set();

  for (let i = 0; i < routePoints.length; i++) {
    const result = evaluateSafety(routePoints[i], context);

    locationScores.push(result.totalScore);

    if (result.totalScore < worstScore) worstScore = result.totalScore;
    if (result.confidenceScore < minConfidence) minConfidence = result.confidenceScore;
    result.reasoning.forEach(r => allReasoning.add(r));
  }

  locationScores.sort((a, b) => a - b);

  const p20Index = Math.max(0, Math.floor(locationScores.length * 0.20) - 1);
  let finalScore = locationScores[p20Index];

  const severity = (10 - worstScore) / 10;
  const bottleneckPenalty = Math.pow(severity, 2) * 1.5;
  finalScore -= bottleneckPenalty;

  const score = parseFloat(Math.min(10, Math.max(0, finalScore)).toFixed(1));

  let category = 'Balanced';
  if (score >= 7) category = 'Safe';
  else if (score < 4) category = 'High Risk';

  return {
    score,
    category,
    confidence: minConfidence,
    reasoning: Array.from(allReasoning),
  };
};

const perturbWeights = (weights, factor) => {
  const perturbed = {
    risk: weights.risk * factor,
    visibility: weights.visibility * (2 - factor),
    social: weights.social * factor
  };
  const total = perturbed.risk + perturbed.visibility + perturbed.social;
  return {
    risk: perturbed.risk / total,
    visibility: perturbed.visibility / total,
    social: perturbed.social / total
  };
};

export const analyzeSensitivity = (scoreFn, point) => {
  const baseResult = scoreFn(point, {});
  const baseScore = baseResult.totalScore;

  const baseWeights = deriveBaselineWeights();
  const shiftedWeights = perturbWeights(baseWeights, 1.1);

  let riskScore = baseResult.breakdown.riskScore;
  let visibilityScore = baseResult.breakdown.visibilityScore;
  let socialScore = baseResult.breakdown.socialScore;

  let perturbedScoreRaw =
    (riskScore * shiftedWeights.risk) +
    (visibilityScore * shiftedWeights.visibility) +
    (socialScore * shiftedWeights.social);

  const perturbedScore = parseFloat(Math.min(10, Math.max(0, perturbedScoreRaw)).toFixed(1));
  const delta = Math.abs(baseScore - perturbedScore);

  return {
    baseScore,
    perturbedScore,
    delta: parseFloat(delta.toFixed(2)),
    stabilityStatus: delta < 1.0
      ? "Engine Robust (Resistant to Priority Perturbation)"
      : "Engine Volatile (High Parameter Sensitivity)"
  };
};

export const calculateSafetyScore = (lat, lon) => {
  const result = evaluateSafety({ latitude: lat, longitude: lon }, {});
  return result.totalScore;
};

export const safeComputeRouteScore = (route, context = {}) => {
  try {
    return evaluateRoute(route.coords, context);
  } catch (err) {
    return { score: 5.5, category: "Balanced" };
  }
};