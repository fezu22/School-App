import { apiClient } from '../api/apiClient';
import type { PublishedSyllabus } from './academicService';

export type AudiencePreview = {
  workType?: 'homework' | 'quiz';
  workId?: string;
  className?: string;
  sectionName?: string;
  recipientCount: number;
  students: { studentId: string; fullName: string; admissionNumber: string }[];
};
export type HomeworkRecord = {
  homeworkId: string;
  type: 'homework';
  status: 'draft' | 'published' | 'closed' | 'cancelled';
  revision: number;
  publishedRevision: number | null;
  lessonPlanId: string;
  lessonPlanRevision: number;
  lessonDeliveryId: string | null;
  topicIds: string[];
  title: string;
  instructions: string;
  dueAt: string;
  latePolicy: 'closed_after_due_date';
  recipientCount: number;
  publishedAt: string | null;
};
export type QuizQuestion =
  | { questionId: string; type: 'multiple_choice'; text: string; options: { optionId: string; text: string }[]; correctOptionIds: string[] }
  | { questionId: string; type: 'true_false'; text: string; correctBoolean: boolean }
  | { questionId: string; type: 'short_answer'; text: string; expectedAnswer: string };
export type QuizRecord = {
  quizId: string;
  type: 'quiz';
  status: 'draft' | 'published' | 'closed' | 'cancelled';
  revision: number;
  publishedRevision: number | null;
  lessonPlanId: string;
  lessonPlanRevision: number;
  lessonDeliveryId: string | null;
  topicIds: string[];
  title: string;
  instructions: string;
  questions: QuizQuestion[];
  availableFrom: string;
  availableUntil: string;
  attemptLimit: number;
  timeLimitMinutes: number | null;
  shuffleQuestions: boolean;
  recipientCount: number;
  publishedAt: string | null;
};
export interface AcademicWorkContext {
  lesson: {
    lessonPlanId: string;
    lessonState: string;
    lessonPlanRevision: number;
    classId: string;
    sectionId: string;
    subjectId: string;
    className: string;
    sectionName: string;
    teacherName: string;
    academicYear: string;
    syllabus: PublishedSyllabus;
    unitId: string;
    topicIds: string[];
    occurrence: { periodId: string; date: string; isSubstitute: boolean } | null;
  };
  audience: AudiencePreview;
  homework: HomeworkRecord[];
  quizzes: QuizRecord[];
  publicationPolicy: 'approved_lesson_required';
  schedulingSupported: false;
}
const base = '/teacher/academic-work';
const request = async <T>(token: string, path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) =>
  (await apiClient.request<{ success: boolean; data: T }>(base + path, { token, method, body })).data;
export const academicWorkService = {
  context: (token: string, lessonPlanId: string) =>
    request<AcademicWorkContext>(token, `/context?lessonPlanId=${encodeURIComponent(lessonPlanId)}`),
  saveHomework: (token: string, body: unknown, homeworkId?: string) =>
    request<HomeworkRecord>(token, homeworkId ? `/homework/${encodeURIComponent(homeworkId)}` : '/homework', homeworkId ? 'PATCH' : 'POST', body),
  previewHomework: (token: string, homeworkId: string) =>
    request<AudiencePreview>(token, `/homework/${encodeURIComponent(homeworkId)}/preview`, 'POST', {}),
  publishHomework: (token: string, homeworkId: string, revision: number, clientOperationId: string) =>
    request<HomeworkRecord>(token, `/homework/${encodeURIComponent(homeworkId)}/publish`, 'POST', { revision, clientOperationId }),
  saveQuiz: (token: string, body: unknown, quizId?: string) =>
    request<QuizRecord>(token, quizId ? `/quiz/${encodeURIComponent(quizId)}` : '/quiz', quizId ? 'PATCH' : 'POST', body),
  previewQuiz: (token: string, quizId: string) =>
    request<AudiencePreview>(token, `/quiz/${encodeURIComponent(quizId)}/preview`, 'POST', {}),
  publishQuiz: (token: string, quizId: string, revision: number, clientOperationId: string) =>
    request<QuizRecord>(token, `/quiz/${encodeURIComponent(quizId)}/publish`, 'POST', { revision, clientOperationId }),
};
export const academicWorkOperationId = (prefix = 'work') =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
