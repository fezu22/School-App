import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import LoginScreen from '../src/screens/LoginScreen';
import { useAuth } from '../src/auth/AuthContext';
import { Card } from '../src/components/UI';

jest.mock('../src/auth/AuthContext', () => ({ useAuth: jest.fn() }));

const base = {
  schoolName: 'School Platform',
  signOut: jest.fn(),
  signIn: jest.fn(),
  devSignIn: jest.fn(),
};

const renderedText = root => JSON.stringify(root.toJSON());

beforeEach(() => {
  jest.clearAllMocks();
});

test('login screen shows role picker options', async () => {
  useAuth.mockReturnValue({ ...base });
  let root;
  await act(async () => {
    root = TestRenderer.create(<LoginScreen />);
  });
  const text = renderedText(root);
  expect(text).toContain('Choose a role');
  expect(text).toContain('Student');
  expect(text).toContain('Teacher');
  expect(text).toContain('Principal');
  expect(text).toContain('Super Admin');
  expect(text).toContain('Parent');
  expect(text).toContain('Accountant');
});

test('tapping a role calls devSignIn', async () => {
  useAuth.mockReturnValue({ ...base });
  let root;
  await act(async () => {
    root = TestRenderer.create(<LoginScreen />);
  });
  const cards = root.root.findAllByType(Card);
  expect(cards.length).toBeGreaterThanOrEqual(6);
  await act(async () => {
    cards[0].props.onPress();
  });
  expect(base.devSignIn).toHaveBeenCalled();
});
