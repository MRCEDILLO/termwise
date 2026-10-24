// Demo store: the same interface as firebase.js, saved in this browser's localStorage.
// Used when config.js has no Firebase settings, so the site works on first open.

import { newKey } from './keys.js';
import { emptyPlan } from './planner.js';

const DATA_KEY = 'termwise-demo-v3';
const USER_KEY = 'termwise-demo-user-v1';
const memory = {};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return key in memory ? memory[key] : fallback; }
}
function save(key, value) {
  memory[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: keep in memory */ }
}

const uid = () => Math.random().toString(36).slice(2, 12);

/* ---------- sample class ---------- */

const SAMPLE_UNITS = [
  ['Integers', ['Ordering integers', 'Adding and subtracting', 'Multiplying and dividing']],
  ['Fractions', ['Equivalent fractions', 'Adding fractions', 'Multiplying fractions', 'Dividing fractions', 'Mixed numbers']],
  ['Decimals and percentages', ['Decimal place value', 'Fractions to percentages', 'Percentage of an amount', 'Percentage change']],
  ['Algebra', ['Pronumerals', 'Substitution', 'Like terms', 'Expanding brackets', 'Factorising']],
  ['Linear equations', ['One-step equations', 'Two-step equations', 'Equations with brackets', 'Worded problems']],
  ['Measurement', ['Perimeter', 'Area of rectangles and triangles', 'Area of composite shapes', 'Volume of prisms']],
  ['Geometry', ['Angles on a line', 'Parallel lines', 'Triangles', 'Quadrilaterals']],
  ['Statistics', ['Collecting data', 'Mean, median and mode', 'Graphs', 'Investigation']],
  ['Ratios and rates', ['Simplifying ratios', 'Dividing in a ratio', 'Rates', 'Best buys']],
  ['Index laws', ['Index notation', 'Multiplying and dividing powers', 'Zero and negative indices']],
  ['Probability', ['Chance language', 'Theoretical probability', 'Experiments', 'Two-way tables']],
  ['Pythagoras', ['Right-angled triangles', 'Finding the hypotenuse', 'Finding a shorter side', 'Problem solving']],
];

export function sampleClass() {
  const units = [];
  const lessons = [];
  SAMPLE_UNITS.forEach(([unit, names], u) => {
    const unitId = uid();
    units.push({ id: unitId, name: `${u + 1}. ${unit}`, order: u });
    const term = Math.floor(u / 3) + 1; // three units a term
    names.forEach((n, i) => lessons.push({
      unitId, term,
      title: `${u + 1}${String.fromCharCode(65 + i)} ${n}`,
      description: i === 0 ? `First lesson of the ${unit.toLowerCase()} unit. Bring your exercise book and calculator.` : '',
      periods: [2, 3, 2, 2, 3][i % 5],
      homework: i % 2 === 0,
    }));
    lessons.push({ unitId, term, title: `${unit} review`, periods: 2, description: 'Practice questions from the whole unit.' });
    lessons.push({ unitId, term, title: `${unit} test`, periods: 1, assessment: true });
  });
  // One lesson that isn't on the planner yet, to show the library and search.
  lessons.push({ unitId: units[0].id, term: null, title: 'Integers extension: number puzzles', periods: 1 });
  const plan = emptyPlan();
  // Sample dates only (Victorian 2026 term starts). Change them on the Setup tab.
  plan.terms = [
    { start: '2026-01-28', weeks: 10 },
    { start: '2026-04-20', weeks: 10 },
    { start: '2026-07-13', weeks: 10 },
    { start: '2026-10-05', weeks: 11 },
  ];
  plan.pattern = ['1-2', '2-4', '4-1', '5-3'];
  plan.events = [
    { id: uid(), term: 1, week: 7, day: 1, period: 'All', label: 'Labour Day' },
    { id: uid(), term: 1, week: 9, day: 4, period: 'All', label: 'Year 8 camp' },
    { id: uid(), term: 2, week: 4, day: 4, period: 'All', label: 'Athletics carnival' },
    { id: uid(), term: 3, week: 6, day: 2, period: 4, label: 'Excursion' },
    { id: uid(), term: 4, week: 4, day: 5, period: 3, label: 'Assembly' },
  ];
  return {
    name: '8A Maths', subject: 'Maths', year: '2026', colour: 0,
    teacher: 'Mr Cedillo', contact: 'teacher@school.vic.edu.au', about: 'Year 8 Mathematics. Lessons are in A12 unless your timetable says otherwise.',
    plan,
    units,
    lessons: lessons.map((l, i) => ({ id: uid(), order: i, description: '', assessment: false, homework: false, ...l })),
    announcements: [
      { id: uid(), text: 'Welcome to 8A Maths! Every lesson\'s slides and worksheets are on the Lessons tab.', createdAt: Date.now() - 86400000 * 3 },
    ],
  };
}

/* ---------- the store ---------- */

export function createDemoStore() {
  let data = load(DATA_KEY, null);
  if (!data) {
    const s = sampleClass();
    const key = newKey();
    data = {
      classes: { sample: {
        name: s.name, subject: s.subject, year: s.year, colour: s.colour, teacher: s.teacher, contact: s.contact, about: s.about,
        owner: 'demo-teacher', currentKey: key, archived: false, createdAt: Date.now(),
      } },
      plans: { sample: s.plan },
      units: { sample: s.units },
      lessons: { sample: s.lessons },
      announcements: { sample: s.announcements },
      members: {},
    };
    save(DATA_KEY, data);
  }
  const persist = () => save(DATA_KEY, data);
  let listeners = [];
  const userFor = (role) => role === 'teacher'
    ? { uid: 'demo-teacher', name: 'Demo teacher', email: '', isTeacher: true }
    : role === 'student' ? { uid: 'demo-student', name: '', email: '', isTeacher: false } : null;
  let user = userFor(load(USER_KEY, null));
  const setUser = (role) => {
    save(USER_KEY, role);
    user = userFor(role);
    listeners.forEach((cb) => cb(user));
  };
  const canRead = (id) => {
    const c = data.classes[id];
    if (!c || !user) return false;
    if (c.owner === user.uid) return true;
    return !c.archived && data.members[`${id}/${user.uid}`] === c.currentKey;
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const demoFiles = {};

  return {
    mode: 'demo',
    // Shown on the front page so the sample can be tried as a student.
    sampleKey: () => (data.classes.sample && !data.classes.sample.archived ? data.classes.sample.currentKey : ''),

    onAuth(cb) {
      listeners.push(cb);
      setTimeout(() => cb(user), 0);
      return () => { listeners = listeners.filter((l) => l !== cb); };
    },
    async signInTeacher() { setUser('teacher'); },
    async signOut() { setUser(null); },

    async listMyClasses() {
      await tick();
      return Object.entries(data.classes).filter(([, c]) => c.owner === user.uid).map(([id, c]) => ({ id, ...c }));
    },
    async createClass({ name, subject, year, colour }) {
      const id = uid();
      data.classes[id] = { name, subject, year, colour, teacher: user.name, owner: user.uid, currentKey: newKey(), archived: false, createdAt: Date.now() };
      data.plans[id] = emptyPlan();
      data.units[id] = [];
      data.lessons[id] = [];
      data.announcements[id] = [];
      persist();
      return id;
    },
    async getClass(id) {
      await tick();
      return canRead(id) ? { id, ...data.classes[id] } : null;
    },
    async updateClass(id, patch) { Object.assign(data.classes[id], patch); persist(); },
    async regenerateKey(id) {
      const key = newKey();
      data.classes[id].currentKey = key;
      persist();
      return key;
    },
    async setArchived(id, archived) { data.classes[id].archived = archived; persist(); },

    async getPlan(id) { return structuredClone({ ...emptyPlan(), ...(data.plans[id] || {}) }); },
    async savePlan(id, plan) { data.plans[id] = structuredClone(plan); persist(); },
    async getLessons(id) {
      return structuredClone((data.lessons[id] || []).slice().sort((a, b) => a.order - b.order));
    },
    newLessonId() { return uid(); },
    async saveLesson(id, lesson) {
      const list = data.lessons[id];
      const i = list.findIndex((l) => l.id === lesson.id);
      if (i >= 0) list[i] = structuredClone(lesson); else list.push(structuredClone(lesson));
      persist();
    },
    async deleteLesson(id, lessonId) {
      data.lessons[id] = data.lessons[id].filter((l) => l.id !== lessonId);
      persist();
    },
    async saveOrder(id, lessons) {
      const pos = new Map(lessons.map((l, i) => [l.id, i]));
      data.lessons[id].forEach((l) => { if (pos.has(l.id)) l.order = pos.get(l.id); });
      persist();
    },

    async getUnits(id) {
      return structuredClone((data.units[id] || []).slice().sort((a, b) => a.order - b.order));
    },
    newUnitId() { return uid(); },
    async saveUnit(id, unit) {
      const list = (data.units[id] ||= []);
      const i = list.findIndex((u) => u.id === unit.id);
      if (i >= 0) list[i] = structuredClone(unit); else list.push(structuredClone(unit));
      persist();
    },
    async deleteUnit(id, unitId, lessonIds) {
      data.units[id] = data.units[id].filter((u) => u.id !== unitId);
      data.lessons[id].forEach((l) => { if (lessonIds.includes(l.id)) l.unitId = null; });
      persist();
    },

    async getAnnouncements(id) {
      return structuredClone((data.announcements[id] || []).slice().sort((a, b) => b.createdAt - a.createdAt));
    },
    async addAnnouncement(id, text) {
      const post = { id: uid(), text, createdAt: Date.now() };
      (data.announcements[id] ||= []).push(post);
      persist();
      return { ...post };
    },
    async deleteAnnouncement(id, postId) {
      data.announcements[id] = data.announcements[id].filter((p) => p.id !== postId);
      persist();
    },

    // Demo files stay in memory only, so they disappear when the page reloads.
    async listFiles(classId) { return (demoFiles[classId] || []).map(({ blob, ...f }) => ({ ...f })); },
    async uploadFile(classId, lessonId, file, { locked = false } = {}, onProgress = () => {}) {
      onProgress(1);
      const f = { id: uid(), lessonId, name: file.name.slice(0, 200), size: file.size, type: file.type, locked, unlocked: false, unlockAt: null, createdAt: Date.now() };
      (demoFiles[classId] ||= []).push({ ...f, blob: URL.createObjectURL(file) });
      return f;
    },
    async updateFile(classId, fileId, patch) {
      Object.assign((demoFiles[classId] || []).find((f) => f.id === fileId) || {}, patch);
    },
    async deleteFile(classId, f) {
      demoFiles[classId] = (demoFiles[classId] || []).filter((x) => x.id !== f.id);
    },
    async fileUrl(classId, f) {
      const rec = (demoFiles[classId] || []).find((x) => x.id === f.id);
      const open = rec && (!rec.locked || rec.unlocked || (rec.unlockAt != null && Date.now() >= rec.unlockAt));
      if (!rec || (!open && user.uid !== data.classes[classId].owner)) throw Object.assign(new Error('locked'), { code: 'storage/unauthorized' });
      return rec.blob;
    },

    async joinWithKey(key) {
      await tick();
      if (!user) setUser('student');
      const entry = Object.entries(data.classes).find(([, c]) => c.currentKey === key && !c.archived);
      if (!entry) return null;
      data.members[`${entry[0]}/${user.uid}`] = key;
      persist();
      return entry[0];
    },
  };
}
