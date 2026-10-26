import { apiClient } from '../api/apiClient';

export type TeacherHomeAction =
  | { type: 'attendance'; count: number; routeTarget: 'TeacherAttendanceQueue' }
  | { type: 'work'; count: number; routeTarget: 'Tasks' }
  | { type: 'notice'; title: string; noticeId: string; routeTarget: 'Inbox' };
export interface TeacherHome {
  teacher: { id: string; fullName: string };
  schoolDate: string;
  timezone: string;
  hero: {
    state: 'current' | 'next' | 'finished' | 'no_periods';
    greeting: string;
    periodCount: number;
    currentOrNextPeriod: {
      periodId: string;
      date: string;
      startTime: string;
      endTime: string;
      className: string;
      sectionName: string;
      subjectName: string;
      room: string;
      isSubstitute: boolean;
    } | null;
  };
  primaryAction: TeacherHomeAction | null;
}
export const homeService = {
  async getHome(token: string) {
    const response = await apiClient.request<{
      success: boolean;
      data: TeacherHome;
    }>('/teacher/home', { token });
    if (!response.success || !response.data?.teacher || !response.data.hero)
      throw new Error('Teacher Home could not be confirmed. Please retry.');
    return response.data;
  },
};
