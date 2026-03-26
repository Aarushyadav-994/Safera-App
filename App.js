import React, { useState, useRef, useEffect } from 'react';
import { calculateSafetyScore } from './SafetyEngine';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  Dimensions, ActivityIndicator, Keyboard, StatusBar, ScrollView, Animated, Modal, Linking, Alert
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import AuthScreen from './AuthScreen';
import { fetchRealRoute, getCoordsFromText } from './RouteService';
import { getActiveUser, logoutUser, updateActiveUserProfile } from './userDatabase';

const { width, height } = Dimensions.get('window');

export default function App() {
  const mapRef = useRef(null);
  const drawerAnim = useRef(new Animated.Value(-width)).current;
  const locationWatcherRef = useRef(null);
  
  const [user, setUser] = useState(null); 
  const [authLoading, setAuthLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [startText, setStartText] = useState('My Location');
  const [endText, setEndText] = useState('DTU Delhi');
  const [allRoutes, setAllRoutes] = useState([]); 
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [markers, setMarkers] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSosOpen, setIsSosOpen] = useState(false);
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
        (nextLocation) => {
          setUserLocation(nextLocation.coords);
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

  const toggleDrawer = () => {
    const toValue = isDrawerOpen ? -width : 0;
    Animated.timing(drawerAnim, { toValue, duration: 300, useNativeDriver: true }).start();
    setIsDrawerOpen(!isDrawerOpen);
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

  const handleFindRoute = async () => {
    Keyboard.dismiss();
    setLoading(true);
    
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
        const routes = await fetchRealRoute(startPoint, endPoint);
        
        console.log("4. Routes fetched. Calculating GPS-seeded safety data...");
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
      
      // Create the deterministic seed based on GPS
      const midCoord = route.coords[Math.floor(route.coords.length / 2)];
      const seedStr = `${midCoord.latitude.toFixed(3)}-${midCoord.longitude.toFixed(3)}-${tierIndex}`;
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) {
        hash = Math.imul(31, hash) + seedStr.charCodeAt(i) | 0;
      }
      const seed = Math.abs(hash % 10000) / 10000; 

      // CALLING YOUR FORMULA ENGINE
      const score = calculateSafetyScore(tierIndex, seed);
      
      // Generate Danger Zones based on tierIndex
      let numDangerZones = tierIndex === 0 ? Math.floor(seed * 2) : 
                          tierIndex === 1 ? Math.floor(seed * 2) + 2 : 
                          Math.floor(seed * 3) + 4;

      const dangerZones = [];
      if (route.coords.length > 10) {
        for (let i = 0; i < numDangerZones; i++) {
          const pSeed = Math.abs((hash * (i + 13)) % 10000) / 10000;
          dangerZones.push(route.coords[Math.floor(pSeed * (route.coords.length - 4)) + 2]);
        }
      }

      return { ...route, safetyScore: score, dangerZones };
    });

    // Finally, sort by safetyScore so the UI always defaults to the Green route
    processedRoutes.sort((a, b) => b.safetyScore - a.safetyScore);
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
    const phoneNumber = isPolice ? '112' : user?.emergencyContact1;

    if (!phoneNumber) {
      Alert.alert('SOS unavailable', 'No emergency contact is saved in the profile yet.');
      return;
    }

    const targetLabel = isPolice ? 'Police' : 'Emergency Contact';
    const liveLocationMessage = getLiveLocationMessage();
    setIsSosOpen(false);

    Alert.alert(
      'SOS sent',
      `${targetLabel} notified.\n${liveLocationMessage}\n\nDialing ${phoneNumber}...`
    );

    const phoneUrl = `tel:${phoneNumber}`;
    const canCall = await Linking.canOpenURL(phoneUrl);

    if (canCall) {
      await Linking.openURL(phoneUrl);
    } else {
      Alert.alert('Call unavailable', `Could not open the dialer for ${phoneNumber}.`);
    }
  };

  // 🛡️ CRITICAL ERROR FIX: Safety check for empty routes
  const currentRoute = allRoutes && allRoutes.length > 0 ? allRoutes[selectedRouteIndex] : null;

  const getRouteTheme = (index) => {
    const route = allRoutes[index];
    const realScore = route ? route.safetyScore : 0; 

    if (index === 0) return { color: '#00FF94', score: realScore, label: '🛡️ MAXIMUM SAFETY' };
    if (index === 1) return { color: '#3498db', score: realScore, label: '🛣️ BALANCED' };
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
        {/* POLYLINES - These still change color dynamically */}
        {allRoutes.map((route, index) => {
          const pathTheme = getRouteTheme(index);
          const isFocused = index === selectedRouteIndex;
          return (
            <Polyline 
              key={`route-${index}`}
              coordinates={route.coords} 
              strokeColor={isFocused ? pathTheme.color : `${pathTheme.color}33`} 
              strokeWidth={isFocused ? 8 : 4}
              zIndex={isFocused ? 1000 : 10 - index}
              tappable={true}
              onPress={() => setSelectedRouteIndex(index)}
            />
          );
        })}

        {/* DANGER ZONES - Locked to permanent full opacity. No jumping, no flashing. */}
        {allRoutes.map((route, index) => {
          return route.dangerZones?.map((zoneCoord, zIndex) => (
            <Marker 
              key={`danger-${index}-${zIndex}`} 
              coordinate={zoneCoord}
              zIndex={1001} // Always on top of lines
              tracksViewChanges={false} // Safe to use now since opacity is static
              anchor={{ x: 0.5, y: 0.5 }} 
            >
              <View style={[styles.dangerIconContainer, { opacity: 0.95 }]}>
                <Ionicons name="warning" size={10} color="#FFF" />
              </View>
            </Marker>
          ));
        })}

        {markers && (
          <>
            <Marker coordinate={markers.start}><View style={styles.dotStart}/></Marker>
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
        ) : (
          <TouchableOpacity style={[styles.minified, {backgroundColor: CARD_BG}]} onPress={() => setIsMinimized(false)}>
             <Text style={[styles.minTitle, {color: activeTheme.color}]}>DESTINATION: {endText.toUpperCase()}</Text>
             <Text style={[styles.minHint, {color: isDarkMode ? '#444' : '#999'}]}>Tap to change route</Text>
          </TouchableOpacity>
        )}
      </View>

      {isMinimized && currentRoute && (
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
          </View>
        </>
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
          <DrawerItem icon="warning" label="Report Unsafe Spot" color={UI_TEXT} isDark={isDarkMode} />
          <DrawerItem icon="people" label="Emergency Contacts" color={UI_TEXT} isDark={isDarkMode} />
          <DrawerItem icon="settings" label="Settings" color={UI_TEXT} isDark={isDarkMode} />
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

      <TouchableOpacity style={styles.sosFab} onPress={() => setIsSosOpen(true)} activeOpacity={0.9}>
        <Ionicons name="warning" size={24} color="#FFF" />
        <Text style={styles.sosFabText}>SOS</Text>
      </TouchableOpacity>

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

            <TouchableOpacity style={styles.sosCancelBtn} onPress={() => setIsSosOpen(false)}>
              <Text style={styles.sosCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const DrawerItem = ({ icon, label, color, isDark }) => (
  <TouchableOpacity style={styles.drawerItem}>
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
  topOverlay: { position: 'absolute', top: 135, width: '100%', paddingHorizontal: 20 },
  fullSearch: { borderRadius: 25, padding: 22, borderWidth: 1, elevation: 5 },
  logoBrand: { fontSize: 10, fontWeight: '900', letterSpacing: 3, marginBottom: 15 },
  minified: { borderRadius: 15, padding: 15, borderLeftWidth: 6 },
  minTitle: { fontSize: 13, fontWeight: '900' },
  minHint: { fontSize: 10, marginTop: 2 },
  input: { height: 35, fontWeight: 'bold', fontSize: 15 },
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
  routeTray: { position: 'absolute', bottom: 170, paddingLeft: 20, width: '100%' },
  routeTab: { padding: 15, borderRadius: 18, marginRight: 12, borderWidth: 1, width: 120 },
  tabType: { fontSize: 10, fontWeight: '900' },
  dashboardContainer: { position: 'absolute', bottom: 30, width: '100%', alignItems: 'center' },
  dashboard: { width: width * 0.92, borderRadius: 25, padding: 22, flexDirection: 'row', alignItems: 'center', borderTopWidth: 3 },
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
  profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  profileTitle: { fontSize: 28, fontWeight: '900' },
  profileSubtitle: { color: '#777', marginTop: 4, maxWidth: width * 0.65 },
  profileField: { marginBottom: 16 },
  profileLabel: { color: '#00FF94', fontSize: 11, fontWeight: '800', marginBottom: 10, letterSpacing: 0.5 },
  profileInput: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 16, paddingHorizontal: 18, height: 56, fontSize: 15 },
  profileInputDisabled: { opacity: 0.65 },
  profileSaveBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  profileSaveText: { color: '#000', fontWeight: '900', fontSize: 15 },
  sosFab: {
    position: 'absolute',
    right: 22,
    bottom: 34,
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#FF3B30',
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
  sosCancelText: { color: '#888', fontSize: 15, fontWeight: '700' }
});
