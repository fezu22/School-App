import { Response } from 'express';

import { BranchScopedRequest } from '../middleware/branch.middleware';
import {objectIdField, RequestContractError, writeFailure, writeScope} from '../utils/request-validation';
import {taskActionBody, taskCreateBody} from '../utils/principal-write.validation';
import {
  createPrincipalTask,
  getBranchPrincipalTasks,
  getPrincipalTaskById,
  processPrincipalTaskAction,
  getEligibleTaskAssignees,
  serializePrincipalTask,
  serializePrincipalTasks,
  canManagePrincipalTasks,
} from '../services/principal-task.service';

export const getPrincipalTasksController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    if (Object.keys(req.query).some(key => !['status', 'priority', 'search', 'branchId'].includes(key))) {
      throw new RequestContractError(400, 'Unsupported task filter');
    }
    const tasks = await getBranchPrincipalTasks(req.branchId, {
      status: req.query.status, priority: req.query.priority, search: req.query.search,
    });
    const data = await serializePrincipalTasks(tasks, req.user!.userId);

    res.status(200).json({
      success: true,
      message: 'Principal tasks fetched successfully',
      canAssign: canManagePrincipalTasks(),
      data,
    });
  } catch (error) {
    if (error instanceof RequestContractError) {writeFailure(res, error); return;}
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to fetch principal tasks';

    if (message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal tasks',
    });
  }
};

export const getPrincipalTaskByIdController = async (
  req: BranchScopedRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.branchId) {
      res.status(403).json({
        success: false,
        message: 'Branch scope is required',
      });
      return;
    }

    const taskIdParam = req.params.taskId;
    const taskId = Array.isArray(taskIdParam) ? taskIdParam[0] : taskIdParam;

    if (!taskId) {
      res.status(400).json({
        success: false,
        message: 'Principal task ID is required',
      });
      return;
    }

    const task = await getPrincipalTaskById(taskId, req.branchId);
    const data = await serializePrincipalTask(task, req.user!.userId);

    res.status(200).json({
      success: true,
      message: 'Principal task fetched successfully',
      data,
    });
  } catch (error) {
    if (error instanceof RequestContractError) {writeFailure(res, error); return;}
    const message =
      error instanceof Error ? error.message : 'Failed to fetch principal task';

    if (message === 'Invalid task ID' || message === 'Invalid branch ID') {
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    if (message === 'Principal task not found') {
      res.status(404).json({
        success: false,
        message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch principal task',
    });
  }
};

export const createPrincipalTaskController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const actor = writeScope(req);
    const input = taskCreateBody(req.body);
    const task = await createPrincipalTask({...actor, ...input});
    const data = await serializePrincipalTask(task, actor.actorId);
    res.status(201).json({success: true, message: 'Principal task created successfully', data});
  } catch (error) {writeFailure(res, error);}
};

export const processPrincipalTaskActionController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const actor = writeScope(req);
    const input = taskActionBody(req.body);
    const taskId = objectIdField(req.params.taskId, 'task ID');
    const task = await processPrincipalTaskAction({...actor, ...input, taskId});
    const data = await serializePrincipalTask(task, actor.actorId);
    res.status(200).json({success: true, message: 'Principal task action completed successfully', data});
  } catch (error) {writeFailure(res, error);}
};

export const getTaskAssigneesController = async (req: BranchScopedRequest, res: Response): Promise<void> => {
  try {
    const {branchId, actorId} = writeScope(req);
    const data = await getEligibleTaskAssignees(branchId, actorId);
    res.status(200).json({success: true, message: 'Task assignees fetched successfully', data});
  } catch (error) {writeFailure(res, error);}
};
