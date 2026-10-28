import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

jest.mock('@react-navigation/native', () => ({useNavigation: () => ({navigate: jest.fn()})}));
jest.mock('../src/staff/context/AuthContext', () => ({useAuth: () => ({
  user: {id: 'admin-fixture', fullName: 'School Administrator', role: 'super_admin'},
  accessToken: 'fixture-token',
})}));
jest.mock('../src/staff/services/admin/adminService', () => ({adminService: {
  getDashboard: jest.fn(), getSystemHealth: jest.fn(), getBackupStatus: jest.fn(),
  getUsageStatus: jest.fn(), getPendingPrivilegedRequests: jest.fn(),
  getAutomations: jest.fn(), getSessions: jest.fn(),
}}));

import SuperAdminDashboardScreen from '../src/staff/screens/superAdmin/SuperAdminDashboardScreen';
import {adminService} from '../src/staff/services/admin/adminService';

beforeEach(() => {
  jest.resetAllMocks();
  (adminService.getDashboard as jest.Mock).mockResolvedValue({data: {branches: {
    total: 1, active: 1, inactive: 0,
    list: [{_id: 'branch-fixture', name: 'Actual School Campus', code: 'MAIN', isActive: true}],
  }}});
  (adminService.getSystemHealth as jest.Mock).mockResolvedValue({data: {
    api: {status: 'healthy', message: 'API is running'},
    database: {status: 'healthy', message: 'Connected'}, overall: 'healthy',
  }});
  (adminService.getBackupStatus as jest.Mock).mockResolvedValue({data: {status: 'not_configured'}});
  (adminService.getUsageStatus as jest.Mock).mockResolvedValue({data: {
    branches: {used: 1, limit: null, status: 'not_configured'},
    users: {used: 1, limit: null, status: 'not_configured'},
  }});
  (adminService.getPendingPrivilegedRequests as jest.Mock).mockResolvedValue({data: {requests: []}});
  (adminService.getAutomations as jest.Mock).mockResolvedValue({data: {automations: []}});
  (adminService.getSessions as jest.Mock).mockResolvedValue({data: {sessions: []}});
});

test('loads real branch data even when optional administration services are unavailable', async () => {
  (adminService.getSessions as jest.Mock).mockRejectedValue(new Error('Session service unavailable'));
  (adminService.getPendingPrivilegedRequests as jest.Mock).mockRejectedValue(new Error('Requests unavailable'));
  (adminService.getAutomations as jest.Mock).mockRejectedValue(new Error('Automation unavailable'));
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {screen = ReactTestRenderer.create(<SuperAdminDashboardScreen />);});
  expect(JSON.stringify(screen.toJSON())).toContain('Actual School Campus');
  expect(adminService.getDashboard).toHaveBeenCalledWith('fixture-token');
  await act(async () => {
    screen.root.findByProps({accessibilityLabel: 'Administration'}).props.onPress();
  });
  const content = JSON.stringify(screen.toJSON());
  expect(content).toContain('Session service unavailable');
  expect(content).toContain('Requests unavailable');
  expect(content).not.toContain('No active sessions');
  expect(content).not.toContain('No pending privileged requests');
  await act(async () => {screen.unmount();});
});

test('a dashboard failure still shows an error and retry rather than invented branch data', async () => {
  (adminService.getDashboard as jest.Mock).mockRejectedValue(new Error('School mapping unavailable'));
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {screen = ReactTestRenderer.create(<SuperAdminDashboardScreen />);});
  const content = JSON.stringify(screen.toJSON());
  expect(content).toContain('School mapping unavailable');
  expect(content).toContain('Retry');
  expect(content).not.toContain('Actual School Campus');
  await act(async () => {screen.unmount();});
});
