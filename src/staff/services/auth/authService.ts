import {apiClient} from '../api/apiClient';
import {User} from '../../types/auth';

interface LoginResponse {
  success: boolean;
  message: string;
  accessToken: string;
  user: User;
}

export const authService = {
  login: async (
    email: string,
    password: string,
  ): Promise<LoginResponse> => {
    return apiClient.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: {
        email,
        password,
      },
    });
  },
  logout: async (token: string): Promise<void> => {
    await apiClient.request('/auth/logout', {method: 'POST', token});
  },
};
