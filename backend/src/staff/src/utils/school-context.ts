import type {Request} from 'express';
import type {AuthenticatedRequest} from '../middleware/auth.middleware';
import {currentAcademicActor} from '../services/teacher-scope.service';

export async function integratedSchoolContext(req: Request) {
  const {getDatabase} = require('../../../database');
  const {verifiedSchoolDatabase} = require('../../../schoolAccess');
  const {schoolObjectId} = require('../../../schoolDatabase');
  const record = await currentAcademicActor((req as AuthenticatedRequest).user);
  const database = await verifiedSchoolDatabase(getDatabase(), record);
  return {database, schoolId: schoolObjectId(record.schoolId).toHexString() as string};
}
