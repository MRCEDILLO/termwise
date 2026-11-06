// Making a class from a template: which parts of an existing class are copied.
// Only the lesson library and where each lesson sits on the planner come across:
// units, lessons (with their term and order) and the lessons' files. Nothing else
// (students, marks, tracker, announcements, plan dates, key, members) is copied.
// No Firebase and no DOM here, so it runs the same in the browser and in node --test.

// newId(kind) returns a fresh id for 'unit', 'lesson' or 'file' in the new class.
// Returns the copies, with every unit and lesson link pointed at the new ids.
export function templateCopy({ units = [], lessons = [], files = [] }, newId) {
  const unitIds = new Map(units.map((u) => [u.id, newId('unit')]));
  const lessonIds = new Map(lessons.map((l) => [l.id, newId('lesson')]));

  const newUnits = units.map((u) => {
    const copy = { id: unitIds.get(u.id), name: u.name || 'Unit', order: u.order ?? 0 };
    if (typeof u.colour === 'number') copy.colour = u.colour;
    return copy;
  });

  const newLessons = lessons.map((l) => {
    const copy = {
      id: lessonIds.get(l.id),
      title: l.title || 'Lesson',
      description: l.description || '',
      unitId: (l.unitId && unitIds.get(l.unitId)) || null,
      periods: l.periods ?? 1,
      assessment: !!l.assessment,
      homework: !!l.homework,
      // Planner placement: the term (null = library only) and the timeline order.
      term: l.term ?? null,
      order: l.order ?? 0,
    };
    if (typeof l.libOrder === 'number') copy.libOrder = l.libOrder;
    if (l.openAfter) copy.openAfter = true;
    const links = copyLinks(l.links);
    if (links.length) copy.links = links;
    return copy;
  });

  // Files stay teacher-only if they were, but start locked again: the old class's
  // "open now" switch and unlock date belong to that class's timetable.
  const newFiles = files.filter((f) => lessonIds.has(f.lessonId)).map((f) => ({
    from: f,
    id: newId('file'),
    lessonId: lessonIds.get(f.lessonId),
    name: f.name,
    size: f.size,
    type: f.type,
    locked: !!f.locked,
    unlocked: false,
    unlockAt: null,
  }));

  return { units: newUnits, lessons: newLessons, files: newFiles };
}

// A lesson's web links, copied as plain { title, url } pairs.
function copyLinks(links) {
  return (Array.isArray(links) ? links : [])
    .filter((k) => k && typeof k.url === 'string' && /^https?:\/\//i.test(k.url))
    .map((k) => ({ title: String(k.title || ''), url: k.url }));
}

// Copying one lesson, or a whole unit, into another of the teacher's classes.
//   from:   { unit, lessons, files, unitName }  unit is set when a whole unit is copied (lessons are
//           its lessons, in Lessons-tab order); unitName is the single lesson's unit name, if any
//   target: { units, lessons }                  what the other class already has
//   onPlanner: lessons on the planner here go to the end of the same term there; otherwise
//              (and for lessons not on the planner here) they go in the library only.
// A copied unit is always a new unit at the end of the list. A single lesson goes into the other
// class's unit with the same name (ignoring case and spaces), or under No unit if there isn't one.
// Files come across as in templateCopy: teacher-only files stay teacher-only, locked again.
export function copyToClass({ unit = null, lessons = [], files = [], unitName = '' }, target, newId, { onPlanner = false } = {}) {
  const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const tUnits = target.units || [];
  const tLessons = target.lessons || [];
  const maxOf = (list, f) => list.reduce((m, x) => Math.max(m, f(x)), -1);
  const libKey = (l) => (typeof l.libOrder === 'number' ? l.libOrder : 100000 + (l.order ?? 0));

  let newUnit = null;
  let unitId = null;
  if (unit) {
    newUnit = { id: newId('unit'), name: unit.name || 'Unit', order: maxOf(tUnits, (u) => u.order ?? 0) + 1 };
    if (typeof unit.colour === 'number') newUnit.colour = unit.colour;
    unitId = newUnit.id;
  } else if (norm(unitName)) {
    const same = tUnits.find((u) => norm(u.name) === norm(unitName));
    unitId = same ? same.id : null;
  }

  // Library order follows the list given; planner order follows this class's timeline.
  const baseOrder = maxOf(tLessons, (l) => l.order ?? 0) + 1;
  const timeline = [...lessons].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((l) => l.id);
  let libOrder = maxOf(tLessons, libKey) + 1;
  const lessonIds = new Map();
  const newLessons = lessons.map((l) => {
    const id = newId('lesson');
    lessonIds.set(l.id, id);
    const placed = onPlanner && l.term >= 1 && l.term <= 4;
    const copy = {
      id,
      title: l.title || 'Lesson',
      description: l.description || '',
      unitId,
      periods: l.periods ?? 1,
      assessment: !!l.assessment,
      homework: !!l.homework,
      term: placed ? l.term : null,
      order: baseOrder + timeline.indexOf(l.id),
      libOrder: libOrder++,
    };
    if (l.openAfter) copy.openAfter = true;
    const links = copyLinks(l.links);
    if (links.length) copy.links = links;
    return copy;
  });

  const newFiles = files.filter((f) => lessonIds.has(f.lessonId)).map((f) => ({
    from: f,
    id: newId('file'),
    lessonId: lessonIds.get(f.lessonId),
    name: f.name,
    size: f.size,
    type: f.type,
    locked: !!f.locked,
    unlocked: false,
    unlockAt: null,
  }));

  return { units: newUnit ? [newUnit] : [], lessons: newLessons, files: newFiles };
}

// Importing events and blocked time from another class into this one. The other
// class's events are added to this class's, never replacing them. An event that
// matches one already here (same term, week, day, period and label, ignoring case
// and spaces) is skipped, so importing the same class twice adds nothing new.
// newId() returns a fresh event id. Returns { events, added, skipped }.
export function importEvents(current = [], incoming = [], newId) {
  const keyOf = (e) => [Number(e.term), Number(e.week), String(e.day), String(e.period),
    String(e.label || '').trim().replace(/\s+/g, ' ').toLowerCase()].join('|');
  const seen = new Set(current.map(keyOf));
  const events = [...current];
  let added = 0;
  let skipped = 0;
  for (const e of incoming) {
    const k = keyOf(e);
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    events.push({
      id: newId(),
      term: Number(e.term) || 1,
      week: Number(e.week) || 1,
      day: e.day === 'All' ? 'All' : Number(e.day) || 'All',
      period: e.period === 'All' ? 'All' : Number(e.period) || 'All',
      label: String(e.label || '').trim().slice(0, 80),
    });
    added++;
  }
  return { events, added, skipped };
}
