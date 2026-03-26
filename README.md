# SAFERA / 🛡️ 
**AI-Enhanced Secure Navigation for Vulnerable Commuters**

Safera is a specialized navigation engine developed at **Delhi Technological University (DTU)**. Unlike traditional GPS systems that optimize for the shortest distance, Safera prioritizes **Personal Safety** by analyzing urban geometry, lighting data, and community-sourced safety reports to provide secure transit corridors.

## 🚀 Key Features
* **Multi-Path Safety Analysis:** Choose between **Safest (Green)**, **Shortest (Red)**, and **Main Roads (Blue)**.
* **Dynamic Safety Scoring:** Real-time 0.0-10.0 ranking of routes based on environmental risk factors.
* **High-Readiness HUD:** A minimalist, dark-mode focused interface designed for low-light, high-stress scenarios.
* **Shield Initialization:** Secure user onboarding with integrated Emergency SOS protocols.
* **Last-Mile Precision:** Snap-to-gate routing for major institutions and transit hubs.

## 🛠️ Tech Stack
* **Frontend:** React Native (Expo)
* **Maps:** Google Maps API via `react-native-maps`
* **Routing Engine:** OpenRouteService (ORS) API
* **Icons:** Ionicons (Expo Vector Icons)
* **Version Control:** Git/GitHub with MIT Licensing

## 🧠 Technical Challenges Solved
* **Coordinate Jittering:** Implemented a custom lat/lng offset algorithm to prevent polyline overlap, ensuring multiple route options remain visually distinct.
* **Asynchronous Multi-Fetch:** Engineered a concurrent API calling structure to retrieve and compare three different routing profiles (Walking vs. Car vs. Recommended) in a single session.
* **Theme-Aware Branding:** Developed dynamic UI logic to ensure brand visibility and accessibility across both Daylight and Nightwatch modes.

## 🏗️ Local Setup
    **Clone the repository:**
   ```bash
   git clone [https://github.com/Aarushyadav-994/Safera-App.git](https://github.com/Aarushyadav-994/Safera-App.git)