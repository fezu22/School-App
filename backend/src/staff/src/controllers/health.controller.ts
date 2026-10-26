import {Request, Response} from 'express';
import {getSystemHealth} from '../services/health.service';

export const getSystemHealthController = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const health = await getSystemHealth();

    res.status(200).json({
      success: true,
      message: 'System health fetched successfully',
      data: health,
    });
  } catch (error) {
    console.error('System health error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch system health',
    });
  }
};