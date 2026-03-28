const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-Memory Storage for Active Emergencies
// Map: emergencyId => { lat, lng, timestamp, startedFrom, destination }
const activeEmergencies = new Map();

// API: Accept Location Updates
app.post('/update-location', (req, res) => {
  const { emergencyId, lat, lng, startedFrom, destination, timestamp } = req.body;

  if (!emergencyId || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Invalid payload.' });
  }

  // Update or insert the emergency record
  const currentData = activeEmergencies.get(emergencyId) || {
    startedFrom: startedFrom || 'Unknown',
    destination: destination || 'Unknown'
  };

  currentData.lat = lat;
  currentData.lng = lng;
  currentData.timestamp = timestamp || Date.now();
  
  // If the mobile app sent updated route info, capture it
  if (startedFrom) currentData.startedFrom = startedFrom;
  if (destination) currentData.destination = destination;

  activeEmergencies.set(emergencyId, currentData);
  
  console.log(`[SYS] Location updated for ${emergencyId} -> ${lat}, ${lng}`);
  res.json({ success: true, recordedAt: currentData.timestamp });
});

// ---------------------------------------------------------
// 2. API: Fetch Latest Location (Used by the Frontend View)
// ---------------------------------------------------------
app.get('/api/location/:emergencyId', (req, res) => {
  const { emergencyId } = req.params;
  const data = activeEmergencies.get(emergencyId);
  
  if (!data) {
    return res.status(404).json({ error: 'Emergency ID not found or expired.' });
  }
  
  res.json(data);
});

// ---------------------------------------------------------
// 3. WEB VIEW: Serve the Live Tracking HTML Page
// ---------------------------------------------------------
app.get('/live/:emergencyId', (req, res) => {
  const { emergencyId } = req.params;

  // If we don't know the ID yet, we still serve the page but it might say "Waiting for signal..."
  
  // Using Leaflet (OpenStreetMap) to avoid needing Google API keys for quick setup
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>SOS Live Tracking</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    #map { height: 100vh; width: 100vw; }
    #overlay {
      position: absolute;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      padding: 15px 25px;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 1000;
      text-align: center;
      min-width: 250px;
    }
    .title { color: #FF3B30; font-weight: bold; font-size: 18px; margin-bottom: 5px; }
    .status { color: #555; font-size: 14px; }
    .pulse {
      display: inline-block;
      width: 10px;
      height: 10px;
      background: #FF3B30;
      border-radius: 50%;
      margin-right: 8px;
    }
  </style>
</head>
<body>
  <div id="overlay">
    <div class="title"><span class="pulse"></span> LIVE SOS TRACKING</div>
    <div class="status" id="status-text">Connecting to device...</div>
    <div class="status" style="font-size: 11px; margin-top: 5px;" id="route-info"></div>
  </div>
  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const emergencyId = "${emergencyId}";
    let map = null;
    let marker = null;
    let isFirstLoad = true;
    
    // Initialize empty map centered globally
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    // Custom Red Icon for SOS
    const redIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    async function fetchLocation() {
      try {
        const response = await fetch('/api/location/' + emergencyId);
        if (!response.ok) {
          document.getElementById('status-text').innerText = "Waiting for GPS signal...";
          return;
        }
        
        const data = await response.json();
        const { lat, lng, timestamp, startedFrom, destination } = data;
        
        // Update Marker
        if (!marker) {
          marker = L.marker([lat, lng], {icon: redIcon}).addTo(map);
        } else {
          marker.setLatLng([lat, lng]);
        }
        
        // Pan Map
        if (isFirstLoad) {
          map.setView([lat, lng], 17);
          isFirstLoad = false;
        }

        // Calculate time since last ping
        const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);
        let timeStr = secondsAgo < 10 ? "Just now" : secondsAgo + " seconds ago";
        if (secondsAgo > 60) {
          timeStr = Math.floor(secondsAgo / 60) + " min ago";
        }
        
        document.getElementById('status-text').innerText = "Last seen: " + timeStr;
        if (startedFrom && destination) {
           document.getElementById('route-info').innerText = startedFrom + " ➔ " + destination;
        }

      } catch (err) {
        console.error(err);
        document.getElementById('status-text').innerText = "Connection lost. Reconnecting...";
      }
    }

    // Poll every 5 seconds
    fetchLocation();
    setInterval(fetchLocation, 5000);
  </script>
</body>
</html>
  `;

  res.send(html);
});

// Start Server
app.listen(PORT, () => {
  console.log('[SYS] Tracker Backend listening on port ' + PORT);
});
