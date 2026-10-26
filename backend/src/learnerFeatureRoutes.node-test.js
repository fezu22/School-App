const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('./learnerFeatureRoutes');

test('learner publication scope stays inside branch and assigned audience', () => {
  const filter = __test.audience({ id: 'stu-1', branchId: 'branch-1', classId: 'class-1' });
  assert.equal(filter.branchId, 'branch-1');
  assert.deepEqual(filter.$and[1].$or, [
    { studentId: 'stu-1' },
    { studentIds: 'stu-1' },
    { classId: 'class-1' },
    { audience: 'all' },
  ]);
});

test('quiz reads remove answer material and scoring stays server-side', () => {
  const quiz = {
    id: 'quiz-1',
    questions: [{ id: 'q1', prompt: '2 + 2', options: ['3', '4'], correctOptionId: '4', explanation: 'Addition' }],
  };
  const safe = __test.safeQuiz(quiz);
  assert.equal(safe.questions[0].correctOptionId, undefined);
  assert.equal(safe.questions[0].explanation, undefined);
  assert.deepEqual(__test.scoreQuiz(quiz, { q1: '4' }), { score: 1, total: 1 });
  assert.deepEqual(__test.scoreQuiz(quiz, { q1: '3' }), { score: 0, total: 1 });
});
