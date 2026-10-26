import 'dotenv/config';

import mongoose from 'mongoose';

import connectDatabase from '../src/staff/src/config/database';
import User, {USER_ROLES} from '../src/staff/src/models/User';

const runTest = async (): Promise<void> => {
  const testEmail = `user-model-test-${Date.now()}@example.com`;

  try {
    await connectDatabase();

    console.log('Creating test user...');

    const user = await User.create({
      fullName: 'User Model Test',
      email: testEmail,
      phone: '03000000000',
      password: 'temporary-test-password',
      role: USER_ROLES.PRINCIPAL,
      isActive: true,
    });

    console.log('User created:', user.email);

    const foundUser = await User.findOne({email: testEmail});

    if (!foundUser) {
      throw new Error('Test user could not be found');
    }

    console.log('User found:', foundUser.email);
    console.log('Role:', foundUser.role);
    console.log('Active:', foundUser.isActive);

    await User.deleteOne({_id: user._id});

    console.log('Test user deleted successfully');
    console.log('User Model test passed');
  } catch (error) {
    console.error('User Model test failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

runTest();