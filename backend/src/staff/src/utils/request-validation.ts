import {Types} from 'mongoose';
import type {Response} from 'express';
import type {BranchScopedRequest} from '../middleware/branch.middleware';

export class RequestContractError extends Error {
  constructor(public readonly status: number, message: string) {super(message);}
}

export const objectBody = (value: unknown, fields: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new RequestContractError(400, 'Request body must be a plain object');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !fields.includes(key))) {
    throw new RequestContractError(400, 'Unsupported request fields');
  }
  return body;
};

export const textField = (value: unknown, name: string, max: number, min = 0): string => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new RequestContractError(400, `Invalid ${name}`);
  }
  return value.trim();
};

export const enumField = <T extends string>(value: unknown, name: string, values: readonly T[]): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new RequestContractError(400, `Invalid ${name}`);
  }
  return value as T;
};

export const objectIdField = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value) || !Types.ObjectId.isValid(value)) {
    throw new RequestContractError(400, `Invalid ${name}`);
  }
  return value.toLowerCase();
};

// Explicit UTC date-only or RFC3339 timestamp; reject Date.parse normalization
// of impossible calendar dates, local-time ambiguity and loosely typed values.
export const dateField = (value: unknown, name: string, allowDateOnly = false): Date => {
  if (typeof value !== 'string') throw new RequestContractError(400, `Invalid ${name}`);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match || (!allowDateOnly && !match[4])) throw new RequestContractError(400, `Invalid ${name}`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (year < 1 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day ||
    (match[4] && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)) ||
    (match[7] && match[7] !== 'Z' && (Number(match[7].slice(1, 3)) > 23 || Number(match[7].slice(4)) > 59))) {
    throw new RequestContractError(400, `Invalid ${name}`);
  }
  const parsed = new Date(match[4] ? value : `${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new RequestContractError(400, `Invalid ${name}`);
  return parsed;
};

export const validDate = (value: unknown, name: string): Date => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RequestContractError(400, `Invalid ${name}`);
  }
  return value;
};

export const writeScope = (req: BranchScopedRequest) => {
  if (!req.user) throw new RequestContractError(401, 'Authentication required');
  if (!req.branchId) throw new RequestContractError(403, 'Branch scope is required');
  return {actorId: req.user.userId, branchId: req.branchId, token: req.headers.authorization?.slice(7)};
};

export const writeFailure = (res: Response, error: unknown): void => {
  res.status(error instanceof RequestContractError ? error.status : 500).json({
    success: false,
    message: error instanceof RequestContractError ? error.message : 'Principal write operation failed',
  });
};
