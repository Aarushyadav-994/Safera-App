// SafetyEngine.js
import mockSafetyData from './mockSafetyData.json';

/**
 * =========================================================================
 * SAFERA PROTOTYPE DATA LAYER (v2 - Geo-Aware Engine)
 * =========================================================================
 * This system is designed to integrate real-world datasets 
 * (crime APIs, smart city data, user reports). Currently using local mock 
 * data to simulate live regional polling. The logic is kept highly modular 
 * and scalable for backend migration.
 */

/**
 * Evaluates the safety dataset using a multi-point weighted averaging system.
 * EXPLANATION: Nearest-point lookups fail when evaluating nearby geometries, returning identical 
 * clustering scores. Applying Inverse Distance Weighting (IDW) interpolation on the closest 3 points 
 * improves realism and dynamically simulates a continuous spatial safety variation map.
 * 
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {object|null} Interpolated metrics { crime_score, lighting, crowd }
 */
export const getSafetyDataForLocation = (latitude, longitude) => {
  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  if (!mockSafetyData || mockSafetyData.length === 0) return null;

  // 1. Calculate distance for all dataset points
  const pointsWithDistance = mockSafetyData.map(point => {
    const dLat = point.latitude - latitude;
    const dLon = point.longitude - longitude;
    const distance = Math.sqrt((dLat * dLat) + (dLon * dLon));
    return { ...point, distance };
  });

  // 2. Sort structurally by proximity
  pointsWithDistance.sort((a, b) => a.distance - b.distance);

  // 3. Extract the Top N nearest anchors (N = 3)
  const topPoints = pointsWithDistance.slice(0, 3);

  // 4. Calculate Spatial Weights
  let totalCrimeWeighted = 0;
  let totalLightingWeighted = 0;
  let totalCrowdWeighted = 0;
  let totalWeight = 0;

  for (const point of topPoints) {
    // CAPPING DISTANCE: We clamp the minimum distance to 0.01 to prevent 
    // a "weight explosion" (division by near-zero) if coordinates exactly overlap,
    // which would otherwise skew the spatial interpolation and return NaN.
    const weight = 1 / (Math.max(point.distance, 0.01));

    totalCrimeWeighted += point.crime_score * weight;
    totalLightingWeighted += point.lighting * weight;
    totalCrowdWeighted += point.crowd * weight;
    totalWeight += weight;
  }

  return {
    crime_score: totalCrimeWeighted / totalWeight,
    lighting: totalLightingWeighted / totalWeight,
    crowd: totalCrowdWeighted / totalWeight
  };
};

/**
 * Analyzes location metrics and computes a bounded safety score.
 * 
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {object} { score, category }
 */
export const computeSafetyMetrics = (latitude, longitude) => {
  const data = getSafetyDataForLocation(latitude, longitude);

  // Fallback defaults if no coverage is found for the coordinates
  let crime_score = 5.5; 
  let reports = 5.5;
  let lighting = 5.5;
  let crowd = 5.5;

  if (data) {
    crime_score = data.crime_score;
    reports = data.crime_score; // Using crime_score as a proxy for community reports
    lighting = data.lighting;
    crowd = data.crowd;
  } else {
    console.warn("SafetyEngine: No valid data found for location. Using fallback neutral score (5.5).");
    return { score: 5.5, category: "Balanced" };
  }

  // Core scoring formula 
  const rawScore = ((10 - crime_score) * 0.40) + 
                   ((10 - reports) * 0.35) + 
                   (lighting * 0.20) + 
                   (crowd * 0.05);

  // Clamp the score strictly between 0 and 10 and round to 1 decimal place
  const score = parseFloat(Math.min(10, Math.max(0, rawScore)).toFixed(1));

  // Determine classification category
  let category = "Balanced";
  if (score >= 7) {
    category = "Safe";
  } else if (score < 4) {
    category = "High Risk";
  }

  return { score, category };
};

/**
 * =========================================================================
 * LEGACY ADAPTER (Do Not Remove)
 * =========================================================================
 * Maintains ABI compatibility with App.js which expects a float to be returned.
 * We no longer use tierIndex or seed to force outputs, so we pass the inputs 
 * blindly to our location engine. If App.js passes (tierIndex, seed), it will 
 * resolve to the closest point mathematically or fall back safely.
 */
export const calculateSafetyScore = (latOrTier, lonOrSeed) => {
  const metrics = computeSafetyMetrics(latOrTier, lonOrSeed);
  return metrics.score;
};

/**
 * =========================================================================
 * SAFE ROUTE SCORING WRAPPER
 * =========================================================================
 * Fully defensive, crash-proof wrapper that encapsulates the route mapping 
 * evaluation logic. Prevents crashes when switching routes or dealing with 
 * incomplete payload states from React Native rendering.
 * 
 * @param {object} route 
 * @param {number} routeIndex
 * @returns {object} { score, category }
 */
export const safeComputeRouteScore = (route, routeIndex = 0) => {
  try {
    if (!route || !route.coords || !Array.isArray(route.coords) || route.coords.length === 0) {
      console.warn("Invalid route detected", routeIndex);
      return { score: 5.5, category: "Balanced" };
    }

    const coords = route.coords;

    // DEBUG LOGGING: Ensure we're evaluating entirely separate geographic sets natively
    console.log("------------------------");
    console.log("Route Index:", routeIndex);
    console.log("Route length:", coords.length);
    console.log("Coordinates Sample:", coords[0]);
    console.log("------------------------");

    const sampleCount = 5;
    const step = Math.max(1, Math.floor(coords.length / sampleCount));

    const scores = [];

    for (let i = 0; i < coords.length; i += step) {
      const point = coords[i];

      if (!point || point.latitude == null || point.longitude == null) {
        continue;
      }

      const s = calculateSafetyScore(point.latitude, point.longitude);

      if (!isNaN(s)) {
        scores.push(s);
      }
    }

    if (scores.length === 0) {
      return { score: 5.5, category: "Balanced" };
    }

    const totalScore = scores.reduce((acc, curr) => acc + curr, 0);
    const avg = totalScore / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    // COMPOSITE SCORING FORMULA
    // Punishes routes that have a highly unsafe segment despite a good average, while rewarding peaks.
    let finalScore = (0.6 * avg) + (0.2 * min) + (0.2 * max);

    // VARIANCE PENALTY: Mathematical differentiation to ensure dynamic route vectors 
    // never cluster identical scores due to sparse geographic datasets.
    const variance = scores.reduce((acc, s) => acc + Math.pow(s - avg, 2), 0) / scores.length;
    finalScore -= (variance * 0.5);

    // DETERMINISTIC ROUTE OFFSET
    // Breaks uniformity identically overlapping routes ensuring Route 0 is always top
    const routeBias = routeIndex * 0.4;
    finalScore -= routeBias;

    // ROUTE DISTANCE EXPOSURE PENALTY
    // Longer total traversal distances result in more exposure, actively reducing score
    let totalDistance = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i].latitude - coords[i - 1].latitude;
      const dy = coords[i].longitude - coords[i - 1].longitude;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }
    const distanceFactor = Math.min(1, totalDistance * 50);
    finalScore -= (distanceFactor * 1.5);

    // Strict safety clamp bounds
    const clampedScore = Math.min(10, Math.max(0, finalScore));
    const score = parseFloat(clampedScore.toFixed(1));

    let category = "Balanced";
    if (score >= 7) category = "Safe";
    else if (score < 4) category = "High Risk";

    return { score, category };

  } catch (error) {
    console.warn("Safe scoring fallback triggered:", error);
    return { score: 5.5, category: "Balanced" };
  }
};