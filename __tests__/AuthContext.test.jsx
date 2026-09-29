import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, Button } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/api/client', () => ({
  api: jest.fn().mockResolvedValue({ schoolName: 'Test School' }),
  setAccessToken: jest.fn(),
}));

function Probe() {
  const { user, loading, devSignIn, signOut } = useAuth();
  if (loading) return <Text>Loading</Text>;
  if (!user) {
    return (
      <>
        <Text>Login</Text>
        <Button title="AsStudent" onPress={() => devSignIn('STUDENT')} />
      </>
    );
  }
  return (
    <>
      <Text>
        Signed in: {user.name} ({user.role})
      </Text>
      <Button title="SignOut" onPress={signOut} />
    </>
  );
}

test('devSignIn sets user and signOut clears it', async () => {
  let root;
  await act(async () => {
    root = TestRenderer.create(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });
  await act(async () => {
    await new Promise(r => setTimeout(r, 80));
  });
  expect(JSON.stringify(root.toJSON())).toContain('Login');

  const asStudent = root.root.findByProps({ title: 'AsStudent' });
  await act(async () => {
    asStudent.props.onPress();
  });
  expect(JSON.stringify(root.toJSON())).toContain('Signed in:');
  expect(JSON.stringify(root.toJSON())).toContain('STUDENT');

  const signOutBtn = root.root.findByProps({ title: 'SignOut' });
  await act(async () => {
    signOutBtn.props.onPress();
  });
  expect(JSON.stringify(root.toJSON())).toContain('Login');
});
