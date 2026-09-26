import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import HomeScreen from '../src/screens/HomeScreen';
import LoginScreen from '../src/screens/LoginScreen';
import { useAuth } from '../src/auth/AuthContext';
import { useParentChild } from '../src/auth/ParentChildContext';
import { api } from '../src/api/client';
import { MODULES } from '../src/navigation/modules';
import { Button, Field } from '../src/components/UI';
jest.mock('../src/auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../src/auth/ParentChildContext', () => ({
  useParentChild: jest.fn(),
}));
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
  api.mockResolvedValue({ classes: 0, students: 0, items: [] });
  useParentChild.mockReturnValue({
    children: [],
    selectedChild: null,
    selectedChildId: '',
    loadingChildren: false,
    childrenError: '',
    selectChild: jest.fn(),
  });
});
test('teacher navigation exposes assigned work but excludes admin and fees', () => {
  const screens = MODULES.filter(module =>
    module.roles.includes('TEACHER'),
  ).map(module => module.screen);
  expect(screens).toContain('Lectures');
  expect(screens).toContain('Assignments');
  expect(screens).toContain('Attendance');
  expect(screens).not.toContain('Users');
  expect(screens).not.toContain('Invoices');
});
test('parent gets family features and never account administration', () => {
  const screens = MODULES.filter(module => module.roles.includes('PARENT')).map(
    module => module.screen,
  );
  expect(screens).toContain('Students');
  expect(screens).toContain('Invoices');
  expect(screens).toContain('Profile');
  expect(screens).not.toContain('Users');
  expect(screens).not.toContain('Audit');
});
test('teacher dashboard renders live role context, not a fabricated statistics card', async () => {
  useAuth.mockReturnValue({
    ...base,
    user: {
      _id: 'teacher',
      name: 'Taylor Teacher',
      role: 'TEACHER',
      classIds: [],
    },
  });
  let root;
  await act(async () => {
    root = TestRenderer.create(
      <HomeScreen navigation={{ navigate: jest.fn() }} />,
    );
  });
  const text = renderedText(root);
  expect(text).toContain('Taylor Teacher');
  expect(text).toContain('live information');
  expect(text).not.toContain('School settings');
  await act(() => root.unmount());
});
test('parent dashboard offers only linked-child selection and no admin management', async () => {
  useAuth.mockReturnValue({
    ...base,
    user: { _id: 'parent', name: 'Sam Parent', role: 'PARENT' },
  });
  useParentChild.mockReturnValue({
    children: [
      {
        _id: 'child-ava',
        name: 'Ava Student',
        classId: { name: 'Grade 5', section: 'A' },
      },
    ],
    selectedChild: { _id: 'child-ava', name: 'Ava Student' },
    selectedChildId: 'child-ava',
    loadingChildren: false,
    childrenError: '',
    selectChild: jest.fn(),
  });
  let root;
  await act(async () => {
    root = TestRenderer.create(
      <HomeScreen navigation={{ navigate: jest.fn() }} />,
    );
  });
  const text = renderedText(root);
  expect(text).toContain('Selected child');
  expect(text).toContain('Ava Student');
  expect(text).toContain('Live location is unavailable');
  expect(text).not.toContain('Users & permissions');
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
