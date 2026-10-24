import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultScale, gradeFor, levelForPoints, trackerColumns, inTerms, parseScore, result, studentSummary,
  assessmentSummary, bands, median, homeworkSummary, classHomework, parseNames, sortStudents, scaleProblem,
} from '../tracker.js';

const scale = defaultScale();
const lessons = [
  { id: 'l1', title: '1A', term: 1, assessment: false, homework: true },
  { id: 'l2', title: 'Integers test', term: 1, assessment: true, homework: false },
  { id: 'l3', title: 'Fractions test', term: 2, assessment: true, homework: true },
  { id: 'l4', title: 'Spare', term: null, assessment: true },
];
const placed = new Map([['l2', { start: { date: '2027-02-10' } }]]);
const tracker = { max: { 'a-l2': 20, 'a-l3': 0 }, extra: [{ id: 'x1', kind: 'homework', title: 'Holiday task', term: 2 }] };

test('levels come from the percentage; IE is only typed in', () => {
  assert.equal(gradeFor(scale, 0).short, 'WBS');
  assert.equal(gradeFor(scale, 39.9).short, 'WBS');
  assert.equal(gradeFor(scale, 40).short, 'BS');
  assert.equal(gradeFor(scale, 85).short, 'WAS');
  assert.equal(gradeFor(scale, 100).short, 'WAS');
  assert.equal(gradeFor(scale, null), null);
  assert.equal(levelForPoints(scale, 3.4).short, 'AS');
  assert.equal(levelForPoints(scale, 3.6).short, 'AbS');
});

test('lessons ticked Assessment or Homework become columns, in order, with tracker-only ones after', () => {
  const cols = trackerColumns(lessons, placed, tracker);
  assert.deepEqual(cols.assessment.map((c) => c.id), ['a-l2', 'a-l3', 'a-l4']);
  assert.deepEqual(cols.homework.map((c) => c.id), ['h-l1', 'h-l3', 'x1']);
  assert.equal(cols.assessment[0].date, '2027-02-10');
  assert.equal(cols.assessment[0].max, 20);
  assert.equal(cols.assessment[1].max, null, 'a max of 0 means not set');
  assert.deepEqual(inTerms(cols.assessment, [2]).map((c) => c.id), ['a-l3', 'a-l4'], 'a lesson off the planner always shows');
});

test('typed marks: numbers, IE, blanks and nonsense', () => {
  assert.deepEqual(parseScore(scale, ' 17.5 '), { value: 17.5 });
  assert.deepEqual(parseScore(scale, 'ie'), { value: 'IE' });
  assert.deepEqual(parseScore(scale, ''), { value: null });
  assert.ok(parseScore(scale, 'abc').error);
  assert.ok(parseScore(scale, '-3').error);
  assert.deepEqual(result(scale, 15, 20), { score: 15, pct: 75, grade: gradeFor(scale, 75), counts: true });
  assert.equal(result(scale, 'IE', 20).counts, false);
  assert.equal(result(scale, 15, null).counts, false, 'no max, no %');
  assert.equal(result(scale, undefined, 20), null);
});

test('a student summary leaves IE and blanks out of the averages', () => {
  const cols = trackerColumns(lessons, placed, { max: { 'a-l2': 20, 'a-l3': 40, 'a-l4': 10 }, extra: [] });
  const s = studentSummary(scale, cols, { a: { 'a-l2': 15, 'a-l3': 'IE', 'a-l4': 9 }, h: { 'h-l1': true, 'h-l3': false } });
  assert.equal(s.avgPct, 82.5); // 75% and 90%
  assert.equal(s.avgPoints, 4.5); // AbS (4) and WAS (5)
  assert.equal(s.hwDone, 1);
  assert.equal(s.hwMarked, 2);
  assert.equal(s.hwPct, 50);
  assert.equal(studentSummary(scale, cols, undefined).avgPct, null);
});

test('assessment summary: average, median, high, low, levels and 10% bands', () => {
  const col = { id: 'a-l2', max: 20 };
  const students = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id }));
  const marks = { a: { a: { 'a-l2': 20 } }, b: { a: { 'a-l2': 10 } }, c: { a: { 'a-l2': 13 } }, d: { a: { 'a-l2': 'IE' } } };
  const s = assessmentSummary(scale, col, students, marks);
  assert.equal(s.count, 3);
  assert.equal(s.entered, 4);
  assert.equal(s.avg, 71.7);
  assert.equal(s.median, 65);
  assert.equal(s.high, 100);
  assert.equal(s.low, 50);
  assert.equal(s.dist.find((d) => d.grade.short === 'IE').count, 1);
  assert.equal(s.dist.find((d) => d.grade.short === 'WAS').count, 1);
  assert.deepEqual(bands([0, 9.9, 10, 100, 95]).map((b) => b.count), [2, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
  assert.equal(median([3, 1, 2, 4]), 2.5);
  assert.equal(median([]), null);
});

test('homework completion counts only marked boxes', () => {
  const students = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const marks = { a: { h: { h1: true, h2: true } }, b: { h: { h1: false } } };
  assert.deepEqual(homeworkSummary({ id: 'h1' }, students, marks), { col: { id: 'h1' }, done: 1, marked: 2, pct: 50 });
  const all = classHomework({ homework: [{ id: 'h1' }, { id: 'h2' }] }, students, marks);
  assert.equal(all.done, 2);
  assert.equal(all.marked, 3);
  assert.equal(all.pct, 67);
});

test('pasted names: one per line, spreadsheet columns joined, sorted by surname', () => {
  assert.deepEqual(parseNames('Ava\tNguyen\n\n  Leo  Papadopoulos \r\nSam P'), ['Ava Nguyen', 'Leo Papadopoulos', 'Sam P']);
  const sorted = sortStudents([{ name: 'Zed Adams' }, { name: 'Amy Zhou' }, { name: 'Bo Adams' }]).map((s) => s.name);
  assert.deepEqual(sorted, ['Bo Adams', 'Zed Adams', 'Amy Zhou']);
});

test('a grading scale needs one level from 0% and no repeats', () => {
  assert.equal(scaleProblem(scale), '');
  assert.match(scaleProblem(scale.map((g) => (g.short === 'WBS' ? { ...g, min: 5 } : g))), /0%/);
  assert.match(scaleProblem([...scale, { ...scale[3], label: 'Copy' }]), /short code|same %/);
  assert.match(scaleProblem([]), /at least one/);
});
