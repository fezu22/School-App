import { Types } from 'mongoose';
import Automation, { IAutomation } from '../models/automation';

export const getAutomations = async (): Promise<IAutomation[]> => {
  return Automation.find().sort({ createdAt: 1 });
};

export const toggleAutomationPause = async (
  key: string,
  isPaused: boolean,
  userId: string,
): Promise<IAutomation> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error('Invalid user ID');
  }

  const automation = await Automation.findOne({ key });
  if (!automation) throw new Error('Automation key not found');

  automation.isPaused = isPaused;
  automation.pausedBy = isPaused ? new Types.ObjectId(userId) : undefined;
  automation.pausedAt = isPaused ? new Date() : undefined;

  await automation.save();

  return automation;
};
