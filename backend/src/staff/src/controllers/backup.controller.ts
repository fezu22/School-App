import {Request, Response} from 'express';

import {getBackupStatus} from '../services/backup.service';

export const getBackupStatusController = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const backupStatus = await getBackupStatus();

    res.status(200).json({
      success: true,
      message: 'Backup status fetched successfully',
      data: backupStatus,
    });
  } catch (error) {
    console.error('Backup status error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch backup status',
    });
  }
};