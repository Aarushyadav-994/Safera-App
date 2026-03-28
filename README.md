# SAFERA: AI-Enhanced Secure Navigation for Vulnerable Commuters

Safera is a specialized navigation engine designed to prioritize personal safety over traditional shortest-path routing. Unlike standard GPS apps that focus solely on distance or time, Safera analyzes urban geometry, lighting conditions, and community-sourced safety reports to recommend secure transit corridors. This project emerged from research into commuter safety in urban environments, particularly for vulnerable groups like women and students traveling alone.

## Research Background

This application stems from a research investigation into urban safety navigation. The core hypothesis was that incorporating real-time safety metrics—such as crime rates, lighting quality, and crowd density—could significantly improve route recommendations for at-risk commuters. Our study collected safety data from various urban locations and developed a weighted scoring algorithm that balances multiple risk factors.

The safety scoring formula uses the following weights:
•  Crime reports: 40%
•  Community safety reports: 35%
•  Lighting conditions: 20%
•  Crowd density: 5%

Data was gathered through surveys, public lighting databases, and anonymized incident reports from local authorities.

## Project Structure

```
Safera-App/
├── App.js                    # Main application component with navigation logic
├── AuthScreen.js             # User authentication (login/signup)
├── SafetyEngine.js           # Safety scoring algorithm
├── RouteService.js           # API integration with OpenRouteService
├── userDatabase.js           # User management and storage
├── tripReports.js            # Trip history and safety reporting
├── mockSafetyData.json       # Sample safety data for testing
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
•  id: Unique identifier (timestamp-based)
•  username: Login username
•  mobile: 10-digit mobile number (normalized)
•  password: Plain text password (for demo purposes)
•  profileName: Display name
•  email: Email address
•  emergencyContact1/2: Emergency contact numbers
•  createdAt: ISO timestamp

### Trip Reports
Safety reports submitted by users contain:
•  Location coordinates
•  Safety concerns (crime, lighting, isolation)
•  Timestamp
•  User ID

## Installation and Setup

### Prerequisites
•  Node.js 18+
•  npm or yarn
•  Expo CLI (`npm install -g @expo/cli`)
•  For iOS: Xcode (macOS only)
•  For Android: Android Studio or Expo Go app

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

1. Registration: Create an account with username, mobile, and emergency contacts
2. Route Planning: Enter start and destination locations
3. Safety Analysis: View three route options:
   - Green: Safest route (prioritizes safety metrics)
   - Blue: Balanced route
   - Red: Shortest/fastest route
4. Navigation: Start turn-by-turn navigation with real-time safety alerts
5. SOS Mode: Activate emergency tracking that shares live location with contacts

## API Integration

### OpenRouteService (ORS)
•  Purpose: Geocoding and multi-modal routing
•  API Key: Included in RouteService.js
•  Endpoints Used:
  - Geocoding: /geocode/search
  - Directions: /v2/directions/{profile}

### Google Maps
•  Purpose: Map display and location services
•  Configuration: Set up API key in app.json for production builds

## Safety Algorithm Details

The safety scoring uses a weighted formula:

```
Safety Score = (10 - Crime) × 0.40 + (10 - Reports) × 0.35 + Lighting × 0.20 + Crowd × 0.05
```

Where:
•  Crime: Crime rate (0-10)
•  Reports: Community safety reports (0-10)
•  Lighting: Street lighting quality (0-10)
•  Crowd: Pedestrian density (0-10)

Routes are categorized as:
•  Safe (Green): Score ≥ 7.0
•  Balanced (Blue): Score 4.0-6.9
•  High Risk (Red): Score < 4.0

## Data Sources

•  OpenRouteService: Open-source routing engine
•  Google Maps Platform: Mapping and location services
•  Public Crime Data: Public safety statistics (anonymized)
•  Community Surveys: Lighting and crowd density assessments
•  User-Generated Reports: Real-time safety feedback

## Technical Implementation

### Frontend
•  Framework: React Native with Expo
•  Maps: react-native-maps with Google Maps provider
•  State Management: React hooks and AsyncStorage
•  UI: React Native Paper components

### Backend
•  Framework: Node.js with Express
•  Database: In-memory storage (for demo)
•  Web Interface: Leaflet.js for live tracking map

### Key Features
•  Asynchronous route fetching with Promise.all
•  Coordinate jittering to prevent polyline overlap
•  Background location tracking for SOS
•  SMS integration for emergency alerts

## Contributing

This project was developed by:
•  Aarush Yadav
•  Paavni Bansal (Team Leader)
•  Devansh Rana

For academic or research use, please cite:

Yadav, A., Bansal, P., & Rana, D. (2026). Safera: AI-Enhanced Secure Navigation System.
Delhi Technological University.


## License

MIT License - see LICENSE file for details.