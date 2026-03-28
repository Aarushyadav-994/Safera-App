# SAFERA 🛡️
**AI-Enhanced Navigation for Vulnerable Commuters**

Safera is a specialized navigation engine designed to prioritize **Personal Safety** over mere distance. Developed for high-stakes urban commuting, Safera analyzes real-time environmental data, infrastructure lighting, and community-sourced incident reports to provide secure transit corridors and live emergency support.

---

## 🌟 CORE FEATURES

### 📡 1. SOS Live-Mesh Tracking
*   **Encrypted Broadcast**: Instantly trigger an emergency protocol that generates a unique live-tracking ID.
*   **Multi-Contact Alert**: Automatically drafts and sends SMS notifications to all saved emergency contacts with a secure live-tracking link.
*   **Global Access via ngrok**: Leveraging secure tunnels to provide worldwide access to the live tracking dashboard even during local development.

### ⚠️ 2. Multi-Zone Proximity Alerts
*   **Safety Geofencing**: Real-time monitoring of three distinct risk tiers:
    *   🔴 **High-Risk Zones**: Areas with verified safety incidents.
    *   🟡 **Low Lighting**: Stretches with poor street illumination.
    *   🔵 **Isolated Areas**: Deserted paths with low footfall.
*   **Orthogonal Path Snapping**: Alerts are intelligently triggered only when the user’s navigation path physically intersects with a risk zone.

### 🎨 3. Safety-First UI/UX
*   **Visual Route Tiers**: Color-coded polylines (Green: Safest, Orange: Secure, Red: Rapid/Shortest) for intuitive decision-making.
*   **Nightwatch Mode**: High-contrast, dark-mode-first design for maximum visibility in low-light environments.
*   **iOS Native Optimization**: Forced custom rendering for Apple Maps to bypass system-blue route overrides.

---

## 🧠 THE SAFETY SCORE ALGORITHM
Safera's unique **Safety Score (0.0 - 10.0)** is calculated using a weighted multi-factor analysis:
*   **Infrastructure Lighting (30%)**: Verified data on street lamp density and functionality.
*   **Community Reports (40%)**: Aggregated "Safety Pins" submitted by real users on specific routes.
*   **Urban Geometry (20%)**: Analysis of "escapability" (narrow lanes vs. open roads) and proximity to safe-havens (Police stations, 24/7 shops).
*   **Temporal Risk (10%)**: Dynamic adjustment based on the time of day and historical incident windows.

---

## 🛠️ TECH STACK
*   **Frontend**: React Native (Expo SDK 51)
*   **Backend**: Node.js & Express (Real-time Tracker)
*   **External Engines**: 
    *   OpenRouteService (High-fidelity safety routing)
    *   Leaflet & OpenStreetMap (Dashboard visualization)
*   **Networking**: ngrok (Secure HTTPS Tunneling)

---

## 🚀 FUTURE ROADMAP: "SAFERA RESILIENCE"
*   **Offline Navigation**: Local caching of map tiles and safety datasets to ensure alerts continue in dead zones.
*   **P2P Mesh Network**: Bluetooth-based location sharing for emergencies without cellular connectivity.
*   **Predictive AI**: Machine learning models to predict path safety based on real-time crowd density and acoustic analysis.

---

## 🏗️ INSTALLATION & SETUP
1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/Aarushyadav-994/Safera-App.git
    ```
2.  **Start the Backend**:
    ```bash
    cd tracker-backend && npm start
    ```
3.  **Start the Secure Tunnel**:
    ```bash
    npx ngrok http 3000
    ```
4.  **Launch the App**:
    ```bash
    npx expo start
    ```

---
*Developed with ❤️ for the safety of our community.*