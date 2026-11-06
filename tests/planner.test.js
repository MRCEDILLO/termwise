import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule, emptyPlan, currentWeek, cellText, isAssessmentLike, isRevisionLike, lessonKind, termMonday, slotDate, daySessions, homeworkDue,
} from '../planner.js';

// Mon P1, Wed P3, Fri P5: 3 meetings a week.
function basePlan(weeks = [2, 0, 0, 0]) {
  const plan = emptyPlan();
  plan.terms = weeks.map((w, i) => ({ start: i === 0 ? '2027-01-27' : '', weeks: w }));
  plan.pattern = ['1-1', '3-3', '5-5'];
  return plan;
}
const L = (title, periods, extra = {}) => ({ id: title, title, periods, ...extra });

test('lessons fill free periods in order', () => {
  const r = schedule(basePlan(), [L('1A', 2), L('1B', 1), L('1C', 2)]);
  assert.equal(r.available, 6);
  assert.equal(r.required, 5);
  assert.equal(r.spare, 1);
  assert.equal(r.fits, true);
  const names = r.slots.map((s) => cellText(s, r.lessons));
  assert.deepEqual(names, ['1A (1/2)', '1A (2/2)', '1B', '1C (1/2)', '1C (2/2)', '']);
  assert.equal(r.lessons[2].start.week, 2);
  assert.equal(r.perTerm[0].finishes.week, 2);
  assert.equal(r.perTerm[0].finishes.day, 3);
});

test('0 periods skips a lesson, blank and junk count as 0', () => {
  const r = schedule(basePlan(), [L('A', 1), L('B', 0), L('C', ''), L('D', 'x'), L('E', 1)]);
  assert.deepEqual(r.lessons.map((l) => l.status), ['scheduled', 'skipped', 'skipped', 'skipped', 'scheduled']);
  assert.equal(r.slots[1].lessonIndex, 4);
});

test('stretching one lesson shifts every later lesson', () => {
  const before = schedule(basePlan(), [L('A', 1), L('B', 1), L('C', 1)]);
  const after = schedule(basePlan(), [L('A', 2), L('B', 1), L('C', 1)]);
  assert.equal(before.lessons[2].start.day, 5);
  assert.equal(after.lessons[2].start.week, 2);
  assert.equal(after.lessons[2].start.day, 1);
});

test('events block a period, a day or a week and lessons flow around them', () => {
  const plan = basePlan([3, 0, 0, 0]);
  plan.events = [
    { term: 1, week: 1, day: 3, period: 3, label: 'Excursion' },
    { term: 1, week: 2, day: 'All', period: 'All', label: 'Camp' },
    { term: 1, week: 3, day: 1, period: 'All', label: 'Public holiday' },
    { term: 1, week: 3, day: 2, period: 'All', label: 'Not a class day' },
  ];
  const r = schedule(plan, [L('A', 1), L('B', 1), L('C', 1)]);
  assert.equal(r.available, 9 - 1 - 3 - 1);
  const blocked = r.slots.filter((s) => s.blocked).map((s) => `${s.week}-${s.day}`);
  assert.deepEqual(blocked, ['1-3', '2-1', '2-3', '2-5', '3-1']);
  assert.deepEqual(r.lessons.map((l) => `${l.start.week}-${l.start.day}`), ['1-1', '1-5', '3-3']);
  assert.equal(cellText(r.slots[1], r.lessons), 'Cancelled: Excursion');
});

test('red banner numbers: short by, no room and over term', () => {
  const r = schedule(basePlan([1, 0, 0, 0]), [L('A', 2), L('B', 2), L('C', 1)]);
  assert.equal(r.available, 3);
  assert.equal(r.required, 5);
  assert.equal(r.fits, false);
  assert.equal(r.spare, -2);
  assert.deepEqual(r.lessons.map((l) => l.status), ['scheduled', 'overterm', 'noroom']);
  assert.equal(r.perTerm[0].finishes.day, 5);
  assert.equal(r.perTerm[0].spare, -2);
});

test('each term schedules only its own lessons', () => {
  const plan = basePlan([1, 1, 0, 0]);
  plan.terms[1].start = '2027-04-19';
  const r = schedule(plan, [
    L('T2 first', 1, { term: 2 }), L('T1 A', 2), L('T1 B', 2, { term: 1 }), L('T2 second', 1, { term: 2 }),
  ]);
  const names = r.slots.map((s) => cellText(s, r.lessons));
  assert.deepEqual(names, ['T1 A (1/2)', 'T1 A (2/2)', 'T1 B (1/2)', 'T2 first', 'T2 second', '']);
  // T1 B doesn't fit in Term 1, and does not spill into Term 2.
  assert.equal(r.lessons[2].status, 'overterm');
  assert.equal(r.lessons[2].end.term, 1);
  assert.equal(r.lessons[3].start.date, '2027-04-21');
  assert.deepEqual(r.perTerm.map((t) => [t.required, t.available, t.fits]), [[4, 3, false], [2, 3, true], [0, 0, true], [0, 0, true]]);
  assert.equal(r.fits, false);
});

test('a lesson with no term, or a bad one, counts as Term 1', () => {
  const plan = basePlan([1, 1, 0, 0]);
  const r = schedule(plan, [L('A', 1, { term: 7 }), L('B', 1, { term: '' })]);
  assert.deepEqual(r.lessons.map((l) => l.start.term), [1, 1]);
});

test('reordering lessons reorders the timetable', () => {
  const r = schedule(basePlan(), [L('B', 1), L('A', 1)]);
  assert.equal(cellText(r.slots[0], r.lessons), 'B');
});

test('dates come from the Monday of the start week', () => {
  const term = { start: '2027-01-27', weeks: 10 }; // a Wednesday
  assert.equal(new Date(termMonday(term)).toISOString().slice(0, 10), '2027-01-25');
  assert.equal(slotDate(term, 2, 5), '2027-02-05');
  assert.equal(slotDate({ start: '', weeks: 3 }, 1, 1), null);
});

test('weeks are capped at 20 and the pattern ignores bad keys', () => {
  const plan = basePlan([25, 0, 0, 0]);
  plan.pattern.push('6-1', '1-7', 'nope');
  const r = schedule(plan, []);
  assert.equal(r.meetingsPerWeek, 3);
  assert.equal(r.available, 60);
  assert.equal(r.perTerm[0].finishes, null);
});

test('auto-tint words match the spreadsheet', () => {
  for (const t of ['Unit test', 'Exam prep', 'Quiz 2', 'SAC Assessment']) {
    assert.equal(isAssessmentLike({ title: t }), true, t);
  }
  assert.equal(isAssessmentLike({ title: 'Fractions' }), false);
  assert.equal(isAssessmentLike({ title: 'Fractions', assessment: true }), true);
});

test('revision and review lessons are their own kind, not assessments', () => {
  for (const t of ['Revision', 'Review', 'Test revision', 'Exam review', 'Unit 3 REVIEW']) {
    assert.equal(lessonKind({ title: t }), 'revise', t);
    assert.equal(isRevisionLike({ title: t }), true, t);
    assert.equal(isAssessmentLike({ title: t }), false, t);
  }
  // Ticking Assessment still makes it an assessment.
  assert.equal(lessonKind({ title: 'Revision', assessment: true }), 'assess');
  assert.equal(lessonKind({ title: 'Fractions' }), '');
});

test('current week from today\'s date', () => {
  const plan = basePlan([2, 2, 0, 0]);
  plan.terms[1].start = '2027-04-19';
  const cw = (d) => currentWeek(plan, d);
  assert.deepEqual(cw('2027-01-10'), { term: 1, week: 1, state: 'holidays' }); // before Term 1
  assert.deepEqual(cw('2027-02-03'), { term: 1, week: 2, state: 'week' });
  assert.deepEqual(cw('2027-01-30'), { term: 1, week: 2, state: 'weekend' }); // Saturday after week 1
  assert.deepEqual(cw('2027-02-06'), { term: 2, week: 1, state: 'holidays' }); // Saturday after the last week
  assert.deepEqual(cw('2027-03-15'), { term: 2, week: 1, state: 'holidays' });
  assert.deepEqual(cw('2027-04-18'), { term: 2, week: 1, state: 'holidays' });
  assert.deepEqual(cw('2027-04-19'), { term: 2, week: 1, state: 'week' });
  assert.deepEqual(cw('2027-12-01'), { term: 2, week: 2, state: 'ended' });
  assert.equal(currentWeek(emptyPlanNoDates(), '2027-02-03'), null);
});

function emptyPlanNoDates() {
  const p = emptyPlan();
  p.terms = p.terms.map(() => ({ start: '', weeks: 10 }));
  return p;
}

test('daySessions lists one day in period order, joining back-to-back periods', () => {
  const plan = emptyPlan();
  plan.terms = [{ start: '2027-02-01', weeks: 2 }, { start: '', weeks: 0 }, { start: '', weeks: 0 }, { start: '', weeks: 0 }];
  plan.pattern = ['1-2', '1-3', '1-5', '2-1', '2-4', '2-5'];
  plan.events = [{ id: 'e', term: 1, week: 1, day: 2, period: 'All', label: 'Camp' }];
  const r = schedule(plan, [L('A', 3), L('B', 2)]);
  // Monday 1 Feb: A takes P2–3 and P5.
  assert.deepEqual(daySessions(r, '2027-02-01').map((s) => [s.from, s.to, s.lesson && s.lesson.title]), [[2, 3, 'A'], [5, 5, 'A']]);
  // Tuesday 2 Feb: camp all day; P4 and P5 run together.
  assert.deepEqual(daySessions(r, '2027-02-02').map((s) => [s.from, s.to, s.blocked, s.label]), [[1, 1, true, 'Camp'], [4, 5, true, 'Camp']]);
  // Monday 8 Feb: B for two periods, then nothing left to teach.
  assert.deepEqual(daySessions(r, '2027-02-08').map((s) => [s.from, s.to, s.lesson.title]), [[2, 3, 'B']]);
  assert.deepEqual(daySessions(r, '2027-02-06'), [], 'a Saturday has nothing');
  assert.deepEqual(daySessions(null, '2027-02-01'), []);
});

test('homeworkDue: due at the next lesson after the homework lesson, soonest first, past ones dropped', () => {
  const plan = emptyPlan();
  plan.terms = [{ start: '2027-02-01', weeks: 3 }, { start: '', weeks: 0 }, { start: '', weeks: 0 }, { start: '', weeks: 0 }];
  plan.pattern = ['1-1', '3-1']; // Mon and Wed
  plan.events = [{ id: 'e', term: 1, week: 2, day: 1, period: 'All', label: 'Holiday' }];
  const r = schedule(plan, [
    L('A', 1, { homework: true }), // Mon 1 Feb, due Wed 3 Feb
    L('B', 1), // Wed 3 Feb
    L('C', 1, { homework: true }), // Wed 10 Feb (Mon 8 Feb is a holiday), due Mon 15 Feb
    L('D', 2, { homework: true }), // Mon 15 + Wed 17 Feb: the last lessons, so no next lesson this term
  ]);
  const at = (today, opts) => homeworkDue(r, today, opts).map((h) => [h.lesson.title, h.set, h.due]);
  assert.deepEqual(at('2027-02-01'), [['A', '2027-02-01', '2027-02-03'], ['C', '2027-02-10', '2027-02-15']]);
  assert.deepEqual(at('2027-02-04'), [['C', '2027-02-10', '2027-02-15'], ['D', '2027-02-17', null]], 'A is past');
  assert.deepEqual(at('2027-02-01', { aheadDays: 3 }), [['A', '2027-02-01', '2027-02-03']], 'far-off homework waits');
  assert.deepEqual(at('2027-02-20'), [], 'nothing left: D, with no due date, drops once set day passes');
});
