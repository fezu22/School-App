import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';

let mockUnauthorizedHandler;
const mockApi = jest.fn();
const mockSetAccessToken = jest.fn();
const mockSetSelectedChildId = jest.fn();

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../src/api/client', () => ({
  api: (...args) => mockApi(...args),
  onUnauthorized: handler => {
    mockUnauthorizedHandler = handler;
    return jest.fn();
  },
  setAccessToken: (...args) => mockSetAccessToken(...args),
  setSelectedChildId: (...args) => mockSetSelectedChildId(...args),
}));

function SessionProbe() {
  const { user } = useAuth();
  return <Text>{user ? `Signed in: ${user.email}` : 'Login'}</Text>;
}

test('revoked session clears keychain and auth state so navigation returns to Login', async () => {
  jest.clearAllMocks();
  Keychain.getGenericPassword.mockResolvedValue({ password: 'stored-token' });
  Keychain.resetGenericPassword.mockResolvedValue(true);
  mockApi.mockImplementation(async path =>
    path === '/branding'
      ? { schoolName: 'Demo School' }
      : {
          user: {
            _id: 'parent-1',
            email: 'parent@example.com',
            role: 'PARENT',
          },
        },
  );

  let root;
  await act(async () => {
    root = TestRenderer.create(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );
  });
  expect(JSON.stringify(root.toJSON())).toContain(
    'Signed in: parent@example.com',
  );
  expect(mockSetAccessToken).toHaveBeenCalledWith('stored-token');

  await act(async () => {
    mockUnauthorizedHandler();
    await Promise.resolve();
  });
  expect(JSON.stringify(root.toJSON())).toContain('Login');
  expect(mockSetAccessToken).toHaveBeenLastCalledWith('');
  expect(mockSetSelectedChildId).toHaveBeenCalledWith('');
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
    service: 'school-platform-session',
  });
  await act(() => root.unmount());
});
