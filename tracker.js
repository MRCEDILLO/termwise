// Tracker maths: grading scale, columns from the planner, averages and report figures.
// No Firebase or DOM here, so it is tested on its own (tests/tracker.test.js).

// The 6-level standards scale from the Class Tracker spreadsheet. `min` is the lowest
// percentage for that level; a level with no `min` (Insufficient Evidence) is only ever
// typed in by hand and is left out of every average.
export function defaultScale() {
  return [
    { label: 'Insufficient Evidence', short: 'IE', points: 0, min: null },
    { label: 'Well Below Standard', short: 'WBS', points: 1, min: 0 },
    { label: 'Below Standard', short: 'BS', points: 2, min: 40 },
    { label: 'At Standard', short: 'AS', points: 3, min: 55 },
    { label: 'Above Standard', short: 'AbS', points: 4, min: 70 },
    { label: 'Well Above Standard', short: 'WAS', points: 5, min: 85 },
  ];
}

export function emptyTracker() {
  return { scale: defaultScale(), max: {}, extra: [] };
}

// Levels a percentage can land in, lowest first.
const graded = (scale) => scale.filter((g) => g.min !== null && g.min !== undefined && g.min !== '')
  .map((g) => ({ ...g, min: Number(g.min) }))
  .sort((a, b) => a.min - b.min);

// Levels that are typed in by hand (IE) and left out of averages.
export const manualLevels = (scale) => scale.filter((g) => g.min === null || g.min === undefined || g.min === '');

export function gradeFor(scale, pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return null;
  const levels = graded(scale);
  let out = null;
  for (const g of levels) if (pct >= g.min) out = g;
  return out || levels[0] || null;
}

// The level nearest an average number of points (e.g. 3.4 -> At Standard).
export function levelForPoints(scale, pts) {
  if (pts === null || pts === undefined) return null;
  const levels = graded(scale);
  let best = null;
  for (const g of levels) if (!best || Math.abs(g.points - pts) < Math.abs(best.points - pts)) best = g;
  return best;
}

/* ---------- columns ---------- */

// Assessment and homework columns: one per lesson ticked Assessment or Homework, in timeline
// order (with its date once it's on the planner), then the tracker-only columns.
// `placed` maps lesson id -> the scheduled lesson (with .start) from planner.schedule().
export function trackerColumns(lessons, placed, tracker) {
  const cols = { assessment: [], homework: [] };
  for (const l of lessons) {
    const p = placed && placed.get(l.id);
    const date = p && p.start ? p.start.date || '' : '';
    const term = l.term >= 1 && l.term <= 4 ? l.term : null;
    if (l.assessment) cols.assessment.push({ id: `a-${l.id}`, lessonId: l.id, title: l.title, term, date });
    if (l.homework) cols.homework.push({ id: `h-${l.id}`, lessonId: l.id, title: l.title, term, date });
  }
  for (const x of (tracker && tracker.extra) || []) {
    const kind = x.kind === 'homework' ? 'homework' : 'assessment';
    cols[kind].push({ id: x.id, lessonId: null, title: x.title, term: x.term || null, date: x.date || '' });
  }
  for (const list of Object.values(cols)) {
    list.forEach((c) => { c.max = maxFor(tracker, c.id); });
  }
  return cols;
}

export function maxFor(tracker, colId) {
  const m = tracker && tracker.max && Number(tracker.max[colId]);
  return m > 0 ? m : null;
}

// Keeps only the columns in the chosen terms (null = every term). Columns with no term always show.
export function inTerms(cols, terms) {
  if (!terms) return cols;
  return cols.filter((c) => c.term === null || terms.includes(c.term));
}

/* ---------- one result ---------- */

// A stored assessment cell is a number (the score), a manual level's short code (e.g. 'IE'), or missing.
export function parseScore(scale, text) {
  const t = String(text ?? '').trim();
  if (!t) return { value: null };
  const manual = manualLevels(scale).find((g) => g.short.toLowerCase() === t.toLowerCase());
  if (manual) return { value: manual.short };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { error: `Type a mark, or ${manualLevels(scale).map((g) => g.short).join(' or ') || 'leave it blank'}` };
  return { value: Math.round(n * 100) / 100 };
}

// What a cell means: score, percentage and level. `counts` is false for IE and blanks.
export function result(scale, raw, max) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    const g = manualLevels(scale).find((x) => x.short === raw);
    return { score: null, pct: null, grade: g || null, counts: false };
  }
  const pct = max ? Math.round((raw / max) * 1000) / 10 : null;
  return { score: raw, pct, grade: pct === null ? null : gradeFor(scale, pct), counts: pct !== null };
}

/* ---------- summaries ---------- */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// One student's line: every assessment result, average %, average standard and homework completion.
// marks = { a: { colId: raw }, h: { colId: true/false } }
export function studentSummary(scale, cols, marks) {
  const m = marks || {};
  const rows = cols.assessment.map((col) => ({ col, r: result(scale, (m.a || {})[col.id], col.max) }));
  const counted = rows.filter((x) => x.r && x.r.counts);
  const avgPct = round1(mean(counted.map((x) => x.r.pct)));
  const avgPoints = round1(mean(counted.map((x) => x.r.grade.points)));
  const hw = cols.homework.map((col) => ({ col, done: (m.h || {})[col.id] }));
  const marked = hw.filter((x) => x.done === true || x.done === false);
  const done = marked.filter((x) => x.done === true).length;
  return {
    rows,
    avgPct,
    avgPoints,
    avgLevel: levelForPoints(scale, avgPoints),
    homework: hw,
    hwDone: done,
    hwMarked: marked.length,
    hwPct: marked.length ? Math.round((done / marked.length) * 100) : null,
  };
}

// One assessment across the class: average, highest, lowest and median %, plus how many got each level.
export function assessmentSummary(scale, col, students, marksById) {
  const results = students.map((s) => ({ student: s, r: result(scale, ((marksById[s.id] || {}).a || {})[col.id], col.max) }));
  const pcts = results.filter((x) => x.r && x.r.counts).map((x) => x.r.pct);
  const dist = scale.map((g) => ({ grade: g, count: results.filter((x) => x.r && x.r.grade && x.r.grade.short === g.short).length }));
  return {
    col,
    results,
    count: pcts.length,
    entered: results.filter((x) => x.r).length,
    avg: round1(mean(pcts)),
    high: pcts.length ? Math.max(...pcts) : null,
    low: pcts.length ? Math.min(...pcts) : null,
    median: round1(median(pcts)),
    dist,
    bands: bands(pcts),
  };
}

// Scores in 10% bands: 0-9, 10-19 … 90-100 (100% goes in the top band).
export function bands(pcts) {
  const out = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
  for (const p of pcts) out[Math.min(9, Math.max(0, Math.floor(p / 10)))].count++;
  return out;
}

// Homework completion for one task, or the whole class across every task.
export function homeworkSummary(col, students, marksById) {
  let done = 0;
  let marked = 0;
  for (const s of students) {
    const v = ((marksById[s.id] || {}).h || {})[col.id];
    if (v === true || v === false) marked++;
    if (v === true) done++;
  }
  return { col, done, marked, pct: marked ? Math.round((done / marked) * 100) : null };
}

export function classHomework(cols, students, marksById) {
  const per = cols.homework.map((col) => homeworkSummary(col, students, marksById));
  const done = per.reduce((a, x) => a + x.done, 0);
  const marked = per.reduce((a, x) => a + x.marked, 0);
  return { per, done, marked, pct: marked ? Math.round((done / marked) * 100) : null };
}

/* ---------- class list ---------- */

// Names pasted one per line. "First<tab>Last" (two spreadsheet columns) becomes "First Last".
export function parseNames(text) {
  return String(text || '').split(/\r?\n/)
    .map((line) => line.split('\t').map((p) => p.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((n) => n.slice(0, 80));
}

// Sorted by surname (the last word), then the full name.
export function sortStudents(list) {
  const last = (n) => n.trim().split(/\s+/).pop().toLowerCase();
  return [...list].sort((a, b) => last(a.name).localeCompare(last(b.name)) || a.name.localeCompare(b.name));
}

// Checks an edited scale: labels and short codes filled in and unique, points numbers, minimums 0-100,
// and exactly one level starting at 0% so every percentage gets a level.
export function scaleProblem(scale) {
  if (!scale.length) return 'Add at least one level.';
  const shorts = new Set();
  for (const g of scale) {
    if (!g.label.trim() || !g.short.trim()) return 'Every level needs a name and a short code.';
    if (shorts.has(g.short.toLowerCase())) return `Two levels share the short code ${g.short}.`;
    shorts.add(g.short.toLowerCase());
    if (!Number.isFinite(Number(g.points))) return `${g.label} needs a number of points.`;
    if (g.min !== null && (!Number.isFinite(g.min) || g.min < 0 || g.min > 100)) return `${g.label}: the lowest % must be between 0 and 100.`;
  }
  const mins = scale.filter((g) => g.min !== null).map((g) => g.min);
  if (!mins.length) return 'At least one level needs a lowest %.';
  if (!mins.includes(0)) return 'One level must start at 0% so every mark gets a level.';
  if (new Set(mins).size !== mins.length) return 'Two levels start at the same %.';
  return '';
}
