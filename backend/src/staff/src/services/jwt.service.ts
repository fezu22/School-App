import jwt from 'jsonwebtoken';

import {UserRole} from '../models/user';

export interface JwtPayload {
  userId: string;
  role: UserRole;
}

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not defined');
  }

  return secret;
};

const getJwtExpiresIn = (): jwt.SignOptions['expiresIn'] => {
  return (process.env.JWT_EXPIRES_IN || '1d') as jwt.SignOptions['expiresIn'];
};

export const generateAccessToken = (
  userId: string,
  role: UserRole,
): string => {
  const payload: JwtPayload = {
    userId,
    role,
  };

  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: getJwtExpiresIn(),
  });
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
};