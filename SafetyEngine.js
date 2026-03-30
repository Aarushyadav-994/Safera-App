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

  // GEO-BASED VARIATION
  // Simulates spatial variation across sparse data points to prevent identical route metrics natively.
  const geoVariation = ((Math.sin(latitude * 50) + Math.cos(longitude * 50)) * 0.5);
  const adjustedScore = rawScore + geoVariation;

  // Clamp the score strictly between 0 and 10 and round to 1 decimal place
  const score = parseFloat(Math.min(10, Math.max(0, adjustedScore)).toFixed(1));

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
    if (!route || !route.coords || !Array.isArray(route.coords) || route.coords.length < 2) {
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

    let totalRisk = 0;
    let totalDistance = 0;

    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];

      if (!prev || !curr) continue;

      const dx = curr.latitude - prev.latitude;
      const dy = curr.longitude - prev.longitude;

      const segmentDistance = Math.sqrt(dx * dx + dy * dy);

      const segmentScore = calculateSafetyScore(curr.latitude, curr.longitude);

      if (isNaN(segmentScore)) continue;

      // Convert safety -> risk
      const segmentRisk = (10 - segmentScore);

      totalRisk += segmentRisk * segmentDistance;
      totalDistance += segmentDistance;
    }

    if (totalDistance === 0) {
      return { score: 5.5, category: "Balanced" };
    }

    const avgRisk = totalRisk / totalDistance;
    let finalScore = 10 - avgRisk;

    const exposurePenalty = Math.min(2, totalDistance * 20);
    finalScore -= exposurePenalty;

    finalScore = Math.min(10, Math.max(0, finalScore));
    const score = parseFloat(finalScore.toFixed(1));

    let category = "Balanced";
    if (score >= 7) category = "Safe";
    else if (score < 4) category = "High Risk";

    return { score, category };

  } catch (error) {
    console.warn("Safe scoring fallback triggered:", error);
    return { score: 5.5, category: "Balanced" };
  }
};