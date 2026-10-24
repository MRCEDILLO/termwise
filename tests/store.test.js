// End-to-end test of firebase.js against the Auth, Firestore and Storage emulators, with the real rules.
// firebase.js imports Firebase from the CDN, so this copies it with the imports pointed at
// the npm package, the emulators connected, and Google's pop-up swapped for an emulator token.
// Run with: npm run test:store
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  await teacher.updateFile(id, answers.id, { unlockAt: Date.now() + 86400000 });
  await assert.rejects(student.fileUrl(id, answers), /unauthorized/, 'not until the date');
  await teacher.updateFile(id, answers.id, { unlocked: true });
  assert.ok(await student.fileUrl(id, answers));
  await teacher.deleteFile(id, sheet);
  assert.deepEqual((await teacher.listFiles(id)).map((f) => f.name), ['Answers.pdf']);

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
