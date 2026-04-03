# SAFERA

Safera is a specialized navigation engine designed to prioritize personal safety over traditional shortest-path routing. Unlike standard GPS apps that focus solely on distance or time, Safera analyzes urban geometry, lighting conditions, and community-sourced safety reports to recommend secure transit corridors. This project emerged from research into commuter safety in urban environments, particularly for vulnerable groups like women and students traveling alone.

## Research Background

This application stems from a research investigation into urban safety navigation. The core hypothesis was that incorporating real-time safety metrics—such as crime rates, lighting quality, and crowd density—could significantly improve route recommendations for at-risk commuters. Our study collected safety data from various urban locations and developed a context-aware scoring algorithm that balances multiple risk factors dynamically.

The safety engine uses a three-category weighting system with adaptive context shifts:

| Category | Baseline Weight | Description |
|----------|----------------|-------------|
| Risk | 50% | Crime metrics and route isolation |
| Visibility | 25% | Street lighting quality |
| Social | 25% | Pedestrian crowd density |

Weights are dynamically adjusted at runtime based on time-of-day and user mode (see Safety Algorithm Details).

## Project Structure

```
Safera-App/
├── App.js                    # Main application component with navigation logic
├── AuthScreen.js             # User authentication (login/signup)
├── SafetyEngine.js           # Context-aware safety scoring engine (v3)
├── RouteService.js           # API integration with OpenRouteService
├── userDatabase.js           # User management, storage, and account deletion
├── tripReports.js            # Trip history and safety reporting
├── mockSafetyData.json       # Sample safety data for testing
├── File.html                 # Standalone SOS tracker web view
├── app.json                  # Expo configuration
├── package.json              # Frontend dependencies
├── index.js                  # App entry point
├── LICENSE                   # MIT License
├── assets/                   # App icons and images
│   ├── adaptive-icon.png     # Android adaptive launcher icon
│   ├── icon.png              # App icon
│   ├── splash-icon.png       # Splash screen image
│   ├── snack-icon.png        # Expo Snack preview icon
│   └── favicon.png           # Web favicon
├── components/               # Reusable UI components
│   └── AssetExample.js       # Example component (can be removed)
└── tracker-backend/          # SOS tracking server
    ├── server.js             # Express server for live location tracking
    ├── package.json          # Backend dependencies
    └── .gitignore            # Backend-specific ignore rules
```

## Data Dictionary

### Safety Data (mockSafetyData.json)
This JSON file contains sample safety metrics. Each entry includes:

| Field | Type | Description | Units/Range |
|-------|------|-------------|-------------|
| name | string | Location identifier/name | Free text |
| latitude | number | Geographic latitude | Decimal degrees (-90 to 90) |
| longitude | number | Geographic longitude | Decimal degrees (-180 to 180) |
| crime_score | integer | Crime risk rating | 0-10 (0 = safest, 10 = highest risk) |
| lighting | integer | Street lighting quality | 0-10 (0 = no lighting, 10 = excellent) |
| crowd | integer | Pedestrian density | 0-10 (0 = deserted, 10 = very crowded) |

### User Data Structure
Users are stored locally with the following fields:
- id: Unique identifier (timestamp-based)
- username: Login username
- mobile: 10-digit mobile number (normalized)
- password: Plain text password (for demo purposes)
- profileName: Display name
- email: Email address
- emergencyContact1/2: Emergency contact numbers
- createdAt: ISO timestamp

### Trip Reports
Safety reports submitted by users contain:
- Location coordinates (pinned on map by user)
- Safety concerns (crime, lighting, isolation)
- Timestamp
- User ID

## Installation and Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g @expo/cli`)
- For iOS: Xcode (macOS only)
- For Android: Android Studio or Expo Go app

### Frontend Setup
```bash
git clone https://github.com/Aarushyadav-994/Safera-App.git
cd Safera-App
npm install
npm start
```

### Backend Setup (for SOS Tracking)
```bash
cd tracker-backend
npm install
node server.js
```

The backend runs on port 3000 by default. For production, set the PORT environment variable.

## Usage

1. **Registration**: Create an account with username, mobile, and emergency contacts
2. **Route Planning**: Enter start and destination locations
3. **Safety Analysis**: View up to three deduplicated route options:
   - Green: Safest route (highest P20 safety score)
   - Blue: Balanced route
   - Red: Highest risk / shortest route
4. **Navigation**: Start turn-by-turn navigation with real-time proximity alerts and a live visited-path trail
5. **SOS Mode**: Activate emergency tracking that shares live location with contacts via SMS
6. **Safety Reports**: Tap any route to drop a pin and submit a community safety report
7. **Account Management**: Update profile details or permanently delete your account from the Profile screen

## API Integration

### OpenRouteService (ORS)
- Purpose: Geocoding and multi-modal routing
- API Key: Included in RouteService.js
- Endpoints Used:
  - Geocoding: `/geocode/search`
  - Directions: `/v2/directions/{profile}`

### Google Maps
- Purpose: Map display and location services
- Configuration: Set up API key in app.json for production builds

## Safety Algorithm Details

### Overview
The safety engine (SafetyEngine.js v3) is a context-aware, explainable scoring pipeline. It evaluates every coordinate on a route individually (not weighted by segment length) and produces a P20-based final score to prevent any single dangerous corridor from being masked by a long safe stretch.

### Step 1 — Spatial Smoothing via IDW
For every route coordinate, safety metrics are interpolated from the 3 nearest data anchors using **Inverse Distance Weighting (IDW)**:

```
weight_i = 1 / distance_i
smoothed_metric = Σ(metric_i × weight_i) / Σ(weight_i)
```

A confidence score is also computed based on proximity to the nearest anchor:
- `≤ 0.01°` → 0.9 (High / direct mapping)
- `≤ 0.05°` → 0.7 (Medium / inferred)
- `> 0.05°` → 0.4 (Low / fallback)

### Step 2 — Dynamic Context Weights
Baseline weights (`Risk 50%, Visibility 25%, Social 25%`) are shifted based on runtime context:

| Context | Adjustment |
|---------|-----------|
| `timeOfDay: "night"` | Visibility +15%, Risk −5%, Social −10% |
| `userMode: "highSafety"` | Risk +20%, Visibility −10%, Social −10% |
| `userMode: "fastest"` | Risk −10%, Visibility +5%, Social +5% |

All adjusted weights are re-normalized to sum to 1.0 before use.

### Step 3 — Per-Location Score
Each location is scored out of 10 using the weighted formula below, with a controlled spatial variance adjustment to prevent score plateaus in sparse datasets:

```
spatialVariance = (sin(lat × 50) + cos(lon × 50)) × 0.5

riskScore       = ((10 - crime_score) × 1.2) + spatialVariance   [clamped 0–10]
visibilityScore = (lighting × 1.1) + spatialVariance              [clamped 0–10]
socialScore     = (crowd × 1.1) + spatialVariance                 [clamped 0–10]

rawScore = (riskScore × w_risk) + (visibilityScore × w_visibility) + (socialScore × w_social)
```

A **Gamma Correction** is then applied to expand safe score clusters upward:
```
normalized = rawScore / 10
finalScore = pow(normalized, 0.7) × 10
```

### Step 4 — P20 Route Score
All per-location scores across the route are collected and sorted. The final route score is the **20th percentile** value — reflecting how safe the worst fifth of the route actually is:

```
p20Index   = floor(numLocations × 0.20) - 1
finalScore = locationScores[p20Index] − bottleneckPenalty
```

A **bottleneck penalty** is applied when there is a single location more dangerous than P20:
```
severity         = (10 - worstScore) / 10
bottleneckPenalty = severity² × 1.5
```

This design means route length has zero influence on ranking — a safe 10km route cannot outscore a dangerous 500m shortcut just because most of it is safe.

### Route Categories

| Category | Score Range | Map Color |
|----------|-------------|-----------|
| Safe | ≥ 7.0 | Green |
| Balanced | 4.0 – 6.9 | Blue |
| High Risk | < 4.0 | Red |

### Explainability
Each evaluation returns a full reasoning trace:
- `reasoning[]` — human-readable causal notes (e.g., "High regional crime density identified")
- `dominantFactor` — which category most dragged the score down
- `dominantReasonLabel` — label shown in the UI (e.g., "Low Visibility")
- `breakdown` — individual `riskScore`, `visibilityScore`, `socialScore`
- `confidenceScore` — data reliability indicator

## Route Deduplication

Before presenting routes to the user, a spatial deduplication pass filters overlapping paths:

1. Each route's coordinates are bucketed to a 100m grid
2. Routes sharing ≥ 60% of their grid cells are considered duplicates
3. From each duplicate cluster, only the highest-scoring (safest) route is retained
4. A maximum of 3 distinct routes are shown

This ensures the three presented options represent genuinely different paths rather than minor variations of the same corridor.

## Navigation Features

### Visited Path Trail
During active navigation, the portion of the route already traversed is rendered as a **gray trail** beneath the active blue polyline. Z-index layering (gray below blue) ensures the active path is always clearly visible.

### Proximity Alerts
Real-time alerts trigger when the user enters zones flagged for:
- **Danger** — high crime score areas
- **Low Lighting** — poor visibility corridors
- **Isolation** — low crowd density segments

Alert IDs are generated using a **coordinate-based hash** (rounded to 3 decimal places), ensuring the same physical zone always produces the same alert ID. This prevents duplicate alerts and supports reliable dismiss-and-re-enter behavior: a dismissed alert resets when the user leaves and re-enters the zone.

## Account Management

Users can permanently delete their account from the Profile screen. The `deleteAccount()` function in `userDatabase.js`:
1. Removes the user record from local AsyncStorage
2. Clears the active session
3. Returns the user to the authentication screen

## Data Sources

- OpenRouteService: Open-source routing engine
- Google Maps Platform: Mapping and location services
- Public Crime Data: Public safety statistics (anonymized)
- User-Generated Reports: Real-time community safety feedback

## Technical Implementation

### Frontend
- Framework: React Native with Expo
- Maps: react-native-maps with Google Maps provider
- State Management: React hooks and AsyncStorage
- UI: React Native Paper components

### Backend
- Framework: Node.js with Express
- Database: In-memory storage (for demo)
- Web Interface: Leaflet.js for live SOS tracking map

### Key Features
- P20 percentile-based route scoring (distance-bias free)
- Context-aware dynamic weight adjustment (time of day + user mode)
- IDW spatial smoothing with confidence scoring
- Explainable scoring pipeline with causal reasoning traces
- Spatial route deduplication (100m grid bucketing)
- Coordinate-hash-based alert IDs with dismiss/re-enter lifecycle
- Visited path trail rendering during navigation
- Background location tracking for SOS
- SMS integration for emergency alerts
- Delete Account with full local data wipe

## Contributing

This project was developed by:
- Paavni Bansal (Team Leader)
- Aarush Yadav
- Devansh Rana


## License

MIT License - see LICENSE file for details.