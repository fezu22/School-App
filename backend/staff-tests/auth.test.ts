import 'dotenv/config';

import mongoose from 'mongoose';

import connectDatabase from '../src/staff/src/config/database';
import User, {USER_ROLES} from '../src/staff/src/models/user';
import {
  authenticateUser,
  createUser,
} from '../src/staff/src/services/auth.service';

const runTest = async (): Promise<void> => {
  const testEmail = `auth-test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123';

  try {
    await connectDatabase();

    console.log('Creating authentication test user...');

    const user = await createUser({
      fullName: 'Authentication Test User',
      email: testEmail,
      phone: '03000000000',
      password: testPassword,
      role: USER_ROLES.PRINCIPAL,
    });

    console.log('User created:', user.email);

    if (user.password === testPassword) {
      throw new Error('Password was stored as plain text');
    }

    console.log('Password hashing passed');

    const authenticatedUser = await authenticateUser(
      testEmail,
      testPassword,
    );

    if (authenticatedUser.email !== testEmail) {
      throw new Error('Authenticated user email does not match');
    }

    console.log('Correct password authentication passed');

    try {
      await authenticateUser(testEmail, 'WrongPassword123');

      throw new Error('Wrong password was accepted');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Wrong password was accepted'
      ) {
        throw error;
      }

      console.log('Wrong password rejection passed');
    }

    await User.findByIdAndDelete(user._id);

    console.log('Test user deleted successfully');
    console.log('Authentication test passed');
  } catch (error) {
    console.error('Authentication test failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

runTest();