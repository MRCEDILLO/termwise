// Firebase data layer. app.js only talks to the store returned here (or the demo store),
// never to Firebase directly. Firebase is loaded from a pinned CDN version.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  writeBatch, query, where, orderBy, limit, serverTimestamp, Timestamp, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { FILE_TYPES, fileExt, storageName } from './files.js';
import { newKey } from './keys.js';
import { emptyPlan } from './planner.js';

export function createFirebaseStore(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  const fileRef = (classId, f) => ref(storage, `classes/${classId}/files/${f.id}/${storageName(f.name)}`);
  // Firestore keeps unlockAt as a Timestamp; the app uses milliseconds.
  const fileFromDoc = (d) => {
    const data = d.data();
    return { id: d.id, ...data, unlockAt: data.unlockAt ? data.unlockAt.toMillis() : null };
  };

  const toUser = (u) => u && {
    uid: u.uid,
    name: u.displayName || '',
    email: u.email || '',
    isTeacher: u.providerData.some((p) => p.providerId === 'google.com'),
  };

  // Permission errors mean "you can't see this" (wrong key, archived, someone else's class).
  async function orNull(promise) {
    try { return await promise; } catch (e) {
      if (e && e.code === 'permission-denied') return null;
      throw e;
    }
  }

  async function ensureAnon() {
    if (!auth.currentUser) await signInAnonymously(auth);
    return auth.currentUser;
  }

  return {
    mode: 'firebase',

    onAuth(cb) {
      return onAuthStateChanged(auth, (u) => cb(toUser(u)));
    },

    async signInTeacher() {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const u = cred.user;
      // Refused for accounts not on the admin's list; the app shows them a "not on the list" page.
      await setDoc(doc(db, 'teachers', u.uid), { name: u.displayName || '', email: u.email || '' }, { merge: true })
        .catch((e) => { if (e.code !== 'permission-denied') throw e; });
    },

    signOut() {
      return signOut(auth);
    },

    /* ---------- who may be a teacher ---------- */

    async isAllowedTeacher(email) {
      const snap = await orNull(getDoc(doc(db, 'allowedTeachers', email.toLowerCase())));
      return !!(snap && snap.exists());
    },

    async listAllowedTeachers() {
      const snap = await getDocs(collection(db, 'allowedTeachers'));
      return snap.docs.map((d) => ({ email: d.id, addedAt: d.data().addedAt || 0 }));
    },

    allowTeacher(email) {
      return setDoc(doc(db, 'allowedTeachers', email.toLowerCase()), { addedAt: Date.now() });
    },

    removeTeacher(email) {
      return deleteDoc(doc(db, 'allowedTeachers', email.toLowerCase()));
    },

    /* ---------- classes ---------- */

    async listMyClasses() {
      const uid = auth.currentUser.uid;
      const snap = await getDocs(query(collection(db, 'classes'), where('owner', '==', uid)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async createClass({ name, subject, year, colour }) {
      const uid = auth.currentUser.uid;
      const ref = doc(collection(db, 'classes'));
      // A clash with an existing key is refused by the rules, so try a fresh one.
      for (let attempt = 0; attempt < 5; attempt++) {
        const key = newKey();
        const b = writeBatch(db);
        b.set(ref, {
          name, subject, year, colour, owner: uid, currentKey: key, archived: false, createdAt: serverTimestamp(),
          teacher: (auth.currentUser.displayName || '').slice(0, 80),
        });
        b.set(doc(db, 'joinKeys', key), { classId: ref.id, owner: uid });
        try {
          await b.commit();
          return ref.id;
        } catch (e) {
          if (e.code !== 'permission-denied' || attempt === 4) throw e;
        }
      }
    },

    async getClass(id) {
      const snap = await orNull(getDoc(doc(db, 'classes', id)));
      return snap && snap.exists() ? { id, ...snap.data() } : null;
    },

    updateClass(id, patch) {
      return updateDoc(doc(db, 'classes', id), patch);
    },

    // Not offered while a class is archived (it has no key lookup to swap).
    async regenerateKey(id) {
      const cls = await this.getClass(id);
      for (let attempt = 0; attempt < 5; attempt++) {
        const key = newKey();
        const b = writeBatch(db);
        b.delete(doc(db, 'joinKeys', cls.currentKey));
        b.update(doc(db, 'classes', id), { currentKey: key });
        b.set(doc(db, 'joinKeys', key), { classId: id, owner: cls.owner });
        try {
          await b.commit();
          return key;
        } catch (e) {
          if (e.code !== 'permission-denied' || attempt === 4) throw e;
        }
      }
    },

    // Archiving removes the key lookup as well, so the key stops working straight away.
    async setArchived(id, archived) {
      const cls = await this.getClass(id);
      const b = writeBatch(db);
      b.update(doc(db, 'classes', id), { archived });
      if (archived) b.delete(doc(db, 'joinKeys', cls.currentKey));
      else b.set(doc(db, 'joinKeys', cls.currentKey), { classId: id, owner: cls.owner });
      await b.commit();
    },

    /* ---------- plan and lessons ---------- */

    async getPlan(id) {
      const snap = await getDoc(doc(db, 'classes', id, 'plan', 'main'));
      return snap.exists() ? { ...emptyPlan(), ...snap.data() } : emptyPlan();
    },

    savePlan(id, plan) {
      return setDoc(doc(db, 'classes', id, 'plan', 'main'), plan);
    },

    async getLessons(id) {
      const snap = await getDocs(query(collection(db, 'classes', id, 'lessons'), orderBy('order')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    newLessonId(id) {
      return doc(collection(db, 'classes', id, 'lessons')).id;
    },

    saveLesson(id, lesson) {
      const { id: lessonId, ...data } = lesson;
      return setDoc(doc(db, 'classes', id, 'lessons', lessonId), data);
    },

    deleteLesson(id, lessonId) {
      return deleteDoc(doc(db, 'classes', id, 'lessons', lessonId));
    },

    async saveOrder(id, lessons) {
      const b = writeBatch(db);
      lessons.forEach((l, i) => b.update(doc(db, 'classes', id, 'lessons', l.id), { order: i }));
      await b.commit();
    },

    /* ---------- units ---------- */

    async getUnits(id) {
      const snap = await getDocs(query(collection(db, 'classes', id, 'units'), orderBy('order')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    newUnitId(id) {
      return doc(collection(db, 'classes', id, 'units')).id;
    },

    saveUnit(id, unit) {
      const { id: unitId, ...data } = unit;
      return setDoc(doc(db, 'classes', id, 'units', unitId), data);
    },

    // The unit's lessons stay, with no unit.
    async deleteUnit(id, unitId, lessonIds) {
      const b = writeBatch(db);
      lessonIds.forEach((l) => b.update(doc(db, 'classes', id, 'lessons', l), { unitId: null }));
      b.delete(doc(db, 'classes', id, 'units', unitId));
      await b.commit();
    },

    /* ---------- announcements ---------- */

    async getAnnouncements(id) {
      const snap = await getDocs(query(collection(db, 'classes', id, 'announcements'), orderBy('createdAt', 'desc'), limit(50)));
      return snap.docs.map((d) => {
        const data = d.data();
        return { id: d.id, text: data.text, createdAt: data.createdAt ? data.createdAt.toMillis() : Date.now() };
      });
    },

    async addAnnouncement(id, text) {
      const ref = doc(collection(db, 'classes', id, 'announcements'));
      await setDoc(ref, { text, createdAt: serverTimestamp() });
      return { id: ref.id, text, createdAt: Date.now() };
    },

    deleteAnnouncement(id, postId) {
      return deleteDoc(doc(db, 'classes', id, 'announcements', postId));
    },

    /* ---------- lesson files ---------- */

    async listFiles(classId) {
      const snap = await getDocs(collection(db, 'classes', classId, 'files'));
      return snap.docs.map(fileFromDoc);
    },

    // The record goes in first, then the file. If the upload fails the record is removed.
    async uploadFile(classId, lessonId, file, { locked = false } = {}, onProgress = () => {}) {
      const id = doc(collection(db, 'classes', classId, 'files')).id;
      const meta = {
        lessonId, name: file.name.slice(0, 200), size: file.size, type: FILE_TYPES[fileExt(file.name)],
        locked, unlocked: false, unlockAt: null, createdAt: serverTimestamp(),
      };
      const recRef = doc(db, 'classes', classId, 'files', id);
      await setDoc(recRef, meta);
      try {
        const task = uploadBytesResumable(fileRef(classId, { id, name: meta.name }), file, { contentType: meta.type });
        task.on('state_changed', (s) => onProgress(s.bytesTransferred / s.totalBytes));
        await task;
      } catch (e) {
        await deleteDoc(recRef).catch(() => {});
        throw e;
      }
      return { id, ...meta, createdAt: Date.now() };
    },

    updateFile(classId, fileId, patch) {
      const p = { ...patch };
      if ('unlockAt' in p) p.unlockAt = p.unlockAt == null ? null : Timestamp.fromMillis(p.unlockAt);
      return updateDoc(doc(db, 'classes', classId, 'files', fileId), p);
    },

    async deleteFile(classId, f) {
      await deleteObject(fileRef(classId, f)).catch((e) => {
        if (e.code !== 'storage/object-not-found') throw e;
      });
      await deleteDoc(doc(db, 'classes', classId, 'files', f.id));
    },

    // A link to open or download the file. Refused by the rules while a file is still locked.
    fileUrl(classId, f) {
      return getDownloadURL(fileRef(classId, f));
    },

    /* ---------- tracker: owner only (the rules refuse everyone else) ---------- */

    async getStudents(id) {
      const snap = await getDocs(collection(db, 'classes', id, 'students'));
      return snap.docs.map((d) => ({ id: d.id, name: d.data().name || '' }));
    },

    newStudentId(id) {
      return doc(collection(db, 'classes', id, 'students')).id;
    },

    async saveStudents(id, list) {
      const b = writeBatch(db);
      list.forEach((s) => b.set(doc(db, 'classes', id, 'students', s.id), { name: s.name }));
      await b.commit();
    },

    // The student's marks go with them.
    async deleteStudent(id, studentId) {
      const b = writeBatch(db);
      b.delete(doc(db, 'classes', id, 'students', studentId));
      b.delete(doc(db, 'classes', id, 'marks', studentId));
      await b.commit();
    },

    // { studentId: { a: { columnId: score or 'IE' }, h: { columnId: true/false } } }
    async getMarks(id) {
      const snap = await getDocs(collection(db, 'classes', id, 'marks'));
      return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    },

    // kind is 'a' (assessment) or 'h' (homework); null clears the cell.
    setMark(id, studentId, kind, colId, value) {
      return setDoc(doc(db, 'classes', id, 'marks', studentId),
        { [kind]: { [colId]: value === null ? deleteField() : value } }, { merge: true });
    },

    // Grading scale, max marks and tracker-only columns. Null until first saved.
    async getTracker(id) {
      const snap = await getDoc(doc(db, 'classes', id, 'tracker', 'settings'));
      return snap.exists() ? snap.data() : null;
    },

    saveTracker(id, tracker) {
      return setDoc(doc(db, 'classes', id, 'tracker', 'settings'), tracker);
    },

    /* ---------- students ---------- */

    // Returns the class id if the key works, otherwise null. Same answer for every failure.
    async joinWithKey(key) {
      await ensureAnon();
      const keySnap = await orNull(getDoc(doc(db, 'joinKeys', key)));
      if (!keySnap || !keySnap.exists()) return null;
      const classId = keySnap.data().classId;
      const ok = await orNull(setDoc(doc(db, 'classes', classId, 'members', auth.currentUser.uid), { key, joinedAt: Date.now() }));
      return ok === null ? null : classId;
    },
  };
}
