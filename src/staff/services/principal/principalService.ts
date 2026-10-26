import { apiClient } from '../api/apiClient';

export interface PrincipalRequester {
  _id: string;
  fullName: string;
  email: string;
  role: string;
  branchId?: string;
}

export type ApprovalAction = 'approved' | 'rejected' | 'changes_requested';

export interface EligibleDelegate {
  _id: string;
  fullName: string;
}

export interface DelegationInput {
  delegatedTo: string;
  delegationExpiresAt: string;
}

export interface ApprovalHistoryEntry {
  _id?: string;
  action: ApprovalAction | 'delegated' | 'resubmitted';
  performedBy: string | PrincipalRequester;
  reason?: string;
  createdAt: string;
  authority?: 'direct' | 'delegated';
  delegatedBy?: string | PrincipalRequester;
}

export interface ApprovalRequest {
  staffLeave?: {leaveType: string; startDate: string; endDate: string; days: number};
  _id: string;
  requesterId: PrincipalRequester | string;
  entityType: string;
  entityId?: string;
  approvalType: string;
  amount?: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  reviewedBy?: string | PrincipalRequester;
  reviewedAt?: string;
  delegatedTo?: string | PrincipalRequester;
  delegatedBy?: string | PrincipalRequester;
  delegationExpiresAt?: string;
  capabilities?: { canReview: boolean; canDelegate: boolean };
  history: ApprovalHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SchoolNotice {
  _id: string;
  title: string;
  message: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'published';
  publishedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface PendingApprovalData {
  requests: ApprovalRequest[];
  total: number;
}

export interface PrincipalDashboardData {
  tasks: Array<{ status: TaskStatus }>;
  branch: {
    id: string;
    name: string;
    code: string;
    city: string;
    isActive: boolean;
  };
  students: { total: number; active: number };
  attendance: {
    totalMarked: number;
    present: number;
    absent: number;
    late: number;
    leave: number;
    attendancePercentage: number;
  };
  feeSummary: {
    totalInvoices: number;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    pendingInvoices: number;
    partialInvoices: number;
    paidInvoices: number;
    overdueInvoices: number;
  };
  safetyAlerts: {
    total: number;
    open: number;
    inProgress: number;
    critical: number;
    high: number;
    byType: Record<string, number>;
  };
  notices: SchoolNotice[];
  pendingApprovals: {
    total: number;
    byType: Record<string, number>;
  };
}

export interface PrincipalApiResult<T> {
  data: T;
  message: string;
}

export const principalService = {
  getSafetyAlerts: async (token: string, filters: SafetyFilters = {}) => {
    const { status, severity, type } = filters;
    const query = Object.entries({ status, severity, type })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
      .join('&');
    const response = await apiClient.request<ApiEnvelope<SafetyAlert[]>>(
      `/principal/safety-alerts${query ? `?${query}` : ''}`,
      { token },
    );
    return { data: response.data, message: response.message };
  },
  getSafetyAlert: async (token: string, alertId: string) => {
    const response = await apiClient.request<ApiEnvelope<SafetyAlert>>(
      `/principal/safety-alerts/${alertId}`,
      { token },
    );
    return { data: response.data, message: response.message };
  },
  getSafetyOfficers: async (token: string, alertId: string) => {
    const response = await apiClient.request<ApiEnvelope<TaskUser[]>>(
      `/principal/safety-alerts/${alertId}/eligible-officers`,
      { token },
    );
    return { data: response.data, message: response.message };
  },
  processSafetyAlert: async (
    token: string,
    alertId: string,
    action: SafetyAction,
    assignedTo?: string,
  ) => {
    const response = await apiClient.request<
      ApiEnvelope<null> & { alert: SafetyAlert }
    >(`/principal/safety-alerts/${alertId}`, {
      method: 'PATCH',
      token,
      body: { action, ...(action === 'assign' ? { assignedTo } : {}) },
    });
    return { data: response.alert, message: response.message };
  },
  getTasks: async (token: string, filters: TaskFilters = {}) => {
    const { status, priority, search } = filters;
    const query = Object.entries({ status, priority, search })
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
      .join('&');
    const response = await apiClient.request<
      ApiEnvelope<PrincipalTask[]> & { canAssign: boolean }
    >(`/principal/tasks${query ? `?${query}` : ''}`, { token });
    return {
      data: response.data,
      message: response.message,
      canAssign: response.canAssign === true,
    };
  },

  getTask: async (token: string, taskId: string) => {
    const response = await apiClient.request<ApiEnvelope<PrincipalTask>>(
      `/principal/tasks/${taskId}`,
      { token },
    );
    return { data: response.data, message: response.message };
  },

  getTaskAssignees: async (token: string) => {
    const response = await apiClient.request<ApiEnvelope<TaskUser[]>>(
      '/principal/task-assignees',
      { token },
    );
    return { data: response.data, message: response.message };
  },

  createTask: async (token: string, input: CreateTaskInput) => {
    // Explicit contract: never forward actor, branch, status or audit metadata.
    const { title, assignedTo, description, priority, dueDate } = input;
    const response = await apiClient.request<ApiEnvelope<PrincipalTask>>(
      '/principal/tasks',
      {
        method: 'POST',
        token,
        body: {
          title,
          assignedTo,
          ...(description !== undefined ? { description } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(dueDate !== undefined ? { dueDate } : {}),
        },
      },
    );
    return { data: response.data, message: response.message };
  },

  processTask: async (token: string, taskId: string, action: TaskAction) => {
    const response = await apiClient.request<ApiEnvelope<PrincipalTask>>(
      `/principal/tasks/${taskId}`,
      {
        method: 'PATCH',
        token,
        body: { action },
      },
    );
    return { data: response.data, message: response.message };
  },
  getDashboard: async (token: string) => {
    const response = await apiClient.request<
      ApiEnvelope<PrincipalDashboardData>
    >('/principal/dashboard', { token });
    return { data: response.data, message: response.message };
  },

  getPendingApprovals: async (token: string) => {
    const response = await apiClient.request<ApiEnvelope<PendingApprovalData>>(
      '/approval-requests/pending',
      { token },
    );
    return { data: response.data, message: response.message };
  },

  getApprovalById: async (token: string, requestId: string) => {
    const response = await apiClient.request<ApiEnvelope<ApprovalRequest>>(
      `/approval-requests/${requestId}`,
      { token },
    );
    return { data: response.data, message: response.message };
  },

  processApproval: async (
    token: string,
    requestId: string,
    action: ApprovalAction | 'delegated',
    reason?: string,
    delegation?: DelegationInput,
  ) => {
    const response = await apiClient.request<
      ApiEnvelope<{ request: ApprovalRequest }>
    >(`/approval-requests/${requestId}`, {
      method: 'PATCH',
      token,
      body: { action, ...(reason ? { reason } : {}), ...delegation },
    });
    return { data: response.data.request, message: response.message };
  },

  getEligibleDelegates: async (token: string, requestId: string) => {
    const response = await apiClient.request<ApiEnvelope<EligibleDelegate[]>>(
      `/approval-requests/${requestId}/eligible-delegates`,
      { token },
    );
    return { data: response.data, message: response.message };
  },

  getNotices: async (token: string) => {
    const response = await apiClient.request<ApiEnvelope<SchoolNotice[]>>(
      '/principal/notices',
      { token },
    );
    return { data: response.data, message: response.message };
  },

  getNotice: async (token: string, noticeId: string) => {
    const response = await apiClient.request<ApiEnvelope<SchoolNotice>>(
      `/principal/notices/${noticeId}`,
      { token },
    );
    return { data: response.data, message: response.message };
  },
};

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type SafetyType =
  | 'missing_attendance'
  | 'substitute_gap'
  | 'bus_exception'
  | 'gate_exception'
  | 'incident'
  | 'helpdesk'
  | 'backup_failure';
export type SafetyStatus = 'open' | 'in_progress' | 'resolved';
export type SafetySeverity = 'low' | 'medium' | 'high' | 'critical';
export type SafetyAction = 'assign' | 'resolve' | 'escalate';
export interface SafetyFilters {
  status?: SafetyStatus;
  severity?: SafetySeverity;
  type?: SafetyType;
}
export interface SafetyIdentity {
  id: string;
  fullName: string;
  role: string;
}
export interface SafetyAlert {
  id: string;
  type: SafetyType;
  title: string;
  description?: string;
  severity: SafetySeverity;
  status: SafetyStatus;
  assignedTo: SafetyIdentity | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  history?: Array<{
    _id?: string;
    action: SafetyAction;
    createdAt: string;
    performer: SafetyIdentity | null;
    assignedOfficer: SafetyIdentity | null;
  }>;
  capabilities: { allowedActions: SafetyAction[]; canViewDetail: boolean };
}
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskAction = 'start' | 'complete' | 'cancel';
export interface TaskUser {
  _id: string;
  fullName: string;
  role: string;
}
export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  search?: string;
}
export interface CreateTaskInput {
  title: string;
  assignedTo: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
}
export interface PrincipalTask {
  _id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: TaskUser | null;
  creator: TaskUser | null;
  dueDate?: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{
    action: TaskAction;
    performer: TaskUser | null;
    createdAt: string;
  }>;
  capabilities: { allowedActions: TaskAction[] };
}
