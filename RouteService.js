// RouteService.js

const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjI1Yjg3OTdiYjFmYTQzMzQ5MDYwODk2MTNlZjQ3MjBhIiwiaCI6Im11cm11cjY0In0=';

const ROUTE_PROFILES = [
  { name: 'foot-walking', pref: 'recommended' },
  { name: 'foot-walking', pref: 'shortest' },
  { name: 'driving-car', pref: 'fastest' }
];

/**
 * Converts a string address (e.g., "Red Fort") into {latitude, longitude}
 */
export const getCoordsFromText = async (text) => {
  try {
    const url = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${text}&boundary.country=IN&size=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      return { latitude: lat, longitude: lng };
    }
    return null;
  } catch (e) { return null; }
};

export const fetchRealRoute = async (start, end) => {
  try {
    const routePromises = ROUTE_PROFILES.map(profile => {
      const url = `https://api.openrouteservice.org/v2/directions/${profile.name}?api_key=${ORS_API_KEY}&start=${start.longitude},${start.latitude}&end=${end.longitude},${end.latitude}&preference=${profile.pref}`;
      return fetch(url).then(res => res.json());
    });

    const results = await Promise.all(routePromises);

    return results.map((data, index) => {
      const feature = data.features[0];
      
      // 💡 THE TRICK: Add a tiny offset (0.0001) to Path 2 and Path 3 
      // This ensures they appear as separate colored lines on the map.
      const offset = index === 1 ? 0.00008 : index === 2 ? -0.00008 : 0;

      return {
        coords: feature.geometry.coordinates.map(c => ({
          latitude: c[1],
          longitude: c[0]
        })),
        displayCoords: feature.geometry.coordinates.map(c => ({
          latitude: c[1] + offset, 
          longitude: c[0] + offset
        })),
        distance: feature.properties.summary.distance,
        duration: feature.properties.summary.duration,
        id: index
      };
    });
  } catch (error) {
    console.error("Multi-Route Fetch Error:", error);
    return [];
  }
};

export const fetchRouteForProfile = async (start, end, profileIndex) => {
  const profile = ROUTE_PROFILES[profileIndex] || ROUTE_PROFILES[0];

  try {
    const url = `https://api.openrouteservice.org/v2/directions/${profile.name}?api_key=${ORS_API_KEY}&start=${start.longitude},${start.latitude}&end=${end.longitude},${end.latitude}&preference=${profile.pref}`;
    const response = await fetch(url);
    const data = await response.json();
    const feature = data?.features?.[0];

    if (!feature) {
      return null;
    }

    return {
      coords: feature.geometry.coordinates.map((c) => ({
        latitude: c[1],
        longitude: c[0]
      })),
      displayCoords: feature.geometry.coordinates.map((c) => ({
        latitude: c[1],
        longitude: c[0]
      })),
      distance: feature.properties.summary.distance,
      duration: feature.properties.summary.duration,
      id: profileIndex
    };
  } catch (error) {
    console.error('Single Route Fetch Error:', error);
    return null;
  }
};
