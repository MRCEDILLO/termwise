/* =====================================================================
   TEACHER SETTINGS: edit this block, nothing else.

   1. In the Firebase console, open Project settings > General > Your apps,
      add a Web app, and copy its firebaseConfig values in below.
   2. Commit the change. The site switches from demo mode to Firebase.

   Leave apiKey empty to run in DEMO MODE: everything is saved in this
   browser only, with a sample class so you can try the planner.

   These values are not secret. The security rules (firestore.rules)
   are what keep each class private.
   ===================================================================== */

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyApjpseJeJpFWW1xwI4JgYTC5F3_EDrP_w',
  authDomain: 'termwise-1fed1.firebaseapp.com',
  projectId: 'termwise-1fed1',
  storageBucket: 'termwise-1fed1.firebasestorage.app',
  messagingSenderId: '353381592713',
  appId: '1:353381592713:web:f43c37f724050dbc34a058',
};

export const SITE_NAME = 'Termwise';

// The admin: always a teacher, and the only one who sees the Teachers page where other
// teachers' emails are added. Also written into firestore.rules and storage.rules.
export const ADMIN_EMAIL = 'gabrielcedillo2002@gmail.com';
