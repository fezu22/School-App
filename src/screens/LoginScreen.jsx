import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import {
  Page,
  Card,
  Title,
  Muted,
  Field,
  Button,
  ErrorText,
} from '../components/UI';
export default function LoginScreen() {
  const { signIn, schoolName } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login() {
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Page>
        <Text
          style={{
            color: '#245ADD',
            fontSize: 16,
            fontWeight: '800',
            marginVertical: 45,
          }}
        >
          {schoolName.toUpperCase()}
        </Text>
        <Title>Your school, connected.</Title>
        <Muted>Sign in with the account assigned by your school.</Muted>
        <Card>
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            password
          />
          <ErrorText message={error} />
          <Button title="Sign in" onPress={login} busy={busy} />
        </Card>
        <Muted>Need an account? Contact your school administrator.</Muted>
      </Page>
    </KeyboardAvoidingView>
  );
}
