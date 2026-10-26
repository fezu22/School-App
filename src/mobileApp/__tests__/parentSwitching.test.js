import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ParentDashboard from '../roles/parent/ParentDashboard';
import { parentApi } from '../roles/parent/parentService';

jest.mock('../roles/parent/parentService', () => ({
  parentApi: {
    getChildren: jest.fn(),
    getChild: jest.fn(),
    getAttendance: jest.fn(),
    getNotifications: jest.fn(),
    getFeeCheckoutConfig: jest.fn(),
  },
}));

function deferred() {
  let resolve;
  const promise = new Promise(next => {
    resolve = next;
  });
  return { promise, resolve };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const visibleText = renderer =>
  renderer.root
    .findAll(node => node.children.some(child => typeof child === 'string'))
    .flatMap(node => node.children.filter(child => typeof child === 'string'))
    .join(' ');

describe('Parent child switching', () => {
  test('clears the old child immediately and ignores a late stale response', async () => {
    const aLateProfile = deferred();
    const aLateAttendance = deferred();
    let aProfileCalls = 0;
    let aAttendanceCalls = 0;

    parentApi.getChildren.mockResolvedValue([
      { id: '002', fullName: 'Child A' },
      { id: '003', fullName: 'Child B' },
    ]);
    parentApi.getNotifications.mockResolvedValue({
      notifications: [],
      unreadCount: 0,
    });
    parentApi.getFeeCheckoutConfig.mockResolvedValue({
      enabled: false,
      methods: [],
    });
    parentApi.getChild.mockImplementation(id => {
      if (id === '003')
        return Promise.resolve({ id: '003', fullName: 'Child B' });
      aProfileCalls += 1;
      return aProfileCalls === 1
        ? Promise.resolve({ id: '002', fullName: 'Child A' })
        : aLateProfile.promise;
    });
    parentApi.getAttendance.mockImplementation(id => {
      if (id === '003')
        return Promise.resolve([
          { id: 'b-record', date: '2026-10-02', status: 'B attendance' },
        ]);
      aAttendanceCalls += 1;
      return aAttendanceCalls === 1
        ? Promise.resolve([
            { id: 'a-record', date: '2026-10-01', status: 'A attendance' },
          ])
        : aLateAttendance.promise;
    });

    let renderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<ParentDashboard page="Attendance" />);
      await flush();
    });

    expect(visibleText(renderer)).toContain('A attendance');

    act(() => {
      renderer.root
        .findByProps({ testID: 'parent-refresh-selected-child' })
        .props.onPress();
    });
    expect(visibleText(renderer)).not.toContain('A attendance');

    act(() => {
      renderer.root.findByProps({ testID: 'parent-child-003' }).props.onPress();
    });
    await act(async () => {
      await flush();
    });
    expect(visibleText(renderer)).not.toContain('A attendance');

    expect(visibleText(renderer)).toContain('B attendance');

    await act(async () => {
      aLateProfile.resolve({ id: '002', fullName: 'Child A stale' });
      aLateAttendance.resolve([
        { id: 'a-late', date: '2026-10-03', status: 'A late attendance' },
      ]);
      await flush();
    });
    expect(visibleText(renderer)).not.toContain('A attendance');
    expect(visibleText(renderer)).toContain('B attendance');

    act(() => renderer.unmount());
  });
});
