// Termwise planner engine: the Term Planner spreadsheet's rules as plain functions.
// No Firebase and no DOM here, so it runs the same in the browser and in node --test.
//
// Inputs (stored in Firestore):
//   plan = {
//     terms:   [{ start: 'YYYY-MM-DD' | '', weeks: 0..20 }, ... 4 terms],
//     pattern: ['1-2', '3-5', ...]   // 'day-period' strings, day 1..5 (Mon..Fri), period 1..6
//     events:  [{ id, term: 1..4, week: 1..20, day: 'All' | 1..5, period: 'All' | 1..6, label }]
//   }
//   lessons = [{ id, term: 1..4, title, periods, assessment, homework }, ...] in teaching order
//
// Each lesson belongs to one term. A term's lessons fill that term's free class periods in
// order; lessons that don't fit are flagged rather than spilling into the next term.

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

// The term a lesson is taught in (1..4). Lessons saved before terms were chosen count as Term 1.
export function lessonTerm(lesson) {
  const t = Math.floor(Number(lesson && lesson.term));
  return t >= 1 && t <= TERM_COUNT ? t : 1;
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

  // 2. Each lesson belongs to one term and fills that term's free periods in order
  //    (the spreadsheet's start / cum columns, worked out per term).
  const out = lessons.map((lesson, index) => ({
    ...lesson, index, term: lessonTerm(lesson), effective: effectivePeriods(lesson), slots: [],
  }));
  const perTerm = terms.map((term, ti) => {
    const termNo = ti + 1;
    const mine = slots.filter((s) => s.term === termNo);
    const free = mine.filter((s) => !s.blocked);
    const list = out.filter((l) => l.term === termNo);
    let cum = 0;
    for (const lesson of list) {
      lesson.startAt = cum + 1;
      cum += lesson.effective;
      lesson.endAt = cum;
    }
    let li = 0;
    free.forEach((slot, i) => {
      const n = i + 1;
      if (n > cum) return;
      while (li < list.length && list[li].endAt < n) li++;
      const lesson = list[li];
      slot.lessonIndex = lesson.index;
      slot.part = n - lesson.startAt + 1;
      slot.of = lesson.effective;
      lesson.slots.push(slot);
    });
    for (const lesson of list) {
      if (lesson.effective === 0) lesson.status = 'skipped';
      else if (lesson.startAt > free.length) lesson.status = 'noroom';
      else if (lesson.endAt > free.length) lesson.status = 'overterm';
      else lesson.status = 'scheduled';
      lesson.start = lesson.slots[0] || null;
      lesson.end = lesson.slots[lesson.slots.length - 1] || null;
    }
    return {
      term: termNo,
      weeks: clampWeeks(term && term.weeks),
      lessons: list.length,
      available: free.length,
      blocked: mine.length - free.length,
      used: mine.filter((s) => s.lessonIndex !== null).length,
      required: cum,
      spare: free.length - cum,
      fits: cum <= free.length,
      finishes: cum > 0 && free.length > 0 ? free[Math.min(cum, free.length) - 1] : null,
    };
  });

  const available = perTerm.reduce((n, t) => n + t.available, 0);
  const required = perTerm.reduce((n, t) => n + t.required, 0);
  return {
    columns: cols,
    meetingsPerWeek: cols.length,
    slots,
    lessons: out,
    available,
    required,
    spare: available - required,
    fits: perTerm.every((t) => t.fits),
    perTerm,
  };
}

/* ---------- reading the result ---------- */

// Which week students should see for a date, and why:
//   'week'     a school day inside a term week
//   'weekend'  Saturday or Sunday: shows the coming week (next term's first week in the holidays)
//   'holidays' between terms, or before Term 1: shows the next term's first week
//   'ended'    after the last term: shows the last week
export function currentWeek(plan, todayISO) {
  const today = parseISO(todayISO);
  const weeks = [];
  (plan.terms || []).slice(0, TERM_COUNT).forEach((term, ti) => {
    const n = clampWeeks(term.weeks);
    for (let w = 1; w <= n; w++) {
      const r = weekRange(term, w);
      if (r) weeks.push({ term: ti + 1, week: w, from: parseISO(r.from), to: parseISO(r.to) });
    }
  });
  if (!weeks.length) return null;
  const pick = (w, state) => ({ term: w.term, week: w.week, state });
  if (today === null) return pick(weeks[0], 'holidays');
  const inWeek = weeks.find((w) => today >= w.from && today <= w.to);
  if (inWeek) return pick(inWeek, 'week');
  const next = weeks.find((w) => w.from > today);
  if (!next) return pick(weeks[weeks.length - 1], 'ended');
  // Saturday or Sunday straight after a term week rolls on to the next week.
  const prev = weeks.filter((w) => w.to < today).pop();
  const weekend = prev && today - prev.to <= 2 * DAY_MS;
  return pick(next, weekend && next.from - prev.to <= 3 * DAY_MS ? 'weekend' : 'holidays');
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
