// What a new class copies from a template. Run with: npm run test:planner
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateCopy, importEvents } from '../template.js';

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

test('importing events adds them to this class with new ids and skips ones already here', () => {
  let n = 0;
  const mine = [{ id: 'a', term: 1, week: 7, day: 1, period: 'All', label: 'Labour Day' }];
  const theirs = [
    { id: 'x', term: 1, week: 7, day: 1, period: 'All', label: '  labour  day ' },
    { id: 'y', term: 2, week: 4, day: 4, period: 'All', label: 'Athletics carnival' },
    { id: 'z', term: 3, week: 6, day: 2, period: 4, label: 'Excursion' },
    { id: 'w', term: 3, week: 6, day: 2, period: 4, label: 'Excursion' },
  ];
  const res = importEvents(mine, theirs, () => `e${++n}`);
  assert.equal(res.added, 2);
  assert.equal(res.skipped, 2, 'the matching Labour Day and the repeated Excursion are skipped');
  assert.deepEqual(res.events, [
    mine[0],
    { id: 'e1', term: 2, week: 4, day: 4, period: 'All', label: 'Athletics carnival' },
    { id: 'e2', term: 3, week: 6, day: 2, period: 4, label: 'Excursion' },
  ]);
  assert.equal(mine.length, 1, "this class's list isn't changed in place");

  const again = importEvents(res.events, theirs, () => `e${++n}`);
  assert.equal(again.added, 0, 'importing the same class twice adds nothing');
  assert.equal(again.events.length, 3);
});

test('events with a different period or label are not treated as duplicates', () => {
  const mine = [{ id: 'a', term: 1, week: 2, day: 3, period: 'All', label: 'Camp' }];
  const res = importEvents(mine, [
    { term: 1, week: 2, day: 3, period: 2, label: 'Camp' },
    { term: 1, week: 2, day: 3, period: 'All', label: 'Assembly' },
  ], () => 'n');
  assert.equal(res.added, 2);
});
