// SafetyEngine.js
export const calculateSafetyScore = (tierIndex, seed) => {
  try {
    let score = 0;
    
    // Tier 0 is the Longest route (Secure Corridor)
    // Tier 2 is the Shortest route (High Risk Shortcut)
    if (tierIndex === 0) {
      score = 7.5 + (seed * 2.3); // Scales between 7.5 and 9.8
    } else if (tierIndex === 1) {
      score = 5.5 + (seed * 1.9); // Scales between 5.5 and 7.4
    } else {
      score = 3.0 + (seed * 2.4); // Scales between 3.0 and 5.4
    }
    
    return parseFloat(score.toFixed(1));

  } catch (error) {
    console.error("Shield Engine Error - Using Fallback:", error);
    return 6.5; 
  }
};