import { apiClient } from '../api/apiClient';
export interface TeacherPeriod {
  periodId: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  approvedVersion: {
    versionId: string;
    versionNumber: number;
    effectiveFrom: string;
    effectiveUntil: string;
  };
  isSubstitute: boolean;
  substituteId: string | null;
  substituteStatus: 'needs_acknowledgement' | 'acknowledged' | null;
  acknowledgedAt: string | null;
  issueStatus: 'open' | null;
  canAcknowledgeSubstitute: boolean;
  canRequestIssue: boolean;
}
export interface TeacherTimetable {
  timezone: string;
  today: string;
  start: string;
  end: string;
  periods: TeacherPeriod[];
}
interface Envelope<T> {
  success: boolean;
  data: T;
}
const periodPath = (id: string) =>
  `/teacher/timetable/periods/${encodeURIComponent(id)}`;
export const timetableService = {
  async getToday(token: string, date?: string): Promise<TeacherTimetable> {
    return (
      await apiClient.request<Envelope<TeacherTimetable>>(
        `/teacher/timetable${date ? '?date=' + encodeURIComponent(date) : ''}`,
        { token },
      )
    ).data;
  },
  async getWeek(token: string, start?: string): Promise<TeacherTimetable> {
    return (
      await apiClient.request<Envelope<TeacherTimetable>>(
        `/teacher/timetable/week${
          start ? '?start=' + encodeURIComponent(start) : ''
        }`,
        { token },
      )
    ).data;
  },
  async getPeriod(
    token: string,
    id: string,
    date: string,
  ): Promise<TeacherPeriod> {
    return (
      await apiClient.request<Envelope<TeacherPeriod>>(
        `${periodPath(id)}?date=${encodeURIComponent(date)}`,
        { token },
      )
    ).data;
  },
  async acknowledge(
    token: string,
    id: string,
    date: string,
  ): Promise<TeacherPeriod> {
    return (
      await apiClient.request<Envelope<TeacherPeriod>>(
        `${periodPath(id)}/acknowledge`,
        { token, method: 'POST', body: { date } },
      )
    ).data;
  },
  async requestIssue(
    token: string,
    id: string,
    date: string,
    reason: string,
    clientOperationId: string,
  ): Promise<TeacherPeriod> {
    return (
      await apiClient.request<Envelope<TeacherPeriod>>(
        `${periodPath(id)}/issues`,
        {
          token,
          method: 'POST',
          body: { date, reason: reason.trim(), clientOperationId },
        },
      )
    ).data;
  },
};
