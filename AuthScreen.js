import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
} from 'react-native';
import { loginUser, registerUser } from './userDatabase';

export default function AuthScreen({ onLoginSuccess }) {
  const [mode, setMode] = useState('login');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [username, setUsername] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [profileName, setProfileName] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyContact1, setEmergencyContact1] = useState('');
  const [emergencyContact2, setEmergencyContact2] = useState('');
  const [loading, setLoading] = useState(false);

  const resetSignupFields = () => {
    setUsername('');
    setMobile('');
    setPassword('');
    setProfileName('');
    setEmail('');
    setEmergencyContact1('');
    setEmergencyContact2('');
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setLoading(false);
  };

  const handleLogin = async () => {
    if (!loginIdentifier.trim() || !loginPassword.trim()) {
      alert('Enter your username or mobile number and password.');
      return;
    }

    try {
      setLoading(true);
      const user = await loginUser({ identifier: loginIdentifier, password: loginPassword });
      onLoginSuccess(user);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    if (!username.trim()) {
      alert('Username is required.');
      return;
    }

    if (!/^\d{10}$/.test(mobile.trim())) {
      alert('Enter a valid 10-digit mobile number.');
      return;
    }

    if (password.trim().length < 4) {
      alert('Password must be at least 4 characters long.');
      return;
    }

    if (!profileName.trim()) {
      alert('Full name is required.');
      return;
    }

    if (!/^\d{10}$/.test(emergencyContact1.trim())) {
      alert('Emergency Contact 1 is required and must be a valid 10-digit number.');
      return;
    }

    if (emergencyContact2.trim() && !/^\d{10}$/.test(emergencyContact2.trim())) {
      alert('Emergency Contact 2 must be a valid 10-digit number.');
      return;
    }

    try {
      setLoading(true);
      const user = await registerUser({
        username,
        mobile,
        password,
        profileName,
        email,
        emergencyContact1,
        emergencyContact2,
      });
      resetSignupFields();
      onLoginSuccess(user);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.welcomeText}>Welcome to</Text>
            <Text style={styles.logo}>SAFERA<Text style={{ color: '#00FF94' }}>.</Text></Text>
            <Text style={styles.tagline}>Your companion for safer journeys.</Text>
          </View>

          <View style={styles.switchRow}>
            <TouchableOpacity
              style={[styles.switchBtn, mode === 'login' && styles.switchBtnActive]}
              onPress={() => switchMode('login')}
            >
              <Text style={[styles.switchText, mode === 'login' && styles.switchTextActive]}>Login</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.switchBtn, mode === 'signup' && styles.switchBtnActive]}
              onPress={() => switchMode('signup')}
            >
              <Text style={[styles.switchText, mode === 'signup' && styles.switchTextActive]}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            {mode === 'login' ? (
              <>
                <Text style={styles.label}>USERNAME OR MOBILE</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter username or mobile number"
                  placeholderTextColor="#555"
                  value={loginIdentifier}
                  onChangeText={setLoginIdentifier}
                  autoCapitalize="none"
                />

                <Text style={styles.label}>PASSWORD</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor="#555"
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  secureTextEntry
                />

                <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
                  <Text style={styles.btnText}>{loading ? 'Checking...' : 'Login'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>USERNAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Create a username"
                  placeholderTextColor="#555"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />

                <Text style={styles.label}>MOBILE NUMBER</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter 10-digit mobile number"
                  placeholderTextColor="#555"
                  keyboardType="phone-pad"
                  value={mobile}
                  onChangeText={setMobile}
                  maxLength={10}
                />

                <Text style={styles.label}>PASSWORD</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Create a password"
                  placeholderTextColor="#555"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />

                <Text style={styles.optionalTitle}>PROFILE SETUP (REQUIRED)</Text>

                <Text style={styles.label}>FULL NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Your full name"
                  placeholderTextColor="#555"
                  value={profileName}
                  onChangeText={setProfileName}
                />

                <Text style={styles.label}>EMAIL (OPTIONAL)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Your email address"
                  placeholderTextColor="#555"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <Text style={styles.label}>EMERGENCY CONTACT 1</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Required emergency number"
                  placeholderTextColor="#555"
                  value={emergencyContact1}
                  onChangeText={setEmergencyContact1}
                  keyboardType="phone-pad"
                  maxLength={10}
                />

                <Text style={styles.label}>EMERGENCY CONTACT 2</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Optional backup emergency number"
                  placeholderTextColor="#555"
                  value={emergencyContact2}
                  onChangeText={setEmergencyContact2}
                  keyboardType="phone-pad"
                  maxLength={10}
                />

                <TouchableOpacity style={styles.btn} onPress={handleSignup} disabled={loading}>
                  <Text style={styles.btnText}>{loading ? 'Creating...' : 'Create Account'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 30 },
  header: { marginBottom: 30 },
  welcomeText: { color: '#888', fontSize: 16, fontWeight: '500' },
  logo: { color: 'white', fontSize: 48, fontWeight: '900', letterSpacing: -1 },
  tagline: { color: '#555', fontSize: 14, marginTop: 10 },
  switchRow: { flexDirection: 'row', backgroundColor: '#0D0D0D', borderRadius: 16, padding: 6, marginBottom: 24 },
  switchBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  switchBtnActive: { backgroundColor: '#00FF94' },
  switchText: { color: '#777', fontSize: 15, fontWeight: '700' },
  switchTextActive: { color: '#000' },
  form: { width: '100%' },
  label: { color: '#00FF94', fontSize: 10, fontWeight: 'bold', marginBottom: 12 },
  optionalTitle: { color: '#888', fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 16 },
  input: {
    backgroundColor: '#111',
    height: 60,
    borderRadius: 16,
    paddingHorizontal: 20,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 16,
  },
  btn: { backgroundColor: '#00FF94', height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  btnText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
});
