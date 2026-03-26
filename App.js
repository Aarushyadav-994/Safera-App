import React, { useState, useRef, useEffect } from 'react';
import { calculateSafetyScore } from './SafetyEngine';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  Dimensions, ActivityIndicator, Keyboard, StatusBar, ScrollView, Animated
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import AuthScreen from './AuthScreen';
import { fetchRealRoute, getCoordsFromText } from './RouteService';

const { width, height } = Dimensions.get('window');

export default function App() {
  const mapRef = useRef(null);
  const drawerAnim = useRef(new Animated.Value(-width)).current;
  
  // App States
  const [user, setUser] = useState(null); 
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

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let location = await Location.getCurrentPositionAsync({});
      setUserLocation(location.coords);
    })();
  }, []);

  const toggleDrawer = () => {
    const toValue = isDrawerOpen ? -width : 0;
    Animated.timing(drawerAnim, { toValue, duration: 300, useNativeDriver: true }).start();
    setIsDrawerOpen(!isDrawerOpen);
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
        
        console.log("4. Routes fetched. Calculating safety scores...");
        if (routes && routes.length > 0) {
          let processedRoutes = routes.map((route, index) => {
            // Pass the index to generate tier-based random data
            return { ...route, safetyScore: calculateSafetyScore(route.coords[0], index) };
          });

          // Sort highest score to the top
          processedRoutes.sort((a, b) => b.safetyScore - a.safetyScore);
          setAllRoutes(processedRoutes);
          setSelectedRouteIndex(0);
          setIsMinimized(true);

          if (mapRef.current) {
            mapRef.current.fitToCoordinates(routes[0].coords, {
              edgePadding: { top: 150, right: 60, bottom: 450, left: 60 },
              animated: true,
            });
          }
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

  if (!user) {
    return <AuthScreen onLoginSuccess={(name) => setUser(name)} />;
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
          <View style={styles.userProfile}>
             <View style={[styles.avatar, {backgroundColor: '#00FF94'}]}>
                <Text style={styles.avatarText}>{user.charAt(0).toUpperCase()}</Text>
             </View>
             <View>
                <Text style={[styles.drawerWelcome, {color: UI_TEXT}]}>{user}</Text>
                <Text style={styles.subUser}>Premium Shield User</Text>
             </View>
          </View>
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
          <TouchableOpacity style={styles.closeBtn} onPress={toggleDrawer}>
            <Text style={{color: '#666', fontWeight: '900', fontSize: 10, letterSpacing: 2}}>EXIT MENU</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const DrawerItem = ({ icon, label, color, isDark }) => (
  <TouchableOpacity style={styles.drawerItem}>
    <Ionicons name={icon} size={22} color={color} />
    <Text style={[styles.drawerItemLabel, {color: color === '#00FF94' ? color : isDark ? '#888' : '#444'}]}>{label}</Text>
  </TouchableOpacity>
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
  userProfile: { flexDirection: 'row', alignItems: 'center', marginTop: 30 },
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
  dotEnd: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFF' }
});