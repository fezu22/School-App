import type {Response} from 'express';
import type {AuthenticatedRequest} from '../middleware/auth.middleware';
import {RequestContractError} from '../utils/request-validation';
import {getTeacherClasses, getTeacherClass} from '../services/teacher-class.service';
import {createTeacherAssignment, revokeTeacherAssignment} from '../services/teacher-assignment.service';
import {getTeacherRoster} from '../services/teacher-roster.service';

const failure = (res: Response, error: unknown) => {
  res.status(error instanceof RequestContractError ? error.status : 500).json({
    success: false, message: error instanceof RequestContractError ? error.message : 'Teacher operation failed',
  });
};

const contract = (req: AuthenticatedRequest, read = false) => {
  if (Object.keys(req.query).length || (read && req.body !== undefined)) {
    throw new RequestContractError(400, 'Unsupported Teacher request fields');
  }
};

export const teacherClasses = async (req: AuthenticatedRequest, res: Response) => {
  try {
    contract(req, true);
    const data = req.params.classId === undefined ? await getTeacherClasses(req.user) : await getTeacherClass(req.user, {
      classId: req.params.classId, sectionId: req.params.sectionId, subjectId: req.params.subjectId,
    });
    res.json({success: true, data});
  } catch (error) {failure(res, error);}
};

export const teacherRoster = async (req: AuthenticatedRequest, res: Response) => {
  try {
    contract(req, true);
    const data = await getTeacherRoster(req.user, {
      classId: req.params.classId, sectionId: req.params.sectionId, subjectId: req.params.subjectId,
    });
    res.json({success: true, data});
  } catch (error) {failure(res, error);}
};

export const createAssignment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    contract(req);
    const data = await createTeacherAssignment(req.user, req.body);
    res.status(201).json({success: true, data});
  } catch (error) {failure(res, error);}
};

export const revokeAssignment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    contract(req);
    const data = await revokeTeacherAssignment(req.user, req.params.assignmentId, req.body);
    res.json({success: true, data});
  } catch (error) {failure(res, error);}
};
