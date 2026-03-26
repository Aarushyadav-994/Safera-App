// SafetyEngine.js
export const calculateSafetyScore = (tierIndex, seed) => {
  try {
    let C, R, L, Cr;

    // We generate the variables based on the Tier to ensure the 
    // formula results in a score that matches our Green/Blue/Red UI.
    if (tierIndex === 0) { // Green Tier (Safe)
      C = (seed * 2);      // Crime is low (0-2)
      R = (seed * 2);      // Reports are low (0-2)
      L = 8 + (seed * 2);  // Lighting is high (8-10)
      Cr = 7 + (seed * 3); // Crowd is high (7-10)
    } else if (tierIndex === 1) { // Blue Tier (Balanced)
      C = 3 + (seed * 2);  // Crime is mid (3-5)
      R = 3 + (seed * 3);  // Reports are mid (3-6)
      L = 5 + (seed * 2);  // Lighting is mid (5-7)
      Cr = 4 + (seed * 3); // Crowd is mid (4-7)
    } else { // Red Tier (High Risk)
      C = 6 + (seed * 4);  // Crime is high (6-10)
      R = 7 + (seed * 3);  // Reports are high (7-10)
      L = (seed * 3);      // Lighting is low (0-3)
      Cr = (seed * 3);     // Crowd is low (0-3)
    }

    // --- THE FORMULA FROM THE SLIDE ---
    // S = [(10 - C) * 0.40] + [(10 - R) * 0.35] + [L * 0.20] + [Cr * 0.05]
    const score = ((10 - C) * 0.40) + ((10 - R) * 0.35) + (L * 0.20) + (Cr * 0.05);

    return parseFloat(Math.min(10, Math.max(0, score)).toFixed(1));

  } catch (error) {
    console.error("Formula Error:", error);
    return 6.5; 
  }
};