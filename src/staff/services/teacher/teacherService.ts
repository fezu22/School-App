import { apiClient } from '../api/apiClient';

export interface TeacherAssignment {
  assignmentId: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
}

export type TeacherTupleIds = Pick<
  TeacherAssignment,
  'classId' | 'sectionId' | 'subjectId'
>;
export interface TeacherStudent {
  studentId: string;
  fullName: string;
  admissionNumber: string;
}
export interface TeacherRoster {
  assignment: TeacherAssignment;
  students: TeacherStudent[];
}
interface Envelope<T> {
  success: boolean;
  data: T;
}
const tuplePath = (ids: TeacherTupleIds) =>
  `/teacher/classes/${encodeURIComponent(
    ids.classId,
  )}/sections/${encodeURIComponent(
    ids.sectionId,
  )}/subjects/${encodeURIComponent(ids.subjectId)}`;

export const teacherService = {
  async getAssignedClasses(token: string): Promise<TeacherAssignment[]> {
    return (
      await apiClient.request<Envelope<TeacherAssignment[]>>(
        '/teacher/classes',
        { token },
      )
    ).data;
  },
  async getAssignedClassDetail(
    token: string,
    ids: TeacherTupleIds,
  ): Promise<TeacherAssignment[]> {
    return (
      await apiClient.request<Envelope<TeacherAssignment[]>>(tuplePath(ids), {
        token,
      })
    ).data;
  },
  async getRoster(token: string, ids: TeacherTupleIds): Promise<TeacherRoster> {
    return (
      await apiClient.request<Envelope<TeacherRoster>>(
        `${tuplePath(ids)}/students`,
        { token },
      )
    ).data;
  },
};
