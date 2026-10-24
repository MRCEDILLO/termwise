# Termwise

A Google Classroom-style site where the term plan and the lesson materials are the same thing. Change the plan, and every student sees the right lesson on the right day.

- **Teachers** sign in with Google, create classes, set up terms and the meeting pattern, pick a term and drag its lesson cards into order. Each term's lessons fill that term's free periods automatically, as in the Term Planner spreadsheet.
- **Students** type the class key. No account and no name: they see this week's lessons first (worked out from today's date), then every week of the year and the timetable.

The site is static (GitHub Pages). Firebase holds the data, and `firestore.rules` decides who can read and write what.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `styles.css` | Page shell and look |
| `app.js` | Screens: front page, class lists, Lessons, Timetable, Setup |
| `planner.js` | The scheduling engine (the spreadsheet's rules). No Firebase, no DOM |
| `firebase.js` | Firebase sign-in and data. Loaded only when `config.js` has settings |
| `demo.js` | Same interface as `firebase.js`, saved in the browser, with a sample class |
| `keys.js` | Class keys: 8 characters, no look-alike letters |
| `config.js` | **The one file to edit**: your Firebase settings |
| `firestore.rules`, `storage.rules` | Security rules (the real lock) |
| `tests/` | Developer tests (planner, rules, Firebase end to end). Not part of the site |

No build step and no npm for the site itself. Firebase comes from the pinned CDN version 10.12.2.

## Demo mode

With `config.js` left empty, the site runs in demo mode: everything is saved in this browser only, with a sample class (8A Maths). The front page shows the sample class key, so you can try the student view too.

## Setting up Firebase

Phases 1 and 2 (sign-in, classes, keys, planner) work on Firebase's free **Spark** plan. File uploads in Phase 3 need the **Blaze** (pay-as-you-go) plan, so you can upgrade now or when we get there.

1. Go to [console.firebase.google.com](https://console.firebase.google.com), choose **Create a project**, and call it `termwise`. Google Analytics can be turned off.
2. **Build > Authentication > Get started.** On **Sign-in method**, turn on **Google** (pick your email as the support email) and **Anonymous**.
3. **Authentication > Settings > Authorized domains:** add `mrcedillo.github.io`.
4. **Build > Firestore Database > Create database.** Choose the **australia-southeast1 (Sydney)** or **australia-southeast2 (Melbourne)** location, so student names stay in Australia, and start in **production mode**. The location can't be changed later.
5. Firestore's **Rules** tab: replace everything with the contents of `firestore.rules` and click **Publish**.
6. **Project settings (gear) > General > Your apps:** click the web icon `</>`, call the app `Termwise`, and skip Hosting. Copy the `firebaseConfig` values into `config.js`. They aren't secret.
7. **Blaze and a budget alert** (needed before Phase 3): click **Upgrade** next to the plan name, add a billing account, then in the Google Cloud console open **Billing > Budgets & alerts** and create a budget of a few dollars with email alerts. Check the current free allowance on Firebase's pricing page.

Whenever `firestore.rules` changes, paste it into the Rules tab again and publish.

## Tests

```
cd tests
npm install
npm test
```

`npm test` runs the planner tests, the security rules tests in the Firestore emulator, and an end-to-end test of `firebase.js` against the Auth and Firestore emulators. The emulators need Java 11 or newer. The same tests run on every pull request (`.github/workflows/tests.yml`).

## Build phases

1. Foundations: sign-in, classes, keys, security rules with tests. **Done**
2. Live planner: terms, meeting pattern, events, drag-and-drop lessons, auto-schedule, capacity banner, student lesson list and timetable. **Done**
3. Materials: uploads per lesson, downloads, teacher-only files.
4. Tracker and reports.
5. Templates, announcements, export, delete.
