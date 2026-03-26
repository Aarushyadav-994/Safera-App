import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';

export default function AuthScreen({ onLoginSuccess }) {
  const [userName, setUserName] = useState('');
  const [sosNumber, setSosNumber] = useState('');

  const handleInitialize = () => {
    if (userName.trim() && sosNumber.length >= 10) {
      onLoginSuccess(userName); 
    } else {
      alert("Please enter your name and an SOS contact.");
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.welcomeText}>Welcome to</Text>
          <Text style={styles.logo}>SAFERA<Text style={{color: '#00FF94'}}>.</Text></Text>
          <Text style={styles.tagline}>Your companion for safer journeys.</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>YOUR NAME</Text>
            <TextInput style={styles.input} placeholder="e.g. Jane Doe" placeholderTextColor="#555" value={userName} onChangeText={setUserName} />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>EMERGENCY CONTACT</Text>
            <TextInput style={styles.input} placeholder="Phone number for SOS" placeholderTextColor="#555" keyboardType="phone-pad" value={sosNumber} onChangeText={setSosNumber} maxLength={15} />
          </View>
          <TouchableOpacity style={styles.btn} onPress={handleInitialize} activeOpacity={0.8}>
            <Text style={styles.btnText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', padding: 30 },
  header: { marginBottom: 40 },
  welcomeText: { color: '#888', fontSize: 16, fontWeight: '500' },
  logo: { color: 'white', fontSize: 48, fontWeight: '900', letterSpacing: -1 },
  tagline: { color: '#555', fontSize: 14, marginTop: 10 },
  form: { width: '100%' },
  inputGroup: { marginBottom: 20 },
  label: { color: '#00FF94', fontSize: 10, fontWeight: 'bold', marginBottom: 12 },
  input: { backgroundColor: '#111', height: 60, borderRadius: 16, paddingHorizontal: 20, color: 'white', fontSize: 16, borderWidth: 1, borderColor: '#222' },
  btn: { backgroundColor: '#00FF94', height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  btnText: { color: '#000', fontWeight: 'bold', fontSize: 16 }
});