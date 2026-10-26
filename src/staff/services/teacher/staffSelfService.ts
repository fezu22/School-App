import { NativeModules, Platform } from 'react-native';
import { apiClient } from '../api/apiClient';
export interface LeaveRequest {
  leaveId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  history: { action: string; createdAt: string }[];
}
export interface Payslip {
  payslipId: string;
  period: string;
  status: 'approved';
  approvedAt: string;
  netAmount: number | null;
  currency: string | null;
  canDownload: boolean;
}
export interface StaffDocument {
  documentId: string;
  title: string;
  documentType: string;
  expiresOn: string | null;
  status: string;
  canDownload: boolean;
}
export interface Appointment {
  appointmentId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  revision: number;
  studentName: string | null;
  context: string | null;
  history: {
    action: string;
    date: string;
    startTime: string;
    endTime: string;
    createdAt: string;
  }[];
}
export interface AppointmentStudent {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  context: string;
}
export interface SelfServiceData {
  leave: {
    items: LeaveRequest[];
    balances: {
      leaveType: string;
      available: number | null;
      approvedDays: number;
      pendingDays: number;
    }[];
    balancePolicy: string;
    cancellationSupported: boolean;
  };
  payslips: { items: Payslip[] };
  documents: { items: StaffDocument[] };
  appointments: {
    items: Appointment[];
    timezone: string;
    today: string;
    time: string;
    parentBookingSupported: boolean;
  };
}
const request = async <T>(token: string, path: string, body?: unknown) =>
  (
    await apiClient.request<{ success: boolean; data: T }>(
      `/teacher/self-service${path}`,
      {
        token,
        ...(body === undefined ? {} : { method: 'POST' as const, body }),
      },
    )
  ).data;
export const staffOperationId = () =>
  `staff_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random()
    .toString(36)
    .slice(2)}`;
export const staffFilesSupported = () =>
  Platform.OS === 'android' && !!NativeModules.StaffFileShare;
export const staffSelfService = {
  summary: (token: string) => request<SelfServiceData>(token, '/summary'),
  students: (token: string) =>
    request<{ items: AppointmentStudent[] }>(token, '/appointment-students'),
  leave: (token: string, body: unknown) =>
    request<LeaveRequest>(token, '/leave', body),
  slot: (token: string, body: unknown) =>
    request<Appointment>(token, '/appointments/slots', body),
  change: (
    token: string,
    id: string,
    action: 'confirm' | 'reschedule' | 'cancel' | 'complete',
    body: unknown,
  ) =>
    request<Appointment>(
      token,
      `/appointments/${encodeURIComponent(id)}/${action}`,
      body,
    ),
  async openFile(
    token: string,
    kind: 'payslips' | 'documents',
    id: string,
    isCurrent: () => boolean = () => true,
  ) {
    if (!staffFilesSupported())
      throw new Error(
        'Secure file opening is not available on this device. Contact the school office for your document.',
      );
    const file = await request<{ base64: string; mime: string }>(
      token,
      `/${kind}/${encodeURIComponent(id)}/file-content`,
    );
    if (!isCurrent()) throw new Error('File request is no longer active.');
    await NativeModules.StaffFileShare.open(file.base64, file.mime);
  },
};
