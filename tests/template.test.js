// What a new class copies from a template. Run with: npm run test:planner
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateCopy, importEvents, copyToClass } from '../template.js';

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

test('copyToClass: a whole unit becomes a new unit at the end, with its lessons and files', () => {
  let n = 0;
  const out = copyToClass({
    unit: { id: 'u1', name: 'Fractions', order: 0, colour: 4 },
    lessons: [
      { id: 'l1', title: 'Adding', description: 'd', unitId: 'u1', periods: 2, homework: true, term: 2, order: 7, libOrder: 3, openAfter: true },
      { id: 'l2', title: 'Spare', unitId: 'u1', periods: 1, term: null, order: 20 },
    ],
    files: [
      { id: 'f1', lessonId: 'l1', name: 'Answers.pdf', size: 9, type: 'application/pdf', locked: true, unlocked: true, unlockAt: 5 },
      { id: 'f9', lessonId: 'other', name: 'Not mine.pdf', size: 1, type: 'application/pdf' },
    ],
  }, {
    units: [{ id: 'x1', name: 'Fractions', order: 0 }, { id: 'x2', name: 'Algebra', order: 4 }],
    lessons: [{ id: 'y1', term: 1, order: 11, libOrder: 2 }, { id: 'y2', term: null, order: 12 }],
  }, (kind) => `${kind}-${++n}`, { onPlanner: true });

  assert.deepEqual(out.units, [{ id: 'unit-1', name: 'Fractions', order: 5, colour: 4 }], 'always a new unit, even with a same-named one');
  assert.deepEqual(out.lessons.map((l) => [l.id, l.title, l.unitId, l.term, l.order, l.libOrder]), [
    ['lesson-2', 'Adding', 'unit-1', 2, 13, 100013],
    ['lesson-3', 'Spare', 'unit-1', null, 14, 100014],
  ]);
  assert.equal(out.lessons[0].openAfter, true);
  assert.equal(out.lessons[0].homework, true);
  assert.equal(out.lessons[1].openAfter, undefined);
  assert.deepEqual(out.files.map((f) => [f.lessonId, f.name, f.locked, f.unlocked, f.unlockAt]), [['lesson-2', 'Answers.pdf', true, false, null]]);
  assert.equal(out.files[0].from.id, 'f1');
});

test('copyToClass: one lesson joins the same-named unit, and stays off the planner unless asked', () => {
  let n = 0;
  const from = { lessons: [{ id: 'l1', title: 'Adding', unitId: 'u1', periods: 1, term: 3, order: 2 }], files: [], unitName: '  fractions ' };
  const target = { units: [{ id: 'x1', name: 'Fractions', order: 0 }], lessons: [] };
  const a = copyToClass(from, target, (kind) => `${kind}-${++n}`);
  assert.deepEqual(a.units, []);
  assert.deepEqual([a.lessons[0].unitId, a.lessons[0].term, a.lessons[0].order, a.lessons[0].libOrder], ['x1', null, 0, 0]);
  const b = copyToClass({ ...from, unitName: 'Decimals' }, target, (kind) => `${kind}-${++n}`, { onPlanner: true });
  assert.deepEqual([b.lessons[0].unitId, b.lessons[0].term], [null, 3], 'no same-named unit: No unit');
});

test('copyToClass keeps the planner order even when the library order differs', () => {
  let n = 0;
  const out = copyToClass({
    unit: { id: 'u', name: 'U' },
    lessons: [{ id: 'b', title: 'B', term: 1, order: 5 }, { id: 'a', title: 'A', term: 1, order: 2 }],
  }, { units: [], lessons: [] }, (kind) => `${kind}-${++n}`, { onPlanner: true });
  assert.deepEqual(out.lessons.map((l) => [l.title, l.order, l.libOrder]), [['B', 1, 0], ['A', 0, 1]]);
});
