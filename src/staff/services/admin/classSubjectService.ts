import {apiClient} from '../api/apiClient';
export interface ClassSubjectRecord {id: string; subject: {id: string; name: string; isActive: boolean}; isActive: boolean; revision: number}
export interface ClassSubjectPage {class: {id: string; name: string; code: string; isActive: boolean}; period: {id: string; name: string; code: string; status: string} | null; writable: boolean; items: ClassSubjectRecord[]; total: number; nextOffset: number | null}
export interface SubjectOptions {items: {id: string; name: string}[]; total: number; nextOffset: number | null}
const path = (classId: string, branchId?: string, suffix = '', offset?: number) => {
  const query = [branchId ? 'branchId=' + encodeURIComponent(branchId) : '', offset !== undefined ? 'offset=' + offset : ''].filter(Boolean).join('&');
  return '/academic-setup/classes/' + encodeURIComponent(classId) + '/subjects' + suffix + (query ? '?' + query : '');
};
async function request<T>(token: string, endpoint: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const response = await apiClient.request<{success: boolean; data: T}>(endpoint, {token, method, ...(body === undefined ? {} : {body})});
  if (!response.success || !response.data) throw new Error('The server did not confirm this Class Subject change. Refresh and retry.');
  return response.data;
}
export const classSubjectService = {
  list: (token: string, classId: string, branchId?: string, offset = 0) => request<ClassSubjectPage>(token, path(classId, branchId, '', offset)),
  options: (token: string, classId: string, branchId?: string, offset = 0) => request<SubjectOptions>(token, path(classId, branchId, '/options', offset)),
  create: (token: string, classId: string, subjectId: string, branchId?: string) => request<ClassSubjectRecord>(token, path(classId, branchId), 'POST', {subjectId}),
  lifecycle: (token: string, classId: string, mapping: ClassSubjectRecord, action: 'deactivate' | 'reactivate', branchId?: string) => request<ClassSubjectRecord>(token, path(classId, branchId, '/' + encodeURIComponent(mapping.id) + '/' + action), 'POST', {revision: mapping.revision}),
};
