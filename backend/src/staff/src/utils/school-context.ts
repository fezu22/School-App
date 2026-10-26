import type {Request} from 'express';

export async function integratedSchoolContext(req: Request) {
  const {getDatabase} = require('../../../database');
  const {verifiedSchoolDatabase} = require('../../../schoolAccess');
  const {schoolObjectId} = require('../../../schoolDatabase');
  const record = (req as any).authenticatedUserRecord;
  const database = await verifiedSchoolDatabase(getDatabase(), record);
  return {database, schoolId: schoolObjectId(record.schoolId).toHexString() as string};
}
