import {expireSession} from '../../../mobileApp/shared/services/authSession';
import {API_ROOT as API_BASE_URL} from '../../../mobileApp/shared/services/apiConfig';
const DEFAULT_TIMEOUT_MS = 10000;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  timeoutMs?: number;
}

export const apiClient = {
  request: async <T>(
    endpoint: string,
    options: ApiOptions = {},
  ): Promise<T> => {
    const { method = 'GET', body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal as any,
      });

      const data = (await response.json()) as T & { message?: string; error?: string };

      if (response.status === 401 && token) expireSession(`Bearer ${token}`);
      if (!response.ok) {
        throw new ApiError(response.status, data.error || data.message || 'API request failed');
      }

      return data;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Network request timed out. Please check server connection.');
        }
        throw err;
      }
      throw new Error('Network request failed');
    } finally {
      clearTimeout(timeoutId);
    }
  },
};