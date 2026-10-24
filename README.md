# Termwise

A Google Classroom-style site where the term plan and the lesson materials are the same thing. Change the plan, and every student sees the right lesson on the right day.

- **Teachers** sign in with Google, create classes, set up terms and the meeting pattern, pick a term and drag its lesson cards into order. Each term's lessons fill that term's free periods automatically, as in the Term Planner spreadsheet.
- **Students** type the class key. No account and no name: they land on a week calendar (days across, periods down, with lesson tiles) and can flip to earlier or later weeks. There's also a week-by-week list and the full timetable.

The site is static (GitHub Pages). Firebase holds the data, and `firestore.rules` decides who can read and write what.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `styles.css` | Page shell and look |
| `app.js` | Screens: front page, class lists, and each class's tabs (Home, Lessons, Planner, Week, Timetable, Setup) |
| `planner.js` | The scheduling engine (the spreadsheet's rules). No Firebase, no DOM |
| `firebase.js` | Firebase sign-in and data. Loaded only when `config.js` has settings |
| `demo.js` | Same interface as `firebase.js`, saved in the browser, with a sample class |
| `files.js` | Lesson file rules shared by both stores: allowed types, 50 MB limit, when a teacher-only file opens |
| `keys.js` | Class keys: 8 characters, no look-alike letters |
| `config.js` | **The one file to edit**: your Firebase settings |
| `firestore.rules`, `storage.rules` | Security rules (the real lock) |
| `tests/` | Developer tests (planner, rules, Firebase end to end). Not part of the site |

No build step and no npm for the site itself. Firebase comes from the pinned CDN version 10.12.2.

## Demo mode

With `config.js` left empty, the site runs in demo mode: everything is saved in this browser only, with a sample class (8A Maths). The front page shows the sample class key, so you can try the student view too.

## Setting up Firebase

Sign-in, classes, keys and the planner work on Firebase's free **Spark** plan. Lesson files need Cloud Storage, which needs the **Blaze** (pay-as-you-go) plan (step 7).

1. Go to [console.firebase.google.com](https://console.firebase.google.com), choose **Create a project**, and call it `termwise`. Google Analytics can be turned off.
2. **Build > Authentication > Get started.** On **Sign-in method**, turn on **Google** (pick your email as the support email) and **Anonymous**.
3. **Authentication > Settings > Authorized domains:** add `mrcedillo.github.io`.
4. **Build > Firestore Database > Create database.** Choose the **australia-southeast1 (Sydney)** or **australia-southeast2 (Melbourne)** location, so student names stay in Australia, and start in **production mode**. The location can't be changed later.
5. Firestore's **Rules** tab: replace everything with the contents of `firestore.rules` and click **Publish**.
6. **Project settings (gear) > General > Your apps:** click the web icon `</>`, call the app `Termwise`, and skip Hosting. Copy the `firebaseConfig` values into `config.js`. They aren't secret.
7. **Blaze and a budget alert** (needed before Phase 3): click **Upgrade** next to the plan name, add a billing account, then in the Google Cloud console open **Billing > Budgets & alerts** and create a budget of a few dollars with email alerts. Check the current free allowance on Firebase's pricing page.
8. **Build > Storage > Get started.** Start in **production mode** and pick the same Australian location as Firestore.
9. Storage's **Rules** tab: replace everything with the contents of `storage.rules` and click **Publish**. Storage rules read Firestore to check who is in a class, so if the console asks to give Storage access to Firestore, allow it.

Whenever `firestore.rules` or `storage.rules` changes, paste it into its Rules tab again and publish.

### Who can be a teacher

Anyone can sign in with Google, but only the **admin** and the emails the admin adds can act as teachers. The admin is `ADMIN_EMAIL` in `config.js`, and the same address is written into `firestore.rules` and `storage.rules` (change all three together). Signed in as the admin, open **Teachers** in the top bar to add or remove teacher emails. Anyone else who signs in with Google sees a "not on the teacher list" page. Students are unaffected: they join with a class key.

## Tests

```
cd tests
npm install
npm test
```

`npm test` runs the planner tests, the security rules tests in the Firestore emulator, the Storage rules tests, and an end-to-end test of `firebase.js` (classes, keys and lesson files) against the Auth, Firestore and Storage emulators. The emulators need Java 11 or newer. The same tests run on every pull request (`.github/workflows/tests.yml`).

## Build phases

1. Foundations: sign-in, classes, keys, security rules with tests. **Done**
2. Live planner: terms, meeting pattern, events, drag-and-drop lessons, auto-schedule, capacity banner, student lesson list and timetable. **Done**
3. Materials: uploads per lesson (PDF, PowerPoint, Word, pictures, up to 50 MB), downloads, teacher-only files that open on a date or when the teacher flips the switch. **Done**
   - Class page overhaul: a Home tab (class details, teacher contact, announcements, this week, coming up), a Lessons library of units and lessons with a lesson builder, and a Planner that searches the library to fill each term. Shift-drag moves a run of lessons from one unit together. **Done**
4. Tracker and reports.
5. Templates, export, delete.
