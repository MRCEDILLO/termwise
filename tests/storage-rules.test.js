// Storage rules tests for lesson files. Run with: npm run test:storage (starts the emulators).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getMetadata, updateMetadata, deleteObject } from 'firebase/storage';

let env;
const KEY = 'K7QA4MXB';
const PDF = 'application/pdf';
const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"
const path = (fileId, name = 'notes.pdf') => `classes/c1/files/${fileId}/${name}`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-termwise',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());

const hour = 3600 * 1000;
const file = (extra) => ({ lessonId: 'l1', name: 'notes.pdf', size: 4, type: PDF, locked: false, unlocked: false, unlockAt: null, ...extra });
// The lock settings as the app writes them onto the stored file (firebase.js accessMeta).
const access = ({ locked = false, unlocked = false, unlockAt = null } = {}) => ({
  locked: String(locked), unlocked: String(unlocked), unlockAt: unlockAt == null ? '' : String(unlockAt),
});
const settings = {
  open: {},
  answers: { locked: true },
  past: { locked: true, unlockAt: Date.now() - hour },
  future: { locked: true, unlockAt: Date.now() + 24 * hour },
  switched: { locked: true, unlocked: true, unlockAt: Date.now() + 24 * hour },
};

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'classes/c1'), { name: '8A', subject: '', year: '', owner: 'gabe', currentKey: KEY, archived: false });
    await setDoc(doc(db, 'classes/c1/members/s1'), { key: KEY });
    await setDoc(doc(db, 'allowedTeachers/gabe@example.com'), { addedAt: 1 });
    await setDoc(doc(db, 'allowedTeachers/other@example.com'), { addedAt: 1 });
    await setDoc(doc(db, 'classes/c1/files/open'), file());
    await setDoc(doc(db, 'classes/c1/files/answers'), file({ name: 'answers.pdf', locked: true }));
    await setDoc(doc(db, 'classes/c1/files/past'), file({ locked: true, unlockAt: Timestamp.fromMillis(Date.now() - hour) }));
    await setDoc(doc(db, 'classes/c1/files/future'), file({ locked: true, unlockAt: Timestamp.fromMillis(Date.now() + 24 * hour) }));
    await setDoc(doc(db, 'classes/c1/files/switched'), file({ locked: true, unlocked: true, unlockAt: Timestamp.fromMillis(Date.now() + 24 * hour) }));
    const st = ctx.storage();
    for (const [id, a] of Object.entries(settings)) {
      await uploadBytes(ref(st, path(id)), bytes, { contentType: PDF, customMetadata: access(a) });
    }
    // Uploaded before the lock settings were copied onto files.
    await setDoc(doc(db, 'classes/c1/files/legacy'), file());
    await uploadBytes(ref(st, path('legacy')), bytes, { contentType: PDF });
  });
});

const teacher = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const student = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } });
const canRead = (ctx, id) => getMetadata(ref(ctx.storage(), path(id)));

/* ---------- reading ---------- */

test('a member opens ordinary lesson files', async () => {
  await assertSucceeds(canRead(student('s1'), 'open'));
});

test('teacher-only files stay shut for students until their date or the switch', async () => {
  const s = student('s1');
  await assertFails(canRead(s, 'answers'));
  await assertFails(canRead(s, 'future'));
  await assertSucceeds(canRead(s, 'past'));
  await assertSucceeds(canRead(s, 'switched'));
});

test('flipping the switch opens a teacher-only file straight away', async () => {
  await assertFails(canRead(student('s1'), 'answers'));
  await assertSucceeds(updateMetadata(ref(teacher('gabe').storage(), path('answers')), { customMetadata: access({ locked: true, unlocked: true }) }));
  await assertSucceeds(canRead(student('s1'), 'answers'));
});

// Firebase lets Storage rules look at only two Firestore documents per request (the emulator
// doesn't enforce this). The student check must use just the class and the membership.
test('students open files without the rules reading the file record', async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'classes/c1/files/open')));
  await assertSucceeds(canRead(student('s1'), 'open'));
});

test('a file without lock settings stays shut for students until the teacher adds them', async () => {
  await assertFails(canRead(student('s1'), 'legacy'));
  await assertSucceeds(canRead(teacher('gabe'), 'legacy'));
  await assertSucceeds(updateMetadata(ref(teacher('gabe').storage(), path('legacy')), { customMetadata: access() }));
  await assertSucceeds(canRead(student('s1'), 'legacy'));
});

test('students cannot change lock settings', async () => {
  await assertFails(updateMetadata(ref(student('s1').storage(), path('answers')), { customMetadata: access() }));
});

test('the teacher opens every file, locked or not', async () => {
  for (const id of ['open', 'answers', 'future']) await assertSucceeds(canRead(teacher('gabe'), id));
});

test('non-members, other teachers and signed-out visitors open nothing', async () => {
  await assertFails(canRead(student('stranger'), 'open'));
  await assertFails(canRead(teacher('other'), 'open'));
  await assertFails(canRead(env.unauthenticatedContext(), 'open'));
});

test('a new key or archiving cuts students off from files', async () => {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'classes/c1'), { currentKey: 'ZZ22HH77' }));
  await assertFails(canRead(student('s1'), 'open'));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'classes/c1'), { currentKey: KEY, archived: true }));
  await assertFails(canRead(student('s1'), 'open'));
});

test('another teacher copying the class with its key opens every file, teacher-only ones too', async () => {
  await assertSucceeds(setDoc(doc(teacher('other').firestore(), 'classes/c1/importers/other'), { key: KEY }));
  for (const id of ['open', 'answers', 'future', 'legacy']) await assertSucceeds(canRead(teacher('other'), id));
  await assertFails(uploadBytes(ref(teacher('other').storage(), path('x')), bytes, { contentType: PDF }));
  await assertFails(deleteObject(ref(teacher('other').storage(), path('open'))));
});

test('an import record with an old key, or on an archived class, opens nothing', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'classes/c1/importers/other'), { key: KEY }));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'classes/c1'), { currentKey: 'ZZ22HH77' }));
  await assertFails(canRead(teacher('other'), 'open'));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'classes/c1'), { currentKey: KEY, archived: true }));
  await assertFails(canRead(teacher('other'), 'open'));
});

test('a student cannot use an import record to open teacher-only files', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'classes/c1/importers/s1'), { key: KEY }));
  await assertFails(canRead(student('s1'), 'answers'));
  await assertSucceeds(canRead(student('s1'), 'open'));
});

/* ---------- writing ---------- */

test('the teacher uploads PDF, PowerPoint, Word and pictures', async () => {
  const st = teacher('gabe').storage();
  const types = [
    PDF,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png', 'image/jpeg',
  ];
  for (const [i, contentType] of types.entries()) {
    await assertSucceeds(uploadBytes(ref(st, path(`new${i}`, `f${i}`)), bytes, { contentType }));
  }
});

test('other file types and files over 50 MB are refused', async () => {
  const st = teacher('gabe').storage();
  await assertFails(uploadBytes(ref(st, path('x', 'run.exe')), bytes, { contentType: 'application/x-msdownload' }));
  await assertFails(uploadBytes(ref(st, path('x', 'page.html')), bytes, { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(st, path('x', 'big.pdf')), new Uint8Array(50 * 1024 * 1024 + 1), { contentType: PDF }));
});

test('students and other teachers cannot upload or delete', async () => {
  await assertFails(uploadBytes(ref(student('s1').storage(), path('x')), bytes, { contentType: PDF }));
  await assertFails(uploadBytes(ref(teacher('other').storage(), path('x')), bytes, { contentType: PDF }));
  await assertFails(deleteObject(ref(student('s1').storage(), path('open'))));
  await assertSucceeds(deleteObject(ref(teacher('gabe').storage(), path('open'))));
});

test('nothing outside class files can be read or written', async () => {
  await assertFails(uploadBytes(ref(teacher('gabe').storage(), 'other/thing.pdf'), bytes, { contentType: PDF }));
});

/* ---------- file records in Firestore ---------- */

test('students can see file records but not change them', async () => {
  const db = student('s1').firestore();
  const { getDoc } = await import('firebase/firestore');
  await assertSucceeds(getDoc(doc(db, 'classes/c1/files/answers')));
  await assertFails(updateDoc(doc(db, 'classes/c1/files/answers'), { unlocked: true }));
  await assertFails(getDoc(doc(student('stranger').firestore(), 'classes/c1/files/open')));
});

test('file records must have the expected shape', async () => {
  const db = teacher('gabe').firestore();
  await assertSucceeds(setDoc(doc(db, 'classes/c1/files/n1'), file()));
  await assertFails(setDoc(doc(db, 'classes/c1/files/n2'), { ...file(), extra: 1 }));
  await assertFails(setDoc(doc(db, 'classes/c1/files/n3'), file({ size: 60 * 1024 * 1024 })));
  await assertFails(setDoc(doc(db, 'classes/c1/files/n4'), file({ unlockAt: 'tomorrow' })));
});

test('a teacher taken off the list can no longer upload or open locked files', async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'allowedTeachers/gabe@example.com')));
  await assertFails(uploadBytes(ref(teacher('gabe').storage(), path('x')), bytes, { contentType: PDF }));
  await assertFails(canRead(teacher('gabe'), 'answers'));
});
