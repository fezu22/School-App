import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { Page, Card, Title, Muted, Field, Button, ErrorText } from '../components/UI';

const ROLES = [
  { key: 'STUDENT', label: 'Student', desc: 'View classes, attendance, assignments' },
  { key: 'PARENT', label: 'Parent', desc: 'Children progress, fees, notices' },
  { key: 'TEACHER', label: 'Teacher', desc: 'Classes, attendance, assignments' },
  { key: 'PRINCIPAL', label: 'Principal', desc: 'School academics & operations' },
  { key: 'SUPER_ADMIN', label: 'Super Admin', desc: 'Full control, users, settings' },
  { key: 'ACCOUNTANT', label: 'Accountant', desc: 'Fees, invoices, students' },
];

export default function LoginScreen() {
  const { signIn, devSignIn, schoolName } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (cause) {
      setError(
        cause.status === 401
          ? 'Email or password is incorrect.'
          : cause.status >= 500
            ? 'The server could not sign you in. Please try again.'
            : cause.message || 'Could not connect. Check your connection and retry.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <Text
        style={{
          color: '#245ADD',
          fontSize: 16,
          fontWeight: '800',
          marginVertical: 24,
        }}
      >
        {(schoolName || 'School Platform').toUpperCase()}
      </Text>
      <Title>Sign in</Title>
      <Muted>Use your school account to load branch-scoped records.</Muted>
      <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} password />
      <ErrorText message={error} />
      <Button title="Sign in" onPress={submit} busy={busy} />

      <Title>Choose a role</Title>
      <Muted>Preview accounts do not have a backend session or access to school data.</Muted>

      <View style={{ marginTop: 16 }}>
        {ROLES.map(r => (
          <View key={r.key} style={{ marginBottom: 10 }}>
            <Card onPress={() => devSignIn(r.key)}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#162A43' }}>
                {r.label}
              </Text>
              <Muted>{r.desc}</Muted>
            </Card>
          </View>
        ))}
      </View>
    </Page>
  );
}
