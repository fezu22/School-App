import {apiClient} from '../api/apiClient';

const request = async <T>(token: string, path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) =>
  (await apiClient.request<{success: boolean; data: T}>(`/student/evidence${path}`, {token, method,
    ...(body === undefined ? {} : {body})})).data;
export const academicEvidenceService = {
  submitHomework: (token: string, homeworkId: string, content: string, clientOperationId: string) =>
    request(token, `/homework/${encodeURIComponent(homeworkId)}/submit`, 'POST', {content, clientOperationId}),
  homework: (token: string, homeworkId: string) => request(token, `/homework/${encodeURIComponent(homeworkId)}`),
  startQuiz: (token: string, quizId: string, clientOperationId: string) =>
    request(token, `/quiz/${encodeURIComponent(quizId)}/attempts/start`, 'POST', {clientOperationId}),
  currentQuiz: (token: string, quizId: string) => request(token, `/quiz/${encodeURIComponent(quizId)}/attempts/current`),
  submitQuiz: (token: string, quizId: string, attemptId: string, revision: number, answers: unknown[], clientOperationId: string) =>
    request(token, `/quiz/${encodeURIComponent(quizId)}/attempts/${encodeURIComponent(attemptId)}/submit`, 'POST',
      {revision, answers, clientOperationId}),
};
