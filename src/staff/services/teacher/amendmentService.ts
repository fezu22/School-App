import { apiClient } from '../api/apiClient';
import type { TeacherPeriod } from '../teacher/timetableService';
import type { AttendanceStatus } from '../teacher/attendanceService';
export interface AmendmentHistory {
  requestId: string;
  approvalId: string;
  originalStatus?: AttendanceStatus;
  baseStatus?: AttendanceStatus;
  requestedStatus: AttendanceStatus | null;
  reason: string;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  revision: number;
  fromDate?: string;
  untilDate?: string;
  category?: string;
}
export interface EffectiveMark {
  originalStatus: AttendanceStatus;
  status: AttendanceStatus;
  effectiveRevision: number;
}
export interface AttendanceReview {
  sessionId: string;
  teacherName: string;
  student: { studentId: string; fullName: string; admissionNumber: string };
  period: TeacherPeriod;
  submitted: boolean;
  submittedRevision: number;
  effective: EffectiveMark | null;
  canRequestCorrection: boolean;
  canRequestLeave: boolean;
  approvedLeaveId: string | null;
  corrections: AmendmentHistory[];
  leaves: AmendmentHistory[];
  total: number;
  nextOffset: number | null;
}
export interface PrincipalAttendanceReview {
  approvalId: string;
  kind: 'correction' | 'leave';
  reviewerRole: string;
  student: AttendanceReview['student'];
  period: TeacherPeriod;
  effective: EffectiveMark | null;
  request: AmendmentHistory;
  canReview: boolean;
}
const request = async <T>(token: string, url: string, body?: unknown) => {
  const result = await apiClient.request<{ success: boolean; data: T }>(url, {
    token,
    ...(body === undefined ? {} : { method: 'POST', body }),
  });
  if (!result.success || !result.data)
    throw new Error(
      'The server did not confirm the attendance review. Refresh before retrying.',
    );
  return result.data;
};
const base = (sessionId: string, studentId: string) =>
  `/teacher/attendance/sessions/${encodeURIComponent(
    sessionId,
  )}/students/${encodeURIComponent(studentId)}`;
export const amendmentService = {
  context: (token: string, sessionId: string, studentId: string, offset = 0) =>
    request<AttendanceReview>(
      token,
      base(sessionId, studentId) + '/review?offset=' + offset,
    ),
  create: (
    token: string,
    sessionId: string,
    studentId: string,
    kind: 'correction' | 'leave',
    body: unknown,
  ) =>
    request<{
      requestId: string;
      approvalId: string;
      state: string;
      replayed: boolean;
    }>(
      token,
      base(sessionId, studentId) +
        (kind === 'correction' ? '/corrections' : '/leaves'),
      body,
    ),
  review: (token: string, approvalId: string) =>
    request<PrincipalAttendanceReview>(
      token,
      '/attendance-review/' + encodeURIComponent(approvalId),
    ),
  decide: (token: string, approvalId: string, body: unknown) =>
    request<{ state: string; replayed: boolean }>(
      token,
      '/attendance-review/' + encodeURIComponent(approvalId) + '/decision',
      body,
    ),
};
