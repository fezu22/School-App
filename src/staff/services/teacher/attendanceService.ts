import { apiClient } from '../api/apiClient';
import type { TeacherPeriod } from './timetableService';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';
export type AttendanceState = 'open' | 'draft' | 'submitted';
export interface AttendanceMark {
  studentId: string;
  status: AttendanceStatus | null;
}
export interface AttendanceDetail {
  sessionId: string;
  period: TeacherPeriod;
  state: AttendanceState;
  revision: number;
  rosterVersion: string;
  rosterChanged: boolean;
  submittedAt: string | null;
  canSave: boolean;
  students: (AttendanceMark & { fullName: string; admissionNumber: string })[];
}
export interface AttendanceQueue {
  date: string;
  timezone: string;
  total: number;
  sessions: {
    period: TeacherPeriod;
    sessionId: string | null;
    state: AttendanceState;
    revision: number;
  }[];
}
export interface AttendanceWrite {
  revision: number;
  rosterVersion: string;
  clientOperationId: string;
  marks: AttendanceMark[];
}
export interface AttendanceResult {
  sessionId: string;
  revision: number;
  state: AttendanceState;
  replayed: boolean;
}
interface Envelope<T> {
  success: boolean;
  data: T;
}
export const attendanceService = {
  async getPending(token: string, date?: string): Promise<AttendanceQueue> {
    return (
      await apiClient.request<Envelope<AttendanceQueue>>(
        `/teacher/attendance/pending${
          date ? '?date=' + encodeURIComponent(date) : ''
        }`,
        { token },
      )
    ).data;
  },
  async open(
    token: string,
    periodId: string,
    date: string,
  ): Promise<AttendanceDetail> {
    return (
      await apiClient.request<Envelope<AttendanceDetail>>(
        `/teacher/attendance/occurrences/${encodeURIComponent(
          periodId,
        )}?date=${encodeURIComponent(date)}`,
        { token },
      )
    ).data;
  },
  async getSession(
    token: string,
    sessionId: string,
  ): Promise<AttendanceDetail> {
    return (
      await apiClient.request<Envelope<AttendanceDetail>>(
        `/teacher/attendance/sessions/${encodeURIComponent(sessionId)}`,
        { token },
      )
    ).data;
  },
  async save(
    token: string,
    sessionId: string,
    action: 'draft' | 'submit',
    body: AttendanceWrite,
  ): Promise<AttendanceResult> {
    return (
      await apiClient.request<Envelope<AttendanceResult>>(
        `/teacher/attendance/sessions/${encodeURIComponent(
          sessionId,
        )}/${action}`,
        { token, method: 'POST', body },
      )
    ).data;
  },
};
// Retry identity only. No security/authority is derived from this value.
export const attendanceOperationId = () =>
  Date.now().toString(36) +
  '_' +
  Array.from({ length: 4 }, () =>
    Math.random().toString(36).slice(2, 12).padEnd(10, '0'),
  ).join('');
