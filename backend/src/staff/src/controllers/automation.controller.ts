import {Response} from 'express';
import {AuthenticatedRequest} from '../middleware/auth.middleware';
import {
  getAutomations,
  toggleAutomationPause,
} from '../services/automation.service';

export const getAutomationsController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const automations = await getAutomations();

    res.status(200).json({
      success: true,
      message: 'Automations fetched successfully',
      data: {
        automations,
        total: automations.length,
      },
    });
  } catch (error) {
    console.error('Fetch automations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch automations',
    });
  }
};

export const toggleAutomationPauseController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const key = String(req.params.key);
    const {isPaused} = req.body;

    if (!req.user || !req.user.userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    if (typeof isPaused !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Field "isPaused" must be a boolean',
      });
      return;
    }

    const updatedAutomation = await toggleAutomationPause(
      key,
      isPaused,
      req.user.userId,
    );

    res.status(200).json({
      success: true,
      message: `Automation "${updatedAutomation.name}" ${
        isPaused ? 'paused' : 'resumed'
      } successfully`,
      data: updatedAutomation,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to update automation pause state';

    if (message === 'Automation key not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Invalid user ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message,
    });
  }
};
