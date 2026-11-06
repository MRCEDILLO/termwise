// End-to-end test of firebase.js against the Auth, Firestore and Storage emulators, with the real rules.
// firebase.js imports Firebase from the CDN, so this copies it with the imports pointed at
// the npm package, the emulators connected, and Google's pop-up swapped for an emulator token.
// Run with: npm run test:store
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { copyToClass } from '../template.js';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const here = new URL('./', import.meta.url);
let createFirebaseStore;

before(async () => {
  let src = readFileSync(new URL('../firebase.js', import.meta.url), 'utf8');
  src = src
    .replace('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js', 'firebase/app')
    .replace('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js', 'firebase/auth')
    .replace('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js', 'firebase/firestore')
    .replace('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js', 'firebase/storage')
    .replace("'./files.js'", `'${new URL('../files.js', import.meta.url)}'`)
    .replace("'./keys.js'", `'${new URL('../keys.js', import.meta.url)}'`)
    .replace("'./planner.js'", `'${new URL('../planner.js', import.meta.url)}'`)
    .replace("'./template.js'", `'${new URL('../template.js', import.meta.url)}'`)
    .replace('initializeApp(config)', 'initializeApp(config, config.appName)')
    .replace('const db = getFirestore(app);', `const db = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);`)
    .replace('const storage = getStorage(app);', `const storage = getStorage(app);
  connectStorageEmulator(storage, '127.0.0.1', 9199);`)
    .replace('signInWithPopup(auth, new GoogleAuthProvider())', 'signInWithCredential(auth, GoogleAuthProvider.credential(config.fakeGoogleToken))');
  src = `import { connectAuthEmulator, signInWithCredential } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectStorageEmulator } from 'firebase/storage';
${src}`;
  for (const needle of ['firebase/app', 'firebase/storage', 'connectStorageEmulator(storage', 'connectAuthEmulator(auth', 'signInWithCredential(auth', 'config.appName']) {
    assert.ok(src.includes(needle), `patch failed: ${needle}`);
  }
  mkdirSync(new URL('.tmp/', here), { recursive: true });
  const out = new URL('.tmp/firebase.node.js', here);
  writeFileSync(out, src);
  ({ createFirebaseStore } = await import(out));

  // The admin has let Gabe and the other teacher in (written with the rules switched off).
  const env = await initializeTestEnvironment({ projectId: 'demo-termwise', firestore: { host: '127.0.0.1', port: 8080 } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const email of ['gabe@example.com', 'o@example.com']) await setDoc(doc(ctx.firestore(), 'allowedTeachers', email), { addedAt: 1 });
  });
});

const config = (appName, token) => ({
  apiKey: 'demo-key', authDomain: 'demo-termwise.firebaseapp.com', projectId: 'demo-termwise', storageBucket: 'demo-termwise.appspot.com', appName,
  fakeGoogleToken: token && JSON.stringify(token),
});

function waitForUser(store) {
  return new Promise((resolve) => {
    const off = store.onAuth((u) => { if (u) { off(); resolve(u); } });
  });
}

test('teacher creates a class, a student joins, the key is regenerated, the class is archived', async () => {
  const run = Date.now();
  const teacher = createFirebaseStore(config(`t${run}`, { sub: `gabe${run}`, email: 'gabe@example.com', email_verified: true, name: 'Gabe' }));
  await teacher.signInTeacher();
  const tu = await waitForUser(teacher);
  assert.equal(tu.isTeacher, true);
  assert.equal(await teacher.isAllowedTeacher('Gabe@Example.com'), true);

  const id = await teacher.createClass({ name: '8A Maths', subject: 'Maths', year: '2027', colour: 2 });
  const mine = await teacher.listMyClasses();
  assert.deepEqual(mine.map((c) => c.id), [id]);
  const cls = await teacher.getClass(id);
  assert.match(cls.currentKey, /^[A-HJKMNP-Z2-9]{8}$/);

  const plan = await teacher.getPlan(id);
  plan.pattern = ['1-1', '3-2'];
  plan.terms[0] = { start: '2027-01-27', weeks: 10 };
  await teacher.savePlan(id, plan);
  const a = { id: teacher.newLessonId(id), title: '1A', periods: 2, order: 0, assessment: false, homework: false };
  const b = { id: teacher.newLessonId(id), title: '1B', periods: 1, order: 1, assessment: false, homework: false };
  await teacher.saveLesson(id, a);
  await teacher.saveLesson(id, b);
  await teacher.saveOrder(id, [b, a]);
  assert.deepEqual((await teacher.getLessons(id)).map((l) => l.title), ['1B', '1A']);

  // Student joins with the key.
  const student = createFirebaseStore(config(`s${run}`));
  assert.equal(await student.joinWithKey('ABCD2345'), null, 'unknown key');
  const joined = await student.joinWithKey(cls.currentKey);
  assert.equal(joined, id);
  assert.equal((await student.getClass(id)).name, '8A Maths');
  assert.deepEqual((await student.getLessons(id)).map((l) => l.title), ['1B', '1A']);
  assert.deepEqual((await student.getPlan(id)).pattern, ['1-1', '3-2']);

  // Units, a lesson kept off the planner, and an announcement: the student reads them, can't post.
  const unit = { id: teacher.newUnitId(id), name: 'Integers', order: 0 };
  await teacher.saveUnit(id, unit);
  const spare = { id: teacher.newLessonId(id), title: 'Extension', description: 'Puzzles', unitId: unit.id, periods: 1, order: 2, term: null, assessment: false, homework: false };
  await teacher.saveLesson(id, spare);
  await teacher.updateClass(id, { teacher: 'Mr Cedillo', contact: 'gabe@example.com', about: 'Room A12' });
  const post = await teacher.addAnnouncement(id, 'Welcome!');
  assert.deepEqual((await student.getUnits(id)).map((u) => u.name), ['Integers']);
  assert.equal((await student.getLessons(id)).find((l) => l.id === spare.id).term, null);
  assert.equal((await student.getClass(id)).contact, 'gabe@example.com');
  assert.deepEqual((await student.getAnnouncements(id)).map((x) => x.text), ['Welcome!']);
  await assert.rejects(student.addAnnouncement(id, 'No homework!'));
  // Dragging in the Lessons tab: a second unit goes first and a lesson moves into it; the student sees it.
  const unit2 = { id: teacher.newUnitId(id), name: 'Fractions', order: 1, colour: 1 };
  await teacher.saveUnit(id, unit2);
  await teacher.saveLibrary(id, {
    units: [{ id: unit2.id, order: 0, colour: 1 }, { id: unit.id, order: 1, colour: 0 }],
    lessons: [{ id: spare.id, libOrder: 0, unitId: unit2.id }],
  });
  assert.deepEqual((await student.getUnits(id)).map((u) => [u.name, u.colour]), [['Fractions', 1], ['Integers', 0]]);
  const moved = (await student.getLessons(id)).find((l) => l.id === spare.id);
  assert.equal(moved.unitId, unit2.id);
  assert.equal(moved.libOrder, 0);
  assert.equal(moved.order, 2); // the planner's order is untouched
  await assert.rejects(student.saveLibrary(id, { lessons: [{ id: spare.id, libOrder: 5, unitId: null }] }));
  await teacher.deleteUnit(id, unit2.id, [spare.id]);
  await teacher.deleteUnit(id, unit.id, [spare.id]);
  assert.equal((await teacher.getLessons(id)).find((l) => l.id === spare.id).unitId, null);
  await teacher.deleteAnnouncement(id, post.id);
  assert.deepEqual(await student.getAnnouncements(id), []);
  await teacher.deleteLesson(id, spare.id);

  // Files: an ordinary file opens; a teacher-only one stays shut until the switch is flipped.
  const pdf = (name) => new File([new Uint8Array([37, 80, 68, 70])], name);
  const sheet = await teacher.uploadFile(id, a.id, pdf('Worksheet.pdf'));
  const answers = await teacher.uploadFile(id, a.id, pdf('Answers.pdf'), { locked: true });
  await assert.rejects(teacher.uploadFile(id, a.id, new File(['x'], 'run.exe')), 'other file types are refused');
  assert.deepEqual((await student.listFiles(id)).map((f) => f.name).sort(), ['Answers.pdf', 'Worksheet.pdf']);
  assert.ok(await student.fileUrl(id, sheet));
  await assert.rejects(student.fileUrl(id, answers), /unauthorized/);
  assert.ok(await teacher.fileUrl(id, answers), 'the teacher can always open it');
  Object.assign(answers, { unlockAt: Date.now() + 86400000 });
  await teacher.updateFile(id, answers, { unlockAt: answers.unlockAt });
  await assert.rejects(student.fileUrl(id, answers), /unauthorized/, 'not until the date');
  Object.assign(answers, { unlocked: true });
  await teacher.updateFile(id, answers, { unlocked: true });
  assert.ok(await student.fileUrl(id, answers));
  // The teacher's check finds nothing to fix, and leaves the student able to open it.
  await teacher.syncFileAccess(id, await teacher.listFiles(id));
  assert.ok(await student.fileUrl(id, answers));
  await teacher.deleteFile(id, sheet);
  assert.deepEqual((await teacher.listFiles(id)).map((f) => f.name), ['Answers.pdf']);

  // Tracker: names, marks and settings are the teacher's alone.
  const sam = { id: teacher.newStudentId(id), name: 'Sam Patel' };
  const ava = { id: teacher.newStudentId(id), name: 'Ava Nguyen' };
  await teacher.saveStudents(id, [sam, ava]);
  await teacher.setMark(id, sam.id, 'a', `a-${a.id}`, 17);
  await teacher.setMark(id, sam.id, 'h', `h-${a.id}`, true);
  await teacher.setMark(id, ava.id, 'a', `a-${a.id}`, 'IE');
  await teacher.saveTracker(id, { scale: [], max: { [`a-${a.id}`]: 20 }, extra: [] });
  assert.deepEqual((await teacher.getStudents(id)).map((s) => s.name).sort(), ['Ava Nguyen', 'Sam Patel']);
  assert.deepEqual((await teacher.getMarks(id))[sam.id], { a: { [`a-${a.id}`]: 17 }, h: { [`h-${a.id}`]: true } });
  assert.equal((await teacher.getTracker(id)).max[`a-${a.id}`], 20);
  await teacher.setMark(id, sam.id, 'a', `a-${a.id}`, null);
  assert.deepEqual((await teacher.getMarks(id))[sam.id].a, {}, 'a cleared cell is removed');
  await assert.rejects(student.getStudents(id));
  await assert.rejects(student.getMarks(id));
  await assert.rejects(student.getTracker(id));
  await teacher.deleteStudent(id, ava.id);
  assert.deepEqual((await teacher.getStudents(id)).map((s) => s.name), ['Sam Patel']);
  assert.equal((await teacher.getMarks(id))[ava.id], undefined, 'their marks go too');

  // New key: the student is cut off until they enter it.
  const newKey = await teacher.regenerateKey(id);
  assert.notEqual(newKey, cls.currentKey);
  assert.equal(await student.getClass(id), null);
  assert.equal(await student.joinWithKey(cls.currentKey), null, 'old key no longer works');
  assert.equal(await student.joinWithKey(newKey), id);
  assert.ok(await student.getClass(id));

  // Archive: cut off at once; restore lets the same key work again.
  await teacher.setArchived(id, true);
  assert.equal(await student.getClass(id), null);
  assert.equal(await student.joinWithKey(newKey), null);
  await teacher.setArchived(id, false);
  assert.equal(await student.joinWithKey(newKey), id);

  // Another teacher can't see it.
  const other = createFirebaseStore(config(`o${run}`, { sub: `other${run}`, email: 'o@example.com', email_verified: true }));
  await other.signInTeacher();
  assert.equal(await other.getClass(id), null);
  assert.deepEqual(await other.listMyClasses(), []);

  await teacher.deleteLesson(id, a.id);
  assert.deepEqual((await teacher.getLessons(id)).map((l) => l.title), ['1B']);
});

test('a new class copies lessons, units, planner placement and files from a template, and nothing else', async () => {
  const run = Date.now();
  const teacher = createFirebaseStore(config(`tp${run}`, { sub: `tpl${run}`, email: 'gabe@example.com', email_verified: true, name: 'Gabe' }));
  await teacher.signInTeacher();
  await waitForUser(teacher);
  const src = await teacher.createClass({ name: '8A Maths', subject: 'Maths', year: '2026', colour: 1 });
  const unit = { id: teacher.newUnitId(src), name: 'Algebra', order: 0, colour: 3 };
  await teacher.saveUnit(src, unit);
  const l1 = { id: teacher.newLessonId(src), title: 'Intro', description: 'Start', unitId: unit.id, periods: 2, assessment: false, homework: true, term: 2, order: 0, libOrder: 0 };
  const l2 = { id: teacher.newLessonId(src), title: 'Spare', description: '', unitId: null, periods: 1, assessment: true, homework: false, term: null, order: 1, libOrder: 1 };
  await teacher.saveLesson(src, l1);
  await teacher.saveLesson(src, l2);
  const pdf = (name) => new File([new Uint8Array([37, 80, 68, 70])], name);
  const open = await teacher.uploadFile(src, l1.id, pdf('Sheet.pdf'));
  const shut = await teacher.uploadFile(src, l1.id, pdf('Answers.pdf'), { locked: true });
  Object.assign(shut, { unlocked: true });
  await teacher.updateFile(src, shut, { unlocked: true });
  await teacher.saveStudents(src, [{ id: teacher.newStudentId(src), name: 'Sam' }]);
  await teacher.addAnnouncement(src, 'Hello');
  await teacher.savePlan(src, { terms: [{ start: '2026-01-27', weeks: 10 }], pattern: ['1-1'], events: [] });

  const id = await teacher.createClass({ name: '8B Maths', subject: 'Maths', year: '2026', colour: 2 });
  const res = await teacher.copyFromTemplate(src, id);
  assert.deepEqual(res, { units: 1, lessons: 2, files: 2, failed: [] });

  const [u] = await teacher.getUnits(id);
  assert.equal(u.name, 'Algebra');
  assert.equal(u.colour, 3);
  assert.notEqual(u.id, unit.id);
  const lessons = await teacher.getLessons(id);
  assert.deepEqual(lessons.map((l) => [l.title, l.term, l.order, l.periods]), [['Intro', 2, 0, 2], ['Spare', null, 1, 1]]);
  assert.equal(lessons[0].unitId, u.id);
  assert.equal(lessons[1].assessment, true);
  const files = await teacher.listFiles(id);
  assert.deepEqual(files.map((f) => [f.name, f.lessonId, f.locked, f.unlocked]).sort(),
    [['Answers.pdf', lessons[0].id, true, false], ['Sheet.pdf', lessons[0].id, false, false]]);
  assert.ok(await teacher.fileUrl(id, files[0]), 'the copied file is really there');

  // A student of the new class opens the ordinary file but not the teacher-only one.
  const student = createFirebaseStore(config(`tps${run}`));
  assert.equal(await student.joinWithKey((await teacher.getClass(id)).currentKey), id);
  const seen = await student.listFiles(id);
  assert.ok(await student.fileUrl(id, seen.find((f) => f.name === 'Sheet.pdf')));
  await assert.rejects(student.fileUrl(id, seen.find((f) => f.name === 'Answers.pdf')), /unauthorized/);
  assert.equal(await student.getClass(src), null, 'joining the copy gives no way into the original');

  // Nothing else came across.
  assert.deepEqual(await teacher.getStudents(id), []);
  assert.deepEqual(await teacher.getAnnouncements(id), []);
  assert.deepEqual((await teacher.getPlan(id)).pattern, []);
  assert.equal(open.name, 'Sheet.pdf');
});

test("another teacher copies a class by its key: their own copy, files included, and no lasting access", async () => {
  const run = Date.now();
  const gabe = createFirebaseStore(config(`ik${run}`, { sub: `ikg${run}`, email: 'gabe@example.com', email_verified: true, name: 'Gabe' }));
  await gabe.signInTeacher();
  await waitForUser(gabe);
  const src = await gabe.createClass({ name: '9C Science', subject: 'Science', year: '2026', colour: 1 });
  const unit = { id: gabe.newUnitId(src), name: 'Cells', order: 0 };
  await gabe.saveUnit(src, unit);
  const l1 = { id: gabe.newLessonId(src), title: 'Microscopes', description: '', unitId: unit.id, periods: 1, assessment: false, homework: false, term: 1, order: 0, libOrder: 0 };
  await gabe.saveLesson(src, l1);
  const pdf = (name) => new File([new Uint8Array([37, 80, 68, 70])], name);
  await gabe.uploadFile(src, l1.id, pdf('Worksheet.pdf'));
  await gabe.uploadFile(src, l1.id, pdf('Answers.pdf'), { locked: true });
  await gabe.saveStudents(src, [{ id: gabe.newStudentId(src), name: 'Sam' }]);
  const studentKey = (await gabe.getClass(src)).currentKey;
  const key = await gabe.setCopyKey(src, true);
  assert.match(key, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.notEqual(key, studentKey);

  const other = createFirebaseStore(config(`iko${run}`, { sub: `iko${run}`, email: 'o@example.com', email_verified: true, name: 'Other' }));
  await other.signInTeacher();
  await waitForUser(other);
  assert.equal(await other.startImport('ZZZZZZZZ'), null, 'a key nobody uses finds nothing');
  assert.equal(await other.startImport(studentKey), null, 'the key students join with is not a copy key');
  const found = await other.startImport(key);
  assert.deepEqual(found, { classId: src, name: '9C Science', own: false });
  const id = await other.createClass({ name: '9D Science', subject: 'Science', year: '2026', colour: 0 });
  const res = await other.copyFromTemplate(src, id);
  assert.deepEqual(res, { units: 1, lessons: 1, files: 2, failed: [] });
  await other.endImport(src);

  // The copy belongs to the other teacher, with its own ids, and both files really copied.
  const lessons = await other.getLessons(id);
  assert.deepEqual(lessons.map((l) => [l.title, l.term]), [['Microscopes', 1]]);
  assert.notEqual(lessons[0].id, l1.id);
  const files = await other.listFiles(id);
  assert.deepEqual(files.map((f) => [f.name, f.locked]).sort(), [['Answers.pdf', true], ['Worksheet.pdf', false]]);
  for (const f of files) assert.ok(await other.fileUrl(id, f));
  assert.equal(await gabe.getClass(id), null, "the original teacher can't see the copy");

  // Editing the copy leaves the original alone.
  await other.saveLesson(id, { ...lessons[0], title: 'Microscopes (mine)' });
  assert.equal((await gabe.getLessons(src))[0].title, 'Microscopes');

  // Once the copy is done, the other teacher can't read the original any more, and never saw its students.
  assert.equal(await other.getClass(src), null);
  await assert.rejects(other.getLessons(src));
  await assert.rejects(other.getStudents(src));

  // A teacher's own copy key just points at their own class, with no import record.
  assert.deepEqual(await gabe.startImport(key), { classId: src, name: '9C Science', own: true });

  // Turning sharing off stops the copy key working.
  assert.equal(await gabe.setCopyKey(src, false), null);
  assert.equal(await other.startImport(key), null);
});

test('deleting a class removes everything in it, and its keys', async () => {
  const run = Date.now();
  const gabe = createFirebaseStore(config(`dl${run}`, { sub: `dl${run}`, email: 'gabe@example.com', email_verified: true, name: 'Gabe' }));
  await gabe.signInTeacher();
  await waitForUser(gabe);
  const id = await gabe.createClass({ name: '7A Maths', subject: 'Maths', year: '2026', colour: 0 });
  const l = { id: gabe.newLessonId(id), title: 'Place value', periods: 1, term: 1, order: 0, assessment: true, homework: false };
  await gabe.saveLesson(id, l);
  await gabe.saveUnit(id, { id: gabe.newUnitId(id), name: 'Number', order: 0 });
  const f = await gabe.uploadFile(id, l.id, new File([new Uint8Array([37, 80, 68, 70])], 'Sheet.pdf'));
  await gabe.addAnnouncement(id, 'Hi');
  const sid = gabe.newStudentId(id);
  await gabe.saveStudents(id, [{ id: sid, name: 'Sam' }]);
  await gabe.setMark(id, sid, 'a', `a-${l.id}`, 7);
  await gabe.saveTracker(id, { max: { [`a-${l.id}`]: 10 }, extra: [] });
  const student = createFirebaseStore(config(`dls${run}`));
  const cls = await gabe.getClass(id);
  assert.equal(await student.joinWithKey(cls.currentKey), id);
  const copyKey = await gabe.setCopyKey(id, true);
  await gabe.setArchived(id, true);

  await gabe.deleteClass(id);
  assert.equal(await gabe.getClass(id), null);
  assert.deepEqual((await gabe.listMyClasses()).filter((c) => c.id === id), []);
  assert.equal(await gabe.startImport(copyKey), null, 'the copy key is gone');
  await assert.rejects(gabe.fileUrl(id, f), 'the stored file is gone');
  // A fresh class can't be reached through anything left behind.
  assert.equal(await student.joinWithKey(cls.currentKey), null);
});

// Waits until onChange has been called with a kind and data that pass the check.
function waitFor(events, check, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for a live update')), ms);
    const tick = () => {
      const hit = events.find(check);
      if (hit) { clearTimeout(t); resolve(hit); } else setTimeout(tick, 50);
    };
    tick();
  });
}

test('a student sees changes live, and is told when the key changes', async () => {
  const run = Date.now();
  const teacher = createFirebaseStore(config(`tw${run}`, { sub: `tw${run}`, email: 'gabe@example.com', email_verified: true, name: 'Gabe' }));
  await teacher.signInTeacher();
  await waitForUser(teacher);
  const id = await teacher.createClass({ name: '8C Maths', subject: 'Maths', year: '2027', colour: 0 });
  const student = createFirebaseStore(config(`sw${run}`));
  assert.equal(await student.joinWithKey((await teacher.getClass(id)).currentKey), id);

  const events = [];
  const stop = student.watchClass(id, (kind, data) => events.push([kind, data]));
  await waitFor(events, ([k]) => k === 'class');
  await teacher.addAnnouncement(id, 'Test moved to Friday');
  await waitFor(events, ([k, d]) => k === 'posts' && d.some((p) => p.text === 'Test moved to Friday'));
  const l = { id: teacher.newLessonId(id), title: 'Live lesson', periods: 1, order: 0, term: 1, assessment: false, homework: false };
  await teacher.saveLesson(id, l);
  await waitFor(events, ([k, d]) => k === 'lessons' && d.some((x) => x.title === 'Live lesson'));

  // The teacher's own listener skips snapshots of its unsaved writes, so it never sees a half-made change.
  const mine = [];
  const stopMine = teacher.watchClass(id, (kind, data) => mine.push([kind, data]));
  await waitFor(mine, ([k]) => k === 'lessons');
  await teacher.saveLesson(id, { ...l, title: 'Renamed' });
  await waitFor(mine, ([k, d]) => k === 'lessons' && d.some((x) => x.title === 'Renamed'));
  stopMine();

  await teacher.regenerateKey(id);
  await waitFor(events, ([k]) => k === 'gone');
  stop();
});

test('copying a unit into another class brings its lessons and files', async () => {
  const run = Date.now();
  const teacher = createFirebaseStore(config(`tc${run}`, { sub: `tc${run}`, email: 'gabe@example.com', email_verified: true, name: 'Gabe' }));
  await teacher.signInTeacher();
  await waitForUser(teacher);
  const a = await teacher.createClass({ name: '9A Maths', subject: 'Maths', year: '2027', colour: 0 });
  const b = await teacher.createClass({ name: '9B Maths', subject: 'Maths', year: '2027', colour: 1 });
  const unit = { id: teacher.newUnitId(a), name: 'Algebra', order: 0, colour: 2 };
  await teacher.saveUnit(a, unit);
  const l1 = { id: teacher.newLessonId(a), title: 'Expanding', unitId: unit.id, periods: 2, term: 1, order: 0, libOrder: 0, assessment: false, homework: true, openAfter: true };
  await teacher.saveLesson(a, l1);
  const pdf = (name) => new File([new Uint8Array([37, 80, 68, 70])], name);
  await teacher.uploadFile(a, l1.id, pdf('Answers.pdf'), { locked: true });
  const existing = { id: teacher.newLessonId(b), title: 'Already here', periods: 1, term: 1, order: 4, assessment: false, homework: false };
  await teacher.saveLesson(b, existing);

  const copy = copyToClass(
    { unit, lessons: [l1], files: await teacher.listFiles(a) },
    { units: await teacher.getUnits(b), lessons: await teacher.getLessons(b) },
    (kind) => teacher.newId(b, kind),
    { onPlanner: true },
  );
  const res = await teacher.copyInto(a, b, copy);
  assert.deepEqual(res, { units: 1, lessons: 1, files: 1, failed: [] });
  const [u] = await teacher.getUnits(b);
  assert.equal(u.name, 'Algebra');
  const lessons = await teacher.getLessons(b);
  assert.deepEqual(lessons.map((l) => [l.title, l.term, l.order, l.unitId === u.id]), [['Already here', 1, 4, false], ['Expanding', 1, 5, true]]);
  assert.equal(lessons[1].openAfter, true);
  const [f] = await teacher.listFiles(b);
  assert.deepEqual([f.name, f.locked, f.lessonId], ['Answers.pdf', true, lessons[1].id]);
  assert.ok(await teacher.fileUrl(b, f), 'the copied file is really there');
  assert.equal((await teacher.getLessons(a)).length, 1, 'the first class is unchanged');
});

test('a Google account the admin has not added cannot make a class', async () => {
  const run = Date.now();
  const stranger = createFirebaseStore(config(`n${run}`, { sub: `new${run}`, email: 'newbie@example.com', email_verified: true }));
  await stranger.signInTeacher(); // signing in works; everything a teacher does is refused
  await waitForUser(stranger);
  assert.equal(await stranger.isAllowedTeacher('newbie@example.com'), false);
  await assert.rejects(stranger.createClass({ name: 'Mine', subject: '', year: '', colour: 0 }));
  await assert.rejects(stranger.listAllowedTeachers());
  await assert.rejects(stranger.allowTeacher('newbie@example.com'));
});

test("a teacher's class order and pins are saved on their own record, out of students' reach", async () => {
  const run = Date.now();
  const teacher = createFirebaseStore(config(`co${run}`, { sub: `gabeco${run}`, email: 'gabe@example.com', email_verified: true, name: 'Gabe' }));
  await teacher.signInTeacher();
  await waitForUser(teacher);
  assert.deepEqual(await teacher.getClassOrder(), { order: [], pinned: [] });
  await teacher.saveClassOrder({ order: ['b', 'a', 'c'], pinned: ['b'] });
  assert.deepEqual(await teacher.getClassOrder(), { order: ['b', 'a', 'c'], pinned: ['b'] });
  // Signing in again keeps them (it merges the name and email in).
  await teacher.signInTeacher();
  assert.deepEqual(await teacher.getClassOrder(), { order: ['b', 'a', 'c'], pinned: ['b'] });
});
