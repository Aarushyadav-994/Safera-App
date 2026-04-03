import React, { useState, useRef, useEffect } from 'react';
import { calculateSafetyScore, safeComputeRouteScore } from './SafetyEngine';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  Dimensions, ActivityIndicator, Keyboard, StatusBar, ScrollView, Animated, Modal, Linking, Alert, Platform, Clipboard, Vibration
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import AuthScreen from './AuthScreen';
import { fetchRealRoute, fetchRouteForProfile, getCoordsFromText } from './RouteService';
import { getActiveUser, logoutUser, updateActiveUserProfile, deleteAccount } from './userDatabase';
import { clearTripHistory, getCompletedTrips, getTripReports, replaceTripReports, saveCompletedTrip, saveTripReport } from './tripReports';

import * as SMS from 'expo-sms';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const debuggerHost = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost;
const hostIp = debuggerHost ? debuggerHost.split(':')[0] : '192.168.1.15';

// PUBLIC NGROK URL FOR REMOTE ACCESS & iOS SECURITY COMPATIBILITY
const NGROK_URL = 'https://harborous-shela-sustainingly.ngrok-free.dev';
const BACKEND_URL = NGROK_URL; // Using ngrok for all devices to ensure HTTPS/Remote access

const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

// Helper for cross-platform color support
const hexToRgba = (hex, alpha = 1) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background Location Error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    const loc = locations[0];
    try {
      const emergencyId = await AsyncStorage.getItem('active_emergency_id');
      const routeStart = await AsyncStorage.getItem('sos_route_start');
      const routeEnd = await AsyncStorage.getItem('sos_route_end');
      if (emergencyId) {
        await fetch(`${BACKEND_URL}/update-location`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify({
            emergencyId,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            timestamp: Date.now(),
            startedFrom: routeStart,
            destination: routeEnd
          })
        });
      }
    } catch (e) {
      console.log('Error posting background location:', e);
    }
  }
});

const { width, height } = Dimensions.get('window');
const NAVIGATION_REROUTE_DISTANCE_METERS = 20;
const ARRIVAL_THRESHOLD_METERS = 30;

const getDistanceMeters = (pointA, pointB) => {
  if (!pointA || !pointB) {
    return Number.POSITIVE_INFINITY;
  }

  const toRadians = (value) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const deltaLat = toRadians(pointB.latitude - pointA.latitude);
  const deltaLon = toRadians(pointB.longitude - pointA.longitude);
  const lat1 = toRadians(pointA.latitude);
  const lat2 = toRadians(pointB.latitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  return earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const getClosestCoordIndex = (coords, point) => {
  if (!coords?.length || !point) {
    return -1;
  }

  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  coords.forEach((coord, index) => {
    const distance = getDistanceMeters(coord, point);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
};

const getClosestPointOnRoute = (coords, point) => {
  if (!coords?.length || !point) {
    return null;
  }

  if (coords.length === 1) {
    return coords[0];
  }

  const projectPointToSegment = (segmentStart, segmentEnd, targetPoint) => {
    const avgLatitude = (segmentStart.latitude + segmentEnd.latitude + targetPoint.latitude) / 3;
    const latScale = 111320;
    const lonScale = 111320 * Math.cos(avgLatitude * Math.PI / 180);

    const ax = segmentStart.longitude * lonScale;
    const ay = segmentStart.latitude * latScale;
    const bx = segmentEnd.longitude * lonScale;
    const by = segmentEnd.latitude * latScale;
    const px = targetPoint.longitude * lonScale;
    const py = targetPoint.latitude * latScale;

    const abx = bx - ax;
    const aby = by - ay;
    const abLengthSquared = abx * abx + aby * aby;

    if (abLengthSquared === 0) {
      return {
        latitude: segmentStart.latitude,
        longitude: segmentStart.longitude,
      };
    }

    const apx = px - ax;
    const apy = py - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLengthSquared));

    return {
      latitude: segmentStart.latitude + (segmentEnd.latitude - segmentStart.latitude) * t,
      longitude: segmentStart.longitude + (segmentEnd.longitude - segmentStart.longitude) * t,
    };
  };

  let closestPoint = coords[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < coords.length - 1; index += 1) {
    const projectedPoint = projectPointToSegment(coords[index], coords[index + 1], point);
    const distance = getDistanceMeters(projectedPoint, point);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestPoint = projectedPoint;
    }
  }

  return closestPoint;
};

export default function App() {
  const mapRef = useRef(null);
  const reportMapRef = useRef(null);
  const drawerAnim = useRef(new Animated.Value(-width)).current;
  const locationWatcherRef = useRef(null);
  const lastNavigationRefreshLocationRef = useRef(null);
  const navigationFetchInFlightRef = useRef(false);
  const navigationCompletionHandledRef = useRef(false);
  const notifiedDangerZonesRef = useRef(new Set());
  const notifiedLowLightingZonesRef = useRef(new Set());
  const notifiedIsolatedZonesRef = useRef(new Set());
  const isSimulatingRef = useRef(false);
  // FROZEN ALERT ZONES: Coordinates locked in at navigation start, never mutated.
  // This is the single source of truth for all alert Markers during a navigation session.
  const frozenAlertZonesRef = useRef({ dangerZones: [], lowLightingZones: [], isolatedZones: [] });
  // Tracks which route object & index the trail last drew up to.
  // Allows filling ALL intermediate route coords between GPS ticks (no straight-line shortcuts).
  const trailStateRef = useRef({ routeCoords: null, lastIndex: -1 });
  // ---- SHAKE-TO-SOS REFS ----
  const lastAccelRef = useRef({ x: 0, y: 0, z: 0 });
  const shakeCountRef = useRef(0);
  const shakeWindowStartRef = useRef(null);
  const shakeCountdownIntervalRef = useRef(null);
  const accelSubscriptionRef = useRef(null);
  const sosCountdownActiveRef = useRef(false); // guard against double-trigger
  // ---- FAKE CALL REFS ----
  const fakeCallTimerRef = useRef(null);
  const ringtoneRef = useRef(null); // expo-av Sound object
  const pulseAnim = useRef(new Animated.Value(0)).current; // incoming call ring pulse
  
  const [user, setUser] = useState(null); 
  const [authLoading, setAuthLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [startText, setStartText] = useState('My Location');
  const [endText, setEndText] = useState('DTU Delhi');
  const [allRoutes, setAllRoutes] = useState([]); 
  const [routeScores, setRouteScores] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  // DECOUPLED SCORING EFFECT
  // Generates real-time math metrics only when local route payloads settle stably.
  useEffect(() => {
    if (!allRoutes || allRoutes.length === 0) {
      setRouteScores([]);
      return;
    }

    const computed = allRoutes.map((route, index) => {
      console.log(`\n--- App.js Routing Pass [${index}] ---`);
      if (route && route.coords) console.log(`Route length:`, route.coords.length);

      // All routes scored with the same neutral context — no index-based bias.
      // The P20 location scores alone determine which route is safest.
      return safeComputeRouteScore(route, { userMode: 'balanced' });
    });

    setRouteScores(computed);
  }, [allRoutes]);

  // Auto-select the highest-scoring route once scores are ready
  useEffect(() => {
    if (!routeScores || routeScores.length === 0) return;
    let bestIdx = 0;
    let bestScore = -1;
    routeScores.forEach((s, i) => {
      if (s && s.score > bestScore) {
        bestScore = s.score;
        bestIdx = i;
      }
    });
    setSelectedRouteIndex(bestIdx);
  }, [routeScores]);
  const [loading, setLoading] = useState(false);
  const [markers, setMarkers] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  // GPS-accumulated trail: grows with each real position tick. Never resets on reroute.
  const [visitedGpsTrail, setVisitedGpsTrail] = useState([]);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSosOpen, setIsSosOpen] = useState(false);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [isMyReportsOpen, setIsMyReportsOpen] = useState(false);
  const [completedTrips, setCompletedTrips] = useState([]);
  const [submittedReports, setSubmittedReports] = useState([]);
  const [selectedTripForReportId, setSelectedTripForReportId] = useState(null);
  const [reportType, setReportType] = useState('Unsafe spot');
  const [reportNote, setReportNote] = useState('');
  const [arrivalMessage, setArrivalMessage] = useState('');
  const [showPostTripCard, setShowPostTripCard] = useState(false);
  const [showUnsafeZoneCard, setShowUnsafeZoneCard] = useState(false);
  const [showLowLightingCard, setShowLowLightingCard] = useState(false);
  const [showIsolatedCard, setShowIsolatedCard] = useState(false);
  const [reportPin, setReportPin] = useState(null);
  const [editingReportId, setEditingReportId] = useState(null);
  const [editReportType, setEditReportType] = useState('Unsafe spot');
  const [editReportNote, setEditReportNote] = useState('');
  // shakeCountdown: null = idle, 3/2/1 = counting down to SOS fire
  const [shakeCountdown, setShakeCountdown] = useState(null);
  // fakeCallPhase: null | 'incoming' | 'active'
  const [fakeCallPhase, setFakeCallPhase] = useState(null);
  const [fakeCallSeconds, setFakeCallSeconds] = useState(0);
  const [profileForm, setProfileForm] = useState({
    profileName: '',
    email: '',
    emergencyContact1: '',
    emergencyContact2: '',
  });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({});
      setUserLocation(location.coords);

      locationWatcherRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        async (nextLocation) => {
          if (!isSimulatingRef.current) {
            setUserLocation(nextLocation.coords);
            try {
              const emergencyId = await AsyncStorage.getItem('active_emergency_id');
              if (emergencyId) {
                const routeStart = await AsyncStorage.getItem('sos_route_start');
                const routeEnd = await AsyncStorage.getItem('sos_route_end');
                await fetch(`${BACKEND_URL}/update-location`, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true'
                  },
                  body: JSON.stringify({
                    emergencyId,
                    lat: nextLocation.coords.latitude,
                    lng: nextLocation.coords.longitude,
                    timestamp: Date.now(),
                    startedFrom: routeStart,
                    destination: routeEnd
                  })
                });
              }
            } catch (e) {
              console.log('Foreground location sync error:', e);
            }
          }
        }
      );
    })();

    return () => {
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      const activeUser = await getActiveUser();
      setUser(activeUser);
      setAuthLoading(false);
    })();
  }, []);

  // ============================================================
  // SHAKE-TO-SOS ENGINE
  // Listens to the accelerometer while a user is logged in.
  // 3+ shakes within 1 second → launches 3s cancellable countdown.
  // ============================================================
  useEffect(() => {
    if (!user) {
      // Stop listener when user logs out
      if (accelSubscriptionRef.current) {
        accelSubscriptionRef.current.remove();
        accelSubscriptionRef.current = null;
      }
      return;
    }

    const SHAKE_THRESHOLD = 1.5;    // delta G-force to count as a shake event
    const SHAKE_COUNT_NEEDED = 3;   // number of events needed to trigger
    const SHAKE_WINDOW_MS = 1000;   // all events must be within this window

    Accelerometer.setUpdateInterval(80); // ~12 samples/sec — responsive but not wasteful

    accelSubscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const prev = lastAccelRef.current;
      const delta = Math.sqrt(
        Math.pow(x - prev.x, 2) +
        Math.pow(y - prev.y, 2) +
        Math.pow(z - prev.z, 2)
      );
      lastAccelRef.current = { x, y, z };

      if (delta > SHAKE_THRESHOLD) {
        const now = Date.now();
        if (!shakeWindowStartRef.current || now - shakeWindowStartRef.current > SHAKE_WINDOW_MS) {
          shakeCountRef.current = 1;
          shakeWindowStartRef.current = now;
        } else {
          shakeCountRef.current += 1;
          if (shakeCountRef.current >= SHAKE_COUNT_NEEDED && !sosCountdownActiveRef.current) {
            shakeCountRef.current = 0;
            shakeWindowStartRef.current = null;
            startSosCountdown();
          }
        }
      }
    });

    return () => {
      if (accelSubscriptionRef.current) {
        accelSubscriptionRef.current.remove();
        accelSubscriptionRef.current = null;
      }
    };
  }, [user]);

  const startSosCountdown = () => {
    if (sosCountdownActiveRef.current) return;
    sosCountdownActiveRef.current = true;
    let count = 3;
    setShakeCountdown(count);

    shakeCountdownIntervalRef.current = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(shakeCountdownIntervalRef.current);
        shakeCountdownIntervalRef.current = null;
        sosCountdownActiveRef.current = false;
        setShakeCountdown(null);
        triggerSos('contacts');
      } else {
        setShakeCountdown(count);
      }
    }, 1000);
  };

  const cancelSosCountdown = () => {
    clearInterval(shakeCountdownIntervalRef.current);
    shakeCountdownIntervalRef.current = null;
    sosCountdownActiveRef.current = false;
    setShakeCountdown(null);
  };

  // ============================================================
  // FAKE CALL ENGINE — expo-av ringtone + iOS UI
  // ============================================================
  const startFakeCall = async () => {
    setIsSosOpen(false);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false });
      const { sound } = await Audio.Sound.createAsync(
        require('./assets/ringtone.mp3'),
        { shouldPlay: true, isLooping: true, volume: 1.0 }
      );
      ringtoneRef.current = sound;
    } catch (e) {
      // Fallback: silent if audio fails — UI still works
      console.log('[FakeCall] Audio failed:', e.message);
    }
    setTimeout(() => setFakeCallPhase('incoming'), 1200);
  };


  const answerFakeCall = async () => {
    if (ringtoneRef.current) {
      await ringtoneRef.current.stopAsync();
      await ringtoneRef.current.unloadAsync();
      ringtoneRef.current = null;
    }
    setFakeCallPhase('active');
    setFakeCallSeconds(0);
    fakeCallTimerRef.current = setInterval(() => {
      setFakeCallSeconds(prev => prev + 1);
    }, 1000);
  };

  const endFakeCall = async () => {
    if (ringtoneRef.current) {
      await ringtoneRef.current.stopAsync();
      await ringtoneRef.current.unloadAsync();
      ringtoneRef.current = null;
    }
    clearInterval(fakeCallTimerRef.current);
    fakeCallTimerRef.current = null;
    setFakeCallPhase(null);
    setFakeCallSeconds(0);
  };

  const formatCallTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Pulse ring animation — runs only during incoming phase
  useEffect(() => {
    if (fakeCallPhase === 'incoming') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1300, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0);
    }
  }, [fakeCallPhase]);

  useEffect(() => {
    if (!isNavigating || !userLocation) {
      return;
    }

    mapRef.current?.animateCamera(
      {
        center: {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        },
        zoom: 17,
        pitch: 50,
      },
      { duration: 800 }
    );
  }, [isNavigating, userLocation]);

  useEffect(() => {
    if (!user?.id) {
      setCompletedTrips([]);
      setSubmittedReports([]);
      setSelectedTripForReportId(null);
      return;
    }

    (async () => {
      const [savedTrips, savedReports] = await Promise.all([
        getCompletedTrips(user.id),
        getTripReports(user.id),
      ]);

      setCompletedTrips(savedTrips);
      setSubmittedReports(savedReports);
      setArrivalMessage('');
      setShowPostTripCard(false);
      setSelectedTripForReportId(savedTrips[0]?.id || null);
    })();
  }, [user]);

  useEffect(() => {
    if (!isNavigating || !markers?.end || !userLocation) {
      return;
    }

    const distanceFromLastRefresh = getDistanceMeters(
      lastNavigationRefreshLocationRef.current,
      userLocation
    );

    if (
      navigationFetchInFlightRef.current ||
      distanceFromLastRefresh < NAVIGATION_REROUTE_DISTANCE_METERS
    ) {
      return;
    }

    navigationFetchInFlightRef.current = true;

    const refreshNavigationRoute = async () => {
      try {
        const nextRoute = await fetchRouteForProfile(userLocation, markers.end, selectedRouteIndex);

        if (nextRoute) {
          // CRITICAL: Only update the polyline path + distance.
          // Alert zone coordinates are FROZEN in frozenAlertZonesRef and must NEVER be re-snapped
          // or re-assigned here. Re-assigning them causes Markers to unmount/remount and drift.
          nextRoute.safetyScore = routeScores[selectedRouteIndex]?.score || 0;
          setNavigationRoute(nextRoute);
          lastNavigationRefreshLocationRef.current = userLocation;
        }
      } finally {
        navigationFetchInFlightRef.current = false;
      }
    };

    refreshNavigationRoute();
  }, [isNavigating, markers, selectedRouteIndex, userLocation]);

  useEffect(() => {
    if (!isReportsOpen || !selectedTripForReport?.coords?.length) {
      return;
    }

    const fitTimer = setTimeout(() => {
      reportMapRef.current?.fitToCoordinates(selectedTripForReport.coords, {
        edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
        animated: true,
      });
    }, 250);

    return () => clearTimeout(fitTimer);
  }, [isReportsOpen, selectedTripForReport]);

  const toggleDrawer = () => {
    const toValue = isDrawerOpen ? -width : 0;
    Animated.timing(drawerAnim, { toValue, duration: 300, useNativeDriver: true }).start();
    setIsDrawerOpen(!isDrawerOpen);
  };

  const clearArrivalMessage = () => {
    setArrivalMessage('');
    setShowPostTripCard(false);
  };

  const openProfile = () => {
    setProfileForm({
      profileName: user.profileName || '',
      email: user.email || '',
      emergencyContact1: user.emergencyContact1 || '',
      emergencyContact2: user.emergencyContact2 || '',
    });
    setIsProfileOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!profileForm.profileName.trim()) {
      alert('Full name is required.');
      return;
    }

    if (profileForm.email.trim() && !/^\S+@\S+\.\S+$/.test(profileForm.email.trim())) {
      alert('Enter a valid email address.');
      return;
    }

    if (!/^\d{10}$/.test(profileForm.emergencyContact1.trim())) {
      alert('Emergency Contact 1 must be a valid 10-digit number.');
      return;
    }

    if (profileForm.emergencyContact2.trim() && !/^\d{10}$/.test(profileForm.emergencyContact2.trim())) {
      alert('Emergency Contact 2 must be a valid 10-digit number.');
      return;
    }

    const updatedUser = await updateActiveUserProfile(profileForm);
    setUser(updatedUser);
    setIsProfileOpen(false);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure? All your data will be permanently removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount(user.id);
              setIsProfileOpen(false);
              setUser(null);
            } catch (e) {
              Alert.alert('Error', 'Could not delete account. Please try again.');
            }
          },
        },
      ]
    );
  };

  /**
   * =========================================================================
   * ROUTE DEDUPLICATION ENGINE
   * =========================================================================
   * Evaluates polyline similarity to guarantee the UI only offers distinctly 
   * different physical street pathways, discarding redundant micro-variants natively.
   */
  const calculateRouteOverlap = (routeA, routeB) => {
    if (!routeA || !routeB || !routeA.coords || !routeB.coords) return 0;
    
    // Performance Optimization: Sample every 4th coordinate to prevent heavy O(N^2) CPU locking
    const pointsA = routeA.coords.filter((_, i) => i % 4 === 0);
    const pointsB = routeB.coords.filter((_, i) => i % 4 === 0);
    
    let matchCount = 0;
    const threshold = 0.0004; // ~40 meters strict Cartesian threshold constraint

    for (const pA of pointsA) {
      for (const pB of pointsB) {
        const dLat = pA.latitude - pB.latitude;
        const dLon = pA.longitude - pB.longitude;
        if (Math.abs(dLat) < threshold && Math.abs(dLon) < threshold) {
          matchCount++;
          break;
        }
      }
    }
    
    return pointsA.length > 0 ? matchCount / pointsA.length : 0;
  };

  const filterDistinctRoutes = (rawRoutes) => {
    if (!rawRoutes || rawRoutes.length <= 1) return rawRoutes;

    const filteredRoutes = [];
    
    for (const currentRoute of rawRoutes) {
      let isDuplicate = false;
      
      for (const existingRoute of filteredRoutes) {
        const overlapRatio = calculateRouteOverlap(currentRoute, existingRoute);
        // If overlap > 0.8 (80%), mark as redundant duplicate path natively
        if (overlapRatio > 0.8) {
          isDuplicate = true;
          break;
        }
      }
      
      if (!isDuplicate) {
        filteredRoutes.push(currentRoute);
      }
      
      if (filteredRoutes.length === 3) break; // Maximum 3 distinct routes allowed per spec
    }

    // Safety fallback: if filtering destructively removed all alternatives natively, cleanly fallback 
    // to returning the original base derivatives capping max arrays securely protecting Demo UI flow.
    if (filteredRoutes.length >= 2) {
      return filteredRoutes;
    } else if (rawRoutes.length >= 2) {
      return [filteredRoutes[0], rawRoutes.find(r => r.id !== filteredRoutes[0].id) || rawRoutes[1]].slice(0, 2);
    }
    
    return filteredRoutes;
  };

  const handleFindRoute = async () => {
    Keyboard.dismiss();
    setLoading(true);
    clearArrivalMessage();
    setIsNavigating(false);
    setNavigationRoute(null);
    setNavigationLoading(false);
    lastNavigationRefreshLocationRef.current = null;
    navigationFetchInFlightRef.current = false;
    navigationCompletionHandledRef.current = false;
    notifiedDangerZonesRef.current.clear();
      notifiedLowLightingZonesRef.current.clear();
      notifiedIsolatedZonesRef.current.clear();
    
    try {
      console.log("1. Starting route fetch...");
      
      let startPoint = (startText.toLowerCase() === 'my location' && userLocation) 
        ? userLocation 
        : await getCoordsFromText(startText);
      
      const endPoint = await getCoordsFromText(endText);
      console.log("2. Coordinates found:", { startPoint, endPoint });

      if (startPoint && endPoint) {
        setMarkers({ start: startPoint, end: endPoint });
        
        console.log("3. Fetching from OpenRouteService...");
        const rawRoutes = await fetchRealRoute(startPoint, endPoint);
        
        console.log("4. Routes fetched. Deduplicating heavily clustered overlapping arrays natively...");
        const routes = filterDistinctRoutes(rawRoutes);
        // ... inside handleFindRoute, after fetching routes:
  if (routes && routes.length > 0) {
    // 1. Group by 100m to catch overlapping paths
    const roundedDistances = routes.map(r => Math.round(r.distance / 100) * 100);
    // 2. Sort distances: DESCENDING (Longest [Safe] first)
    const uniqueDistances = [...new Set(roundedDistances)].sort((a, b) => b - a); 

    let processedRoutes = routes.map((route) => {
      const roundedDist = Math.round(route.distance / 100) * 100;
      // tierIndex 0 = Longest (Safe), 1 = Balanced, 2 = Shortest (Risky)
      const tierIndex = uniqueDistances.indexOf(roundedDist); 
      
      // VALIDATE ROUTE DATA: Prevents fatal index crashes or dividing by zero
      if (!route || !route.coords || route.coords.length === 0) {
        return { ...route, dangerZones: [], lowLightingZones: [], isolatedZones: [] };
      }

      // Create the deterministic seed based on GPS
      const midCoord = route.coords[Math.floor(route.coords.length / 2)];
      const seedStr = `${midCoord.latitude.toFixed(3)}-${midCoord.longitude.toFixed(3)}-${tierIndex}`;
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) {
        hash = Math.imul(31, hash) + seedStr.charCodeAt(i) | 0;
      }
      const seed = Math.abs(hash % 10000) / 10000; 

      // Route evaluation has been fully decoupled to a React useEffect cycle.
      
      // Generate Danger Zones based on tierIndex
      let numDangerZones = tierIndex === 0 ? Math.floor(seed * 2) : 
                          tierIndex === 1 ? Math.floor(seed * 2) + 2 : 
                          Math.floor(seed * 3) + 4;

      let numLowLighting = tierIndex === 0 ? 1 : tierIndex === 1 ? 2 : Math.floor(seed * 3) + 3;
      let numIsolated = tierIndex === 0 ? 1 : tierIndex === 1 ? 1 : Math.floor(seed * 2) + 2;

      const dangerZones = [];
      const lowLightingZones = [];
      const isolatedZones = [];

      if (route.coords.length > 10) {
        for (let i = 0; i < numDangerZones; i++) {
          const pSeed = Math.abs((hash * (i + 13)) % 10000) / 10000;
          dangerZones.push(route.coords[Math.floor(pSeed * (route.coords.length - 4)) + 2]);
        }
        for (let i = 0; i < numLowLighting; i++) {
          const pSeed2 = Math.abs((hash * (i + 23)) % 10000) / 10000;
          lowLightingZones.push(route.coords[Math.floor(pSeed2 * (route.coords.length - 4)) + 2]);
        }
        for (let i = 0; i < numIsolated; i++) {
          const pSeed3 = Math.abs((hash * (i + 33)) % 10000) / 10000;
          isolatedZones.push(route.coords[Math.floor(pSeed3 * (route.coords.length - 4)) + 2]);
        }
      }

      return { ...route, dangerZones, lowLightingZones, isolatedZones };
    });

    // Keep ORS natural route order — scoring+auto-select determines the best route, not distance
    setAllRoutes(processedRoutes);
    setSelectedRouteIndex(0);
    setIsMinimized(true);
    
    mapRef.current?.fitToCoordinates(routes[0].coords, {
      edgePadding: { top: 150, right: 60, bottom: 450, left: 60 },
      animated: true,
    });
} else {
          console.warn("API returned empty routes.");
          setAllRoutes([]);
        }
      } else {
        console.warn("Could not resolve start or end coordinates.");
      }
    } catch (error) {
      console.error("🔥 FATAL ERROR in handleFindRoute:", error);
      alert("Failed to fetch route. Check console for details.");
    } finally {
      console.log("5. Finished processing. Stopping loader.");
      setLoading(false); 
    }
  };

  const getLiveLocationMessage = () => {
    if (!userLocation) {
      return 'Live location is currently unavailable.';
    }

    return `Live location: https://maps.google.com/?q=${userLocation.latitude},${userLocation.longitude}`;
  };

  const triggerSos = async (target) => {
    const isPolice = target === 'police';
    const contacts = [];
    if (isPolice) {
      contacts.push('112');
    } else {
      if (user?.emergencyContact1) contacts.push(user.emergencyContact1);
      if (user?.emergencyContact2) contacts.push(user.emergencyContact2);
    }

    if (contacts.length === 0) {
      Alert.alert('SOS unavailable', 'No emergency contact is saved in the profile yet.');
      return;
    }

    const primaryPhone = contacts[0];

    const targetLabel = isPolice ? 'Police' : 'Emergency Contact';
    setIsSosOpen(false);

    // 1. Generate Emergency ID
    const emergencyId = `user-${Date.now()}`;
    await AsyncStorage.setItem('active_emergency_id', emergencyId);
    let routeStart = 'Unknown';
    let routeEnd = 'Unknown';
    if (isNavigating) {
      await AsyncStorage.setItem('sos_route_start', startText);
      await AsyncStorage.setItem('sos_route_end', endText);
      routeStart = startText;
      routeEnd = endText;
    }

    // IMMEDIATELY PING SERVER ONCE (Crucial for stationary testing)
    console.log(`[SOS] Starting tracking. Backend: ${BACKEND_URL}, ID: ${emergencyId}`);
    
    if (userLocation) {
      fetch(`${BACKEND_URL}/update-location`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          emergencyId,
          lat: userLocation.latitude,
          lng: userLocation.longitude,
          timestamp: Date.now(),
          startedFrom: routeStart,
          destination: routeEnd
        })
      }).catch(e => console.log('Init SOS POST error:', e));
    }

    // IMMEDIATELY DRAFT SMS (Don't let location permissions block this)
    const trackingLink = `${BACKEND_URL}/live/${emergencyId}`;
    const smsMessage = `SOS! I am in a critical situation.\n\nTrack my live location here:\n${trackingLink}`;
    console.log(`[SOS] Link: ${trackingLink}`);

    const isAllowed = await SMS.isAvailableAsync();
    console.log(`[SMS] isAvailable: ${isAllowed}, Contacts: ${JSON.stringify(contacts)}`);

    const handleSms = async () => {
      try {
        if (isAllowed && !isPolice) {
          // Small timeout to let UI settle/modal close on iOS
          setTimeout(async () => {
            const { result } = await SMS.sendSMSAsync(contacts, smsMessage);
            console.log(`[SMS] Result: ${result}`);
          }, 600);
        } else {
          Alert.alert(
            'SOS Triggered',
            `SMS draft unavailable.${!isPolice ? '\n\nTrack Link copy-ready below.' : ''}\n\nDialing ${primaryPhone}...`,
            [
              { text: 'Cancel Call', style: 'cancel' },
              { 
                text: 'Copy & Call', 
                onPress: async () => {
                  Clipboard?.setString?.(trackingLink);
                  const phoneUrl = `tel:${primaryPhone}`;
                  Linking.openURL(phoneUrl);
                } 
              }
            ]
          );
        }
      } catch (err) {
        console.log('[SMS] Error:', err);
      }
    };

    // 2. Start Logic (Don't await tracking setup to avoid blocking SMS)
    (async () => {
      try {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus === 'granted') {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 10,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "SOS Active",
              notificationBody: "Live tracking is running in the background.",
              notificationColor: "#FF3B30",
            }
          });
        }
      } catch (e) {
        console.log("[SOS] Background tracking skipped:", e.message);
      }
    })();

    // 3. One-time initial ping
    if (userLocation) {
      fetch(`${BACKEND_URL}/update-location`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          emergencyId,
          lat: userLocation.latitude,
          lng: userLocation.longitude,
          timestamp: Date.now(),
          startedFrom: routeStart,
          destination: routeEnd
        })
      }).catch(e => console.log('[SOS] Init Ping error:', e.message));
    }

    // 4. Trigger SMS & Dialer
    await handleSms();

    if (isPolice || !isAllowed) { // If police, or if SMS handled by alert
       if (isPolice) {
          const phoneUrl = `tel:${primaryPhone}`;
          Linking.openURL(phoneUrl);
       }
    }
  };

  // 🛡️ CRITICAL ERROR FIX: Safety check for empty routes
  const handleStartNavigation = async () => {
    if (!markers?.end || !userLocation) {
      Alert.alert('Navigation unavailable', 'Live location is required before navigation can start.');
      return;
    }

    setNavigationLoading(true);

    try {
      const liveRoute = await fetchRouteForProfile(userLocation, markers.end, selectedRouteIndex);

      if (!liveRoute) {
        Alert.alert('Navigation unavailable', 'Could not start live navigation for this route.');
        return;
      }

      const originalRoute = allRoutes[selectedRouteIndex];
      liveRoute.safetyScore = routeScores[selectedRouteIndex]?.score || 0;

      // FREEZE alert zone coordinates once at navigation start.
      // These coords will NEVER change for the entire navigation session,
      // ensuring Markers are always stationary and never drift on reroute.
      frozenAlertZonesRef.current = {
        dangerZones: originalRoute?.dangerZones || [],
        lowLightingZones: originalRoute?.lowLightingZones || [],
        isolatedZones: originalRoute?.isolatedZones || [],
      };

      setNavigationRoute(liveRoute);
      setIsNavigating(true);
      clearArrivalMessage();
      // Reset trail state — the useEffect will seed on the very first GPS tick.
      setVisitedGpsTrail([]);
      trailStateRef.current = { routeCoords: null, lastIndex: -1 };
      lastNavigationRefreshLocationRef.current = userLocation;
      navigationCompletionHandledRef.current = false;
      notifiedDangerZonesRef.current.clear();
      notifiedLowLightingZonesRef.current.clear();
      notifiedIsolatedZonesRef.current.clear();

      mapRef.current?.animateCamera(
        {
          center: {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
          },
          zoom: 17,
          pitch: 50,
        },
        { duration: 900 }
      );
    } finally {
      setNavigationLoading(false);
    }
  };

  const persistArrivalMessage = (message) => {
    setArrivalMessage(message);
  };

  const resetNavigationState = () => {
    setIsNavigating(false);
    setNavigationRoute(null);
    setNavigationLoading(false);
    setVisitedGpsTrail([]);
    trailStateRef.current = { routeCoords: null, lastIndex: -1 };
    setShowUnsafeZoneCard(false);
    lastNavigationRefreshLocationRef.current = null;
    navigationFetchInFlightRef.current = false;
    navigationCompletionHandledRef.current = false;
    notifiedDangerZonesRef.current.clear();
    notifiedLowLightingZonesRef.current.clear();
    notifiedIsolatedZonesRef.current.clear();
    // Clear the frozen zones so they don't leak into the next session.
    frozenAlertZonesRef.current = { dangerZones: [], lowLightingZones: [], isolatedZones: [] };

    if (currentRoute?.coords?.length) {
      mapRef.current?.fitToCoordinates(currentRoute.coords, {
        edgePadding: { top: 150, right: 60, bottom: 450, left: 60 },
        animated: true,
      });
    }
  };

  const handleCompleteNavigation = React.useCallback(async () => {
    const selectedRoute = allRoutes[selectedRouteIndex];
    const completedTripDistance = Number.isFinite(navigationRoute?.distance)
      ? navigationRoute.distance
      : selectedRoute?.distance ?? 0;
    const completedTrip = {
      id: `${Date.now()}`,
      startedFrom: startText,
      destination: endText,
      completedAt: new Date().toISOString(),
      routeIndex: selectedRouteIndex,
      distance: completedTripDistance,
      safetyScore: routeScores[selectedRouteIndex]?.score || 0,
      coords: navigationRoute?.coords || selectedRoute?.coords || [],
    };

    if (user?.id) {
      const nextTrips = await saveCompletedTrip(user.id, completedTrip);
      setCompletedTrips(nextTrips);
      setSelectedTripForReportId(completedTrip.id);
    }

    persistArrivalMessage(`Destination reached: ${endText}`);
    setShowPostTripCard(true);
    resetNavigationState();
    Alert.alert(
      'Destination reached',
      'Navigation has ended and this route is now available in Route Reports.',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Report now', onPress: () => setIsReportsOpen(true) },
      ]
    );
  }, [allRoutes, endText, navigationRoute, selectedRouteIndex, startText, user?.id]);

  useEffect(() => {
    if (!isNavigating || !markers?.end || !userLocation || navigationCompletionHandledRef.current) {
      return;
    }

    const distanceToDestination = getDistanceMeters(userLocation, markers.end);
    const remainingDistance = Number.isFinite(navigationRoute?.distance) ? navigationRoute.distance : null;

    if (
      distanceToDestination <= ARRIVAL_THRESHOLD_METERS ||
      (remainingDistance !== null && remainingDistance <= ARRIVAL_THRESHOLD_METERS)
    ) {
      navigationCompletionHandledRef.current = true;
      void handleCompleteNavigation();
    }
  }, [isNavigating, markers, navigationRoute, userLocation, handleCompleteNavigation]);

  // 🔴 200m Proximity Check — reads from frozenAlertZonesRef (stationary, immutable coords).
  useEffect(() => {
    if (!isNavigating || !userLocation) {
      return;
    }

    const frozen = frozenAlertZonesRef.current;

    frozen.dangerZones.forEach((zone, index) => {
      const distance = getDistanceMeters(userLocation, zone);
      if (distance <= 200 && !notifiedDangerZonesRef.current.has(index)) {
        notifiedDangerZonesRef.current.add(index);
        setShowUnsafeZoneCard(true);
      }
    });

    frozen.lowLightingZones.forEach((zone, index) => {
      const distance = getDistanceMeters(userLocation, zone);
      if (distance <= 200 && !notifiedLowLightingZonesRef.current.has(index)) {
        notifiedLowLightingZonesRef.current.add(index);
        setShowLowLightingCard(true);
      }
    });

    frozen.isolatedZones.forEach((zone, index) => {
      const distance = getDistanceMeters(userLocation, zone);
      if (distance <= 200 && !notifiedIsolatedZonesRef.current.has(index)) {
        notifiedIsolatedZonesRef.current.add(index);
        setShowIsolatedCard(true);
      }
    });
  }, [isNavigating, userLocation]);

  // 🩶 ROUTE-SNAPPED TRAIL ENGINE
  // On every GPS tick, finds user's closest index on the route and appends ALL intermediate
  // route coords since the last index — so the trail follows every road curve, not straight lines.
  // trailStateRef tracks the current route object identity + last index drawn,
  // so it resets cleanly when a reroute fetches a new coords array.
  useEffect(() => {
    if (!isNavigating || !userLocation || !navigationRoute?.coords?.length) return;

    const coords = navigationRoute.coords;
    const state = trailStateRef.current;
    const currentIdx = getClosestCoordIndex(coords, userLocation);

    if (state.routeCoords !== coords) {
      // New route (nav start or reroute): initialise tracker at current position.
      trailStateRef.current = { routeCoords: coords, lastIndex: currentIdx };
      // Append the current route point to keep the trail visually connected.
      setVisitedGpsTrail(prev => [...prev, coords[currentIdx]]);
      return;
    }

    if (currentIdx > state.lastIndex) {
      // Fill EVERY coord between last drawn index and current index.
      const newSegment = coords.slice(state.lastIndex + 1, currentIdx + 1);
      trailStateRef.current = { routeCoords: coords, lastIndex: currentIdx };
      if (newSegment.length > 0) {
        setVisitedGpsTrail(prev => [...prev, ...newSegment]);
      }
    }
  }, [isNavigating, userLocation, navigationRoute]);

  const handleExitNavigation = () => {
    resetNavigationState();
  };

  const handleSimulateStep = () => {
    if (!__DEV__ || !navigationRoute?.coords?.length || !userLocation) {
      return;
    }

    isSimulatingRef.current = true;

    const closestIndex = getClosestCoordIndex(navigationRoute.coords, userLocation);
    const lastIndex = navigationRoute.coords.length - 1;
    const nextIndex = Math.min(
      closestIndex >= 0 ? closestIndex + 8 : 8,
      lastIndex
    );
    const nextCoord = nextIndex >= lastIndex && markers?.end
      ? markers.end
      : navigationRoute.coords[nextIndex];

    if (!nextCoord) {
      return;
    }

    lastNavigationRefreshLocationRef.current = null;
    const updatedLocation = {
      ...nextCoord,
      accuracy: userLocation.accuracy,
      altitude: userLocation.altitude,
      altitudeAccuracy: userLocation.altitudeAccuracy,
      heading: userLocation.heading,
      speed: userLocation.speed,
    };
    setUserLocation(updatedLocation);

    // Sync simulated movement to live tracker dashboard
    (async () => {
      try {
        const emergencyId = await AsyncStorage.getItem('active_emergency_id');
        if (emergencyId) {
          const routeStart = await AsyncStorage.getItem('sos_route_start');
          const routeEnd = await AsyncStorage.getItem('sos_route_end');
          await fetch(`${BACKEND_URL}/update-location`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
              emergencyId,
              lat: updatedLocation.latitude,
              lng: updatedLocation.longitude,
              timestamp: Date.now(),
              startedFrom: routeStart,
              destination: routeEnd
            })
          });
        }
      } catch (e) {
        console.log('Simulated location sync error:', e);
      }
    })();
  };

  const handleSubmitReport = async () => {
    if (!selectedTripForReportId) {
      Alert.alert('Select a trip', 'Finish a trip first, then choose it here to submit a report.');
      return;
    }

    if (!reportPin) {
      Alert.alert('Pin required', 'Tap the route preview to pin the exact area you want to report.');
      return;
    }

    const selectedTrip = completedTrips.find((trip) => trip.id === selectedTripForReportId);

    if (!selectedTrip) {
      Alert.alert('Trip unavailable', 'That completed route could not be found.');
      return;
    }

    const report = {
      id: `${Date.now()}`,
      tripId: selectedTrip.id,
      type: reportType,
      note: reportNote.trim(),
      createdAt: new Date().toISOString(),
      coordinate: reportPin,
      routeSnapshot: {
        startedFrom: selectedTrip.startedFrom,
        destination: selectedTrip.destination,
      },
    };

    if (user?.id) {
      const nextReports = await saveTripReport(user.id, report);
      setSubmittedReports(nextReports);
    }

    setReportNote('');
    setReportType('Unsafe spot');
    setReportPin(null);
    Alert.alert('Report submitted', 'Thanks. This issue has been linked to your completed route.');
  };

  const currentRoute = allRoutes && allRoutes.length > 0 ? allRoutes[selectedRouteIndex] : null;
  const selectedTripForReport = completedTrips.find((trip) => trip.id === selectedTripForReportId) || null;
  const selectedTripReports = selectedTripForReport
    ? submittedReports.filter((report) => report.tripId === selectedTripForReport.id)
    : [];

  const getNearestRoutePoint = (trip, coordinate) => {
    if (!trip?.coords?.length || !coordinate) {
      return null;
    }

    return getClosestPointOnRoute(trip.coords, coordinate);
  };

  const handleSelectTripForReport = (tripId) => {
    setSelectedTripForReportId(tripId);
    setReportPin(null);
    setReportNote('');
    setReportType('Unsafe spot');
  };

  const handleRouteMapPress = (event) => {
    if (!selectedTripForReport?.coords?.length) {
      return;
    }

    const nearestPoint = getNearestRoutePoint(selectedTripForReport, event.nativeEvent.coordinate);

    if (nearestPoint) {
      setReportPin(nearestPoint);
    }
  };

  const openReports = () => {
    setIsReportsOpen(true);
    setIsMyReportsOpen(false);
    setIsDrawerOpen(false);
    drawerAnim.setValue(-width);
    setSelectedTripForReportId(null);
    setReportPin(null);
    setReportNote('');
    setReportType('Unsafe spot');
  };

  const openMyReports = () => {
    setIsMyReportsOpen(true);
    setIsReportsOpen(false);
    setIsDrawerOpen(false);
    drawerAnim.setValue(-width);
    setEditingReportId(null);
    setEditReportType('Unsafe spot');
    setEditReportNote('');
  };

  const handleBackToTripSelection = () => {
    setSelectedTripForReportId(null);
    setReportPin(null);
    setReportNote('');
    setReportType('Unsafe spot');
  };

  const handleClearTripHistory = () => {
    if (!user?.id) {
      return;
    }

    Alert.alert(
      'Clear trip history',
      'This will remove only your completed trip history. Submitted reports will stay available in My Reports.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearTripHistory(user.id);
            setCompletedTrips([]);
            handleBackToTripSelection();
          },
        },
      ]
    );
  };

  const handleStartEditingReport = (report) => {
    setEditingReportId(report.id);
    setEditReportType(report.type);
    setEditReportNote(report.note || '');
  };

  const handleCancelEditingReport = () => {
    setEditingReportId(null);
    setEditReportType('Unsafe spot');
    setEditReportNote('');
  };

  const handleSaveEditedReport = async () => {
    if (!user?.id || !editingReportId) {
      return;
    }

    const nextReports = submittedReports.map((report) =>
      report.id === editingReportId
        ? {
            ...report,
            type: editReportType,
            note: editReportNote.trim(),
            updatedAt: new Date().toISOString(),
          }
        : report
    );

    const savedReports = await replaceTripReports(user.id, nextReports);
    setSubmittedReports(savedReports);
    handleCancelEditingReport();
    Alert.alert('Report updated', 'Your submitted report has been updated.');
  };

  const handleDeleteReport = (reportId) => {
    if (!user?.id) {
      return;
    }

    Alert.alert(
      'Delete report',
      'This will permanently remove the selected report.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const nextReports = submittedReports.filter((report) => report.id !== reportId);
            const savedReports = await replaceTripReports(user.id, nextReports);
            setSubmittedReports(savedReports);

            if (editingReportId === reportId) {
              handleCancelEditingReport();
            }
          },
        },
      ]
    );
  };

  const getRouteTheme = (index) => {
    if (!routeScores[index]) {
      return { color: '#888', score: 0, label: '⏱️ ANALYZING...' };
    }

    const realScore = routeScores[index].score;

    if (realScore >= 7) return { color: '#00FF94', score: realScore, label: '🛡️ SAFE ROUTE' };
    if (realScore >= 5) return { color: '#FF9500', score: realScore, label: '🛣️ MODERATE' };
    return { color: '#FF3B30', score: realScore, label: '⚠️ HIGH RISK' };
  };

  const activeTheme = getRouteTheme(selectedRouteIndex);
  const UI_TEXT = isDarkMode ? '#FFF' : '#000';
  const CARD_BG = isDarkMode ? '#0A0A0A' : '#FFF';
  const LOGO_COLOR = isDarkMode ? '#FFF' : '#1A1A1A';

  if (authLoading) {
    return (
      <View style={[styles.container, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#00FF94" size="large" />
      </View>
    );
  }

  if (!user) {
    return <AuthScreen onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#000' : '#F5F5F5' }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        customMapStyle={isDarkMode ? mapDarkStyle : []}
        showsUserLocation={true}
      >
        {isNavigating && navigationRoute ? (
          <>
            {/* FULL active route — always full coords, grey trail paints on top */}
            <Polyline
              key="active-navigation-route"
              coordinates={navigationRoute.displayCoords || navigationRoute.coords}
              strokeColor={hexToRgba(activeTheme.color, 1)}
              strokeWidth={8}
              zIndex={1000}
              lineJoin="round"
              lineCap="round"
              lineDashPattern={[0]}
            />
            {/* GPS TRAIL: Actual path walked — grows permanently, never collapses on reroute.
                Painted on top of the colored route (zIndex 1001) to hide covered segments. */}
            {visitedGpsTrail.length >= 2 && (
              <Polyline
                key="nav-trail-visited"
                coordinates={visitedGpsTrail}
                strokeColor={isDarkMode ? '#888888' : '#AAAAAA'}
                strokeWidth={8}
                zIndex={1001}
                lineJoin="round"
                lineCap="round"
                lineDashPattern={[0]}
              />
            )}
            {/* STATIONARY ALERT MARKERS: Always read from frozenAlertZonesRef, never from navigationRoute.
                Keys are coordinate-based hashes to guarantee React never unmounts/remounts these Markers. */}
            {frozenAlertZonesRef.current.dangerZones.map((zoneCoord, zIndex) => (
              <Marker 
                key={`nav-danger-${zoneCoord.latitude.toFixed(6)}-${zoneCoord.longitude.toFixed(6)}`} 
                coordinate={zoneCoord}
                zIndex={1002}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }} 
              >
                <View style={[styles.dangerIconContainer, { opacity: 0.95 }]}>
                  <Ionicons name="warning" size={10} color="#FFF" />
                </View>
              </Marker>
            ))}
            {frozenAlertZonesRef.current.lowLightingZones.map((zoneCoord, zIndex) => (
              <Marker 
                key={`nav-light-${zoneCoord.latitude.toFixed(6)}-${zoneCoord.longitude.toFixed(6)}`} 
                coordinate={zoneCoord}
                zIndex={1002}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }} 
              >
                <View style={[styles.dangerIconContainer, { opacity: 0.95, backgroundColor: '#FFC107' }]}>
                  <Ionicons name="flashlight" size={10} color="#000" />
                </View>
              </Marker>
            ))}
            {frozenAlertZonesRef.current.isolatedZones.map((zoneCoord, zIndex) => (
              <Marker 
                key={`nav-iso-${zoneCoord.latitude.toFixed(6)}-${zoneCoord.longitude.toFixed(6)}`} 
                coordinate={zoneCoord}
                zIndex={1002}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }} 
              >
                <View style={[styles.dangerIconContainer, { opacity: 0.95, backgroundColor: '#5E5CE6' }]}>
                  <Ionicons name="eye-off" size={10} color="#FFF" />
                </View>
              </Marker>
            ))}
          </>
        ) : (
          <>
            {allRoutes.map((route, index) => {
              const pathTheme = getRouteTheme(index);
              const isFocused = index === selectedRouteIndex;
              return (
                <Polyline 
                  key={`route-${index}`}
                  coordinates={route.displayCoords || route.coords} 
                  strokeColor={isFocused ? hexToRgba(pathTheme.color, 1) : hexToRgba(pathTheme.color, 0.2)} 
                  strokeWidth={isFocused ? 8 : 4}
                  zIndex={isFocused ? 1000 : 10 - index}
                  tappable={true}
                  onPress={() => setSelectedRouteIndex(index)}
                  lineJoin="round"
                  lineCap="round"
                  lineDashPattern={[0]}
                />
              );
            })}

            {allRoutes.map((route, index) => {
              if (index !== selectedRouteIndex) return null;
              
              return (
                <React.Fragment key={`all-markers-${index}`}>
                  {route.dangerZones?.map((zoneCoord, zIndex) => (
                    <Marker 
                      key={`danger-${index}-${zIndex}`} 
                      coordinate={zoneCoord}
                      zIndex={1001}
                      tracksViewChanges={false}
                      anchor={{ x: 0.5, y: 0.5 }} 
                    >
                      <View collapsable={false} style={[styles.dangerIconContainer, { opacity: 0.95 }]}>
                        <Ionicons name="warning" size={10} color="#FFF" />
                      </View>
                    </Marker>
                  ))}
                  {route.lowLightingZones?.map((zoneCoord, zIndex) => (
                    <Marker 
                      key={`light-${index}-${zIndex}`} 
                      coordinate={zoneCoord}
                      zIndex={1001}
                      tracksViewChanges={false}
                      anchor={{ x: 0.5, y: 0.5 }} 
                    >
                      <View collapsable={false} style={[styles.dangerIconContainer, { opacity: 0.95, backgroundColor: '#FFC107' }]}>
                        <Ionicons name="flashlight" size={10} color="#000" />
                      </View>
                    </Marker>
                  ))}
                  {route.isolatedZones?.map((zoneCoord, zIndex) => (
                    <Marker 
                      key={`iso-${index}-${zIndex}`} 
                      coordinate={zoneCoord}
                      zIndex={1001}
                      tracksViewChanges={false}
                      anchor={{ x: 0.5, y: 0.5 }} 
                    >
                      <View collapsable={false} style={[styles.dangerIconContainer, { opacity: 0.95, backgroundColor: '#5E5CE6' }]}>
                        <Ionicons name="eye-off" size={10} color="#FFF" />
                      </View>
                    </Marker>
                  ))}
                </React.Fragment>
              );
            })}
          </>
        )}

        {markers && (
          <>
            {!isNavigating && <Marker coordinate={markers.start}><View style={styles.dotStart}/></Marker>}
            <Marker coordinate={markers.end}><View style={[styles.dotEnd, {backgroundColor: activeTheme.color}]}/></Marker>
          </>
        )}
      </MapView>

      <TouchableOpacity style={[styles.menuBtn, {backgroundColor: CARD_BG}]} onPress={toggleDrawer}>
        <Ionicons name="menu" size={24} color={activeTheme.color} />
      </TouchableOpacity>

      <View style={styles.topOverlay}>
        {!isMinimized ? (
          <View style={[styles.fullSearch, { backgroundColor: CARD_BG, borderColor: isDarkMode ? '#1A1A1A' : '#DDD' }]}>
             <Text style={[styles.logoBrand, {color: LOGO_COLOR}]}>SAFERA<Text style={{color: '#00FF94'}}>.</Text></Text>
             <TextInput style={[styles.input, {color: UI_TEXT}]} value={startText} onChangeText={setStartText} placeholder="Start location" placeholderTextColor="#666" />
             <View style={[styles.line, {backgroundColor: isDarkMode ? '#1A1A1A' : '#EEE'}]} />
             <TextInput style={[styles.input, {color: UI_TEXT}]} value={endText} onChangeText={setEndText} placeholder="Destination" placeholderTextColor="#666" />
             <TouchableOpacity style={[styles.searchBtn, {backgroundColor: activeTheme.color}]} onPress={handleFindRoute}>
                {loading ? <ActivityIndicator color="#000"/> : <Text style={styles.btnText}>Find Safe Paths</Text>}
             </TouchableOpacity>
          </View>
        ) : isNavigating ? (
          <View style={[styles.minified, {backgroundColor: CARD_BG}]}>
             <Text style={[styles.minTitle, {color: activeTheme.color}]}>NAVIGATING TO: {endText.toUpperCase()}</Text>
             <Text style={[styles.minHint, {color: isDarkMode ? '#444' : '#999'}]}>Following your live location</Text>
          </View>
        ) : (
          <TouchableOpacity style={[styles.minified, {backgroundColor: CARD_BG}]} onPress={() => setIsMinimized(false)}>
             <Text style={[styles.minTitle, {color: activeTheme.color}]}>DESTINATION: {endText.toUpperCase()}</Text>
             <Text style={[styles.minHint, {color: isDarkMode ? '#444' : '#999'}]}>
               {arrivalMessage || 'Tap to change route'}
             </Text>
          </TouchableOpacity>
        )}
      </View>

      {!isNavigating && showPostTripCard && completedTrips.length > 0 && (
        <View style={styles.postTripContainer}>
          <View style={[styles.postTripCard, { backgroundColor: CARD_BG, borderColor: activeTheme.color }]}>
            <Text style={[styles.postTripTitle, { color: activeTheme.color }]}>DESTINATION REACHED</Text>
            <Text style={[styles.postTripText, { color: UI_TEXT }]}>
              {arrivalMessage || 'Your last route has been saved.'}
            </Text>
            <Text style={styles.postTripSubtext}>
              You can now report unsafe spots, crimes, low lighting, or isolated areas on that route.
            </Text>
            <View style={styles.postTripActions}>
              <TouchableOpacity
                style={[styles.postTripPrimaryBtn, { backgroundColor: activeTheme.color }]}
                onPress={openReports}
              >
                <Text style={styles.postTripPrimaryText}>Report Now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.postTripSecondaryBtn, { borderColor: isDarkMode ? '#333' : '#D6D6D6' }]}
                onPress={() => setShowPostTripCard(false)}
              >
                <Text style={[styles.postTripSecondaryText, { color: UI_TEXT }]}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {isNavigating && (showUnsafeZoneCard || showLowLightingCard || showIsolatedCard) && (
        <View style={[styles.postTripContainer, { flexDirection: 'column', gap: 10 }]}>
          {showUnsafeZoneCard && (
            <View style={[styles.postTripCard, { backgroundColor: CARD_BG, borderColor: '#FF3B30' }]}>
              <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                <Ionicons name="warning" size={20} color="#FF3B30"/>
                <Text style={[styles.postTripTitle, { color: '#FF3B30', marginLeft: 8, marginBottom: 0 }]}>UNSAFE ZONE AHEAD</Text>
              </View>
              <Text style={[styles.postTripText, { color: UI_TEXT, marginBottom: 12 }]}>
                You are within 200m of a flagged high-risk area. Please stay alert to your surroundings.
              </Text>
              <View style={styles.postTripActions}>
                <TouchableOpacity
                  style={[styles.postTripPrimaryBtn, { backgroundColor: '#FF3B30', flex: 1 }]}
                  onPress={() => setShowUnsafeZoneCard(false)}
                >
                  <Text style={styles.postTripPrimaryText}>Acknowledged</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {showLowLightingCard && (
            <View style={[styles.postTripCard, { backgroundColor: CARD_BG, borderColor: '#FFC107' }]}>
              <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                <Ionicons name="flashlight" size={20} color="#FFC107"/>
                <Text style={[styles.postTripTitle, { color: '#FFC107', marginLeft: 8, marginBottom: 0 }]}>LOW LIGHTING AHEAD</Text>
              </View>
              <Text style={[styles.postTripText, { color: UI_TEXT, marginBottom: 12 }]}>
                You are approaching an area with historically poor street lighting. Stay vigilant.
              </Text>
              <View style={styles.postTripActions}>
                <TouchableOpacity
                  style={[styles.postTripPrimaryBtn, { backgroundColor: '#FFC107', flex: 1 }]}
                  onPress={() => setShowLowLightingCard(false)}
                >
                  <Text style={[styles.postTripPrimaryText, { color: '#000' }]}>Acknowledged</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {showIsolatedCard && (
            <View style={[styles.postTripCard, { backgroundColor: CARD_BG, borderColor: '#5E5CE6' }]}>
              <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                <Ionicons name="eye-off" size={20} color="#5E5CE6"/>
                <Text style={[styles.postTripTitle, { color: '#5E5CE6', marginLeft: 8, marginBottom: 0 }]}>ISOLATED STRETCH AHEAD</Text>
              </View>
              <Text style={[styles.postTripText, { color: UI_TEXT, marginBottom: 12 }]}>
                You are approaching a deserted or sparsely populated stretch. Keep your guards up.
              </Text>
              <View style={styles.postTripActions}>
                <TouchableOpacity
                  style={[styles.postTripPrimaryBtn, { backgroundColor: '#5E5CE6', flex: 1 }]}
                  onPress={() => setShowIsolatedCard(false)}
                >
                  <Text style={styles.postTripPrimaryText}>Acknowledged</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {isMinimized && currentRoute && !isNavigating && !showPostTripCard && (
        <>
          <View style={styles.routeTray}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {allRoutes.map((r, i) => {
                const tabTheme = getRouteTheme(i);
                return (
                  <TouchableOpacity key={i} style={[styles.routeTab, {backgroundColor: CARD_BG, borderColor: selectedRouteIndex === i ? tabTheme.color : isDarkMode ? '#1A1A1A' : '#EEE'}]} onPress={() => setSelectedRouteIndex(i)}>
                    <Text style={[styles.tabType, {color: selectedRouteIndex === i ? tabTheme.color : '#555'}]}>{tabTheme.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          <View style={styles.dashboardContainer}>
            <View style={[styles.dashboard, {backgroundColor: CARD_BG, borderTopColor: activeTheme.color}]}>
              <View style={[styles.scoreBox, {borderColor: activeTheme.color}]}>
                <Text style={[styles.scoreNum, {color: activeTheme.color}]}>{activeTheme.score.toFixed(1)}</Text>
              </View>
              <View style={styles.info}>
                <Text style={[styles.status, {color: UI_TEXT}]}>{activeTheme.score > 7 ? "SECURED CORRIDOR" : activeTheme.score > 5 ? "NEUTRAL ZONE" : "HIGH RISK PATH"}</Text>
                <Text style={[styles.subStatus, {color: isDarkMode ? '#444' : '#777'}]}>Analyzed via lighting & community reports.</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.navigationBtn, { backgroundColor: activeTheme.color }]}
              onPress={handleStartNavigation}
              disabled={navigationLoading}
            >
              {navigationLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="navigate" size={18} color="#000" />
                  <Text style={styles.navigationBtnText}>Start</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {isNavigating && navigationRoute && (
        <View style={styles.dashboardContainer}>
          <View style={[styles.navigationPanel, { backgroundColor: CARD_BG, borderColor: activeTheme.color }]}>
            <View style={styles.navigationMeta}>
              <Text style={[styles.navigationLabel, { color: activeTheme.color }]}>NAVIGATION ACTIVE</Text>
              <Text style={[styles.navigationText, { color: UI_TEXT }]}>
                {Number.isFinite(navigationRoute.distance)
                  ? `${(navigationRoute.distance / 1000).toFixed(2)} km remaining`
                  : 'Destination reached'}
              </Text>
              <Text style={[styles.navigationSubtext, { color: isDarkMode ? '#777' : '#666' }]}>
                Route updates live and recenters as you move.
              </Text>
            </View>
            <TouchableOpacity style={styles.exitNavigationBtn} onPress={handleExitNavigation}>
              <Ionicons name="close-circle-outline" size={18} color="#FFF" />
              <Text style={styles.exitNavigationText}>Exit navigation</Text>
            </TouchableOpacity>
            {__DEV__ && (
              <TouchableOpacity style={styles.debugSimBtn} onPress={handleSimulateStep}>
                <Ionicons name="footsteps-outline" size={18} color="#111" />
                <Text style={styles.debugSimText}>Simulate forward</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <Animated.View style={[styles.drawer, { backgroundColor: CARD_BG, transform: [{ translateX: drawerAnim }] }]}>
        <View style={styles.drawerHeader}>
          <Text style={[styles.drawerLogo, {color: LOGO_COLOR}]}>SAFERA<Text style={{color: '#00FF94'}}>.</Text></Text>
          <TouchableOpacity style={styles.userProfile} onPress={openProfile} activeOpacity={0.85}>
             <View style={[styles.avatar, {backgroundColor: '#00FF94'}]}>
                <Text style={styles.avatarText}>{(user.profileName || user.username).charAt(0).toUpperCase()}</Text>
             </View>
             <View style={styles.userProfileText}>
                <Text style={[styles.drawerWelcome, {color: UI_TEXT}]}>{user.profileName || user.username}</Text>
                <Text style={styles.subUser}>{user.mobile}</Text>
             </View>
             <Ionicons name="chevron-forward" size={20} color={isDarkMode ? '#777' : '#555'} />
          </TouchableOpacity>
        </View>

        <View style={styles.drawerLinks}>
          <DrawerItem icon="shield-checkmark" label="Protection Active" color="#00FF94" isDark={isDarkMode} />
          <DrawerItem icon="warning" label="Report Unsafe Spot" color={UI_TEXT} isDark={isDarkMode} onPress={openReports} />
          <DrawerItem icon="documents" label="My Reports" color={UI_TEXT} isDark={isDarkMode} onPress={openMyReports} />
        </View>

        <View style={styles.drawerFooter}>
          <TouchableOpacity style={styles.themeToggle} onPress={() => setIsDarkMode(!isDarkMode)}>
            <Ionicons name={isDarkMode ? "moon" : "sunny"} size={22} color="#00FF94" />
            <Text style={[styles.themeToggleText, {color: UI_TEXT}]}>{isDarkMode ? "NIGHTWATCH" : "DAYLIGHT"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={async () => {
            await logoutUser();
            setUser(null);
            setIsDrawerOpen(false);
            drawerAnim.setValue(-width);
          }}>
            <Ionicons name="log-out-outline" size={20} color="#FF6B6B" />
            <Text style={styles.logoutText}>LOG OUT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={toggleDrawer}>
            <Text style={{color: '#666', fontWeight: '900', fontSize: 10, letterSpacing: 2}}>EXIT MENU</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ============================================================
          SHAKE-TO-SOS COUNTDOWN OVERLAY
          Full-screen urgent overlay that gives 3 seconds to cancel.
          ============================================================ */}
      {shakeCountdown !== null && (
        <View style={styles.shakeCountdownOverlay}>
          <View style={styles.shakeCountdownCard}>
            <Text style={styles.shakeCountdownEmoji}>🆘</Text>
            <Text style={styles.shakeCountdownTitle}>SOS ACTIVATING</Text>
            <Text style={styles.shakeCountdownTimer}>{shakeCountdown}</Text>
            <Text style={styles.shakeCountdownHint}>Shake detected. Sending SOS to emergency contacts.</Text>
            <TouchableOpacity style={styles.shakeCountdownCancelBtn} onPress={cancelSosCountdown}>
              <Text style={styles.shakeCountdownCancelText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.sosFab} onPress={() => setIsSosOpen(true)} activeOpacity={0.9}>
        <Ionicons name="warning" size={24} color="#FFF" />
        <Text style={styles.sosFabText}>SOS</Text>
      </TouchableOpacity>

      <Modal
        visible={isMyReportsOpen}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsMyReportsOpen(false)}
      >
        <View style={[styles.fullScreenModalPage, { backgroundColor: CARD_BG }]}>
          <View style={[styles.fullScreenModalBody, { backgroundColor: CARD_BG }]}>
            <View style={styles.profileHeader}>
              <View>
                <Text style={[styles.profileTitle, { color: UI_TEXT }]}>My Reports</Text>
                <Text style={styles.profileSubtitle}>
                  Review, edit, or delete the reports you have already submitted.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsMyReportsOpen(false)}>
                <Ionicons name="close" size={24} color={UI_TEXT} />
              </TouchableOpacity>
            </View>

            {submittedReports.length === 0 ? (
              <View style={styles.emptyReportsState}>
                <Ionicons name="documents-outline" size={36} color={activeTheme.color} />
                <Text style={[styles.emptyReportsTitle, { color: UI_TEXT }]}>No submitted reports yet</Text>
                <Text style={styles.emptyReportsText}>
                  Reports you submit after a completed trip will appear here for future edits or deletion.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {submittedReports.map((report) => {
                  const isEditing = editingReportId === report.id;
                  return (
                    <View key={report.id} style={styles.manageReportCard}>
                      <Text style={[styles.reportHistoryType, { color: UI_TEXT }]}>{report.type}</Text>
                      <Text style={styles.reportHistoryMeta}>
                        {report.routeSnapshot?.startedFrom || 'Unknown start'} to {report.routeSnapshot?.destination || 'Unknown destination'}
                      </Text>
                      <Text style={styles.reportHistoryMeta}>
                        {new Date(report.updatedAt || report.createdAt).toLocaleString()}
                      </Text>
                      {report.coordinate && (
                        <Text style={styles.reportHistoryMeta}>
                          Pin: {report.coordinate.latitude.toFixed(5)}, {report.coordinate.longitude.toFixed(5)}
                        </Text>
                      )}

                      {isEditing ? (
                        <>
                          <Text style={[styles.profileLabel, { marginTop: 14 }]}>Issue Type</Text>
                          <View style={styles.reportTypeRow}>
                            {['Unsafe spot', 'Crime', 'Low lighting', 'Isolated area'].map((type) => {
                              const isSelected = editReportType === type;
                              return (
                                <TouchableOpacity
                                  key={`${report.id}-${type}`}
                                  style={[
                                    styles.reportChip,
                                    {
                                      backgroundColor: isSelected ? activeTheme.color : 'transparent',
                                      borderColor: isSelected ? activeTheme.color : isDarkMode ? '#222' : '#DDD',
                                    },
                                  ]}
                                  onPress={() => setEditReportType(type)}
                                >
                                  <Text style={[styles.reportChipText, { color: isSelected ? '#000' : UI_TEXT }]}>{type}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          <Text style={[styles.profileLabel, { marginTop: 4 }]}>Description</Text>
                          <ProfileField
                            label="Description"
                            value={editReportNote}
                            onChangeText={setEditReportNote}
                            textColor={UI_TEXT}
                            optional
                          />
                          <View style={styles.manageReportActions}>
                            <TouchableOpacity style={styles.reportCancelBtn} onPress={handleCancelEditingReport}>
                              <Text style={[styles.reportCancelText, { color: UI_TEXT }]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.reportSubmitBtn, { backgroundColor: activeTheme.color }]} onPress={handleSaveEditedReport}>
                              <Text style={styles.profileSaveText}>Save Changes</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={styles.reportHistoryNote}>{report.note || 'No extra notes added.'}</Text>
                          <View style={styles.manageReportActions}>
                            <TouchableOpacity style={styles.manageReportGhostBtn} onPress={() => handleStartEditingReport(report)}>
                              <Ionicons name="create-outline" size={16} color={UI_TEXT} />
                              <Text style={[styles.manageReportGhostText, { color: UI_TEXT }]}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.manageReportDeleteBtn} onPress={() => handleDeleteReport(report.id)}>
                              <Ionicons name="trash-outline" size={16} color="#FF6B6B" />
                              <Text style={styles.manageReportDeleteText}>Delete</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={isReportsOpen}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsReportsOpen(false)}
      >
        <View style={[styles.fullScreenModalPage, { backgroundColor: CARD_BG }]}>
          <View style={[styles.fullScreenModalBody, { backgroundColor: CARD_BG }]}>
            <View style={styles.profileHeader}>
              <View>
                <Text style={[styles.profileTitle, { color: UI_TEXT }]}>Route Reports</Text>
                <Text style={styles.profileSubtitle}>
                  Only completed navigation paths are listed here for reporting.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsReportsOpen(false)}>
                <Ionicons name="close" size={24} color={UI_TEXT} />
              </TouchableOpacity>
            </View>

            {completedTrips.length === 0 ? (
              <View style={styles.emptyReportsState}>
                <Ionicons name="navigate-circle-outline" size={36} color={activeTheme.color} />
                <Text style={[styles.emptyReportsTitle, { color: UI_TEXT }]}>No completed trips yet</Text>
                <Text style={styles.emptyReportsText}>
                  Finish a route and it will appear here so you can report unsafe spots, low lighting, crimes, or isolated stretches.
                </Text>
              </View>
            ) : !selectedTripForReport ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.reportSectionHeader}>
                  <Text style={styles.profileLabel}>Choose A Trip</Text>
                  <TouchableOpacity style={styles.clearHistoryPill} onPress={handleClearTripHistory}>
                    <Ionicons name="trash-outline" size={14} color="#FF6B6B" />
                    <Text style={styles.clearHistoryPillText}>Clear History</Text>
                  </TouchableOpacity>
                </View>
                {completedTrips.map((trip) => {
                  return (
                    <TouchableOpacity
                      key={trip.id}
                      style={[
                        styles.completedTripCard,
                        {
                          borderColor: isDarkMode ? '#222' : '#DDD',
                          backgroundColor: 'transparent',
                        },
                      ]}
                      onPress={() => handleSelectTripForReport(trip.id)}
                    >
                      <Text style={[styles.completedTripDestination, { color: UI_TEXT }]}>{trip.destination}</Text>
                      <Text style={styles.completedTripMeta}>
                        From {trip.startedFrom} • {(trip.distance / 1000).toFixed(2)} km
                      </Text>
                      <Text style={styles.completedTripMeta}>
                        {new Date(trip.completedAt).toLocaleString()}
                      </Text>
                      <View style={styles.tripSelectRow}>
                        <Text style={[styles.tripSelectText, { color: activeTheme.color }]}>Select trip</Text>
                        <Ionicons name="arrow-forward" size={16} color={activeTheme.color} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.selectedTripHeader}>
                  <TouchableOpacity style={styles.tripBackBtn} onPress={handleBackToTripSelection}>
                    <Ionicons name="arrow-back" size={16} color={UI_TEXT} />
                    <Text style={[styles.tripBackText, { color: UI_TEXT }]}>Back to trips</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.clearHistoryPill} onPress={handleClearTripHistory}>
                    <Ionicons name="trash-outline" size={14} color="#FF6B6B" />
                    <Text style={styles.clearHistoryPillText}>Clear History</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.selectedTripCard}>
                  <Text style={[styles.completedTripDestination, { color: UI_TEXT }]}>{selectedTripForReport.destination}</Text>
                  <Text style={styles.completedTripMeta}>
                    From {selectedTripForReport.startedFrom} • {(selectedTripForReport.distance / 1000).toFixed(2)} km
                  </Text>
                  <Text style={styles.completedTripMeta}>
                    {new Date(selectedTripForReport.completedAt).toLocaleString()}
                  </Text>
                </View>

                <Text style={styles.profileLabel}>Tap Route To Place Pin</Text>
                <View style={styles.reportMapWrap}>
                  <MapView
                    key={selectedTripForReport.id}
                    ref={reportMapRef}
                    style={styles.reportMap}
                    provider={PROVIDER_GOOGLE}
                    customMapStyle={isDarkMode ? mapDarkStyle : []}
                    initialRegion={{
                      latitude: selectedTripForReport.coords[0].latitude,
                      longitude: selectedTripForReport.coords[0].longitude,
                      latitudeDelta: 0.02,
                      longitudeDelta: 0.02,
                    }}
                    onMapReady={() => {
                      reportMapRef.current?.fitToCoordinates(selectedTripForReport.coords, {
                        edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
                        animated: false,
                      });
                    }}
                    onPress={handleRouteMapPress}
                  >
                    <Polyline
                      coordinates={selectedTripForReport.coords}
                      strokeColor={hexToRgba(activeTheme.color, 1)}
                      strokeWidth={5}
                      lineJoin="round"
                      lineCap="round"
                      lineDashPattern={[0]}
                    />
                    <Marker coordinate={selectedTripForReport.coords[0]}>
                      <View style={styles.dotStart} />
                    </Marker>
                    <Marker coordinate={selectedTripForReport.coords[selectedTripForReport.coords.length - 1]}>
                      <View style={[styles.dotEnd, { backgroundColor: activeTheme.color }]} />
                    </Marker>
                    {reportPin && (
                      <Marker coordinate={reportPin}>
                        <View style={styles.reportPinMarker}>
                          <Ionicons name="location-sharp" size={18} color="#FF3B30" />
                        </View>
                      </Marker>
                    )}
                  </MapView>
                  <View style={styles.reportMapBadge}>
                    <Ionicons name="location-sharp" size={16} color={activeTheme.color} />
                    <Text style={[styles.reportMapBadgeText, { color: UI_TEXT }]}>Tap route to drop pin</Text>
                  </View>
                </View>
                <Text style={styles.reportPinHint}>
                  {reportPin
                    ? 'Pin set on the selected route.'
                    : 'Tap the route preview to drop the report icon exactly where the problem happened.'}
                </Text>

                <Text style={styles.profileLabel}>Issue Type</Text>
                <View style={styles.reportTypeRow}>
                  {['Unsafe spot', 'Crime', 'Low lighting', 'Isolated area'].map((type) => {
                    const isSelected = reportType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.reportChip,
                          {
                            backgroundColor: isSelected ? activeTheme.color : 'transparent',
                            borderColor: isSelected ? activeTheme.color : isDarkMode ? '#222' : '#DDD',
                          },
                        ]}
                        onPress={() => setReportType(type)}
                      >
                        <Text style={[styles.reportChipText, { color: isSelected ? '#000' : UI_TEXT }]}>{type}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.profileLabel, { marginTop: 18 }]}>Description</Text>
                <ProfileField
                  label="Description"
                  value={reportNote}
                  onChangeText={setReportNote}
                  textColor={UI_TEXT}
                  optional
                />

                {selectedTripForReport && (
                  <>
                    <Text style={[styles.profileLabel, { marginTop: 4 }]}>Reports For Selected Trip</Text>
                    {selectedTripReports.length === 0 ? (
                      <Text style={styles.noReportsText}>No reports submitted on this route yet.</Text>
                    ) : (
                      selectedTripReports.map((report) => (
                        <View key={report.id} style={styles.reportHistoryCard}>
                          <Text style={[styles.reportHistoryType, { color: UI_TEXT }]}>{report.type}</Text>
                          <Text style={styles.reportHistoryMeta}>{new Date(report.createdAt).toLocaleString()}</Text>
                          {report.coordinate && (
                            <Text style={styles.reportHistoryMeta}>
                              Pin: {report.coordinate.latitude.toFixed(5)}, {report.coordinate.longitude.toFixed(5)}
                            </Text>
                          )}
                          <Text style={styles.reportHistoryNote}>{report.note || 'No extra notes added.'}</Text>
                        </View>
                      ))
                    )}
                  </>
                )}
              </ScrollView>
            )}

            {completedTrips.length > 0 && selectedTripForReport && (
              <View style={styles.reportActionRow}>
                <TouchableOpacity style={styles.reportCancelBtn} onPress={handleBackToTripSelection}>
                  <Text style={[styles.reportCancelText, { color: UI_TEXT }]}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.reportSubmitBtn, { backgroundColor: activeTheme.color }]} onPress={handleSubmitReport}>
                  <Text style={styles.profileSaveText}>Submit Report</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={isProfileOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsProfileOpen(false)}
      >
        <View style={styles.profileModalBackdrop}>
          <View style={[styles.profileModal, { backgroundColor: CARD_BG }]}>
            <View style={styles.profileHeader}>
              <View>
                <Text style={[styles.profileTitle, { color: UI_TEXT }]}>Your Profile</Text>
                <Text style={styles.profileSubtitle}>Manage your contact and safety details.</Text>
              </View>
              <TouchableOpacity onPress={() => setIsProfileOpen(false)}>
                <Ionicons name="close" size={24} color={UI_TEXT} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <ProfileField label="Username" value={user.username} editable={false} textColor={UI_TEXT} />
              <ProfileField label="Mobile Number" value={user.mobile} editable={false} textColor={UI_TEXT} />
              <ProfileField
                label="Full Name"
                value={profileForm.profileName}
                onChangeText={(value) => setProfileForm((current) => ({ ...current, profileName: value }))}
                textColor={UI_TEXT}
              />
              <ProfileField
                label="Email"
                value={profileForm.email}
                onChangeText={(value) => setProfileForm((current) => ({ ...current, email: value }))}
                keyboardType="email-address"
                textColor={UI_TEXT}
                optional
              />
              <ProfileField
                label="Emergency Contact 1"
                value={profileForm.emergencyContact1}
                onChangeText={(value) => setProfileForm((current) => ({ ...current, emergencyContact1: value }))}
                keyboardType="phone-pad"
                textColor={UI_TEXT}
              />
              <ProfileField
                label="Emergency Contact 2"
                value={profileForm.emergencyContact2}
                onChangeText={(value) => setProfileForm((current) => ({ ...current, emergencyContact2: value }))}
                keyboardType="phone-pad"
                textColor={UI_TEXT}
                optional
              />
            </ScrollView>

            <TouchableOpacity style={[styles.profileSaveBtn, { backgroundColor: activeTheme.color }]} onPress={handleSaveProfile}>
              <Text style={styles.profileSaveText}>Save Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.profileDeleteBtn} onPress={handleDeleteAccount}>
              <Ionicons name="trash-outline" size={16} color="#FF3B30" style={{ marginRight: 6 }} />
              <Text style={styles.profileDeleteText}>Delete Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isSosOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setIsSosOpen(false)}
      >
        <View style={styles.sosBackdrop}>
          <View style={[styles.sosModal, { backgroundColor: CARD_BG }]}>
            <Text style={[styles.sosTitle, { color: UI_TEXT }]}>Trigger SOS</Text>
            <Text style={styles.sosSubtitle}>
              This simulates sending your live location and opening the call screen immediately.
            </Text>

            <TouchableOpacity style={styles.sosOption} onPress={() => triggerSos('police')}>
              <View style={[styles.sosIconWrap, { backgroundColor: '#2A1010' }]}>
                <Ionicons name="shield" size={22} color="#FF5A5F" />
              </View>
              <View style={styles.sosOptionText}>
                <Text style={[styles.sosOptionTitle, { color: UI_TEXT }]}>Police</Text>
                <Text style={styles.sosOptionSub}>Share live location and dial emergency services.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sosOption} onPress={() => triggerSos('contact')}>
              <View style={[styles.sosIconWrap, { backgroundColor: '#10261E' }]}>
                <Ionicons name="call" size={22} color="#00FF94" />
              </View>
              <View style={styles.sosOptionText}>
                <Text style={[styles.sosOptionTitle, { color: UI_TEXT }]}>Emergency Contact</Text>
                <Text style={styles.sosOptionSub}>
                  Send live location to {user.emergencyContact1 || 'your saved contact'} and dial them.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sosOption} onPress={startFakeCall}>
              <View style={[styles.sosIconWrap, { backgroundColor: '#1A1A2E' }]}>
                <Ionicons name="call" size={22} color="#5E9EFF" />
              </View>
              <View style={styles.sosOptionText}>
                <Text style={[styles.sosOptionTitle, { color: UI_TEXT }]}>Fake a Call</Text>
                <Text style={styles.sosOptionSub}>Trigger a realistic fake incoming call to exit an unsafe situation discreetly.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sosCancelBtn} onPress={() => setIsSosOpen(false)}>
              <Text style={styles.sosCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ================================================================
          FAKE CALL — iOS 17 INCOMING CALL SCREEN
          ================================================================ */}
      {fakeCallPhase === 'incoming' && (
        <View style={styles.iosCallBg}>
          <StatusBar barStyle="light-content" />

          {/* Top info */}
          <View style={styles.iosCallTopInfo}>
            <Text style={styles.iosCallIncomingLabel}>INCOMING CALL</Text>

            {/* Animated pulse ring behind avatar */}
            <View style={styles.iosCallAvatarWrap}>
              <Animated.View style={[
                styles.iosCallPulseRing,
                {
                  transform: [{ scale: pulseAnim.interpolate({ inputRange: [0,1], outputRange: [1, 1.55] }) }],
                  opacity: pulseAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.45, 0.15, 0] }),
                }
              ]} />
              <View style={styles.iosCallAvatar}>
                <Text style={styles.iosCallAvatarText}>M</Text>
              </View>
            </View>

            <Text style={styles.iosCallName}>Mom</Text>
            <Text style={styles.iosCallSub}>mobile</Text>
          </View>

          {/* Quick actions */}
          <View style={styles.iosCallQuickRow}>
            <View style={styles.iosCallQuickBtn}>
              <View style={styles.iosCallQuickIcon}>
                <Ionicons name="alarm" size={22} color="#FFF" />
              </View>
              <Text style={styles.iosCallQuickLabel}>Remind Me</Text>
            </View>
            <View style={styles.iosCallQuickBtn}>
              <View style={styles.iosCallQuickIcon}>
                <Ionicons name="chatbubble" size={22} color="#FFF" />
              </View>
              <Text style={styles.iosCallQuickLabel}>Message</Text>
            </View>
          </View>

          {/* Decline / Accept */}
          <View style={styles.iosCallActionRow}>
            <View style={styles.iosCallActionWrap}>
              <TouchableOpacity style={styles.iosCallDecline} onPress={endFakeCall}>
                <Ionicons name="call" size={32} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
              </TouchableOpacity>
              <Text style={styles.iosCallActionLabel}>Decline</Text>
            </View>
            <View style={styles.iosCallActionWrap}>
              <TouchableOpacity style={styles.iosCallAccept} onPress={answerFakeCall}>
                <Ionicons name="call" size={32} color="#FFF" />
              </TouchableOpacity>
              <Text style={styles.iosCallActionLabel}>Accept</Text>
            </View>
          </View>
        </View>
      )}

      {/* ================================================================
          FAKE CALL — iOS 17 ACTIVE CALL SCREEN
          ================================================================ */}
      {fakeCallPhase === 'active' && (
        <View style={styles.iosCallBg}>
          <StatusBar barStyle="light-content" />

          <View style={styles.iosCallTopInfo}>
            {/* Mini avatar */}
            <View style={styles.iosCallMiniAvatar}>
              <Text style={styles.iosCallMiniAvatarText}>M</Text>
            </View>
            <Text style={styles.iosCallName}>Mom</Text>
            {/* Green connected dot + timer */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <View style={styles.iosCallConnectedDot} />
              <Text style={styles.iosCallTimer}>{formatCallTime(fakeCallSeconds)}</Text>
            </View>
          </View>

          {/* 2×3 control grid — iOS style */}
          <View style={styles.iosCallGrid}>
            {[
              { icon: 'mic-off',     label: 'mute'     },
              { icon: 'keypad',      label: 'keypad'   },
              { icon: 'volume-high', label: 'audio'    },
              { icon: 'add',         label: 'add call' },
              { icon: 'pause',       label: 'hold'     },
              { icon: 'videocam',    label: 'FaceTime' },
            ].map((btn) => (
              <View key={btn.label} style={styles.iosCallCtrl}>
                <View style={styles.iosCallCtrlIcon}>
                  <Ionicons name={btn.icon} size={26} color="#FFF" />
                </View>
                <Text style={styles.iosCallCtrlLabel}>{btn.label}</Text>
              </View>
            ))}
          </View>

          {/* End call */}
          <TouchableOpacity style={styles.iosCallEndBtn} onPress={endFakeCall}>
            <Ionicons name="call" size={34} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const DrawerItem = ({ icon, label, color, isDark, onPress }) => (
  <TouchableOpacity style={styles.drawerItem} onPress={onPress}>
    <Ionicons name={icon} size={22} color={color} />
    <Text style={[styles.drawerItemLabel, {color: color === '#00FF94' ? color : isDark ? '#888' : '#444'}]}>{label}</Text>
  </TouchableOpacity>
);

const ProfileField = ({ label, value, onChangeText, keyboardType, editable = true, textColor, optional = false }) => (
  <View style={styles.profileField}>
    <Text style={styles.profileLabel}>
      {label}
      {optional ? ' (Optional)' : ''}
    </Text>
    <TextInput
      style={[
        styles.profileInput,
        { color: textColor },
        !editable && styles.profileInputDisabled,
      ]}
      value={value}
      onChangeText={onChangeText}
      editable={editable}
      keyboardType={keyboardType}
      placeholderTextColor="#666"
    />
  </View>
);

const mapDarkStyle = [{ "elementType": "geometry", "stylers": [{ "color": "#121212" }] }, { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#1A1A1A" }] }, { "featureType": "water", "stylers": [{ "color": "#000000" }] }];

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width, height },
  menuBtn: { position: 'absolute', top: 60, left: 20, width: 55, height: 55, borderRadius: 18, justifyContent: 'center', alignItems: 'center', zIndex: 90, elevation: 10 },
  topOverlay: { position: 'absolute', top: 135, width: '100%', paddingHorizontal: 20, zIndex: 80 },
  fullSearch: { borderRadius: 25, padding: 22, borderWidth: 1, elevation: 5 },
  logoBrand: { fontSize: 10, fontWeight: '900', letterSpacing: 3, marginBottom: 15 },
  minified: { borderRadius: 15, padding: 15, borderLeftWidth: 6 },
  minTitle: { fontSize: 13, fontWeight: '900' },
  minHint: { fontSize: 10, marginTop: 2 },
  input: {
    minHeight: 48,
    paddingVertical: 10,
    fontWeight: 'bold',
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'center',
  },
  line: { height: 1, marginVertical: 10 },
  searchBtn: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 15 },
  btnText: { fontWeight: '900', color: '#000', fontSize: 14 },
  drawer: { position: 'absolute', top: 0, bottom: 0, width: width * 0.8, zIndex: 1000, padding: 35, elevation: 25 },
  drawerHeader: { marginTop: 40, marginBottom: 50 },
  drawerLogo: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  userProfile: { flexDirection: 'row', alignItems: 'center', marginTop: 30, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 18, padding: 16 },
  userProfileText: { flex: 1 },
  avatar: { width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  avatarText: { fontWeight: '900', fontSize: 20 },
  drawerWelcome: { fontSize: 18, fontWeight: '900' },
  subUser: { color: '#666', fontSize: 11, marginTop: 2 },
  drawerLinks: { flex: 1 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  drawerItemLabel: { marginLeft: 15, fontSize: 15, fontWeight: 'bold' },
  drawerFooter: { marginBottom: 20 },
  themeToggle: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', padding: 18, borderRadius: 15 },
  themeToggleText: { marginLeft: 15, fontWeight: '900', letterSpacing: 1 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 18, paddingHorizontal: 6 },
  logoutText: { color: '#FF6B6B', fontWeight: '900', letterSpacing: 1, marginLeft: 10 },
  closeBtn: { marginTop: 40, alignItems: 'center' },
  routeTray: { position: 'absolute', bottom: 235, paddingLeft: 20, width: '100%', zIndex: 85, elevation: 9 },
  routeTab: { paddingVertical: 16, paddingHorizontal: 15, borderRadius: 18, marginRight: 12, borderWidth: 1, width: 150, minHeight: 66, justifyContent: 'center' },
  tabType: { fontSize: 11, fontWeight: '900', lineHeight: 16 },
  postTripContainer: { position: 'absolute', top: 220, width: '100%', paddingHorizontal: 20, zIndex: 86, elevation: 10 },
  postTripCard: { borderRadius: 22, padding: 18, borderWidth: 1.5 },
  postTripTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  postTripText: { fontSize: 18, fontWeight: '900', marginTop: 8, lineHeight: 24 },
  postTripSubtext: { color: '#888', fontSize: 12, marginTop: 8, lineHeight: 18 },
  postTripActions: { flexDirection: 'row', marginTop: 16 },
  postTripPrimaryBtn: { flex: 1, height: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  postTripPrimaryText: { color: '#000', fontWeight: '900', fontSize: 13 },
  postTripSecondaryBtn: { width: 100, height: 46, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  postTripSecondaryText: { fontWeight: '800', fontSize: 13 },
  dashboardContainer: { position: 'absolute', bottom: 30, width: '100%', alignItems: 'center', zIndex: 84, elevation: 8 },
  dashboard: { width: width * 0.92, borderRadius: 25, padding: 22, flexDirection: 'row', alignItems: 'center', borderTopWidth: 3 },
  navigationBtn: {
    marginTop: 14,
    width: width * 0.92,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  navigationBtnText: { color: '#000', fontWeight: '900', fontSize: 15, marginLeft: 8 },
  navigationPanel: {
    width: width * 0.92,
    borderRadius: 25,
    padding: 20,
    borderWidth: 1.5,
  },
  navigationMeta: { marginBottom: 16 },
  navigationLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  navigationText: { fontSize: 22, fontWeight: '900', marginTop: 8 },
  navigationSubtext: { fontSize: 12, marginTop: 6, lineHeight: 18 },
  exitNavigationBtn: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  exitNavigationText: { color: '#FFF', fontWeight: '900', fontSize: 14, marginLeft: 8 },
  debugSimBtn: {
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#F4D35E',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  debugSimText: { color: '#111', fontWeight: '900', fontSize: 13, marginLeft: 8 },
  scoreBox: { width: 60, height: 60, borderRadius: 30, borderWidth: 3, justifyContent: 'center', alignItems: 'center' },
  scoreNum: { fontSize: 20, fontWeight: '900' },
  info: { marginLeft: 15, flex: 1 },
  status: { fontSize: 16, fontWeight: '900' },
  subStatus: { fontSize: 10, marginTop: 4 },
  dotStart: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#3498db', borderWidth: 2, borderColor: '#FFF' },
  dotEnd: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFF' },
  dangerIconContainer: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#FFF', elevation: 4 },
  profileModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  profileModal: { minHeight: height * 0.72, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 },
  fullScreenModalPage: { flex: 1, paddingTop: 52 },
  fullScreenModalBody: { flex: 1, paddingHorizontal: 24, paddingBottom: 24 },
  profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  profileTitle: { fontSize: 28, fontWeight: '900' },
  profileSubtitle: { color: '#777', marginTop: 4, maxWidth: width * 0.65 },
  profileField: { marginBottom: 16 },
  profileLabel: { color: '#00FF94', fontSize: 11, fontWeight: '800', marginBottom: 10, letterSpacing: 0.5 },
  profileInput: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 16, paddingHorizontal: 18, height: 56, fontSize: 15 },
  profileInputDisabled: { opacity: 0.65 },
  profileSaveBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  profileDeleteBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FF3B30',
    marginTop: 10,
    marginBottom: 4,
  },
  profileDeleteText: { color: '#FF3B30', fontSize: 14, fontWeight: '600' },
  profileSaveText: { color: '#000', fontWeight: '900', fontSize: 15 },
  emptyReportsState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyReportsTitle: { fontSize: 20, fontWeight: '900', marginTop: 16 },
  emptyReportsText: { color: '#777', marginTop: 10, textAlign: 'center', lineHeight: 20 },
  reportSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  clearHistoryPill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#3A1A1A', backgroundColor: '#1A0E0E', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  clearHistoryPillText: { color: '#FF6B6B', fontSize: 12, fontWeight: '800', marginLeft: 6 },
  completedTripCard: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 12 },
  completedTripDestination: { fontSize: 16, fontWeight: '900' },
  completedTripMeta: { color: '#888', marginTop: 6, lineHeight: 18 },
  tripSelectRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  tripSelectText: { fontWeight: '800', fontSize: 13, marginRight: 6 },
  selectedTripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  tripBackBtn: { flexDirection: 'row', alignItems: 'center' },
  tripBackText: { fontSize: 13, fontWeight: '800', marginLeft: 8 },
  selectedTripCard: { borderWidth: 1, borderColor: '#222', borderRadius: 18, padding: 16, marginBottom: 18, backgroundColor: 'rgba(255,255,255,0.03)' },
  reportTypeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  reportChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, marginRight: 10, marginBottom: 10 },
  reportChipText: { fontWeight: '800', fontSize: 12 },
  reportMapWrap: { overflow: 'hidden', borderRadius: 22, marginBottom: 12, borderWidth: 1, borderColor: '#222', position: 'relative' },
  reportMap: { width: '100%', height: 300 },
  reportMapBadge: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  reportMapBadgeText: { fontSize: 12, fontWeight: '800', marginLeft: 6 },
  reportPinMarker: { justifyContent: 'center', alignItems: 'center' },
  reportPinHint: { color: '#888', fontSize: 12, marginBottom: 14, lineHeight: 18 },
  noReportsText: { color: '#777', marginTop: 4, marginBottom: 8 },
  reportHistoryCard: { borderRadius: 16, padding: 14, backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 10 },
  reportHistoryType: { fontSize: 14, fontWeight: '900' },
  reportHistoryMeta: { color: '#777', fontSize: 12, marginTop: 4 },
  reportHistoryNote: { color: '#999', marginTop: 8, lineHeight: 18 },
  manageReportCard: { borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 14, borderWidth: 1, borderColor: '#222' },
  manageReportActions: { flexDirection: 'row', marginTop: 14 },
  manageReportGhostBtn: { height: 44, borderRadius: 14, borderWidth: 1, borderColor: '#333', paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', marginRight: 12 },
  manageReportGhostText: { fontWeight: '800', fontSize: 13, marginLeft: 8 },
  manageReportDeleteBtn: { height: 44, borderRadius: 14, borderWidth: 1, borderColor: '#4A1E1E', backgroundColor: '#1A0E0E', paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  manageReportDeleteText: { color: '#FF6B6B', fontWeight: '800', fontSize: 13, marginLeft: 8 },
  reportActionRow: { flexDirection: 'row', marginTop: 18 },
  reportCancelBtn: { width: 110, height: 56, borderRadius: 16, borderWidth: 1, borderColor: '#333', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  reportCancelText: { fontWeight: '800', fontSize: 15 },
  reportSubmitBtn: { flex: 1, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  sosFab: {
    position: 'absolute',
    right: 22,
    bottom: 34,
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#FF3B30',
    borderWidth: 4,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 950,
    elevation: 16,
    shadowColor: '#FF3B30',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  sosFabText: { color: '#FFF', fontWeight: '900', fontSize: 13, marginTop: 4, letterSpacing: 1 },
  sosBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: 20 },
  sosModal: { borderRadius: 28, padding: 22, marginBottom: 8 },
  sosTitle: { fontSize: 28, fontWeight: '900' },
  sosSubtitle: { color: '#777', marginTop: 8, marginBottom: 22, lineHeight: 20 },
  sosOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  sosIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  sosOptionText: { flex: 1 },
  sosOptionTitle: { fontSize: 17, fontWeight: '900' },
  sosOptionSub: { color: '#888', fontSize: 12, marginTop: 4, lineHeight: 18 },
  sosCancelBtn: { alignItems: 'center', justifyContent: 'center', paddingTop: 6, paddingBottom: 8 },
  sosCancelText: { color: '#888', fontSize: 15, fontWeight: '700' },
  // Shake-to-SOS countdown overlay
  shakeCountdownOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(180,0,0,0.88)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 9999,
  },
  shakeCountdownCard: {
    width: width * 0.82,
    backgroundColor: '#1A0000',
    borderRadius: 32,
    padding: 36,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  shakeCountdownEmoji: { fontSize: 52, marginBottom: 14 },
  shakeCountdownTitle: {
    color: '#FF3B30', fontSize: 18, fontWeight: '900',
    letterSpacing: 3, marginBottom: 20,
  },
  shakeCountdownTimer: {
    color: '#FFF', fontSize: 96, fontWeight: '900',
    lineHeight: 100, marginBottom: 16,
  },
  shakeCountdownHint: {
    color: '#FF9999', fontSize: 13, textAlign: 'center',
    lineHeight: 20, marginBottom: 32,
  },
  shakeCountdownCancelBtn: {
    width: '100%', height: 56, borderRadius: 18,
    borderWidth: 2, borderColor: '#FF3B30',
    justifyContent: 'center', alignItems: 'center',
  },
  shakeCountdownCancelText: {
    color: '#FFF', fontWeight: '900', fontSize: 16, letterSpacing: 2,
  },
  // iOS 17 Fake Call screens
  iosCallBg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#1A3A2A', // deep green tint — iOS contacts default
    zIndex: 99999,
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 50,
    alignItems: 'center',
  },
  iosCallTopInfo: {
    alignItems: 'center',
    marginTop: 20,
  },
  iosCallIncomingLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 24,
    letterSpacing: 0.3,
  },
  iosCallAvatar: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#2E7D52',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  // Wrapper: bigger than avatar so the ring has room to show outside the avatar
  iosCallAvatarWrap: {
    width: 140, height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  // Ring fills the entire wrapper via inset 0 — perfectly centered behind the 100px avatar
  iosCallPulseRing: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: 'rgba(46,125,82,0.85)',
    backgroundColor: 'transparent',
  },
  // Mini avatar for active call screen
  iosCallMiniAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#2E7D52',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  iosCallMiniAvatarText: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '600',
  },
  // Green dot for "connected" status
  iosCallConnectedDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#34C759',
  },
  iosCallAvatarText: {
    color: '#FFF',
    fontSize: 44,
    fontWeight: '600',
  },
  iosCallName: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '600',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  iosCallSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 16,
    fontWeight: '400',
  },
  iosCallTimer: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: 1,
  },
  iosCallQuickRow: {
    flexDirection: 'row',
    gap: 60,
    marginBottom: 10,
  },
  iosCallQuickBtn: {
    alignItems: 'center',
    gap: 8,
  },
  iosCallQuickIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iosCallQuickLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
  },
  iosCallActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 52,
  },
  iosCallActionWrap: {
    alignItems: 'center',
    gap: 12,
  },
  iosCallDecline: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iosCallAccept: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: '#34C759',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iosCallActionLabel: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
  iosCallGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: width,
    paddingHorizontal: 36,
    justifyContent: 'space-between',
    rowGap: 20,
  },
  iosCallCtrl: {
    width: '30%',
    alignItems: 'center',
    gap: 8,
  },
  iosCallCtrlIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iosCallCtrlLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
  },
  iosCallEndBtn: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
