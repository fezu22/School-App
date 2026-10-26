import { apiClient } from '../api/apiClient';
import type { Enrollment } from './enrollmentService';
export interface StudentProfile {
  id: string;
  fullName: string;
  admissionNumber: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  address: string;
  isActive: boolean;
  revision: number;
}
export type ProfileFields = Pick<
  StudentProfile,
  | 'fullName'
  | 'admissionNumber'
  | 'phone'
  | 'dateOfBirth'
  | 'gender'
  | 'guardianName'
  | 'guardianPhone'
  | 'address'
>;
export interface ProfileResult {
  student: StudentProfile;
  capabilities: { editProfile: boolean };
  initialEnrollment?: Enrollment;
  replayed?: boolean;
}
export interface AdmissionInput extends ProfileFields {
  email: string;
  password: string;
  academicPeriodId: string;
  classId: string;
  sectionId: string;
  operationId: string;
}
export const studentAdminService = {
  profile: async (token: string, id: string) =>
    (
      await apiClient.request<{ data: ProfileResult }>(
        '/staff-students/' + encodeURIComponent(id) + '/profile',
        { token },
      )
    ).data,
  admit: async (token: string, body: AdmissionInput) =>
    (
      await apiClient.request<{ data: ProfileResult }>('/staff-students/admissions', {
        token,
        method: 'POST',
        body,
      })
    ).data,
  edit: async (
    token: string,
    id: string,
    body: ProfileFields & { revision: number },
  ) =>
    (
      await apiClient.request<{ data: ProfileResult }>(
        '/staff-students/' + encodeURIComponent(id) + '/profile',
        { token, method: 'PATCH', body },
      )
    ).data,
};
