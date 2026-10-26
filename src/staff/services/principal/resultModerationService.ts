import { apiClient } from '../api/apiClient';
import type { TeacherResult, ResultStatus } from '../teacher/resultService';
export interface ResultModerationDetail {
  approvalId: string;
  approvalStatus: string;
  canModerate: boolean;
  canPublish: boolean;
  teacherName?: string;
  configurationIssue?: string | null;
  result: Omit<TeacherResult, 'revisions'> & {
    revisions: Omit<TeacherResult['revisions'][number], 'teacherPrivateNote'>[];
  };
}
export type ResultQueueState =
  | 'pending'
  | 'awaiting_publication'
  | 'published'
  | 'returned'
  | 'rejected';
export interface ResultQueueItem {
  approvalId: string;
  resultId: string;
  assessmentTitle: string;
  status: ResultStatus;
  recordRevision: number;
  academicYear: string;
  className: string;
  sectionName: string;
  subjectName: string;
  teacherName: string;
  studentName?: string;
  publishedAt?: string | null;
}
export interface ResultQueue {
  items: ResultQueueItem[];
  total: number;
  nextOffset: number | null;
  configurationIssueCount: number;
}
const request = async <T>(
  token: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(
      `/principal/results${path}`,
      { token, method, ...(body === undefined ? {} : { body }) },
    )
  ).data;
export const resultModerationService = {
  list: (
    token: string,
    filters: {
      state: ResultQueueState;
      search?: string;
      offset?: number;
      classId?: string;
      sectionId?: string;
      subjectId?: string;
    },
  ) => {
    const query = Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(
        ([key, value]) =>
          encodeURIComponent(key) + '=' + encodeURIComponent(String(value)),
      )
      .join('&');
    return request<ResultQueue>(token, '?' + query);
  },
  detail: (token: string, id: string) =>
    request<ResultModerationDetail>(token, '/' + encodeURIComponent(id)),
  moderate: (token: string, id: string, body: Record<string, unknown>) =>
    request<ResultModerationDetail>(
      token,
      '/' + encodeURIComponent(id) + '/moderate',
      'POST',
      body,
    ),
  publish: (token: string, id: string, body: Record<string, unknown>) =>
    request<ResultModerationDetail>(
      token,
      '/' + encodeURIComponent(id) + '/publish',
      'POST',
      body,
    ),
};
