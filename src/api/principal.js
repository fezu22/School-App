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

export async function getPrincipalStudents() {
  const students = await api('/staff/students');
  let branches = [];
  try {
    branches = (await api('/staff/branches')).items || [];
  } catch (cause) {
    if (cause.status === 401 || cause.status === 403) throw cause;
  }
  return { items: students.items || [], branches };
}