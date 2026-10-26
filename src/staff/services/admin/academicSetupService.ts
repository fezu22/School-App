import {apiClient} from '../api/apiClient';

export type SetupKind = 'periods' | 'classes' | 'sections' | 'subjects' | 'rooms';
export interface AcademicPeriod {
  id: string; name: string; code: string; startDate: string; endDate: string;
  status: 'draft' | 'active' | 'closed' | 'archived'; revision: number;
}
export interface CatalogRecord {
  id: string; name: string; code?: string; isActive: boolean; revision: number;
  category?: string;
  academicPeriodId?: string | null; academicYear?: string; periodName?: string;
  periodStatus?: string; legacy?: boolean; classId?: string;
}
export interface SetupPage<T> {items: T[]; total: number; nextOffset: number | null; branchName: string; current?: AcademicPeriod | null}
export interface SetupQuery {q?: string;branchId?: string; academicPeriodId?: string; classId?: string; offset?: number}
export type SetupAction = 'activate' | 'close' | 'archive' | 'deactivate' | 'reactivate';
function path(kind: string, query: SetupQuery = {}, suffix = '') {
  const params = Object.entries(query).filter(([, value]) => value !== undefined && value !== '');
  return `/academic-setup/${kind}${suffix}${params.length ? '?' + params.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&') : ''}`;
}
async function request<T>(token: string, endpoint: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown): Promise<T> {
  const response = await apiClient.request<{success: boolean; data: T}>(endpoint, {token, method, ...(body === undefined ? {} : {body})});
  if (!response.success || !response.data) throw new Error('The server did not confirm this academic setup operation. Refresh and retry.');
  return response.data;
}
export const academicSetupService = {
  branches: (token: string) => request<{items: {id: string; name: string; code: string}[]}>(token, path('branches')),
  periods: (token: string, query: SetupQuery) => request<SetupPage<AcademicPeriod>>(token, path('periods', query)),
  list: (token: string, kind: SetupKind, query: SetupQuery) => request<SetupPage<CatalogRecord>>(token, path(kind, query)),
  create: (token: string, kind: SetupKind, query: SetupQuery, body: Record<string, unknown>) => request<CatalogRecord | AcademicPeriod>(token, path(kind, query), 'POST', body),
  update: (token: string, kind: SetupKind, query: SetupQuery, id: string, body: Record<string, unknown>) => request<CatalogRecord | AcademicPeriod>(token, path(kind, query, `/${encodeURIComponent(id)}`), 'PATCH', body),
  lifecycle: (token: string, kind: SetupKind, query: SetupQuery, id: string, action: SetupAction, revision: number) => request<CatalogRecord | AcademicPeriod>(token, path(kind, query, `/${encodeURIComponent(id)}/${action}`), 'POST', {revision}),
};
