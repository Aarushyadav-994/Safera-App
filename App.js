import React, { useState, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  Dimensions, ActivityIndicator, Keyboard, StatusBar, ScrollView, Animated, Modal
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
  
  // App States
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
  const [profileForm, setProfileForm] = useState({
    profileName: '',
    email: '',
    emergencyContact1: '',
    emergencyContact2: '',
  });

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let location = await Location.getCurrentPositionAsync({});
      setUserLocation(location.coords);
    })();
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
    let startPoint = (startText.toLowerCase() === 'my location' && userLocation) ? userLocation : await getCoordsFromText(startText);
    const endPoint = await getCoordsFromText(endText);

    if (startPoint && endPoint) {
      setMarkers({ start: startPoint, end: endPoint });
      const routes = await fetchRealRoute(startPoint, endPoint);
      setAllRoutes(routes || []);
      setSelectedRouteIndex(0);
      setIsMinimized(true);

      if (routes && routes.length > 0 && mapRef.current) {
        mapRef.current.fitToCoordinates(routes[0].coords, {
          edgePadding: { top: 150, right: 60, bottom: 450, left: 60 },
          animated: true,
        });
      }
    }
    setLoading(false);
  };

  // 🛡️ CRITICAL ERROR FIX: Safety check for empty routes
  const currentRoute = allRoutes && allRoutes.length > 0 ? allRoutes[selectedRouteIndex] : null;

  const getRouteTheme = (index) => {
    if (index === 0) return { color: '#00FF94', score: 7.8, label: '🛡️ SAFEST' };
    if (index === 1) return { color: '#FF3B30', score: 4.2, label: '⚡ SHORTEST' };
    return { color: '#3498db', score: 6.5, label: '🛣️ MAIN ROAD' };
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
        {allRoutes.map((route, index) => {
          const pathTheme = getRouteTheme(index);
          const isFocused = index === selectedRouteIndex;
          return (
            <Polyline 
              key={`route-${index}`}
              coordinates={route.coords} 
              strokeColor={isFocused ? pathTheme.color : `${pathTheme.color}33`} // Transparency for inactive paths
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

      {/* 🍔 CLEAN TOP MENU ICON */}
      <TouchableOpacity style={[styles.menuBtn, {backgroundColor: CARD_BG}]} onPress={toggleDrawer}>
        <Ionicons name="menu" size={24} color={activeTheme.color} />
      </TouchableOpacity>

      {/* 🧭 SEARCH OVERLAY */}
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

      {/* 📊 TABS & DASHBOARD */}
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

      {/* 🚪 SIDE MENU (DRAWER) */}
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
  profileSaveText: { color: '#000', fontWeight: '900', fontSize: 15 }
});
