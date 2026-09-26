import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import {
  ParentChildProvider,
  useParentChild,
} from '../src/auth/ParentChildContext';
import { useAuth } from '../src/auth/AuthContext';
import {
  api,
  setChildSelectionRequired,
  setSelectedChildId,
} from '../src/api/client';

jest.mock('../src/auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../src/api/client', () => ({
  api: jest.fn(),
  onInvalidChildSelection: jest.fn(() => jest.fn()),
  setChildSelectionRequired: jest.fn(),
  setSelectedChildId: jest.fn(),
}));

let contextValue;
function Probe() {
  contextValue = useParentChild();
  return <Text>{contextValue.selectedChild?.name || 'No child selected'}</Text>;
}

test('parent context fetches only linked students, selects a child, and clears selection on account change', async () => {
  const linked = [
    {
      _id: 'ava-id',
      name: 'Ava Student',
      classId: { name: 'Grade 5', section: 'A' },
    },
    {
      _id: 'leo-id',
      name: 'Leo Reed',
      classId: { name: 'Grade 5', section: 'A' },
    },
  ];
  useAuth.mockReturnValue({ user: { _id: 'parent-one', role: 'PARENT' } });
  api.mockResolvedValueOnce({ items: linked });
  let root;
  await act(async () => {
    root = TestRenderer.create(
      <ParentChildProvider>
        <Probe />
      </ParentChildProvider>,
    );
  });
  expect(api).toHaveBeenCalledWith('/students', 'GET', undefined, {
    withoutSelectedChild: true,
  });
  expect(contextValue.children).toHaveLength(2);
  expect(contextValue.selectedChildId).toBe('ava-id');
  act(() => contextValue.selectChild('leo-id'));
  expect(contextValue.selectedChild.name).toBe('Leo Reed');
  expect(setSelectedChildId).toHaveBeenLastCalledWith('leo-id');

  useAuth.mockReturnValue({ user: { _id: 'parent-two', role: 'PARENT' } });
  api.mockResolvedValueOnce({ items: [{ _id: 'ivy-id', name: 'Ivy Brooks' }] });
  await act(async () => {
    root.update(
      <ParentChildProvider>
        <Probe />
      </ParentChildProvider>,
    );
  });
  expect(contextValue.selectedChildId).toBe('ivy-id');
  expect(contextValue.children.map(item => item.name)).toEqual(['Ivy Brooks']);
  expect(setChildSelectionRequired).toHaveBeenLastCalledWith(true);
  await act(() => root.unmount());
});
