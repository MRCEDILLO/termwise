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
