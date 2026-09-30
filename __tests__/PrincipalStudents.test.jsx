import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import StudentsScreen from '../src/roles/principal/StudentsScreen';
import { useAuth } from '../src/auth/AuthContext';
import { getPrincipalStudents } from '../src/api/principal';

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
jest.mock('../src/api/principal', () => ({ getPrincipalStudents: jest.fn() }));

const signOut = jest.fn();
const branches = [{ _id: 'north-branch', name: 'North Demo Campus' }];
const student = {
  _id: 'student-1',
  name: 'Ava Student',
  admissionNumber: 'DEMO-001',
  classId: { name: 'Grade 5', section: 'A' },
  branchId: 'north-branch',
  active: true,
};
const renderedText = renderer =>
  renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ signOut, isDevMode: false });
});

test('shows loading before scoped students are returned', async () => {
  let resolveStudents;
  getPrincipalStudents.mockReturnValue(
    new Promise(resolve => {
      resolveStudents = resolve;
    }),
  );
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<StudentsScreen />);
  });
  expect(renderer.root.findAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
  await act(async () => {
    resolveStudents({ items: [student], branches });
  });
});

test('renders student class, branch, and active status', async () => {
  getPrincipalStudents.mockResolvedValue({ items: [student], branches });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<StudentsScreen />);
  });
  const output = renderedText(renderer);
  expect(output).toContain('Ava Student');
  expect(output).toContain('Grade 5 A');
  expect(output).toContain('North Demo Campus');
  expect(output).toContain('Status: Active');
});

test('shows an empty state for a successful empty response', async () => {
  getPrincipalStudents.mockResolvedValue({ items: [], branches });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<StudentsScreen />);
  });
  expect(renderedText(renderer)).toContain('No students are assigned to your branches.');
});

test('shows a specific access denied message for 403', async () => {
  getPrincipalStudents.mockRejectedValue(Object.assign(new Error('Access denied'), { status: 403 }));
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<StudentsScreen />);
  });
  expect(renderedText(renderer)).toContain('You do not have access to the student directory.');
});

test('signs out after an expired session response', async () => {
  getPrincipalStudents.mockRejectedValue(Object.assign(new Error('Please sign in again'), { status: 401 }));
  await act(async () => {
    TestRenderer.create(<StudentsScreen />);
  });
  expect(signOut).toHaveBeenCalledTimes(1);
});

test('offers retry after a network failure and reloads the directory', async () => {
  getPrincipalStudents
    .mockRejectedValueOnce(new Error('Network request failed'))
    .mockResolvedValueOnce({ items: [student], branches });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<StudentsScreen />);
  });
  expect(renderedText(renderer)).toContain('Network request failed');
  const retry = renderer.root.findByProps({ title: 'Retry' });
  await act(async () => {
    await retry.props.onPress();
  });
  expect(renderedText(renderer)).toContain('Ava Student');
});

test('offers retry after a server error', async () => {
  getPrincipalStudents
    .mockRejectedValueOnce(Object.assign(new Error('Server error'), { status: 503 }))
    .mockResolvedValueOnce({ items: [student], branches });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<StudentsScreen />);
  });
  expect(renderedText(renderer)).toContain('The student directory could not be loaded. Please try again.');
  await act(async () => {
    await renderer.root.findByProps({ title: 'Retry' }).props.onPress();
  });
  expect(renderedText(renderer)).toContain('Ava Student');
});

test('does not request or show live students in Preview mode', async () => {
  useAuth.mockReturnValue({ signOut, isDevMode: true });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<StudentsScreen />);
  });
  expect(getPrincipalStudents).not.toHaveBeenCalled();
  expect(renderedText(renderer)).toContain('Preview mode has no API session.');
});