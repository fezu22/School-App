import { apiClient, ApiError } from '../api/apiClient';
export interface LiveLesson {
  id: string;
  periodId: string;
  date: string;
  academicPeriodId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: 'scheduled' | 'starting' | 'live' | 'ended' | 'cancelled' | 'failed';
  revision: number;
  startedAt: string | null;
  endedAt: string | null;
  className?: string;
  sectionName?: string;
  subjectName?: string;
}
export interface PublicRtcConfig {
  provider: string;
  appId: number;
}
export interface LiveCredential extends PublicRtcConfig {
  roomId: string;
  userId: string;
  token: string;
  expiresAt: string;
  role: 'host' | 'participant';
}
export interface AuthorizedRoom {
  session: LiveLesson;
  connection: LiveCredential;
}
export interface ClassroomParticipant {
  id: string;
  displayName: string;
  role: 'host' | 'participant';
  admission: 'waiting' | 'admitted' | 'rejected' | 'removed' | 'left';
  connectionState: 'connected' | 'reconnecting' | 'disconnected';
  handRaised: boolean;
  reconnectCount: number;
  enforcement: 'none' | 'pending' | 'confirmed' | 'failed' | 'expired';
}
export interface ClassroomState {
  session: LiveLesson;
  participant: ClassroomParticipant;
  participants?: ClassroomParticipant[];
}
type Envelope<T> = { success: boolean; data: T };
const root = '/live-lessons';
const idPath = (id: string) => `${root}/${encodeURIComponent(id)}`;
async function request<T>(
  path: string,
  token: string,
  body?: object,
): Promise<T> {
  return (
    await apiClient.request<Envelope<T>>(path, {
      token,
      ...(body ? ({ method: 'POST', body } as const) : {}),
    })
  ).data;
}
export const liveLessonService = {
  previewConfig: (token: string, periodId: string, date: string) =>
    request<PublicRtcConfig>(
      `${root}/from-timetable/${encodeURIComponent(periodId)}/preview-config`,
      token,
      { date },
    ),
  startLesson: (
    token: string,
    periodId: string,
    date: string,
    connectionId?: string,
  ) =>
    request<AuthorizedRoom>(
      `${root}/from-timetable/${encodeURIComponent(periodId)}/start`,
      token,
      { date, connectionId },
    ),
  getLiveLesson: (token: string, id: string) =>
    request<LiveLesson>(idPath(id), token),
  getJoinToken: (token: string, id: string, connectionId?: string) =>
    request<AuthorizedRoom>(`${idPath(id)}/join-token`, token, {
      connectionId,
    }),
  requestAdmission: (token: string, id: string, connectionId: string) =>
    request<ClassroomState>(`${idPath(id)}/admission`, token, { connectionId }),
  classroom: (token: string, id: string, connectionId: string, state: string) =>
    request<ClassroomState>(`${idPath(id)}/classroom`, token, {
      connectionId,
      state,
    }),
  moderate: (
    token: string,
    id: string,
    participantId: string,
    action: string,
  ) =>
    request(
      `${idPath(id)}/participants/${encodeURIComponent(
        participantId,
      )}/moderate`,
      token,
      { action },
    ),
  hand: (token: string, id: string, connectionId: string, raised: boolean) =>
    request(`${idPath(id)}/hand`, token, { connectionId, raised }),
  endLesson: (token: string, id: string) =>
    request<LiveLesson>(`${idPath(id)}/end`, token, {}),
  available: (token: string) =>
    request<{ sessions: LiveLesson[] }>(`${root}/available`, token),
};
export function liveLessonError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Your session has expired. Sign in again.';
      case 403:
        return 'You do not have permission to access this live lesson.';
      case 404:
        return 'This lesson is unavailable for your current assignment or enrollment.';
      case 409:
        return 'This lesson is unavailable, has ended, or is already open on another connection. Close the other screen and wait for its access lease to expire.';
      case 429:
        return 'Too many classroom actions. Please wait a moment and try again.';
      case 503:
        return 'Live lesson media is not configured or is temporarily unavailable.';
    }
  }
  return 'Unable to reach the school server. Check your connection and try again.';
}
