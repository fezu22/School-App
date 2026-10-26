import { apiClient } from '../api/apiClient';
export type AcademicOption = { id: string; name: string };
export type ManagedTeacher = {
  teacherId: string;
  fullName: string;
  email: string;
  branchId: string;
  isActive: boolean;
};
export type AssignmentOptions = {
  branchId: string | null;
  branchFixed: boolean;
  branches: (AcademicOption & { code: string })[];
  teachers: {
    items: ManagedTeacher[];
    total: number;
    nextOffset: number | null;
  };
  selectedTeacher: ManagedTeacher | null;
  classes: AcademicOption[];
  sections: AcademicOption[];
  subjects: AcademicOption[];
};
export type ManagedAssignment = {
  assignmentId: string;
  className: string;
  sectionName: string;
  subjectName: string;
  validFrom: string;
  validUntil: string | null;
  status: 'active' | 'upcoming' | 'expired' | 'revoked' | 'unavailable';
  canRevoke: boolean;
};
export type AssignmentHistory = {
  teacher: ManagedTeacher;
  items: ManagedAssignment[];
  total: number;
  nextOffset: number | null;
};
export type AssignmentInput = {
  teacherId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  validFrom: string;
  validUntil?: string;
};
const query = (input: Record<string, string | number | undefined>) => {
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  return entries.length
    ? '?' +
        entries
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
          )
          .join('&')
    : '';
};
export const teacherAssignmentService = {
  async options(
    token: string,
    input: {
      branchId?: string;
      teacherId?: string;
      classId?: string;
      search?: string;
      offset?: number;
    },
  ) {
    return (
      await apiClient.request<{ data: AssignmentOptions }>(
        '/teacher-assignments/options' +
          query({
            branchId: input.branchId,
            teacherId: input.teacherId,
            classId: input.classId,
            search: input.search,
            offset: input.offset,
          }),
        { token },
      )
    ).data;
  },
  async history(token: string, teacherId: string, offset = 0) {
    return (
      await apiClient.request<{ data: AssignmentHistory }>(
        `/teacher-assignments/teachers/${encodeURIComponent(teacherId)}` +
          query({ offset }),
        { token },
      )
    ).data;
  },
  async create(token: string, input: AssignmentInput) {
    return apiClient.request<{
      success: boolean;
      data: { assignmentId: string; isActive: boolean };
    }>('/teacher-assignments', {
      token,
      method: 'POST',
      body: {
        teacherId: input.teacherId,
        classId: input.classId,
        sectionId: input.sectionId,
        subjectId: input.subjectId,
        validFrom: input.validFrom,
        ...(input.validUntil ? { validUntil: input.validUntil } : {}),
      },
    });
  },
  async revoke(token: string, assignmentId: string) {
    return apiClient.request<{
      success: boolean;
      data: { assignmentId: string; isActive: boolean };
    }>(`/teacher-assignments/${encodeURIComponent(assignmentId)}/revoke`, {
      token,
      method: 'PATCH',
      body: {},
    });
  },
};
