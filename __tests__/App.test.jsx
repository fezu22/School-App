import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import HomeScreen from '../src/screens/HomeScreen';
import LoginScreen from '../src/screens/LoginScreen';
import { useAuth } from '../src/auth/AuthContext';
import { api } from '../src/api/client';
import { Button, Field } from '../src/components/UI';
jest.mock('../src/auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../src/api/client', () => ({ api: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
const base = {
  schoolName: 'School Platform',
  signOut: jest.fn(),
  signIn: jest.fn(),
};
const renderedText = root => JSON.stringify(root.toJSON());
beforeEach(() => {
  jest.clearAllMocks();
  api.mockResolvedValue({ classes: 0, students: 0 });
});
test('teacher work navigation excludes admin and finance', async () => {
  useAuth.mockReturnValue({ ...base, user: { name: '', role: 'TEACHER' } });
  let root;
  await act(async () => {
    root = TestRenderer.create(
      <HomeScreen navigation={{ navigate: jest.fn() }} />,
    );
  });
  const text = renderedText(root);
  expect(text).toContain('AI learning');
  expect(text).toContain('Attendance');
  expect(text).not.toContain('School settings');
  expect(text).not.toContain('Fees & receipts');
  expect(text).not.toContain('Users');
  await act(() => root.unmount());
});
test('parent sees child area without account administration', async () => {
  useAuth.mockReturnValue({ ...base, user: { name: '', role: 'PARENT' } });
  let root;
  await act(async () => {
    root = TestRenderer.create(
      <HomeScreen navigation={{ navigate: jest.fn() }} />,
    );
  });
  const text = renderedText(root);
  expect(text).toContain('Students');
  expect(text).toContain('Fees & receipts');
  expect(text).not.toContain('Users');
  expect(text).not.toContain('Audit trail');
  await act(() => root.unmount());
});
test('login normalizes email and displays server error', async () => {
  const signIn = jest
    .fn()
    .mockRejectedValue(Error('Invalid email or password'));
  useAuth.mockReturnValue({ ...base, signIn });
  let root;
  await act(async () => {
    root = TestRenderer.create(<LoginScreen />);
  });
  await act(async () => {
    root.root.findAllByType(Field)[0].props.onChangeText(' USER@SCHOOL.COM ');
    root.root.findAllByType(Field)[1].props.onChangeText('secret');
  });
  await act(async () => {
    await root.root.findByType(Button).props.onPress();
  });
  expect(signIn).toHaveBeenCalledWith('user@school.com', 'secret');
  expect(renderedText(root)).toContain('Invalid email or password');
  await act(() => root.unmount());
});
