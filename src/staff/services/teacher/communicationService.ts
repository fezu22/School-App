import { apiClient } from '../api/apiClient';
import type { TeacherAssignment, TeacherTupleIds } from './teacherService';
export interface TeacherNotice {
  noticeId: string;
  kind: 'class_notice' | 'school_notice';
  title: string;
  body: string;
  language: 'en' | 'ur' | null;
  state: 'draft' | 'published' | 'archived';
  revision: number | null;
  classId: string | null;
  sectionId: string | null;
  subjectId: string | null;
  audienceType: 'class_students' | 'branch_teachers';
  createdAt: string;
  updatedAt: string | null;
  publishedAt: string | null;
  recipientCount: number | null;
  channel: 'school_app_internal';
  deliveryState: 'accepted_internal' | null;
  canEdit: boolean;
}
export interface NoticeContent extends TeacherTupleIds {
  audienceType: 'class_students';
  title: string;
  body: string;
  language: 'en' | 'ur';
}
export interface RecipientPreview {
  context: TeacherAssignment;
  audienceType: 'class_students';
  recipientCount: number;
  channel: 'school_app_internal';
}
export interface TeacherWork {
  workId: string;
  title: string;
  summary: string;
  sourceType: 'coordinator_follow_up' | 'class_follow_up';
  source: TeacherTupleIds | null;
  status: 'open' | 'completed' | 'cancelled';
  priority: 'normal' | 'high';
  dueAt: string | null;
  revision: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canComplete: boolean;
}
export interface TeacherQueue<T> {
  total: number;
  items: T[];
  nextOffset: number | null;
}
const request = async <T>(
  token: string,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(`/teacher${path}`, {
      token,
      method,
      ...(body === undefined ? {} : { body }),
    })
  ).data;
export const communicationService = {
  inbox: (token: string, offset = 0) =>
    request<TeacherQueue<TeacherNotice>>(token, `/inbox?offset=${offset}`),
  notice: (token: string, id: string) =>
    request<TeacherNotice>(token, `/notices/${encodeURIComponent(id)}`),
  preview: (token: string, context: TeacherTupleIds) =>
    request<RecipientPreview>(token, '/notices/preview', 'POST', {
      classId: context.classId,
      sectionId: context.sectionId,
      subjectId: context.subjectId,
      audienceType: 'class_students',
    }),
  draft: (
    token: string,
    content: NoticeContent,
    existing?: { noticeId: string; revision: number },
  ) =>
    request<TeacherNotice>(
      token,
      existing
        ? `/notices/${encodeURIComponent(existing.noticeId)}`
        : '/notices',
      existing ? 'PATCH' : 'POST',
      { ...content, ...(existing ? { revision: existing.revision } : {}) },
    ),
  send: (
    token: string,
    id: string,
    revision: number,
    clientOperationId: string,
  ) =>
    request<TeacherNotice>(
      token,
      `/notices/${encodeURIComponent(id)}/send`,
      'POST',
      { revision, clientOperationId },
    ),
  tasks: (token: string, offset = 0) =>
    request<TeacherQueue<TeacherWork>>(token, `/tasks?offset=${offset}`),
  work: (token: string, id: string) =>
    request<TeacherWork>(token, `/tasks/${encodeURIComponent(id)}`),
  complete: (token: string, id: string) =>
    request<TeacherWork>(
      token,
      `/tasks/${encodeURIComponent(id)}/complete`,
      'POST',
      {},
    ),
};
// An identity, not a security token. Keep it across retries of the same send.
export const noticeOperationId = () =>
  `notice_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random()
    .toString(36)
    .slice(2)}`;
