import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const colors = {
  ink: '#14243A',
  muted: '#69788C',
  blue: '#246BFD',
  pale: '#F2F6FC',
  line: '#E3EAF3',
  red: '#B42318',
};

export default function LoginForm({ onSubmit, loading = false, error = '' }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const integrationMissing = typeof onSubmit !== 'function';

  function submit() {
    setValidationError('');
    if (!identifier.trim() || !password) {
      setValidationError('Enter your account ID and password.');
      return;
    }
    if (!integrationMissing && !loading) {
      onSubmit({ identifier: identifier.trim(), password });
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>S</Text>
        </View>
        <Text style={styles.eyebrow}>SCHOOL MANAGEMENT</Text>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Sign in with the account provided by your school.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Account ID or email</Text>
          <TextInput
            accessibilityLabel="Account ID or email"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            keyboardType="email-address"
            onChangeText={setIdentifier}
            placeholder="Enter your account ID or email"
            placeholderTextColor={colors.muted}
            returnKeyType="next"
            style={styles.input}
            value={identifier}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            editable={!loading}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Enter your password"
            placeholderTextColor={colors.muted}
            returnKeyType="go"
            secureTextEntry
            style={styles.input}
            value={password}
          />

          {integrationMissing ? (
            <Text accessibilityRole="alert" style={styles.integrationNotice}>
              Sign-in is unavailable until the partner authentication service is
              connected.
            </Text>
          ) : null}
          {validationError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {validationError}
            </Text>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={integrationMissing || loading}
            onPress={submit}
            style={[
              styles.button,
              (integrationMissing || loading) && styles.disabled,
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.footer}>
          Secure access for your school community
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.pale },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  brandMark: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.blue,
    borderRadius: 18,
    height: 58,
    justifyContent: 'center',
    marginBottom: 24,
    width: 58,
  },
  brandMarkText: { color: '#FFFFFF', fontSize: 30, fontWeight: '800' },
  eyebrow: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 9,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 25,
    marginTop: 8,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
  },
  label: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 7,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.line,
    borderRadius: 11,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  integrationNotice: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
  },
  error: { color: colors.red, fontSize: 12, lineHeight: 18, marginTop: 12 },
  button: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: 11,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 48,
  },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  footer: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 24,
    textAlign: 'center',
  },
});
