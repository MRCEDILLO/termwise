// Firebase data layer. app.js only talks to the store returned here (or the demo store),
// never to Firebase directly. Firebase is loaded from a pinned CDN version.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInAnonymously, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  writeBatch, query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { newKey } from './keys.js';
import { emptyPlan } from './planner.js';

export function createFirebaseStore(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

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
      await setDoc(doc(db, 'teachers', u.uid), { name: u.displayName || '', email: u.email || '' }, { merge: true });
    },

    signOut() {
      return signOut(auth);
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
        b.set(ref, { name, subject, year, colour, owner: uid, currentKey: key, archived: false, createdAt: serverTimestamp() });
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
