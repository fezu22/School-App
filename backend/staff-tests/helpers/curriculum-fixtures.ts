import {AcademicPeriod} from '../../src/staff/src/models/academicPeriod';
import {ClassSubject} from '../../src/staff/src/models/classSubject';
import SchoolClass from '../../src/staff/src/models/schoolClass';
import Subject from '../../src/staff/src/models/subject';
import User from '../../src/staff/src/models/user';

// Explicit migration of OWNED TEST FIXTURES ONLY. This is never imported by
// production. Existing regression tests create new work and therefore now seed
// period-backed Classes and intentional curriculum before invoking write APIs.
export async function seedCurriculumFixtures(preservePeriods = false) {
  await ClassSubject.deleteMany({});
  if (!preservePeriods) await AcademicPeriod.deleteMany({});
  await AcademicPeriod.createIndexes(); await ClassSubject.createIndexes();
  const actor = await User.findOne({role: 'super_admin'}).select('_id').lean() ?? await User.findOne().select('_id').lean();
  if (!actor) throw new Error('Curriculum fixtures require a fixture actor');
  for (const row of await SchoolClass.find().lean()) {
    const branchId = String(row.branchId);
    let period = preservePeriods && row.academicPeriodId ? await AcademicPeriod.findById(row.academicPeriodId) : null;
    period ??= await AcademicPeriod.findOne({branchId, code: row.academicYear});
    period ??= await AcademicPeriod.create({branchId, code: row.academicYear, name: 'Fixture year ' + row.academicYear, startDate: '2020-01-01', endDate: '2030-01-01', status: 'active', createdBy: actor._id, updatedBy: actor._id});
    await SchoolClass.collection.updateOne({_id: row._id}, {$set: {academicPeriodId: period._id}});
    for (const subject of await Subject.find({branchId, isActive: true}).lean()) {
      await ClassSubject.create({branchId, academicPeriodId: period._id, classId: row._id, subjectId: subject._id, createdBy: actor._id, updatedBy: actor._id});
    }
  }
}
