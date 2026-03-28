# SAFERA 🛡️
**AI-Enhanced Navigation for Secure Urban Commuting**

Safera is a specialized navigation engine designed to prioritize personal safety over traditional shortest-path routing. Unlike standard GPS apps that focus solely on distance or time, Safera analyzes infrastructure lighting, and community-sourced safety reports to recommend secure transit corridors for vulnerable commuters.

---

## 🌟 CORE FEATURES

### 📡 1. SOS Live-Mesh Tracking
*   **Encrypted Broadcast**: Instantly trigger an emergency protocol that generates a unique live-tracking ID.
*   **Multi-Contact Alert**: Automatically drafts and sends SMS notifications to all saved emergency contacts with a secure live-tracking link.
*   **Secure Tunneling**: Leveraging ngrok to provide worldwide access to the live tracking dashboard.

### ⚠️ 2. Multi-Zone Proximity Alerts
*   **Safety Geofencing**: Real-time monitoring of risk tiers:
    *   🔴 **High-Risk Zones**: Areas with verified safety incidents.
    *   🟡 **Low Lighting**: Stretches with poor street illumination.
    *   🔵 **Isolated Areas**: Deserted paths with low footfall.
*   **Path Intelligence**: Alerts are intelligently triggered only when the user’s navigation path intersects with a risk zone.

### 🎨 3. Safety-First UI/UX
*   **Visual Route Tiers**: Color-coded polylines (Green: Safest, Orange: Secure, Red: Rapid/Shortest) for intuitive decision-making.
*   **Nightwatch Mode**: High-contrast, dark-mode-first design for maximum visibility in low-light environments.
*   **Native Optimization**: Custom rendering for iOS to ensure consistent safety-tier colors.

---

## 🧠 THE SAFETY SCORE
Safera's unique **Safety Score (0.0 - 10.0)** balances multiple risk factors:
•  **Crime Metrics**: 40% weighting
•  **Community Feedback**: 35% weighting
•  **Lighting Quality**: 20% weighting
•  **Crowd Presence**: 5% weighting

Routes are categorized analytically:
•  **Safe (Green)**: Score ≥ 7.0
•  **Balanced (Blue)**: Score 4.0-6.9
•  **High Risk (Red)**: Score < 4.0

---

## 🛠️ TECH STACK
*   **Frontend**: React Native (Expo)
*   **Backend**: Node.js & Express (Real-time Tracker)
*   **Mapping**: Leaflet.js & OpenStreetMap
*   **Routing Engine**: OpenRouteService (ORS)
*   **Networking**: ngrok (Secure HTTPS Tunneling)

---

## 🏗️ INSTALLATION & SETUP

### Frontend
```bash
git clone https://github.com/Aarushyadav-994/Safera-App.git
cd Safera-App
npm install
npm start
```

### Backend (SOS Tracking)
```bash
cd tracker-backend
npm install
node server.js
```

---

## 👥 CONTRIBUTORS
•  **Aarush Yadav**
•  **Paavni Bansal**
•  **Devansh Rana**

---

## 📜 LICENSE
MIT License - see LICENSE file for details.
adav
•  Paavni Bansal
•  Devansh Rana

For academic or research use, please cite:

Yadav, A., Bansal, P., & Rana, D. (2026). Safera: AI-Enhanced Secure Navigation System.
Delhi Technological University.


## License

MIT License - see LICENSE file for details.