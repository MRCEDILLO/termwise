// Termwise planner engine: the Term Planner spreadsheet's rules as plain functions.
// No Firebase and no DOM here, so it runs the same in the browser and in node --test.
//
// Inputs (stored in Firestore):
//   plan = {
//     terms:   [{ start: 'YYYY-MM-DD' | '', weeks: 0..20 }, ... 4 terms],
//     pattern: ['1-2', '3-5', ...]   // 'day-period' strings, day 1..5 (Mon..Fri), period 1..6
//     events:  [{ id, term: 1..4, week: 1..20, day: 'All' | 1..5, period: 'All' | 1..6, label }]
//   }
//   lessons = [{ id, title, periods, assessment, homework }, ...] in teaching order
//
// Lessons fill the free class periods in order and run on from one term into the next.

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const PERIODS_PER_DAY = 6;
export const MAX_WEEKS = 20;
export const TERM_COUNT = 4;

const ASSESSMENT_WORDS = /assessment|exam|test|quiz|revision|review/i;

/* ---------- small helpers ---------- */

export function emptyPlan() {
  return {
    terms: Array.from({ length: TERM_COUNT }, () => ({ start: '', weeks: 10 })),
    pattern: [],
    events: [],
  };
}

// Same rule as the spreadsheet's red tint, plus the lesson's own assessment flag.
export function isAssessmentLike(lesson) {
  return !!(lesson && (lesson.assessment || ASSESSMENT_WORDS.test(lesson.title || '')));
}

// Periods a lesson takes. Blank, negative or non-numbers count as 0 (skipped).
export function effectivePeriods(lesson) {
  const n = Math.floor(Number(lesson && lesson.periods));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function clampWeeks(n) {
  const w = Math.floor(Number(n));
  if (!Number.isFinite(w) || w < 0) return 0;
  return Math.min(w, MAX_WEEKS);
}

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : t;
}

function toISO(t) {
  return new Date(t).toISOString().slice(0, 10);
}

const DAY_MS = 86400000;

// Monday of the week containing the term start date (the spreadsheet's TermMonday).
export function termMonday(term) {
  const t = parseISO(term && term.start);
  if (t === null) return null;
  const dow = new Date(t).getUTCDay(); // 0 Sun .. 6 Sat
  const back = dow === 0 ? 6 : dow - 1;
  return t - back * DAY_MS;
}

export function slotDate(term, week, day) {
  const mon = termMonday(term);
  if (mon === null) return null;
  return toISO(mon + ((week - 1) * 7 + (day - 1)) * DAY_MS);
}

export function weekRange(term, week) {
  const mon = termMonday(term);
  if (mon === null) return null;
  const start = mon + (week - 1) * 7 * DAY_MS;
  return { from: toISO(start), to: toISO(start + 4 * DAY_MS) };
}

export function patternSet(pattern) {
  return new Set((pattern || []).filter((k) => /^[1-5]-[1-6]$/.test(k)));
}

// The class's meeting periods in a week, in timetable column order (Mon P1, Mon P2, ... Fri P6).
export function meetingColumns(pattern) {
  const set = patternSet(pattern);
  const cols = [];
  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= PERIODS_PER_DAY; period++) {
      if (set.has(`${day}-${period}`)) cols.push({ day, period });
    }
  }
  return cols;
}

function eventMatches(ev, term, week, day, period) {
  return Number(ev.term) === term &&
    Number(ev.week) === week &&
    (ev.day === 'All' || Number(ev.day) === day) &&
    (ev.period === 'All' || Number(ev.period) === period);
}

/* ---------- the engine ---------- */

export function schedule(plan, lessons) {
  plan = plan || emptyPlan();
  lessons = lessons || [];
  const cols = meetingColumns(plan.pattern);
  const events = plan.events || [];
  const terms = (plan.terms || []).slice(0, TERM_COUNT);

  // 1. Every meeting period of the year, in order, with blocked ones marked.
  const slots = [];
  terms.forEach((term, ti) => {
    const termNo = ti + 1;
    const weeks = clampWeeks(term && term.weeks);
    for (let week = 1; week <= weeks; week++) {
      for (const { day, period } of cols) {
        const ev = events.find((e) => eventMatches(e, termNo, week, day, period));
        slots.push({
          term: termNo, week, day, period,
          date: slotDate(term, week, day),
          blocked: !!ev,
          label: ev ? (ev.label || '') : '',
          lessonIndex: null, part: 0, of: 0,
        });
      }
    }
  });

  // 2. Cumulative lesson positions (the spreadsheet's start / cum columns).
  let cum = 0;
  const out = lessons.map((lesson, index) => {
    const eff = effectivePeriods(lesson);
    const startAt = cum + 1;
    cum += eff;
    return { ...lesson, index, effective: eff, startAt, endAt: cum, slots: [] };
  });
  const required = cum;

  // 3. Fill free periods in order.
  const free = slots.filter((s) => !s.blocked);
  const available = free.length;
  let li = 0;
  free.forEach((slot, i) => {
    const n = i + 1;
    if (n > required) return;
    while (li < out.length && out[li].endAt < n) li++;
    const lesson = out[li];
    slot.lessonIndex = li;
    slot.part = n - lesson.startAt + 1;
    slot.of = lesson.effective;
    lesson.slots.push(slot);
  });

  for (const lesson of out) {
    if (lesson.effective === 0) lesson.status = 'skipped';
    else if (lesson.startAt > available) lesson.status = 'noroom';
    else if (lesson.endAt > available) lesson.status = 'overterm';
    else lesson.status = 'scheduled';
    lesson.start = lesson.slots[0] || null;
    lesson.end = lesson.slots[lesson.slots.length - 1] || null;
  }

  const finishes = required > 0 && available > 0 ? free[Math.min(required, available) - 1] : null;

  const perTerm = terms.map((term, ti) => {
    const mine = slots.filter((s) => s.term === ti + 1);
    return {
      term: ti + 1,
      weeks: clampWeeks(term && term.weeks),
      available: mine.filter((s) => !s.blocked).length,
      blocked: mine.filter((s) => s.blocked).length,
      used: mine.filter((s) => s.lessonIndex !== null).length,
    };
  });

  return {
    columns: cols,
    meetingsPerWeek: cols.length,
    slots,
    lessons: out,
    available,
    required,
    spare: available - required,
    fits: required <= available,
    finishes,
    perTerm,
  };
}

/* ---------- reading the result ---------- */

// The term and week a date falls in, or the next one coming up, or the last one.
export function currentWeek(plan, todayISO) {
  const today = parseISO(todayISO);
  const weeks = [];
  (plan.terms || []).slice(0, TERM_COUNT).forEach((term, ti) => {
    const n = clampWeeks(term.weeks);
    for (let w = 1; w <= n; w++) {
      const r = weekRange(term, w);
      if (r) weeks.push({ term: ti + 1, week: w, from: parseISO(r.from), to: parseISO(r.to) + 2 * DAY_MS });
    }
  });
  if (!weeks.length || today === null) return weeks.length ? { term: weeks[0].term, week: weeks[0].week } : null;
  const hit = weeks.find((w) => today >= w.from && today <= w.to) ||
    weeks.find((w) => w.from > today) ||
    weeks[weeks.length - 1];
  return { term: hit.term, week: hit.week };
}

export function slotLabel(slot) {
  if (!slot) return '';
  return `T${slot.term} Wk ${slot.week} ${DAYS[slot.day - 1]} P${slot.period}`;
}

// The lesson's text in a timetable cell, e.g. "3A Fractions (2/3)".
export function cellText(slot, lessons) {
  if (slot.blocked) return slot.label ? `Cancelled: ${slot.label}` : 'Cancelled';
  if (slot.lessonIndex === null) return '';
  const lesson = lessons[slot.lessonIndex];
  return slot.of > 1 ? `${lesson.title} (${slot.part}/${slot.of})` : lesson.title;
}
