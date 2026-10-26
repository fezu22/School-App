import {UserRole} from '../constants/roles';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  branchId?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
}