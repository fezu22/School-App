import { api } from './client';

export async function getPrincipalDashboard() {
  const [dashboard, branches] = await Promise.all([
    api('/staff/dashboard'),
    api('/staff/branches'),
  ]);
  return {
    ...dashboard,
    branches: branches.items || [],
  };
}

export const getPrincipalTeachers = () => api('/staff/teachers');