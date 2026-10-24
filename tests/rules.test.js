// Firestore security rules tests. Run with: npm run test:rules (starts the emulator).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, query, where,
} from 'firebase/firestore';

let env;
const KEY = 'K7QA4MXB';
const NEW_KEY = 'ZZ22HH77';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-termwise',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  // Gabe owns class c1 with key KEY. Student s1 is a member.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'classes/c1'), classData('gabe'));
    await setDoc(doc(db, `joinKeys/${KEY}`), { classId: 'c1', owner: 'gabe' });
    await setDoc(doc(db, 'classes/c1/members/s1'), { key: KEY });
    await setDoc(doc(db, 'classes/c1/plan/main'), { pattern: [] });
    await setDoc(doc(db, 'classes/c1/lessons/l1'), { title: '1A', periods: 2, order: 0 });
    await setDoc(doc(db, 'classes/c1/students/st1'), { name: 'Sam P' });
    await setDoc(doc(db, 'classes/c1/marks/m1'), { score: 7 });
    await setDoc(doc(db, 'classes/c1/tracker/settings'), { max: { 'a-l1': 20 } });
    // The admin has let these two teachers in.
    await setDoc(doc(db, 'allowedTeachers/gabe@example.com'), { addedAt: 1 });
    await setDoc(doc(db, 'allowedTeachers/other@example.com'), { addedAt: 1 });
  });
});

function classData(owner, extra = {}) {
  return { name: '8A Maths', subject: 'Maths', year: '2027', owner, currentKey: KEY, archived: false, ...extra };
}
const ADMIN_EMAIL = 'gabrielcedillo2002@gmail.com';
const google = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } }).firestore();
const teacher = (uid) => google(uid, `${uid}@example.com`);
const admin = () => google('admin-uid', ADMIN_EMAIL);
const student = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const nobody = () => env.unauthenticatedContext().firestore();

/* ---------- classes ---------- */

test('a teacher creates a class and its key in one batch', async () => {
  const db = teacher('gabe');
  const b = writeBatch(db);
  b.set(doc(db, 'classes/c2'), classData('gabe', { currentKey: NEW_KEY }));
  b.set(doc(db, `joinKeys/${NEW_KEY}`), { classId: 'c2', owner: 'gabe' });
  await assertSucceeds(b.commit());
});

test('a class cannot be created without registering its key', async () => {
  await assertFails(setDoc(doc(teacher('gabe'), 'classes/c2'), classData('gabe', { currentKey: NEW_KEY })));
});

test('a key already in use cannot be claimed by another class', async () => {
  const db = teacher('other');
  const b = writeBatch(db);
  b.set(doc(db, 'classes/c9'), classData('other'));
  b.set(doc(db, `joinKeys/${KEY}`), { classId: 'c9', owner: 'other' });
  await assertFails(b.commit());
});

test('a key with look-alike letters is rejected', async () => {
  const db = teacher('gabe');
  const b = writeBatch(db);
  b.set(doc(db, 'classes/c2'), classData('gabe', { currentKey: 'O0IL1ABC' }));
  b.set(doc(db, 'joinKeys/O0IL1ABC'), { classId: 'c2', owner: 'gabe' });
  await assertFails(b.commit());
});

test('a student (anonymous) cannot create a class', async () => {
  const db = student('s9');
  const b = writeBatch(db);
  b.set(doc(db, 'classes/c2'), classData('s9', { currentKey: NEW_KEY }));
  b.set(doc(db, `joinKeys/${NEW_KEY}`), { classId: 'c2', owner: 's9' });
  await assertFails(b.commit());
});

test('one teacher cannot see or change another teacher\'s class', async () => {
  const db = teacher('other');
  await assertFails(getDoc(doc(db, 'classes/c1')));
  await assertFails(updateDoc(doc(db, 'classes/c1'), { name: 'Hacked' }));
  await assertFails(getDocs(collection(db, 'classes/c1/lessons')));
  await assertFails(getDocs(collection(db, 'classes/c1/students')));
  await assertFails(deleteDoc(doc(db, 'classes/c1')));
});

test('a teacher can list only their own classes', async () => {
  await assertSucceeds(getDocs(query(collection(teacher('gabe'), 'classes'), where('owner', '==', 'gabe'))));
  await assertFails(getDocs(collection(teacher('gabe'), 'classes')));
});

test('the owner cannot hand the class to someone else', async () => {
  await assertFails(updateDoc(doc(teacher('gabe'), 'classes/c1'), { owner: 'other' }));
});

/* ---------- keys and joining ---------- */

test('anyone signed in can look up one exact key, nobody can list keys', async () => {
  await assertSucceeds(getDoc(doc(student('s9'), `joinKeys/${KEY}`)));
  await assertFails(getDocs(collection(student('s9'), 'joinKeys')));
  await assertFails(getDocs(collection(teacher('gabe'), 'joinKeys')));
  await assertFails(getDoc(doc(nobody(), `joinKeys/${KEY}`)));
});

test('a student joins with the right key and can then read lessons', async () => {
  const db = student('s2');
  await assertSucceeds(setDoc(doc(db, 'classes/c1/members/s2'), { key: KEY }));
  await assertSucceeds(getDoc(doc(db, 'classes/c1')));
  await assertSucceeds(getDocs(collection(db, 'classes/c1/lessons')));
  await assertSucceeds(getDoc(doc(db, 'classes/c1/plan/main')));
});

test('a wrong key does not let a student join', async () => {
  const db = student('s2');
  await assertFails(setDoc(doc(db, 'classes/c1/members/s2'), { key: NEW_KEY }));
  await assertFails(getDocs(collection(db, 'classes/c1/lessons')));
});

test('a student cannot join as somebody else or add extra fields', async () => {
  await assertFails(setDoc(doc(student('s2'), 'classes/c1/members/s3'), { key: KEY }));
  await assertFails(setDoc(doc(student('s2'), 'classes/c1/members/s2'), { key: KEY, role: 'teacher' }));
});

test('regenerating the key cuts off existing members at once', async () => {
  const db = teacher('gabe');
  const b = writeBatch(db);
  b.delete(doc(db, `joinKeys/${KEY}`));
  b.set(doc(db, `joinKeys/${NEW_KEY}`), { classId: 'c1', owner: 'gabe' });
  b.update(doc(db, 'classes/c1'), { currentKey: NEW_KEY });
  await assertSucceeds(b.commit());
  await assertFails(getDocs(collection(student('s1'), 'classes/c1/lessons')));
  await assertFails(getDoc(doc(student('s1'), 'classes/c1')));
  // Re-entering the new key lets them back in.
  await assertSucceeds(setDoc(doc(student('s1'), 'classes/c1/members/s1'), { key: NEW_KEY }));
  await assertSucceeds(getDocs(collection(student('s1'), 'classes/c1/lessons')));
});

test('archiving a class cuts off members and blocks new joins', async () => {
  await assertSucceeds(updateDoc(doc(teacher('gabe'), 'classes/c1'), { archived: true }));
  await assertFails(getDocs(collection(student('s1'), 'classes/c1/lessons')));
  await assertFails(setDoc(doc(student('s2'), 'classes/c1/members/s2'), { key: KEY }));
});

test('a teacher cannot register a key for someone else\'s class', async () => {
  const db = teacher('other');
  await assertFails(setDoc(doc(db, `joinKeys/${NEW_KEY}`), { classId: 'c1', owner: 'other' }));
  await assertFails(deleteDoc(doc(db, `joinKeys/${KEY}`)));
});

test('a teacher cannot point their class at a key another class uses', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'classes/c9'), classData('other', { currentKey: NEW_KEY }));
    await setDoc(doc(db, `joinKeys/${NEW_KEY}`), { classId: 'c9', owner: 'other' });
  });
  await assertFails(updateDoc(doc(teacher('other'), 'classes/c9'), { currentKey: KEY }));
  // Creating a new class on that key fails too.
  await assertFails(setDoc(doc(teacher('other'), 'classes/c8'), classData('other')));
});

test('class colour and join time must be plain numbers', async () => {
  await assertFails(updateDoc(doc(teacher('gabe'), 'classes/c1'), { colour: 'x'.repeat(5000) }));
  await assertSucceeds(updateDoc(doc(teacher('gabe'), 'classes/c1'), { colour: 3 }));
  await assertFails(setDoc(doc(student('s2'), 'classes/c1/members/s2'), { key: KEY, joinedAt: 'x'.repeat(5000) }));
  await assertSucceeds(setDoc(doc(student('s2'), 'classes/c1/members/s2'), { key: KEY, joinedAt: Date.now() }));
});

/* ---------- what students can and cannot do ---------- */

test('students never read names or marks', async () => {
  const db = student('s1');
  await assertFails(getDocs(collection(db, 'classes/c1/students')));
  await assertFails(getDoc(doc(db, 'classes/c1/students/st1')));
  await assertFails(getDocs(collection(db, 'classes/c1/marks')));
  await assertFails(getDoc(doc(db, 'classes/c1/marks/s1')));
  await assertFails(getDoc(doc(db, 'classes/c1/tracker/settings')));
  await assertFails(setDoc(doc(db, 'classes/c1/marks/s1'), { a: { 'a-l1': 20 } }));
  await assertFails(getDocs(collection(db, 'classes/c1/members')));
});

test('other teachers and removed teachers cannot see the tracker', async () => {
  await assertFails(getDocs(collection(teacher('other'), 'classes/c1/marks')));
  await assertFails(getDoc(doc(teacher('other'), 'classes/c1/tracker/settings')));
  // Gabe's account, but his email has been taken off the admin's list.
  const removed = google('gabe', 'gone@example.com');
  await assertFails(getDocs(collection(removed, 'classes/c1/students')));
  await assertFails(getDoc(doc(removed, 'classes/c1/tracker/settings')));
});

test('students cannot change the plan or lessons', async () => {
  const db = student('s1');
  await assertFails(updateDoc(doc(db, 'classes/c1/lessons/l1'), { title: 'Free period' }));
  await assertFails(setDoc(doc(db, 'classes/c1/plan/main'), { pattern: ['1-1'] }));
  await assertFails(updateDoc(doc(db, 'classes/c1'), { name: 'Hacked' }));
});

test('signed-out visitors can read nothing', async () => {
  const db = nobody();
  await assertFails(getDoc(doc(db, 'classes/c1')));
  await assertFails(getDocs(collection(db, 'classes/c1/lessons')));
});

test('the owner manages the plan, lessons, students and marks', async () => {
  const db = teacher('gabe');
  await assertSucceeds(setDoc(doc(db, 'classes/c1/plan/main'), { pattern: ['1-1'] }));
  await assertSucceeds(setDoc(doc(db, 'classes/c1/lessons/l2'), { title: '1B', periods: 1, order: 1 }));
  await assertSucceeds(getDocs(collection(db, 'classes/c1/students')));
  await assertSucceeds(setDoc(doc(db, 'classes/c1/marks/m2'), { score: 5 }));
  await assertSucceeds(setDoc(doc(db, 'classes/c1/tracker/settings'), { max: {}, extra: [] }));
  await assertSucceeds(getDoc(doc(db, 'classes/c1/tracker/settings')));
  await assertSucceeds(getDocs(collection(db, 'classes/c1/members')));
});

test('teacher profile is private to that teacher', async () => {
  await assertSucceeds(setDoc(doc(teacher('gabe'), 'teachers/gabe'), { name: 'Gabe' }));
  await assertFails(getDoc(doc(teacher('other'), 'teachers/gabe')));
  await assertFails(setDoc(doc(student('gabe'), 'teachers/gabe'), { name: 'x' }));
});

/* ---------- class home page: contact details, units, announcements ---------- */

test('the teacher\'s name, contact details and about text are short plain text', async () => {
  const db = teacher('gabe');
  await assertSucceeds(updateDoc(doc(db, 'classes/c1'), { teacher: 'Mr Cedillo', contact: 'gabe@school.vic.edu.au', about: 'Year 8 maths.' }));
  await assertFails(updateDoc(doc(db, 'classes/c1'), { contact: 'x'.repeat(201) }));
  await assertFails(updateDoc(doc(db, 'classes/c1'), { about: 42 }));
  await assertFails(updateDoc(doc(student('s1'), 'classes/c1'), { contact: 'hacked' }));
});

test('members read units and announcements, only the owner writes them', async () => {
  const t = teacher('gabe');
  await assertSucceeds(setDoc(doc(t, 'classes/c1/units/u1'), { name: 'Fractions', order: 0 }));
  await assertSucceeds(setDoc(doc(t, 'classes/c1/announcements/a1'), { text: 'Test on Friday', createdAt: Date.now() }));
  const s = student('s1');
  await assertSucceeds(getDocs(collection(s, 'classes/c1/units')));
  await assertSucceeds(getDocs(collection(s, 'classes/c1/announcements')));
  await assertFails(setDoc(doc(s, 'classes/c1/units/u2'), { name: 'Mine', order: 1 }));
  await assertFails(setDoc(doc(s, 'classes/c1/announcements/a2'), { text: 'No homework!', createdAt: Date.now() }));
  await assertFails(deleteDoc(doc(s, 'classes/c1/announcements/a1')));
  await assertFails(getDocs(collection(student('stranger'), 'classes/c1/announcements')));
});

test('announcements are text only', async () => {
  const t = teacher('gabe');
  await assertFails(setDoc(doc(t, 'classes/c1/announcements/a3'), { text: '' }));
  await assertFails(setDoc(doc(t, 'classes/c1/announcements/a4'), { text: 'Hi', pinned: true }));
  await assertFails(setDoc(doc(t, 'classes/c1/announcements/a5'), { text: 'x'.repeat(4001) }));
  await assertSucceeds(deleteDoc(doc(t, 'classes/c1/announcements/a3')));
});

/* ---------- who may be a teacher ---------- */

test('a Google account the admin has not added is not a teacher', async () => {
  const db = google('newbie', 'newbie@example.com');
  const b = writeBatch(db);
  b.set(doc(db, 'classes/c2'), classData('newbie', { currentKey: NEW_KEY }));
  b.set(doc(db, `joinKeys/${NEW_KEY}`), { classId: 'c2', owner: 'newbie' });
  await assertFails(b.commit());
  await assertFails(setDoc(doc(db, 'teachers/newbie'), { name: 'New' }));
  await assertFails(getDocs(query(collection(db, 'classes'), where('owner', '==', 'newbie'))));
});

test('taking a teacher off the list locks them out of their own class', async () => {
  await assertSucceeds(getDoc(doc(teacher('gabe'), 'classes/c1')));
  await assertSucceeds(deleteDoc(doc(admin(), 'allowedTeachers/gabe@example.com')));
  await assertFails(getDoc(doc(teacher('gabe'), 'classes/c1')));
  await assertFails(setDoc(doc(teacher('gabe'), 'classes/c1/plan/main'), { pattern: [] }));
});

test('an unverified email does not count, even if it is on the list', async () => {
  const db = env.authenticatedContext('gabe', { email: 'gabe@example.com', email_verified: false, firebase: { sign_in_provider: 'google.com' } }).firestore();
  await assertFails(getDoc(doc(db, 'classes/c1')));
});

test('the admin is always a teacher and manages the list', async () => {
  const db = admin();
  const b = writeBatch(db);
  b.set(doc(db, 'classes/c2'), classData('admin-uid', { currentKey: NEW_KEY }));
  b.set(doc(db, `joinKeys/${NEW_KEY}`), { classId: 'c2', owner: 'admin-uid' });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDocs(collection(db, 'allowedTeachers')));
  await assertSucceeds(setDoc(doc(db, 'allowedTeachers/new.teacher@school.vic.edu.au'), { addedAt: Date.now() }));
  await assertFails(setDoc(doc(db, 'allowedTeachers/Mixed@Case.com'), { addedAt: Date.now() }));
  await assertFails(setDoc(doc(db, 'allowedTeachers/not-an-email'), { addedAt: Date.now() }));
  await assertFails(setDoc(doc(db, 'allowedTeachers/x@y.com'), { addedAt: Date.now(), role: 'admin' }));
});

test('nobody else can see or change the list, but a teacher can check their own entry', async () => {
  await assertSucceeds(getDoc(doc(teacher('gabe'), 'allowedTeachers/gabe@example.com')));
  await assertSucceeds(getDoc(doc(google('newbie', 'newbie@example.com'), 'allowedTeachers/newbie@example.com')));
  await assertFails(getDoc(doc(teacher('gabe'), 'allowedTeachers/other@example.com')));
  await assertFails(getDocs(collection(teacher('gabe'), 'allowedTeachers')));
  await assertFails(setDoc(doc(google('newbie', 'newbie@example.com'), 'allowedTeachers/newbie@example.com'), { addedAt: 1 }));
  await assertFails(setDoc(doc(teacher('gabe'), 'allowedTeachers/friend@example.com'), { addedAt: 1 }));
  await assertFails(deleteDoc(doc(teacher('gabe'), 'allowedTeachers/other@example.com')));
  await assertFails(getDoc(doc(student('s1'), 'allowedTeachers/gabe@example.com')));
  // A look-alike of the admin's address is just another account.
  await assertFails(getDocs(collection(google('fake', 'gabrielcedillo2002@gmail.com.evil.com'), 'allowedTeachers')));
});
