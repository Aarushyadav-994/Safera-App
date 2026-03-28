// SafetyEngine.js
export const calculateSafetyScore = (tierIndex, seed) => {
  try {
    let C, R, L, Cr;

    // We generate the variables based on the Tier to ensure the 
    // formula results in a score that matches our Green/Blue/Red UI.
    if (tierIndex === 0) { 
      C = (seed * 2);      
      R = (seed * 2);      
      L = 8 + (seed * 2);  
      Cr = 7 + (seed * 3); 
    } else if (tierIndex === 1) { 
      C = 3 + (seed * 2);  
      R = 3 + (seed * 3);  
      L = 5 + (seed * 2);  
      Cr = 4 + (seed * 3); 
    } else { 
      C = 6 + (seed * 4);  
      R = 7 + (seed * 3);  
      L = (seed * 3);      
      Cr = (seed * 3);     
    }

    const score = ((10 - C) * 0.40) + ((10 - R) * 0.35) + (L * 0.20) + (Cr * 0.05);

    return parseFloat(Math.min(10, Math.max(0, score)).toFixed(1));

  } catch (error) {
    console.error("Formula Error:", error);
    return 6.5; 
  }
};