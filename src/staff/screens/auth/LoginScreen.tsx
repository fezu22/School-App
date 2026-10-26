import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/auth/authService';
import { colors, fonts, shadow } from '../../theme/hiraTheme';

const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const response = await authService.login(email.trim(), password);
      login(response.user, response.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.decorTop} />
        <View style={styles.decorCircle} />
        <View style={styles.content}>
          <View style={styles.brandRow}>
            <View style={styles.logo}><Text style={styles.logoText}>H</Text></View>
            <Text style={styles.brand}>Hira School</Text>
          </View>

          <View style={styles.welcome}>
            <Text style={styles.eyebrow}>ADMIN PORTAL</Text>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in to keep your school community thriving.
            </Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Let’s get started</Text>
            <Text style={styles.formCaption}>Use your administrator credentials.</Text>

            <Text style={styles.inputLabel}>Email address</Text>
            <View style={styles.inputWrap}>
              <Text style={styles.inputIcon}>@</Text>
              <TextInput
                style={styles.input}
                placeholder="you@school.edu"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!loading}
              />
            </View>

            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputWrap}>
              <Text style={styles.inputIcon}>•</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={colors.muted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                editable={!loading}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.button, loading && styles.disabled, pressed && styles.pressed]}
              onPress={handleLogin}
              disabled={loading}>
              {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Sign in to dashboard</Text>}
            </Pressable>
          </View>

          <Text style={styles.footer}>A calmer way to manage your school.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.cream },
  keyboardView: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 26, justifyContent: 'center' },
  decorTop: { position: 'absolute', top: -85, right: -70, width: 225, height: 225, borderRadius: 112, backgroundColor: colors.lime },
  decorCircle: { position: 'absolute', top: 73, right: 22, width: 45, height: 45, borderRadius: 23, backgroundColor: colors.softPurple },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 48 },
  logo: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: fonts.display, color: colors.lime, fontSize: 25 },
  brand: { fontFamily: fonts.heading, color: colors.ink, fontSize: 19, marginLeft: 11 },
  welcome: { marginBottom: 28 },
  eyebrow: { fontFamily: fonts.bodySemiBold, color: colors.primary, fontSize: 11, letterSpacing: 1.1, marginBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 32, letterSpacing: -1.1, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 8, maxWidth: 270 },
  formCard: { backgroundColor: colors.white, borderRadius: 24, padding: 22, ...shadow },
  formTitle: { fontFamily: fonts.heading, color: colors.ink, fontSize: 19 },
  formCaption: { fontFamily: fonts.body, color: colors.muted, fontSize: 13, marginTop: 4, marginBottom: 22 },
  inputLabel: { fontFamily: fonts.bodySemiBold, color: colors.ink, fontSize: 12, marginBottom: 8, marginTop: 15 },
  inputWrap: { height: 52, backgroundColor: colors.cream, borderRadius: 15, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  inputIcon: { fontFamily: fonts.bodySemiBold, color: colors.primary, fontSize: 17, width: 23, textAlign: 'center' },
  input: { flex: 1, color: colors.ink, fontFamily: fonts.body, fontSize: 14, paddingVertical: 0, marginLeft: 7 },
  error: { fontFamily: fonts.bodyMedium, color: colors.danger, fontSize: 12, marginTop: 14 },
  button: { marginTop: 22, minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: fonts.bodySemiBold, color: colors.white, fontSize: 14 },
  disabled: { opacity: .65 },
  pressed: { opacity: .84 },
  footer: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 25 },
});

export default LoginScreen;
