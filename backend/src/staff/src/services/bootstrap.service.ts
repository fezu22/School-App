import User, { SUPER_ADMIN_BOOTSTRAP_INDEX, USER_ROLES } from '../models/user';
import { createUser } from './auth.service';

export class BootstrapError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const validateInput = (body: unknown) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BootstrapError(400, 'Invalid bootstrap request');
  }
  const input = body as Record<string, unknown>;
  const allowedFields = ['fullName', 'email', 'password', 'phone'];
  if (Object.keys(input).some(key => !allowedFields.includes(key))) {
    throw new BootstrapError(400, 'Unsupported bootstrap fields');
  }
  const { fullName, email, password, phone } = input;
  if (
    typeof fullName !== 'string' ||
    fullName.trim().length < 2 ||
    fullName.trim().length > 100
  ) {
    throw new BootstrapError(400, 'Full name must contain 2 to 100 characters');
  }
  if (
    typeof email !== 'string' ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    throw new BootstrapError(400, 'A valid email is required');
  }
  // bcrypt only uses the first 72 bytes; reject rather than truncate passwords.
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.trim().length < 12 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new BootstrapError(
      400,
      'Password must contain at least 12 characters and at most 72 bytes',
    );
  }
  if (
    phone !== undefined &&
    (typeof phone !== 'string' || phone.trim().length > 30)
  ) {
    throw new BootstrapError(400, 'Invalid phone number');
  }
  return {
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    password,
    ...(typeof phone === 'string' ? { phone: phone.trim() } : {}),
  };
};

export const provisionBootstrapSuperAdmin = async (body: unknown) => {
  // Await the database invariant even when production disables Mongoose autoIndex.
  // Failure to create/verify the index must fail closed before account creation.
  await User.collection.createIndex(
    { bootstrapKey: 1 },
    SUPER_ADMIN_BOOTSTRAP_INDEX,
  );
  if (await User.exists({ role: USER_ROLES.SUPER_ADMIN })) {
    throw new BootstrapError(409, 'Super Admin bootstrap is unavailable');
  }
  const input = validateInput(body);
  try {
    return await createUser(
      { ...input, role: USER_ROLES.SUPER_ADMIN },
      { bootstrap: true },
    );
  } catch (error: unknown) {
    if (
      (error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000) ||
      (error instanceof Error &&
        error.message === 'User with this email already exists')
    ) {
      throw new BootstrapError(
        409,
        'Bootstrap request conflicts with existing records',
      );
    }
    throw error;
  }
};
