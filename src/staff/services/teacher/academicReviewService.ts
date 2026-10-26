import {apiClient} from '../api/apiClient';

export type ReviewTargetType = 'homework_submission' | 'quiz_attempt';
export interface ReviewQueueItem {
  targetType: ReviewTargetType | 'missing'; evidenceId: string | null; workId: string; title: string;
  student: {fullName: string; admissionNumber: string}; evidenceRevision: number | null;
  submissionState: string; reviewState: string; reviewRevision: number; submittedAt: string | null; timing: string;
}
export interface RubricCriterion { criterionId: string; title: string; description: string; maxScore: number }
export interface ReviewDetail {
  targetType: ReviewTargetType;
  work: {workId: string; title: string; publishedRevision: number; className: string; sectionName: string; subjectName: string};
  student: {studentId: string; fullName: string; admissionNumber: string};
  evidence: Record<string, any>;
  review: null | {reviewId: string; revision: number; state: string; evidenceRevision: number; rubricRevision: number | null;
    scores: {criterionId: string; score: number}[]; totalScore: number | null; maxScore: number | null;
    feedback: string; privateNote: string; history: {revision: number; action: string; feedback: string; returnReason: string | null; createdAt: string}[]};
  rubric: null | {rubricId: string; revision: number; status: 'draft' | 'frozen'; criteria: RubricCriterion[]; totalMax: number};
}
export interface ReviewMutation {
  review: NonNullable<ReviewDetail['review']>;
  rubric: ReviewDetail['rubric'];
}
const request = async <T>(token: string, path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) =>
  (await apiClient.request<{success: boolean; data: T}>(`/teacher/reviews${path}`, {token, method,
    ...(body === undefined ? {} : {body})})).data;
export const academicReviewService = {
  queue: (token: string) => request<{items: ReviewQueueItem[]; total: number}>(token, ''),
  detail: (token: string, type: ReviewTargetType, id: string) =>
    request<ReviewDetail>(token, `/${type}/${encodeURIComponent(id)}`),
  mutate: (token: string, type: ReviewTargetType, id: string, body: Record<string, unknown>) =>
    request<ReviewMutation>(token, `/${type}/${encodeURIComponent(id)}`, 'POST', body),
};
export const reviewOperationId = (action: string) =>
  `${action}_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
