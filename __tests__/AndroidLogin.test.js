import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }) => children,
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen: ({ children }) => children(),
  }),
}));
jest.mock('../src/mobileApp/MobileApp', () => () => null);
jest.mock('../src/mobileApp/app/StaffWorkspace', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  setGenericPassword: jest.fn(async () => true),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
}));

import * as Keychain from 'react-native-keychain';
import AppNavigator from '../src/navigation/AppNavigator';
import StaffWorkspace from '../src/mobileApp/app/StaffWorkspace';
import { API_ROOT } from '../src/mobileApp/shared/services/apiConfig';
import {
  clearAccessToken,
  getAuthHeaders,
} from '../src/mobileApp/shared/services/authSession';

const originalFetch = global.fetch;
const reply = (status, data) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
let screen;

beforeEach(() => {
  clearAccessToken();
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  screen = undefined;
  clearAccessToken();
  global.fetch = originalFetch;
});

async function signIn() {
  await act(async () => {
    screen = ReactTestRenderer.create(<AppNavigator />);
  });
  const fields = screen.root.findAllByType(TextInput);
  await act(async () => {
    fields[0].props.onChangeText(' admin@fixture.invalid ');
    fields[1].props.onChangeText('fixture-only-password');
  });
  const submit = screen.root
    .findAllByProps({ disabled: false })
    .find(button => typeof button.props.onPress === 'function');
  expect(submit).toBeDefined();
  await act(async () => {
    await submit.props.onPress();
  });
}

test('Android Sign In uses ADB API root, stores the valid fixture session, and enters StaffWorkspace', async () => {
  const data = {
    token: 'fixture-session-token',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    user: {
      id: 'fixture-admin',
      role: 'super_admin',
      fullName: 'Fixture Admin',
    },
  };
  fetch.mockResolvedValue(reply(200, { success: true, data }));
  await signIn();
  // This diagnostic asserts the actual imported root and outgoing URL. No
  // production logging, credentials, tokens or headers are emitted.
  expect(API_ROOT).toBe('http://127.0.0.1:5000/api');
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(`${API_ROOT}/auth/login`);
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({
    email: 'admin@fixture.invalid',
    password: 'fixture-only-password',
  });
  expect(options.headers.Authorization).toBeUndefined();
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'school-session',
    JSON.stringify(data),
    expect.objectContaining({ service: 'com.schoolmanagementsystem.session' }),
  );
  expect(getAuthHeaders().Authorization).toBe(`Bearer ${data.token}`);
  expect(StaffWorkspace).toHaveBeenCalled();
  expect(StaffWorkspace.mock.calls.at(-1)[0].user).toEqual(data.user);
});

test.each([401, 403])(
  'HTTP %s login rejection stays an authentication error and never enters StaffWorkspace',
  async status => {
    fetch.mockResolvedValue(
      reply(status, { success: false, error: 'Invalid email or password.' }),
    );
    await signIn();
    expect(JSON.stringify(screen.toJSON())).toContain(
      'Invalid email or password.',
    );
    expect(JSON.stringify(screen.toJSON())).not.toContain('Could not reach');
    expect(StaffWorkspace).not.toHaveBeenCalled();
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(getAuthHeaders()).toEqual({});
  },
);
