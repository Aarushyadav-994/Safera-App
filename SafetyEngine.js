// SafetyEngine.js
export const calculateSafetyScore = (point, mockData) => {
  if (!mockData || mockData.length === 0) return 5; // Default safe-ish score
  
  // For the hackathon demo, we just look at the first mock data entry 
  // that represents the IGDTUW area.
  const nearest = mockData[0]; 
  
  // Formula: Higher lighting/crowd is good, High crime is bad.
  const score = (nearest.lighting * 0.4) + (nearest.crowd * 0.4) - (nearest.crime_score * 0.2);
  
  return score; // Max possible score is around 8.0 with current formula
};