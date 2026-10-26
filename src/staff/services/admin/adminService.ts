import { apiClient } from '../api/apiClient';

interface Branch {
  _id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SuperAdminDashboard {
  branches: {
    total: number;
    active: number;
    inactive: number;
    list: Branch[];
  };
}

interface SuperAdminDashboardResponse {
  success: boolean;
  message: string;
  data: SuperAdminDashboard;
}

export interface SystemHealth {
  api: {
    status: string;
    message: string;
  };
  database: {
    status: string;
    message: string;
  };
  overall: string;
}
export interface BackupStatus {
  status: string;
  message: string;
  lastSuccessfulBackup: string | null;
  nextScheduledBackup: string | null;
}
export interface UsageStatus {
  branches: {
    used: number;
    limit: number | null;
    status: string;
  };
  users: {
    used: number;
    limit: number | null;
    status: string;
  };
}
export interface PrivilegedRequest {
  _id: string;
  requesterId: {
    _id: string;
    fullName: string;
    email: string;
    role: string;
  };
  branchId?: {
    _id: string;
    name: string;
    code: string;
  };
  requestType: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingPrivilegedRequests {
  requests: PrivilegedRequest[];
  total: number;
}
export interface branch {
  _id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PendingPrivilegedRequestsResponse {
  success: boolean;
  message: string;
  data: PendingPrivilegedRequests;
}

interface SystemHealthResponse {
  success: boolean;
  message: string;
  data: SystemHealth;
}
interface BackupStatusResponse {
  success: boolean;
  message: string;
  data: BackupStatus;
}
interface UsageStatusResponse {
  success: boolean;
  message: string;
  data: UsageStatus;
}

export interface AutomationConfig {
  _id: string;
  key: string;
  name: string;
  description: string;
  isPaused: boolean;
  pausedBy?: string;
  pausedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSession {
  _id: string;
  userId: {
    _id: string;
    fullName: string;
    email: string;
    role: string;
  };
  role: string;
  isRevoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface ReviewPrivilegedRequestResponse {
  success: boolean;
  message: string;
  data: PrivilegedRequest;
}

interface GetAutomationsResponse {
  success: boolean;
  message: string;
  data: {
    automations: AutomationConfig[];
    total: number;
  };
}

interface ToggleAutomationResponse {
  success: boolean;
  message: string;
  data: AutomationConfig;
}

interface GetSessionsResponse {
  success: boolean;
  message: string;
  data: {
    sessions: UserSession[];
    total: number;
  };
}

interface RevokeSessionResponse {
  success: boolean;
  message: string;
  data: UserSession;
}

export interface CreatePrincipalPayload {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  branchId: string;
}

export interface CreatePrincipalResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    fullName: string;
    email: string;
    phone?: string;
    role: string;
    branchId: string;
    isActive: boolean;
    createdAt: string;
  };
}

interface BranchesResponse {
  success: boolean;
  message: string;
  branches: Branch[];
}

export const adminService = {
  getTeacherBranches: (accessToken: string) =>
    apiClient.request<{success: boolean; data: {id: string; name: string; code: string}[]}>(
      '/admin/teachers/branches', {token: accessToken},
    ),
  createTeacher: (accessToken: string, payload: {fullName: string; email: string; password: string; branchId: string}) =>
    apiClient.request<{success: boolean; message: string; data: {id: string; role: 'teacher'; branchId: string}}>(
      '/admin/teachers', {method: 'POST', token: accessToken, body: {
        fullName: payload.fullName, email: payload.email,
        password: payload.password, branchId: payload.branchId,
      }},
    ),
  getDashboard: async (
    accessToken: string,
  ): Promise<SuperAdminDashboardResponse> => {
    return apiClient.request<SuperAdminDashboardResponse>('/admin/dashboard', {
      method: 'GET',
      token: accessToken,
    });
  },
  getPendingPrivilegedRequests: async (
    accessToken: string,
  ): Promise<PendingPrivilegedRequestsResponse> => {
    return apiClient.request<PendingPrivilegedRequestsResponse>(
      '/privileged-requests/pending',
      {
        method: 'GET',
        token: accessToken,
      },
    );
  },
  reviewPrivilegedRequest: async (
    accessToken: string,
    requestId: string,
    status: 'approved' | 'rejected',
  ): Promise<ReviewPrivilegedRequestResponse> => {
    return apiClient.request<ReviewPrivilegedRequestResponse>(
      `/privileged-requests/${requestId}/review`,
      {
        method: 'PATCH',
        token: accessToken,
        body: { status },
      },
    );
  },
  getBranches: async (accessToken: string): Promise<BranchesResponse> => {
    return apiClient.request<BranchesResponse>('/branches', {
      method: 'GET',
      token: accessToken,
    });
  },
  createPrincipal: async (
    accessToken: string,
    payload: CreatePrincipalPayload,
  ): Promise<CreatePrincipalResponse> => {
    return apiClient.request<CreatePrincipalResponse>('/admin/principals', {
      method: 'POST',
      token: accessToken,
      body: payload,
    });
  },
  getBranchById: async (
    accessToken: string,
    branchId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: Branch;
  }> => {
    return apiClient.request<{
      success: boolean;
      message: string;
      data: Branch;
    }>(`/branches/${branchId}`, {
      method: 'GET',
      token: accessToken,
    });
  },
  getUsageStatus: async (accessToken: string): Promise<UsageStatusResponse> => {
    return apiClient.request<UsageStatusResponse>('/usage', {
      method: 'GET',
      token: accessToken,
    });
  },

  getBackupStatus: async (
    accessToken: string,
  ): Promise<BackupStatusResponse> => {
    return apiClient.request<BackupStatusResponse>('/backup', {
      method: 'GET',
      token: accessToken,
    });
  },

  getSystemHealth: async (
    accessToken: string,
  ): Promise<SystemHealthResponse> => {
    return apiClient.request<SystemHealthResponse>('/health', {
      method: 'GET',
      token: accessToken,
    });
  },

  getAutomations: async (
    accessToken: string,
  ): Promise<GetAutomationsResponse> => {
    return apiClient.request<GetAutomationsResponse>('/automation', {
      method: 'GET',
      token: accessToken,
    });
  },

  toggleAutomationPause: async (
    accessToken: string,
    key: string,
    isPaused: boolean,
  ): Promise<ToggleAutomationResponse> => {
    return apiClient.request<ToggleAutomationResponse>(
      `/automation/${key}/pause`,
      {
        method: 'PATCH',
        token: accessToken,
        body: { isPaused },
      },
    );
  },

  getSessions: async (accessToken: string): Promise<GetSessionsResponse> => {
    return apiClient.request<GetSessionsResponse>('/sessions', {
      method: 'GET',
      token: accessToken,
    });
  },

  revokeSession: async (
    accessToken: string,
    sessionId: string,
  ): Promise<RevokeSessionResponse> => {
    return apiClient.request<RevokeSessionResponse>(
      `/sessions/${sessionId}/revoke`,
      {
        method: 'PATCH',
        token: accessToken,
      },
    );
  },
};
