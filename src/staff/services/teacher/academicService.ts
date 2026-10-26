import { apiClient } from '../api/apiClient';
import type { TeacherAssignment, TeacherTupleIds } from './teacherService';
export interface SyllabusTopic {
  topicId: string;
  title: string;
  order: number;
  outcomes: string[];
}
export interface SyllabusUnit {
  unitId: string;
  title: string;
  order: number;
  topics: SyllabusTopic[];
}
export interface PublishedSyllabus {
  syllabusId: string;
  title: string;
  academicYear: string;
  version: number;
  revision: number;
  status: 'published';
  units: SyllabusUnit[];
}
export interface AcademicContext {
  assignment: TeacherAssignment;
  teacherName: string;
  academicYear: string;
  syllabus: PublishedSyllabus | null;
}
export interface LessonDetails {
  unitId: string;
  topicIds: string[];
  teachingDate: string;
  objectives: string;
  teachingActivities: string;
  resources: string;
  notes: string;
}
export interface LessonPlan extends LessonDetails, TeacherTupleIds {
  lessonPlanId: string;
  syllabusId: string;
  academicYear: string;
  revision: number;
  state: 'draft' | 'submitted' | 'approved' | 'needs_revision' | 'rejected';
  submittedAt: string | null;
  occurrence?: { periodId: string; timetableVersionId: string; date: string } | null;
  approvalRequestId?: string | null;
  approvedRevision?: number | null;
  submissions?: { revision: number; content: LessonDetails; submittedAt: string }[];
  reviews?: { submittedRevision: number; action: string; note: string; reviewedAt: string }[];
}
const base = '/teacher/academic';
const query = (ids: TeacherTupleIds) =>
  `classId=${encodeURIComponent(ids.classId)}&sectionId=${encodeURIComponent(
    ids.sectionId,
  )}&subjectId=${encodeURIComponent(ids.subjectId)}`;
const request = async <T>(
  token: string,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(base + path, {
      token,
      method,
      body,
    })
  ).data;
export const academicService = {
  context: (token: string, ids: TeacherTupleIds) =>
    request<AcademicContext>(token, `/context?${query(ids)}`),
  lessons: (token: string, ids: TeacherTupleIds) =>
    request<LessonPlan[]>(token, `/lessons?${query(ids)}`),
  create: (
    token: string,
    body: LessonDetails &
      TeacherTupleIds & { syllabusId: string; clientOperationId: string; occurrence?: LessonPlan['occurrence'] },
  ) => request<LessonPlan>(token, '/lessons', 'POST', body),
  update: (
    token: string,
    id: string,
    body: LessonDetails & { revision: number; clientOperationId: string },
  ) =>
    request<LessonPlan>(
      token,
      `/lessons/${encodeURIComponent(id)}`,
      'PATCH',
      body,
    ),
  submit: (
    token: string,
    id: string,
    revision: number,
    clientOperationId: string,
  ) =>
    request<LessonPlan>(
      token,
      `/lessons/${encodeURIComponent(id)}/submit`,
      'POST',
      { revision, clientOperationId },
    ),
  revise: (token: string, id: string, revision: number, clientOperationId: string) =>
    request<LessonPlan>(token, `/lessons/${encodeURIComponent(id)}/revise`, 'POST', { revision, clientOperationId }),
  deliveryContext: (token: string, id: string) => request<DeliveryContext>(token, `/lessons/${encodeURIComponent(id)}/delivery-context`),
  recordDelivery: (token: string, id: string, body: DeliveryInput) => request<DeliveryContext>(token, `/lessons/${encodeURIComponent(id)}/deliveries`, 'POST', body),
  coverage: (token: string, ids: TeacherTupleIds) => request<Coverage | null>(token, `/coverage?${query(ids)}`),
  occurrenceLessons: (token: string, periodId: string, date: string) => request<LessonPlan[]>(token, `/occurrences/${encodeURIComponent(periodId)}/lessons?date=${encodeURIComponent(date)}`),
};
export type TopicEvidence = { topicId: string; state: 'completed' | 'partial' | 'not_covered'; evidence: string };
export interface Coverage {
  syllabusId: string; version: number; sectionId: string; totalTopics: number;
  completedTopics: number; partialTopics: number; pendingTopics: number; completedPercentage: number;
  units: { unitId: string; title: string; totalTopics: number; completedTopics: number; partialTopics: number; pendingTopics: number;
    topics: { topicId: string; title: string; state: 'pending' | 'partial' | 'completed' }[] }[];
}
export interface DeliveryRecord {
  deliveryId: string; lessonPlanId: string; lessonPlanRevision: number; syllabusId: string; syllabusVersion: number; revision: number; state: string;
  history: { revision: number; deliveryStatus: 'delivered' | 'partially_delivered' | 'not_delivered'; actualTeachingDate: string;
    topics: TopicEvidence[]; teacherNotes: string; correctionReason: string; recordedAt: string; recordedBy: string; recordedByName?: string }[];
}
export interface DeliveryInput {
  lessonPlanRevision: number; revision: number; clientOperationId: string;
  deliveryStatus: 'delivered' | 'partially_delivered' | 'not_delivered'; actualTeachingDate: string;
  topics: TopicEvidence[]; teacherNotes: string; correctionReason: string;
}
export interface DeliveryContext {
  lesson: LessonPlan; syllabus: PublishedSyllabus; className: string; sectionName: string; teacherName: string;
  today: string; canRecord: boolean; delivery: DeliveryRecord | null; coverage: Coverage;
  period: { startTime: string; endTime: string; isSubstitute: boolean } | null;
}
export interface LessonReviewContext extends Omit<DeliveryContext, 'today' | 'period' | 'canRecord'> {
  approvalId: string; submittedRevision: number; submittedContent: LessonDetails; canReview: boolean;
}
export const lessonReviewService = {
  history: async (token: string) => (await apiClient.request<{data: import('../principal/principalService').ApprovalRequest[]}>('/principal/academic-review/history', {token})).data,
  detail: async (token: string, approvalId: string) => (await apiClient.request<{data: LessonReviewContext}>(`/principal/academic-review/${encodeURIComponent(approvalId)}`, {token})).data,
  decide: async (token: string, approvalId: string, body: { action: 'approved' | 'needs_revision' | 'rejected'; reviewNote: string; revision: number; clientOperationId: string }) =>
    (await apiClient.request<{data: LessonReviewContext}>(`/principal/academic-review/${encodeURIComponent(approvalId)}/decision`, {token, method: 'POST', body})).data,
};
export const academicOperationId = () =>
  `lesson_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}_${Math.random().toString(36).slice(2)}`;
