import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import PrincipalHome from '../src/roles/principal/PrincipalHome';
import { useAuth } from '../src/auth/AuthContext';
import { getPrincipalDashboard } from '../src/api/principal';

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {
    useFocusEffect: callback =>
      ReactRuntime.useEffect(() => {
        callback();
      }, [callback]),
  };
});
jest.mock('../src/auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../src/api/principal', () => ({ getPrincipalDashboard: jest.fn() }));

const navigation = { navigate: jest.fn() };
const user = {
  name: 'Casey Principal',
  role: 'PRINCIPAL',
};
const data = {
  summary: {
    students: 82,
    classes: 6,
    teachers: 9,
    attendance: { present: 74, absent: 5, late: 2, excused: 1 },
  },
  branches: [{ name: 'North Campus' }],
  recentNotices: [{ _id: 'notice-1', title: 'Term begins', body: 'Welcome back', createdAt: '2026-09-01' }],
};
const renderedText = renderer =>
  renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user, schoolName: 'School Platform', signOut: jest.fn() });
});

test('principal dashboard renders assigned school summary and notices', async () => {
  getPrincipalDashboard.mockResolvedValue(data);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<PrincipalHome navigation={navigation} />);
    await Promise.resolve();
  });
  const output = renderedText(renderer);
  expect(output).toMatch(/Good day,\s+Casey Principal/);
  expect(output).toContain('North Campus');
  expect(output).toContain('82');
  expect(output).toContain('Teachers');
  expect(output).toContain('Term begins');
});

test('principal dashboard presents access denied for a 403 response', async () => {
  getPrincipalDashboard.mockRejectedValue(Object.assign(new Error('Access denied'), { status: 403 }));
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<PrincipalHome navigation={navigation} />);
    await Promise.resolve();
  });
  expect(renderedText(renderer)).toContain('You do not have access to this school dashboard.');
});