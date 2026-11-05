// What a new class copies from a template. Run with: npm run test:planner
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateCopy } from '../template.js';

test('copies units, lessons, planner placement and files with fresh ids, and nothing else', () => {
  let n = 0;
  const out = templateCopy({
    units: [{ id: 'u1', name: 'Algebra', order: 2, colour: 5, extra: 'x' }],
    lessons: [
      { id: 'l1', title: 'Intro', description: 'Hi', unitId: 'u1', periods: 2, assessment: false, homework: true, term: 2, order: 4, libOrder: 1, notes: 'secret' },
      { id: 'l2', title: 'Spare', unitId: 'gone', periods: 1, term: null, order: 9 },
    ],
    files: [
      { id: 'f1', lessonId: 'l1', name: 'Sheet.pdf', size: 4, type: 'application/pdf', locked: true, unlocked: true, unlockAt: 123 },
      { id: 'f2', lessonId: 'nowhere', name: 'Lost.pdf', size: 4, type: 'application/pdf' },
    ],
  }, (kind) => `${kind}-${++n}`);

  const [u] = out.units;
  assert.deepEqual(u, { id: 'unit-1', name: 'Algebra', order: 2, colour: 5 });
  const [a, b] = out.lessons;
  assert.deepEqual(a, {
    id: 'lesson-2', title: 'Intro', description: 'Hi', unitId: 'unit-1', periods: 2,
    assessment: false, homework: true, term: 2, order: 4, libOrder: 1,
  });
  assert.equal(b.unitId, null, 'a link to a missing unit is dropped');
  assert.equal(b.term, null, 'library-only lessons stay off the planner');
  assert.equal(b.order, 9);
  assert.equal(out.files.length, 1, 'files whose lesson is gone are left behind');
  const { from, ...f } = out.files[0];
  assert.equal(from.id, 'f1');
  assert.deepEqual(f, {
    id: 'file-4', lessonId: 'lesson-2', name: 'Sheet.pdf', size: 4, type: 'application/pdf',
    locked: true, unlocked: false, unlockAt: null,
  });
});
