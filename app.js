// Termwise screens. Data goes through `store` (Firebase or the demo store); the
// timetable is always worked out fresh in the browser by planner.js.

import { FIREBASE_CONFIG, SITE_NAME, ADMIN_EMAIL } from './config.js';
import { createDemoStore } from './demo.js';
import { normaliseKey, formatKey } from './keys.js';
import { ACCEPT, fileProblem, isOpen, fileSize, fileIcon, linkUrl, linkHost, MAX_LINKS } from './files.js';
import {
  schedule, emptyPlan, isAssessmentLike, lessonKind, currentWeek, weekRange, slotLabel, cellText, slotDate, daySessions, homeworkDue,
  DAYS, PERIODS_PER_DAY, MAX_WEEKS, TERM_COUNT, clampWeeks,
} from './planner.js';
import {
  emptyTracker, defaultScale, manualLevels, trackerColumns, inTerms, parseScore, result, studentSummary,
  assessmentSummary, homeworkSummary, classHomework, parseNames, sortStudents, scaleProblem, csvText, marksRows,
} from './tracker.js';
import { importEvents, copyToClass } from './template.js';
import { CLASS_FILES } from './files.js';

const store = FIREBASE_CONFIG.apiKey
  ? (await import('./firebase.js')).createFirebaseStore(FIREBASE_CONFIG)
  : createDemoStore();

const $app = document.getElementById('app');
const state = { user: undefined, cls: null };
// Classes whose file lock settings were checked against the stored files this visit.
const syncedFiles = new Set();

// Banner and unit colours, all dark enough for white text. The rules allow up to 32.
export const CLASS_COLOURS = [
  '#1F6FD1', '#0D8466', '#C2410C', '#7C3AED', '#BE185D', '#0E7490', '#4D7C0F', '#A16207',
  '#1E3A8A', '#B91C1C', '#166534', '#4338CA', '#86198F', '#475569', '#7C2D12', '#0F766E',
  // Added later: new colours go on the end so saved choices keep their colour.
  '#0369A1', '#047857', '#E11D48', '#6B21A8', '#B45309', '#7E5A9B', '#4F7A5A', '#1F2937',
];
const colourOf = (c) => CLASS_COLOURS[(Number(c && c.colour) || 0) % CLASS_COLOURS.length];

/* ---------- html helper: everything interpolated is escaped unless wrapped in raw() ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('')
      : v instanceof Raw ? v.s
      : v === false || v === null || v === undefined ? ''
      : esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}
// Assessment (★, red) and revision (↻, violet) markers. lessonKind gives 'assess', 'revise' or ''.
const KINDS = { assess: { mark: '★', label: 'Assessment' }, revise: { mark: '↻', label: 'Revision' } };
const kindMark = (l) => { const k = KINDS[lessonKind(l)]; return k ? `${k.mark} ` : ''; };
// Line-style paperclip that marks lessons with files; it takes the text colour.
const CLIP_ICON = raw('<svg class="clip-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>');
const kindIcon = (kind) => (KINDS[kind] ? html`<span class="mark ${kind}" aria-label="${KINDS[kind].label}">${KINDS[kind].mark}</span> ` : '');
const kindTag = (l) => { const kind = lessonKind(l); return KINDS[kind] ? html`<span class="tag ${kind}-tag">${KINDS[kind].mark} ${KINDS[kind].label}</span>` : ''; };
const show = (el, content) => { el.innerHTML = String(content); };

/* ---------- dates ---------- */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmt = (iso, opts) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', opts) : '');
const fmtDay = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = (iso) => fmt(iso, { day: 'numeric', month: 'short' });
const rangeText = (r) => (r ? `${fmtShort(r.from)} – ${fmtShort(r.to)}` : '');

/* ---------- small things ---------- */

let toastTimer;
let undoAction = null; // what the toast's Undo button (or Ctrl+Z) puts back, while it's showing

// undo: a function that puts back what was just done. The toast then has an Undo button
// and stays up longer, so there's time to reach it.
function toast(msg, kind = 'ok', undo = null) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.addEventListener('click', (ev) => { if (ev.target.closest('[data-undo]')) runUndo(); });
    document.body.append(el);
  }
  el.textContent = msg;
  undoAction = undo;
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.undo = '1';
    b.className = 'toast-undo';
    b.textContent = 'Undo';
    el.append(' ', b);
  }
  el.className = `toast show ${kind}${undo ? ' has-undo' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; undoAction = null; }, undo ? 8000 : kind === 'error' ? 6000 : 1800);
}

function runUndo() {
  const fn = undoAction;
  undoAction = null;
  const el = document.getElementById('toast');
  if (el) el.className = 'toast';
  clearTimeout(toastTimer);
  if (fn) fn();
}

// Ctrl+Z (Cmd+Z on a Mac) undoes the last drag while its toast is up, unless you're typing.
document.addEventListener('keydown', (ev) => {
  if (!undoAction || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.key.toLowerCase() !== 'z') return;
  if (ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable]')) return;
  ev.preventDefault();
  runUndo();
});

async function saving(promise, ok = 'Saved') {
  try {
    await promise;
    if (ok) toast(ok);
    return true;
  } catch (e) {
    console.error(e);
    // A refusal from the security rules usually means the rules published in the
    // Firebase console are older than firestore.rules in this repo.
    toast(e && e.code === 'permission-denied'
      ? "Couldn't save: Firebase refused it. Republish firestore.rules in the Firebase console."
      : "Couldn't save. Check your connection and try again.", 'error');
    return false;
  }
}

// Student's joined classes on this browser.
const JOINED_KEY = 'termwise-joined-v1';
function getJoined() {
  try { return JSON.parse(localStorage.getItem(JOINED_KEY)) || []; } catch { return []; }
}
function setJoined(list) {
  try { localStorage.setItem(JOINED_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
}

/* ---------- live updates ---------- */

// The open class listens for changes saved elsewhere (another device, or the teacher while a
// student has the page open) and redraws with them. Leaving the class stops listening.
let unwatch = null;
function setCls(cls) {
  if (unwatch) { unwatch(); unwatch = null; }
  state.cls = cls;
}

// The same data, whatever order its keys are in. Firestore times compare as milliseconds.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    if (typeof v.toMillis === 'function') return v.toMillis();
    return Object.fromEntries(Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
// Leaves out the times the server fills in, which this page only knows roughly.
const noTimes = (x) => ({ ...x, createdAt: undefined });

function applyRemote(id, kind, data) {
  const c = state.cls;
  if (!c || c.id !== id) return;
  if (kind === 'gone') {
    if (c.isOwner) return;
    setCls(null);
    showUnavailable(id);
    return;
  }
  let changed = false;
  if (kind === 'class') {
    if (!same(noTimes(c.cls), noTimes(data))) { c.cls = data; c.fullPending = true; changed = true; }
  } else if (kind === 'plan') {
    if (!same(c.plan, data)) { c.plan = data; changed = true; }
  } else if (kind === 'lessons') {
    data.forEach((l) => { if (l.term === undefined) l.term = 1; });
    const next = { lessons: data };
    sortLessons(next);
    if (!same(byId(c.lessons), byId(next.lessons))) { c.lessons = next.lessons; changed = true; }
  } else if (kind === 'units') {
    if (!same(byId(c.units), byId(data))) { c.units = data; changed = true; }
  } else if (kind === 'files') {
    if (!same(byId(c.files).map(noTimes), byId(data).map(noTimes))) { c.files = data; changed = true; }
  } else if (kind === 'posts') {
    const brief = (list) => list.map((p) => [p.id, p.text, !!p.pinned, p.editedAt || 0]);
    if (!same(brief(c.posts), brief(data))) { c.posts = data; changed = true; }
  }
  const first = !c.seen.has(kind);
  c.seen.add(kind);
  if (!changed) return;
  if (kind === 'plan' || kind === 'lessons') recompute();
  // A teacher hears about planning changes from another device (not on first load, when
  // the listener is only catching up with what was just read).
  if (c.isOwner && !first && ['plan', 'lessons', 'units'].includes(kind)) toast('Updated with changes from another device');
  c.renderPending = true;
  flushRender();
}

// Redraws are held back while someone is typing in a box, dragging, or has a dialog open.
function busy() {
  if (libDrag || dragIds) return true;
  if (document.querySelector('dialog[open]')) return true;
  const a = document.activeElement;
  return !!(a && a.closest && a.closest('#panel') && a.matches('input, textarea, select'));
}
function flushRender() {
  const c = state.cls;
  if (!c || !(c.renderPending || c.fullPending) || busy()) return;
  const full = c.fullPending;
  c.renderPending = false;
  c.fullPending = false;
  if (full) showClass(c.id, c.tab, c.sub); else renderPanel();
}
setInterval(flushRender, 1000);

/* ---------- page frame ---------- */

function frame(body, { wide = false } = {}) {
  const u = state.user;
  const demo = store.mode === 'demo'
    ? html`<div class="demo-strip">Demo mode: Firebase isn't set up yet, so everything is saved in this browser only.</div>`
    : '';
  return html`
    ${demo}
    <header class="topbar">
      <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"></span>${SITE_NAME}</a>
      <div class="topbar-right">
        ${u && u.isTeacher ? html`<span class="who">${u.name || u.email}</span>` : ''}
        ${u && u.isAdmin ? html`<a class="btn ghost" href="#/teachers">Teachers</a>` : ''}
        ${u ? html`<button class="btn ghost" data-action="sign-out">${u.isTeacher ? 'Sign out' : 'Leave'}</button>` : ''}
      </div>
    </header>
    <main class="${wide ? 'wrap wide' : 'wrap'}" id="main">${body}</main>`;
}

/* ---------- routing ---------- */

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'teachers') return { page: 'teachers' };
  if (parts[0] === 'class' && parts[1]) return { page: 'class', id: parts[1], tab: parts[2] || '', sub: parts[3] || '' };
  return { page: 'home' };
}

async function route() {
  if (state.user === undefined) {
    show($app, html`<div class="loading">Loading…</div>`);
    return;
  }
  const r = parseHash();
  if (state.user && state.user.isTeacher && !state.user.allowed) return showNotAllowed();
  if (r.page === 'teachers') {
    if (state.user && state.user.isAdmin) return showTeachers();
    location.hash = '#/';
    return;
  }
  if (r.page === 'class') return showClass(r.id, r.tab, r.sub);
  setCls(null);
  if (!state.user) return showLanding();
  return state.user.isTeacher ? showTeacherHome() : showStudentHome();
}

/* ---------- landing: the two front doors ---------- */

function joinForm(id) {
  return html`
    <form class="join-form" data-form="join">
      <label for="${id}">Class key</label>
      <div class="row">
        <input id="${id}" name="key" autocomplete="off" autocapitalize="characters" spellcheck="false"
          placeholder="ABCD-2345" maxlength="12" required>
        <button class="btn primary" type="submit">Join</button>
      </div>
      <p class="form-msg" aria-live="polite"></p>
    </form>`;
}

function showLanding() {
  const sample = store.mode === 'demo' ? store.sampleKey() : '';
  show($app, frame(html`
    <section class="hero">
      <h1>Every lesson, on the right day.</h1>
      <p>Your term plan and your lesson materials, in one place. Change the plan and every student sees the right lesson.</p>
    </section>
    <div class="doors">
      <section class="card door">
        <h2>I'm a teacher</h2>
        <p>Plan your terms, schedule lessons and share them with your classes.</p>
        <button class="btn primary big" data-action="teacher-sign-in">
          ${store.mode === 'demo' ? 'Try the teacher view' : 'Sign in with Google'}
        </button>
      </section>
      <section class="card door">
        <h2>I'm a student</h2>
        <p>Type the class key your teacher gave you. You don't need an account.</p>
        ${joinForm('key-landing')}
        ${sample ? html`<p class="hint">Sample class key: <strong class="mono">${formatKey(sample)}</strong></p>` : ''}
      </section>
    </div>`));
}

/* ---------- who may be a teacher ---------- */

// A Google account the admin hasn't added. The rules refuse it everything a teacher can do.
function showNotAllowed() {
  setCls(null);
  show($app, frame(html`
    <section class="card narrow">
      <h1>You're not on the teacher list yet</h1>
      <p>Only teachers the admin has added can use ${SITE_NAME}. You're signed in as <strong>${state.user.email}</strong>.</p>
      <p>Ask the admin to add this email, then sign in again. If you're a student, sign out and join with your class key instead.</p>
      <button class="btn primary" data-action="sign-out">Sign out</button>
    </section>`));
}

// Admin only: the Google emails allowed to sign in as teachers.
async function showTeachers() {
  setCls(null);
  show($app, frame(html`<div class="loading">Loading the teacher list…</div>`));
  let list = [];
  try { list = await store.listAllowedTeachers(); } catch (e) { console.error(e); toast("Couldn't load the teacher list.", 'error'); }
  list.sort((a, b) => a.email.localeCompare(b.email));
  show($app, frame(html`
    <div class="page-head teachers-head">
      <h1>Teachers</h1>
      <a class="btn ghost" href="#/">Back to your classes</a>
    </div>
    <section class="card narrow">
      <p class="hint">Only these Google accounts can sign in as teachers. You (${state.user.email || ADMIN_EMAIL}) always can, as the admin, and only you see this page. Taking someone off the list locks them out of their classes straight away but doesn't delete anything.</p>
      <form class="allow-form" data-form="allow-teacher">
        <label>Add a teacher's Google email
          <input name="email" type="email" required maxlength="200" autocomplete="off" spellcheck="false" placeholder="name@school.vic.edu.au">
        </label>
        <button class="btn primary" type="submit">Add teacher</button>
      </form>
      ${list.length ? html`<ul class="allow-list">${list.map((t) => html`
        <li><span>${t.email}</span>
          <button class="icon-btn danger" data-action="remove-teacher" data-email="${t.email}" aria-label="Remove ${t.email}">✕</button></li>`)}</ul>`
        : html`<p class="empty small">No other teachers yet.</p>`}
    </section>`));
}

/* ---------- teacher home ---------- */

async function showTeacherHome() {
  show($app, frame(html`<div class="loading">Loading your classes…</div>`));
  let classes = [];
  let order = { order: [], pinned: [] };
  try {
    [classes, order] = await Promise.all([
      store.listMyClasses(),
      store.getClassOrder().catch((e) => { console.error(e); return { order: [], pinned: [] }; }),
    ]);
  } catch (e) { console.error(e); toast("Couldn't load your classes.", 'error'); }
  const live = classes.filter((c) => !c.archived);
  state.today = null;
  state.home = { classes, order };
  const byName = classes.slice().sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name));
  show($app, frame(html`
    ${live.length ? html`<section class="today" id="today" aria-label="Your lessons today"><p class="loading small">Loading today's lessons…</p></section>` : ''}
    <div class="page-head">
      <h1>Your classes</h1>
      <button class="btn primary" data-action="new-class">New class</button>
    </div>
    ${classes.length ? '' : html`<p class="empty">No classes yet. Make your first one with <strong>New class</strong>.</p>`}
    <div id="class-list"></div>
    ${newClassDialog(byName)}`, { wide: true }));
  renderClassList();
  if (live.length) loadToday(live);
}

/* ---------- the class list: the teacher's own order, with pinned classes on top ---------- */

// Pinned classes come first, then a line, then the rest, then archived ones. The order and the pins are
// saved on the teacher's own record (teachers/{uid}), so students never see them. Classes that have
// never been moved keep alphabetical order after the ones that have.
function arrangeClasses(classes, { order = [], pinned = [] } = {}) {
  const rank = new Map(order.map((id, i) => [id, i]));
  const at = (c) => (rank.has(c.id) ? rank.get(c.id) : order.length);
  const sorted = classes.slice().sort((a, b) => (a.archived - b.archived) || (at(a) - at(b)) || a.name.localeCompare(b.name));
  const pins = new Set(pinned);
  return {
    pinned: sorted.filter((c) => !c.archived && pins.has(c.id)),
    rest: sorted.filter((c) => c.archived || !pins.has(c.id)),
  };
}

const PIN_ICON = raw('<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>');

function classTile(c, pinned) {
  return html`
    <div class="class-tile ${pinned ? 'pinned' : ''}" data-id="${c.id}" ${raw(c.archived ? 'data-archived="1"' : '')}>
      <a class="class-card ${c.archived ? 'archived' : ''}" href="#/class/${c.id}">
        <div class="class-card-banner" style="--class:${colourOf(c)}">
          <span class="class-card-name">${c.name}</span>
          <span class="class-card-sub">${[c.subject, c.year].filter(Boolean).join(' · ')}</span>
        </div>
        <div class="class-card-foot">
          ${c.archived ? html`<span class="tag">Archived</span>` : html`<span>Key <span class="mono">${formatKey(c.currentKey)}</span></span>`}
        </div>
      </a>
      ${c.archived ? '' : html`
        <div class="class-tools">
          <button type="button" class="class-tool class-grip" data-id="${c.id}" title="Drag to move" aria-label="Move ${c.name}. Use the arrow keys.">⋮⋮</button>
          <button type="button" class="class-tool class-pin" data-action="pin-class" data-id="${c.id}" aria-pressed="${pinned ? 'true' : 'false'}"
            title="${pinned ? 'Unpin' : 'Pin to the top'}" aria-label="${pinned ? `Unpin ${c.name}` : `Pin ${c.name} to the top`}">${PIN_ICON}</button>
        </div>`}
    </div>`;
}

function renderClassList() {
  const el = document.getElementById('class-list');
  const h = state.home;
  if (!el || !h || !h.classes.length) return;
  const { pinned, rest } = arrangeClasses(h.classes, h.order);
  show(el, html`
    <div class="class-grid" data-group="pinned" data-empty="Drop here to pin">${pinned.map((c) => classTile(c, true))}</div>
    <hr class="pin-line">
    <div class="class-grid" data-group="rest" data-empty="Drop here to unpin">${rest.map((c) => classTile(c, false))}</div>`);
  classZones(el);
}

// Empty groups and the line are hidden, except while dragging, when an empty group is a drop zone.
function classZones(el) {
  const [pins, rest] = ['pinned', 'rest'].map((g) => el.querySelector(`[data-group="${g}"]`));
  pins.classList.toggle('is-empty', !pins.querySelector('.class-tile'));
  rest.classList.toggle('is-empty', !rest.querySelector('.class-tile'));
  el.classList.toggle('has-pins', !!pins.querySelector('.class-tile'));
}

// Saves whatever the page now shows.
async function saveClassOrder() {
  const el = document.getElementById('class-list');
  const h = state.home;
  if (!el || !h) return;
  const ids = (sel) => [...el.querySelectorAll(sel)].map((t) => t.dataset.id);
  const next = { order: ids('.class-tile'), pinned: ids('[data-group="pinned"] .class-tile') };
  const before = arrangeClasses(h.classes, h.order);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const was = [...before.pinned, ...before.rest].map((c) => c.id);
  const wasPinned = before.pinned.map((c) => c.id);
  if (same(was, next.order) && same(wasPinned, next.pinned)) { renderClassList(); return; }
  const added = next.pinned.filter((id) => !wasPinned.includes(id));
  const removed = wasPinned.filter((id) => !next.pinned.includes(id));
  h.order = next;
  renderClassList();
  const name = (id) => (h.classes.find((c) => c.id === id) || {}).name;
  const msg = added.length ? `Pinned ${name(added[0])}` : removed.length ? `Unpinned ${name(removed[0])}` : 'Order saved';
  await saving(store.saveClassOrder(next), msg);
}

/* ---------- today: every class's lessons for today and the next school day ---------- */

// Today and the next school day (Monday after a Friday). At the weekend: Monday and Tuesday.
function teachingDays(today = todayISO()) {
  const step = (d) => {
    const x = new Date(d);
    do x.setDate(x.getDate() + 1); while (x.getDay() === 0 || x.getDay() === 6);
    return x;
  };
  const t = new Date(`${today}T00:00:00`);
  const first = t.getDay() === 0 || t.getDay() === 6 ? step(t) : t;
  return [first, step(first)].map((d) => msToISO(d.getTime()));
}

function dayHeading(iso, today = todayISO()) {
  if (iso === today) return 'Today';
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return iso === msToISO(tomorrow.getTime()) ? 'Tomorrow' : fmt(iso, { weekday: 'long' });
}

async function loadToday(classes) {
  const data = await Promise.all(classes.map(async (cls) => {
    try {
      const [plan, lessons, files] = await Promise.all([
        store.getPlan(cls.id), store.getLessons(cls.id), store.listFiles(cls.id).catch((e) => { console.error(e); return []; }),
      ]);
      lessons.forEach((l) => { if (l.term === undefined) l.term = 1; });
      const c = { lessons };
      sortLessons(c);
      return { cls, files, result: schedule(plan, c.lessons.filter(isPlaced)) };
    } catch (e) {
      console.error(e);
      return { cls, files: [], result: null, failed: true };
    }
  }));
  const el = document.getElementById('today');
  if (!el) return; // moved on to another page
  state.today = data;
  show(el, todayPanel(data));
}

function todayPanel(data) {
  const days = teachingDays();
  const rowsFor = (iso) => data.flatMap((d) => daySessions(d.result, iso).map((s) => ({ ...s, d })))
    .sort((a, b) => a.from - b.from || a.d.cls.name.localeCompare(b.d.cls.name));
  const failed = data.filter((d) => d.failed);
  return html`
    <div class="today-grid">
      ${days.map((iso) => {
        const rows = rowsFor(iso);
        return html`
          <section class="card today-day">
            <h2>${dayHeading(iso)} <span class="today-date">${fmtDay(iso)}</span></h2>
            ${rows.length ? html`<ul class="today-list">${rows.map((r) => {
              const cls = r.d.cls;
              const when = r.from === r.to ? `P${r.from}` : `P${r.from}–${r.to}`;
              const files = r.lesson ? r.d.files.filter((f) => f.lessonId === r.lesson.id)
                .sort((a, b) => (a.locked - b.locked) || a.name.localeCompare(b.name)) : [];
              return html`
                <li class="today-row ${r.blocked ? 'cancelled' : ''}" style="--class:${colourOf(cls)}">
                  <span class="today-period">${when}</span>
                  <div class="today-body">
                    <a class="today-class" href="#/class/${cls.id}">${cls.name}</a>
                    ${r.blocked
                      ? html`<span class="today-title"><span class="tag">Cancelled</span> ${r.label || 'No class'}</span>`
                      : html`<a class="today-title" href="#/class/${cls.id}/lessons/${r.lesson.id}">${kindMark(r.lesson)}${r.lesson.title}</a>`}
                    ${files.length ? html`<div class="today-files">${files.map((f) => html`
                      <button class="file-chip small" data-action="open-file" data-class="${cls.id}" data-file="${f.id}" title="Open ${f.name}">
                        <span class="file-icon" aria-hidden="true">${f.locked ? '🔒' : fileIcon(f.name)}</span>
                        <span class="file-name">${f.name}</span>
                      </button>`)}</div>` : ''}
                  </div>
                </li>`;
            })}</ul>` : html`<p class="empty small">No lessons on your planners.</p>`}
          </section>`;
      })}
    </div>
    ${failed.length ? html`<p class="hint">Couldn't load ${failed.map((d) => d.cls.name).join(', ')}. Reload the page to try again.</p>` : ''}`;
}

function newClassDialog(classes = []) {
  return html`
    <dialog id="new-class">
      <form data-form="new-class" method="dialog">
        <h2>New class</h2>
        <label>Start from
          <select name="template">
            <option value="">A blank class</option>
            ${classes.map((c) => html`<option value="${c.id}">Copy of ${c.name}${c.archived ? ' (archived)' : ''}</option>`)}
            <option value="key">Copy another teacher's class, using its copy key</option>
          </select>
        </label>
        <label class="import-key" hidden>Their copy key
          <input name="importKey" autocomplete="off" autocapitalize="characters" spellcheck="false"
            placeholder="ABCD-2345" maxlength="12">
        </label>
        <p class="hint" data-from-hint="copy" ${raw(classes.length ? '' : 'hidden')}>A copy brings across the lessons, units, lesson files and where each lesson sits on the planner. Students, marks, announcements, term dates and the timetable are not copied.</p>
        <p class="hint" data-from-hint="key" hidden>Ask the other teacher for their class's copy key, from <strong>Share with other teachers</strong> on their Setup tab. The key their students join with won't work. You get your own copy of their lessons, units, lesson files and planner, teacher-only files included. It's yours alone to change: nothing you do touches their class, and their later changes don't reach yours.</p>
        <p class="form-msg" aria-live="polite"></p>
        <label>Class name <input name="name" required maxlength="80" placeholder="8A Maths"></label>
        <div class="row2">
          <label>Subject <input name="subject" maxlength="80" placeholder="Maths"></label>
          <label>Year <input name="year" maxlength="20" value="${new Date().getFullYear()}"></label>
        </div>
        <fieldset class="swatches">
          <legend>Banner colour</legend>
          ${CLASS_COLOURS.map((c, i) => html`
            <label class="swatch" style="--class:${c}">
              <input type="radio" name="colour" value="${i}" ${raw(i === 0 ? 'checked' : '')}>
              <span class="sr-only">Colour ${i + 1}</span>
            </label>`)}
        </fieldset>
        <div class="dialog-actions">
          <button class="btn ghost" type="button" data-action="close-dialog">Cancel</button>
          <button class="btn primary" type="submit">Create class</button>
        </div>
      </form>
    </dialog>`;
}

/* ---------- student home ---------- */

function showStudentHome() {
  const joined = getJoined();
  show($app, frame(html`
    <div class="page-head"><h1>Your classes</h1></div>
    ${joined.length ? html`
      <div class="class-grid">
        ${joined.map((j) => html`
          <a class="class-card" href="#/class/${j.classId}">
            <div class="class-card-banner" style="--class:${CLASS_COLOURS[j.colour || 0] || CLASS_COLOURS[0]}">
              <span class="class-card-name">${j.name || 'Class'}</span>
              <span class="class-card-sub">${j.subject || ''}</span>
            </div>
          </a>`)}
      </div>` : html`<p class="empty">You haven't joined a class on this browser yet.</p>`}
    <section class="card narrow">
      <h2>Join another class</h2>
      ${joinForm('key-home')}
    </section>`, { wide: true }));
}

async function joinClass(form) {
  const msg = form.querySelector('.form-msg');
  const btn = form.querySelector('button[type=submit]');
  const key = normaliseKey(form.key.value);
  const fail = () => { msg.textContent = "That key didn't work. Check it with your teacher and try again."; };
  msg.textContent = '';
  if (!key) return fail();
  btn.disabled = true;
  state.joining = true; // joining signs a student in; don't redraw the page under the form
  try {
    const classId = await store.joinWithKey(key);
    if (!classId) return fail();
    const cls = await store.getClass(classId);
    if (!cls) return fail();
    const list = getJoined().filter((j) => j.classId !== classId);
    list.push({ classId, key, name: cls.name, subject: cls.subject, colour: cls.colour || 0 });
    setJoined(list);
    location.hash = `#/class/${classId}`;
  } catch (e) {
    console.error(e);
    msg.textContent = "Couldn't reach the server. Check your connection and try again.";
  } finally {
    btn.disabled = false;
    state.joining = false;
  }
}

/* ---------- class page ---------- */

function showUnavailable(id) {
  if (!state.user.isTeacher) setJoined(getJoined().filter((j) => j.classId !== id));
  show($app, frame(html`
    <section class="card narrow">
      <h1>This class isn't available</h1>
      <p>The class key may have changed, or the class has been archived. Ask your teacher for the current key.</p>
      <a class="btn primary" href="#/">Back to your classes</a>
    </section>`));
}

async function showClass(id, tab, sub = '') {
  if (!state.user) { location.hash = '#/'; return; }
  if (!state.cls || state.cls.id !== id) {
    setCls(null);
    show($app, frame(html`<div class="loading">Opening class…</div>`, { wide: true }));
    let cls = null;
    try { cls = await store.getClass(id); } catch (e) { console.error(e); }
    if (!cls) { showUnavailable(id); return; }
    const quiet = (p, empty = []) => p.catch((e) => { console.error(e); return empty; });
    const isOwner = cls.owner === state.user.uid;
    // Students never ask for the tracker (and the rules would refuse them).
    const [plan, lessons, units, files, posts, students, marks, tracker] = await Promise.all([
      store.getPlan(id), store.getLessons(id), quiet(store.getUnits(id)),
      quiet(store.listFiles(id)), quiet(store.getAnnouncements(id)),
      isOwner ? quiet(store.getStudents(id)) : [], isOwner ? quiet(store.getMarks(id), {}) : {}, isOwner ? quiet(store.getTracker(id), null) : null,
    ]);
    // Lessons saved before terms were chosen are Term 1; a null term means "not on the planner".
    lessons.forEach((l) => { if (l.term === undefined) l.term = 1; });
    setCls({
      id, cls, plan, lessons, units, files, posts, uploads: [], expanded: new Set(), isOwner,
      students, marks, tracker: { ...emptyTracker(), ...(tracker || {}) }, seen: new Set(),
    });
    sortLessons(state.cls);
    // Once per class per visit: make sure students can open the files they should (see syncFileAccess).
    if (isOwner && files.length && !syncedFiles.has(id)) {
      syncedFiles.add(id);
      store.syncFileAccess(id, files).catch((e) => { syncedFiles.delete(id); console.error(e); });
    }
    state.cls.editTerm = (currentWeek(plan, todayISO()) || { term: 1 }).term;
    // The tracker opens on the current semester; reports on the whole year.
    state.cls.trackPeriod = state.cls.editTerm <= 2 ? 's1' : 's2';
    state.cls.reportPeriod = 'year';
    recompute();
    unwatch = store.watchClass(id, (kind, data) => applyRemote(id, kind, data));
  }
  const c = state.cls;
  const tabs = c.isOwner
    ? [['home', 'Home'], ['lessons', 'Lessons'], ['planner', 'Planner'], ['week', 'Week'], ['timetable', 'Timetable'], ['tracker', 'Tracker'], ['reports', 'Reports'], ['setup', 'Setup']]
    : [['home', 'Home'], ['week', 'Week'], ['lessons', 'Lessons'], ['timetable', 'Timetable']];
  if (!tabs.some(([t]) => t === tab)) tab = 'home';
  const lessonId = tab === 'lessons' && sub && c.lessons.some((l) => l.id === sub) ? sub : null;
  if (lessonId !== c.lessonId) c.preview = false;
  if (tab !== c.tab || sub !== c.sub) c.scaleDraft = null;
  // Coming into the Lessons tab starts with every unit folded, so the whole list fits at a glance.
  if (tab === 'lessons' && c.tab !== 'lessons') { c.expanded.clear(); c.autoOpened = null; }
  c.tab = tab;
  c.sub = sub;
  c.lessonId = lessonId;
  show($app, frame(html`
    <section class="class-banner" style="--class:${colourOf(c.cls)}">
      <div>
        <h1>${c.cls.name}</h1>
        <p>${[c.cls.subject, c.cls.year].filter(Boolean).join(' · ')}</p>
      </div>
      ${c.isOwner && !c.cls.archived ? html`<div class="banner-key">Class key <strong class="mono">${formatKey(c.cls.currentKey)}</strong></div>` : ''}
      ${c.cls.archived ? html`<div class="banner-key">Archived: students can't open this class</div>` : ''}
    </section>
    <nav class="tabs" aria-label="Class sections">
      ${tabs.map(([t, label]) => html`<a href="#/class/${id}/${t}" class="${t === tab ? 'active' : ''}" ${raw(t === tab ? 'aria-current="page"' : '')}>${label}</a>`)}
    </nav>
    <div id="panel"></div>`, { wide: true }));
  renderPanel();
}

function recompute() {
  const c = state.cls;
  c.result = schedule(c.plan, c.lessons.filter(isPlaced));
  c.placed = new Map(c.result.lessons.map((l) => [l.id, l]));
  syncAfterLesson(c);
}

function renderPanel() {
  const c = state.cls;
  const panel = document.getElementById('panel');
  if (!panel) return;
  const views = {
    home: homePanel, lessons: libraryPanel, planner: plannerPanel, week: weekCalendar, timetable: timetablePanel,
    tracker: trackerPanel, reports: reportsPanel, setup: setupPanel,
  };
  const scroller = panel.querySelector('.grid-scroll');
  const keep = scroller ? [scroller.scrollLeft, scroller.scrollTop] : null;
  show(panel, views[c.tab](c));
  if (c.tab === 'tracker') {
    fillNumbers(c);
    // Redrawing the grid (a new column, a removed student) shouldn't lose your place in it.
    const grid = panel.querySelector('.grid-scroll');
    if (grid && keep) [grid.scrollLeft, grid.scrollTop] = keep;
  }
  if (c.tab === 'lessons') {
    applyLibFilter();
    // Keep the sidebar where it was, and the chosen lesson in view.
    const side = document.querySelector('.lib-side');
    if (side) {
      side.scrollTop = c.libScroll || 0;
      const on = side.querySelector('a.on');
      if (on && (on.offsetTop < side.scrollTop || on.offsetTop + on.offsetHeight > side.scrollTop + side.clientHeight)) {
        side.scrollTop = on.offsetTop - side.clientHeight / 3;
      }
    }
    if (c.focusTitle) {
      c.focusTitle = false;
      const t = document.querySelector('.builder-title');
      if (t) { t.focus(); t.select(); }
    }
  }
}

/* ---------- capacity banner ---------- */

function finishText(t) {
  if (!t.finishes) return '';
  const s = t.finishes;
  return `Week ${s.week}${s.date ? ` (${fmtDay(s.date)})` : ''}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function setupFirstBanner() {
  return html`<div class="banner info" role="status"><span class="banner-icon" aria-hidden="true">i</span>
    <span>Tick the periods this class meets on the <strong>Setup</strong> tab to start the timetable.</span></div>`;
}

// One term's capacity, as in the spreadsheet's banner.
function termBanner(r, t) {
  if (!r.meetingsPerWeek) return setupFirstBanner();
  if (!t.weeks) {
    return html`<div class="banner info" role="status"><span class="banner-icon" aria-hidden="true">i</span>
      <span>Term ${t.term} has no weeks yet. Set its start date and weeks on the <strong>Setup</strong> tab.</span></div>`;
  }
  if (!t.required) {
    return html`<div class="banner info" role="status"><span class="banner-icon" aria-hidden="true">i</span>
      <span>Add lessons to Term ${t.term} with the search box below. ${plural(t.available, 'class period')} are free this term.</span></div>`;
  }
  if (t.fits) {
    return html`<div class="banner good" role="status"><span class="banner-icon" aria-hidden="true">✓</span>
      <span><strong>All Term ${t.term} lessons fit.</strong> ${t.required} of ${t.available} periods used, ${t.spare} spare. Finishes ${finishText(t)}.</span></div>`;
  }
  return html`<div class="banner bad" role="status"><span class="banner-icon" aria-hidden="true">!</span>
    <span><strong>Term ${t.term} is short by ${plural(-t.spare, 'period')}.</strong> Its lessons need ${t.required} periods but only ${t.available} are free. Shorten, skip or move lessons to another term, or add weeks.</span></div>`;
}

// Every term at once, for the Timetable tab.
function yearBanner(r) {
  if (!r.meetingsPerWeek) return setupFirstBanner();
  if (!r.required) {
    return html`<div class="banner info" role="status"><span class="banner-icon" aria-hidden="true">i</span>
      <span>Put lessons on the <strong>Planner</strong> tab to fill the timetable.</span></div>`;
  }
  const short = r.perTerm.filter((t) => !t.fits);
  if (!short.length) {
    return html`<div class="banner good" role="status"><span class="banner-icon" aria-hidden="true">✓</span>
      <span><strong>All lessons fit.</strong> ${r.required} of ${r.available} periods used this year, ${r.spare} spare.</span></div>`;
  }
  return html`<div class="banner bad" role="status"><span class="banner-icon" aria-hidden="true">!</span>
    <span><strong>${short.map((t) => `Term ${t.term} is short by ${plural(-t.spare, 'period')}`).join('. ')}.</strong> Fix it on the Planner tab.</span></div>`;
}

/* ---------- lessons and units: shared helpers ---------- */

const lessonById = (id) => state.cls.lessons.find((l) => l.id === id);
const unitById = (id) => state.cls.units.find((u) => u.id === id);
const lessonUrl = (c, id) => `#/class/${c.id}/lessons/${id}`;
const nextOrder = (c) => (c.lessons.length ? Math.max(...c.lessons.map((l) => l.order ?? 0)) + 1 : 0);
const clampPeriods = (v) => Math.max(0, Math.min(20, Math.floor(Number(v)) || 0));

// A lesson with no term is in the library but not on the planner.
const isPlaced = (l) => l.term >= 1 && l.term <= TERM_COUNT;

// The lesson's unit, or null if it has none (or its unit was deleted).
const unitIdOf = (c, l) => (l.unitId && c.units.some((u) => u.id === l.unitId) ? l.unitId : null);
const unitLessons = (c, unitId) => c.lessons.filter((l) => unitIdOf(c, l) === unitId);
// A unit keeps its colour once it has been dragged (saved as `colour`); before that, its place picks it.
const unitColourIndex = (c, u) => (Number.isInteger(u.colour) ? u.colour : c.units.indexOf(u));
const unitColour = (c, unitId) => {
  const u = c.units.find((x) => x.id === unitId);
  return u ? CLASS_COLOURS[unitColourIndex(c, u) % CLASS_COLOURS.length] : 'var(--line-2)';
};
// The first colour no unit is using yet (they repeat once all are taken).
function freeUnitColour(c) {
  const used = new Set(c.units.map((u) => unitColourIndex(c, u) % CLASS_COLOURS.length));
  const i = CLASS_COLOURS.findIndex((_, k) => !used.has(k));
  return i >= 0 ? i : c.units.length % CLASS_COLOURS.length;
}

// The Lessons tab has its own order (`libOrder`), separate from the planner's timeline order,
// so dragging there never moves anything on the timetable. Lessons never dragged keep their timeline order.
const libKey = (l) => (typeof l.libOrder === 'number' ? l.libOrder : 100000 + (l.order ?? 0));
const nextLibOrder = (c) => (c.lessons.length ? Math.max(...c.lessons.map(libKey)) + 1 : 0);
const libLessons = (c, unitId) => unitLessons(c, unitId).sort((a, b) => libKey(a) - libKey(b));

// Timeline order: placed lessons by term, then the rest. Numbered 0, 1, 2…
function sortLessons(c) {
  const key = (l) => (isPlaced(l) ? l.term : TERM_COUNT + 1);
  c.lessons.sort((a, b) => key(a) - key(b) || (a.order ?? 0) - (b.order ?? 0));
  c.lessons.forEach((l, i) => { l.order = i; });
}

function termLessons(c) {
  return c.lessons.filter((l) => l.term === c.editTerm);
}

// Saves one field. The caller redraws, so typing in the lesson builder isn't interrupted.
async function updateLesson(id, field, value) {
  const lesson = lessonById(id);
  if (!lesson) return;
  if (field === 'periods') value = clampPeriods(value);
  if (field === 'title') value = String(value).trim().slice(0, 200) || lesson.title;
  if (field === 'description') value = String(value).slice(0, 5000);
  if (field === 'unitId') {
    value = value || null;
    if (value !== unitIdOf(state.cls, lesson)) lesson.libOrder = nextLibOrder(state.cls); // goes to the end of its new unit
  }
  lesson[field] = value;
  recompute();
  await saving(store.saveLesson(state.cls.id, lesson));
}

// Puts lessons, in the order given, at the end of a term (or takes them off the planner when term is null).
async function placeLessons(list, term, msg) {
  const c = state.cls;
  let order = nextOrder(c);
  list.forEach((l) => { l.term = term; l.order = order++; });
  sortLessons(c);
  recompute();
  renderPanel();
  return saving(Promise.all([...list.map((l) => store.saveLesson(c.id, l)), store.saveOrder(c.id, c.lessons)]), msg);
}

async function createLessons(rows, { term = null, unitId = null } = {}, msg = 'Lesson created') {
  const c = state.cls;
  let order = nextOrder(c);
  let libOrder = nextLibOrder(c);
  const added = rows.map((row) => ({
    id: store.newLessonId(c.id),
    title: row.title,
    description: '',
    unitId,
    periods: row.periods ?? 1,
    assessment: false,
    homework: false,
    term,
    order: order++,
    libOrder: libOrder++,
  }));
  c.lessons.push(...added);
  sortLessons(c);
  recompute();
  renderPanel();
  await saving(Promise.all([...added.map((l) => store.saveLesson(c.id, l)), store.saveOrder(c.id, c.lessons)]), msg);
  return added;
}

function parsePasted(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = /^(.*?)[\t,]\s*(\d+)\s*$/.exec(line);
    return m ? { title: m[1].trim().slice(0, 200), periods: Math.min(20, Number(m[2])) } : { title: line.slice(0, 200), periods: 1 };
  }).filter((r) => r.title);
}

// Moves lessons (ids, already next to each other) so they sit before position toIndex of the term's list.
async function reorder(ids, toIndex) {
  const c = state.cls;
  const list = termLessons(c);
  const moving = new Set(ids);
  const next = [
    ...list.slice(0, toIndex).filter((l) => !moving.has(l.id)),
    ...list.filter((l) => moving.has(l.id)),
    ...list.slice(toIndex).filter((l) => !moving.has(l.id)),
  ];
  if (next.every((l, i) => l === list[i])) return;
  const orders = list.map((l) => l.order); // the term keeps the same order numbers, shuffled
  const before = new Map(list.map((l) => [l.id, l.order]));
  next.forEach((l, i) => { l.order = orders[i]; });
  sortLessons(c);
  recompute();
  renderPanel();
  if (!await saving(store.saveOrder(c.id, c.lessons), '')) return;
  toast(ids.length > 1 ? `Moved ${ids.length} lessons` : 'Order saved', 'ok', () => undoReorder(c, before));
}

// Puts the planner order back to how it was before a drag or move.
async function undoReorder(c, before) {
  if (state.cls !== c) return;
  c.lessons.forEach((l) => { if (before.has(l.id)) l.order = before.get(l.id); });
  sortLessons(c);
  recompute();
  renderPanel();
  await saving(store.saveOrder(c.id, c.lessons), 'Move undone');
}

// The lesson plus the lessons right next to it (same term) from the same unit, for Shift-moves.
function unitBlock(c, id) {
  const list = termLessons(c);
  const i = list.findIndex((l) => l.id === id);
  const unit = i >= 0 ? unitIdOf(c, list[i]) : null;
  if (!unit) return [id];
  let s = i;
  let e = i;
  while (s > 0 && unitIdOf(c, list[s - 1]) === unit) s--;
  while (e < list.length - 1 && unitIdOf(c, list[e + 1]) === unit) e++;
  return list.slice(s, e + 1).map((l) => l.id);
}

// When a placed lesson is taught: consecutive periods on one day are joined (Mon 12 May P2–3).
function sessions(placed) {
  const out = [];
  for (const s of placed.slots) {
    const last = out[out.length - 1];
    if (last && last.date === s.date && last.day === s.day && last.to === s.period - 1) last.to = s.period;
    else out.push({ term: s.term, week: s.week, day: s.day, date: s.date, from: s.period, to: s.period });
  }
  return out.map((x) => ({ ...x, text: `${x.date ? fmtDay(x.date) : `Wk ${x.week} ${DAYS[x.day - 1]}`} ${x.from === x.to ? `P${x.from}` : `P${x.from}–${x.to}`}` }));
}

// Plain text with web links made clickable. Everything else is escaped.
function linkify(text) {
  return raw(String(text || '').split(/(https?:\/\/[^\s<>"]+)/g)
    .map((part, i) => (i % 2 ? `<a href="${esc(part)}" target="_blank" rel="noopener">${esc(part)}</a>` : esc(part)))
    .join(''));
}

/* ---------- planner: put lessons from the library onto the terms ---------- */

const statusText = (l) => ({ skipped: 'Skipped', noroom: `No room in Term ${l.term}`, overterm: `Runs past the end of Term ${l.term}` })[l.status];

function termPicker(c) {
  return html`
    <div class="term-picker" role="group" aria-label="Choose a term, or events">
      ${c.result.perTerm.map((t) => html`
        <button class="${!c.planEvents && t.term === c.editTerm ? 'on' : ''}" aria-pressed="${!c.planEvents && t.term === c.editTerm}" data-action="pick-term" data-term="${t.term}">
          <span class="tp-name">Term ${t.term}</span>
          <span class="tp-meta">${plural(t.lessons, 'lesson')}${t.fits ? '' : html` · <span class="tp-short">short ${-t.spare}</span>`}</span>
        </button>`)}
      <button class="tp-events ${c.planEvents ? 'on' : ''}" aria-pressed="${!!c.planEvents}" data-action="pick-events">
        <span class="tp-name">Events</span>
        <span class="tp-meta">${plural(c.plan.events.length, 'event')}</span>
      </button>
    </div>`;
}

function plannerPanel(c) {
  if (c.planEvents) return html`<div class="panel-head"><h2>Planner</h2></div>${termPicker(c)}${eventsPanel(c)}`;
  const r = c.result;
  const t = r.perTerm[c.editTerm - 1];
  const mine = r.lessons.filter((l) => l.term === c.editTerm);
  let lastWeek = '';
  const items = mine.map((l, i) => {
    let sep = '';
    if (l.start) {
      const wk = `${l.start.term}-${l.start.week}`;
      if (wk !== lastWeek) {
        lastWeek = wk;
        const range = weekRange(c.plan.terms[l.start.term - 1], l.start.week);
        sep = html`<li class="week-sep" aria-hidden="true">Term ${l.start.term} · Week ${l.start.week}<span>${rangeText(range)}</span></li>`;
      }
    }
    const when = l.start
      ? (l.start === l.end ? slotLabel(l.start) : `${slotLabel(l.start)} → Wk ${l.end.week} ${DAYS[l.end.day - 1]} P${l.end.period}`)
      : '';
    const unitId = unitIdOf(c, l);
    const unit = unitId && unitById(unitId);
    const nFiles = filesFor(c, l.id).length;
    return html`${sep}
      <li class="lesson ${l.status !== 'scheduled' ? `st-${l.status}` : ''} ${lessonKind(l)}" data-id="${l.id}" style="--unit:${unitColour(c, unitId)}">
        <span class="grip" draggable="true" aria-hidden="true" title="Drag to reorder. Hold Shift to bring the rest of the unit.">⋮⋮</span>
        <span class="num">${i + 1}</span>
        <div class="lesson-main">
          <a class="lesson-title" href="${lessonUrl(c, l.id)}">${l.title}</a>
          <div class="lesson-meta">
            ${unit ? html`<span class="unit-tag">${unit.name}</span>` : ''}
            ${when ? html`<span class="when">${when}</span>` : ''}
            ${statusText(l) ? html`<span class="tag ${l.status === 'skipped' ? '' : 'bad'}">${statusText(l)}</span>` : ''}
            ${kindTag(l)}
            ${nFiles ? html`<span class="file-count" title="${plural(nFiles, 'file')}">${CLIP_ICON}${nFiles}</span>` : ''}
          </div>
        </div>
        <label class="periods">Periods
          <input type="number" min="0" max="20" data-field="periods" value="${l.effective}">
        </label>
        <label class="check as"><input type="checkbox" data-field="assessment" ${raw(l.assessment ? 'checked' : '')}> Assessment</label>
        <label class="check hw"><input type="checkbox" data-field="homework" ${raw(l.homework ? 'checked' : '')}> Homework</label>
        <label class="term-move">Term
          <select data-field="term" aria-label="Move ${l.title} to another term">
            ${[1, 2, 3, 4].map((n) => html`<option value="${n}" ${raw(n === l.term ? 'selected' : '')}>${n}</option>`)}
          </select>
        </label>
        <div class="lesson-tools">
          <button class="icon-btn" data-action="move" data-dir="-1" aria-label="Move ${l.title} up" ${raw(i === 0 ? 'disabled' : '')}>↑</button>
          <button class="icon-btn" data-action="move" data-dir="1" aria-label="Move ${l.title} down" ${raw(i === mine.length - 1 ? 'disabled' : '')}>↓</button>
          <button class="icon-btn danger" data-action="unplace" aria-label="Take ${l.title} off the planner" title="Take off the planner (it stays on the Lessons tab)">✕</button>
        </div>
      </li>`;
  });
  return html`
    <div class="panel-head"><h2>Planner</h2></div>
    ${termPicker(c)}
    ${termBanner(r, t)}
    <section class="card add-lessons">
      <h3>Add to Term ${c.editTerm}</h3>
      <div class="combo">
        <label for="plan-search">Find a lesson or a whole unit</label>
        <input id="plan-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false"
          aria-controls="plan-results" autocomplete="off" spellcheck="false" placeholder="Start typing a lesson or unit name">
        <ul id="plan-results" class="combo-list" role="listbox" aria-label="Lessons and units" hidden></ul>
      </div>
      <p class="hint">Lessons come from the <a href="#/class/${c.id}/lessons">Lessons</a> tab. Picking a unit adds all of its lessons that aren't on the planner yet. Typing a new name lets you make a lesson on the spot.</p>
      <details>
        <summary>Paste a list of new lessons</summary>
        <form data-form="paste-lessons">
          <p class="hint">One lesson per line. Copying the Lesson and Periods columns from your Term Planner spreadsheet works too: a number after a tab or a comma is the periods (1 if left out).</p>
          <textarea name="text" rows="6" placeholder="1A Ordering integers	1&#10;1B Adding and subtracting	2"></textarea>
          <button class="btn" type="submit">Make these lessons and add them to Term ${c.editTerm}</button>
        </form>
      </details>
    </section>
    <p class="hint">Drag cards, or use the arrows, to change the order. Hold <kbd>Shift</kbd> while you drag or click an arrow to move a lesson together with the lessons next to it from the same unit. Set periods to 0 to skip a lesson. Later lessons move automatically.</p>
    ${mine.length ? html`<ol class="lesson-list" data-list="lessons">${items}</ol>` : html`<p class="empty">No lessons in Term ${c.editTerm} yet. Find some with the search box above.</p>`}`;
}

// Search results for the planner's "Add to term" box: units first, then lessons not yet placed.
function searchResults(c, q) {
  const needle = q.trim().toLowerCase();
  const match = (s) => !needle || s.toLowerCase().includes(needle);
  const units = c.units.filter((u) => match(u.name)).map((u) => {
    const all = unitLessons(c, u.id);
    const left = all.filter((l) => !isPlaced(l)).length;
    return {
      kind: 'unit', id: u.id, label: u.name, disabled: !left,
      note: !all.length ? 'No lessons yet' : left ? `Adds ${plural(left, 'lesson')}` : 'All on the planner',
    };
  });
  const lessons = c.lessons.filter((l) => match(l.title))
    .sort((a, b) => isPlaced(a) - isPlaced(b))
    .map((l) => {
      const unit = unitById(unitIdOf(c, l));
      const where = !isPlaced(l) ? 'Not on the planner' : l.term === c.editTerm ? `Already in Term ${l.term}` : `In Term ${l.term}, moves here`;
      return { kind: 'lesson', id: l.id, label: l.title, note: [unit && unit.name, where].filter(Boolean).join(' · '), disabled: l.term === c.editTerm };
    });
  const out = [...units.slice(0, 5), ...lessons.slice(0, 12)];
  if (needle && !c.lessons.some((l) => l.title.toLowerCase() === needle)) {
    out.push({ kind: 'new', id: '', label: `Make a new lesson: "${q.trim()}"`, note: `Added to Term ${c.editTerm}` });
  }
  return out;
}

function renderResults(input) {
  const c = state.cls;
  const list = document.getElementById('plan-results');
  if (!list) return;
  const items = searchResults(c, input.value);
  c.search = { query: input.value, items, active: items.findIndex((it) => !it.disabled) };
  show(list, items.length ? html`${items.map((it, i) => html`
    <li id="opt-${i}" role="option" class="opt ${it.disabled ? 'off' : ''}" aria-selected="${i === c.search.active}"
      ${raw(it.disabled ? 'aria-disabled="true"' : '')} data-action="pick-result" data-i="${i}">
      <span class="opt-kind kind-${it.kind}">${{ unit: 'Unit', lesson: 'Lesson', new: 'New' }[it.kind]}</span>
      <span class="opt-label">${it.label}</span>
      <span class="opt-note">${it.note}</span>
    </li>`)}` : html`<li class="opt off" role="option" aria-disabled="true">No lessons yet. Make some on the Lessons tab, or type a name.</li>`);
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  setActive(c.search.active);
}

function setActive(i) {
  const c = state.cls;
  c.search.active = i;
  document.querySelectorAll('#plan-results .opt').forEach((el, n) => el.setAttribute('aria-selected', String(n === i)));
  const input = document.getElementById('plan-search');
  const el = document.getElementById(`opt-${i}`);
  if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
}

function hideResults() {
  const list = document.getElementById('plan-results');
  if (list) list.hidden = true;
  document.getElementById('plan-search')?.setAttribute('aria-expanded', 'false');
}

async function pickResult(i) {
  const c = state.cls;
  const it = c.search && c.search.items[i];
  if (!it || it.disabled) return;
  const term = c.editTerm;
  if (it.kind === 'unit') {
    const list = libLessons(c, it.id).filter((l) => !isPlaced(l));
    await placeLessons(list, term, `Added ${plural(list.length, 'lesson')} to Term ${term}`);
  } else if (it.kind === 'lesson') {
    const l = lessonById(it.id);
    await placeLessons([l], term, isPlaced(l) ? `Moved to Term ${term}` : `Added to Term ${term}`);
  } else {
    await createLessons([{ title: c.search.query.trim().slice(0, 200), periods: 1 }], { term }, `Made and added to Term ${term}`);
  }
  c.search = null;
  document.getElementById('plan-search')?.focus();
}

/* ---------- lessons tab: units and lessons on the left, the lesson on the right ---------- */

function libraryPanel(c) {
  const sel = c.lessonId ? lessonById(c.lessonId) : null;
  const groups = [
    ...c.units.map((u) => ({ unit: u, lessons: libLessons(c, u.id) })),
    { unit: null, lessons: libLessons(c, null) },
  ].filter((g) => (g.unit && (c.isOwner || g.lessons.length)) || (!g.unit && g.lessons.length));
  // Units stay folded until opened, except the one holding the lesson being viewed, which opens once
  // (when that lesson is picked or moves unit) and can then be folded again by hand.
  if (sel) {
    const g = groups.find((x) => x.lessons.some((l) => l.id === sel.id));
    const key = g && `${sel.id}|${g.unit ? g.unit.id : ''}`;
    if (g && c.autoOpened !== key) { c.autoOpened = key; c.expanded.add(g.unit ? g.unit.id : ''); }
  }
  const whenShort = (l) => {
    const p = c.placed.get(l.id);
    if (p && p.start) return `T${p.start.term} Wk ${p.start.week}`;
    return isPlaced(l) ? `Term ${l.term}` : c.isOwner ? 'Not planned' : '';
  };
  const canDrag = c.isOwner && !c.preview;
  const grip = (kind, id, name) => (canDrag ? html`<button type="button" class="lib-grip" data-drag="${kind}" data-id="${id}"
    aria-label="Move ${name}" title="Drag to move, or use the arrow keys">⋮⋮</button>` : '');
  const side = html`
    <aside class="lib-side ${c.libFilter && c.libFilter.trim() ? 'filtering' : ''}" aria-label="Units and lessons">
      ${c.isOwner ? html`
        <div class="lib-actions">
          <button class="btn primary small" data-action="new-lesson">New lesson</button>
          <button class="btn small" data-action="new-unit">New unit</button>
        </div>
        ${c.addingUnit ? html`
          <form class="lib-unit-form" data-form="new-unit">
            <label for="new-unit-name">New unit</label>
            <input id="new-unit-name" name="name" maxlength="80" required placeholder="e.g. Fractions">
            <div class="row"><button class="btn small primary" type="submit">Add unit</button>
            <button class="btn small ghost" type="button" data-action="cancel-unit">Cancel</button></div>
          </form>` : ''}` : ''}
      ${c.lessons.length ? html`<input class="lib-filter" type="search" placeholder="Find a lesson" aria-label="Find a lesson" data-libfilter value="${c.libFilter || ''}">` : ''}
      ${groups.map((g) => {
        const id = g.unit ? g.unit.id : '';
        const name = g.unit ? g.unit.name : 'No unit';
        const editing = g.unit && c.editingUnit === id;
        const open = c.expanded.has(id);
        return html`
          <section class="lib-unit" data-unit="${id}" data-name="${name.toLowerCase()}" style="--unit:${unitColour(c, g.unit && id)}">
            ${editing ? html`
              <form class="lib-unit-form" data-form="rename-unit" data-unit="${id}">
                <label for="rename-unit">Unit name</label>
                <input id="rename-unit" name="name" maxlength="80" required value="${name}">
                <div class="row"><button class="btn small primary" type="submit">Save</button>
                <button class="btn small ghost" type="button" data-action="cancel-rename">Cancel</button></div>
              </form>` : html`
              <div class="lib-unit-head">
                ${g.unit ? grip('unit', id, `the unit ${name}`) : ''}
                <h3><button class="lib-toggle" data-action="toggle-unit" data-unit="${id}" aria-expanded="${String(open)}">${name}</button></h3>
                <span class="lib-count" aria-label="${plural(g.lessons.length, 'lesson')}">${g.lessons.length}</span>
                ${c.isOwner && g.unit ? html`
                  <button class="icon-btn" data-action="new-lesson" data-unit="${id}" aria-label="New lesson in ${name}" title="New lesson in this unit">+</button>
                  <button class="icon-btn" data-action="rename-unit" data-unit="${id}" aria-label="Rename ${name}" title="Rename">✎</button>
                  <button class="icon-btn danger" data-action="delete-unit" data-unit="${id}" aria-label="Delete the unit ${name}" title="Delete unit">✕</button>` : ''}
              </div>`}
            ${g.lessons.length || canDrag ? html`<ul class="lib-lessons" ${raw(open ? '' : 'hidden')}>${g.lessons.map((l) => html`
              <li data-title="${l.title.toLowerCase()}" data-id="${l.id}">
                ${grip('lesson', l.id, l.title)}
                <a href="${lessonUrl(c, l.id)}" class="${l.id === c.lessonId ? 'on' : ''} ${isPlaced(l) ? '' : 'unplaced'}" ${raw(l.id === c.lessonId ? 'aria-current="page"' : '')}>
                  <span class="lib-title">${kindMark(l)}${l.title}</span>
                  <span class="lib-when">${whenShort(l)}</span>
                </a>
              </li>`)}</ul>` : ''}
            ${g.lessons.length ? '' : html`<p class="lib-empty">${canDrag ? 'No lessons yet. Drag one here.' : 'No lessons yet'}</p>`}
          </section>`;
      })}
      ${!groups.length ? html`<p class="lib-empty">${c.isOwner ? 'Make a unit, then add lessons to it.' : 'No lessons yet.'}</p>` : ''}
    </aside>`;
  let main;
  if (sel) main = c.isOwner && !c.preview ? lessonBuilder(c, sel) : lessonPage(c, sel);
  else {
    main = html`<div class="lib-blank">
      <h2>${c.isOwner ? 'Your lessons' : 'Lessons'}</h2>
      <p>${c.isOwner
        ? (c.lessons.length ? 'Pick a lesson on the left to edit it, or make a new one. Lessons go onto the timetable from the Planner tab.' : 'Start with New unit, then add lessons to it with the + next to the unit. Each lesson holds its description and files.')
        : 'Pick a lesson on the left to see what it covers and open its files.'}</p>
    </div>`;
  }
  return html`<div class="library ${sel ? 'has-lesson' : ''}">${side}<section class="lib-main">${main}</section></div>`;
}

// Hides sidebar lessons that don't match the "Find a lesson" box (no redraw, so typing isn't interrupted).
function applyLibFilter() {
  const q = (state.cls.libFilter || '').trim().toLowerCase();
  document.querySelector('.lib-side')?.classList.toggle('filtering', !!q); // no dragging while filtered
  document.querySelectorAll('.lib-unit').forEach((sec) => {
    const unitHit = q && sec.dataset.name.includes(q);
    let shown = 0;
    const ul = sec.querySelector('.lib-lessons');
    if (ul) ul.hidden = q ? false : sec.querySelector('.lib-toggle')?.getAttribute('aria-expanded') === 'false';
    sec.querySelectorAll('.lib-lessons li').forEach((li) => {
      const on = !q || unitHit || li.dataset.title.includes(q);
      li.hidden = !on;
      if (on) shown++;
    });
    sec.hidden = !!q && !shown && !unitHit;
  });
}

function lessonBuilder(c, l) {
  const placed = c.placed.get(l.id);
  const opt = (v, label, sel) => html`<option value="${v}" ${raw(String(v) === String(sel ?? '') ? 'selected' : '')}>${label}</option>`;
  let plan;
  if (placed) {
    const when = sessions(placed);
    plan = html`
      <p>${statusText(placed) ? html`<span class="tag ${placed.status === 'skipped' ? '' : 'bad'}">${statusText(placed)}</span> ` : ''}
        Term ${l.term}${when.length ? html`, Week ${when[0].week}: ${when.map((s) => s.text).join(' · ')}` : ''}</p>
      <div class="row">
        <a class="btn small" href="#/class/${c.id}/planner" data-action="goto-term" data-term="${l.term}">Open Term ${l.term} in the planner</a>
        <button class="btn small" data-action="unplace">Take off the planner</button>
      </div>`;
  } else {
    plan = html`
      <p class="hint">Not on the planner yet, so it isn't on the week calendar.</p>
      <div class="row">
        <label class="inline">Add to <select id="place-term">${[1, 2, 3, 4].map((n) => opt(n, `Term ${n}`, c.editTerm))}</select></label>
        <button class="btn small primary" data-action="place">Add to the end of the term</button>
      </div>`;
  }
  return html`
    <article class="builder" data-lesson="${l.id}" aria-label="Edit lesson">
      <a class="lib-back" href="#/class/${c.id}/lessons">← All lessons</a>
      <label class="field">Lesson name
        <input class="builder-title" data-lfield="title" value="${l.title}" maxlength="200" required>
      </label>
      <label class="field">Description <span class="optional">(optional)</span>
        <textarea data-lfield="description" rows="4" maxlength="5000" placeholder="What the lesson covers, what to bring, links to videos…">${l.description || ''}</textarea>
      </label>
      <div class="builder-row">
        <label class="field">Unit
          <select data-lfield="unitId">${opt('', 'No unit', unitIdOf(c, l) || '')}${c.units.map((u) => opt(u.id, u.name, unitIdOf(c, l)))}</select>
        </label>
        <label class="field periods">Periods
          <input type="number" min="0" max="20" data-lfield="periods" value="${clampPeriods(l.periods)}">
        </label>
        <label class="check"><input type="checkbox" data-lfield="assessment" ${raw(l.assessment ? 'checked' : '')}> Assessment</label>
        <label class="check"><input type="checkbox" data-lfield="homework" ${raw(l.homework ? 'checked' : '')}> Homework</label>
      </div>
      <section class="builder-part">
        <h3>Files</h3>
        ${teacherFiles(c, l)}
      </section>
      <section class="builder-part">
        <h3>Links</h3>
        ${teacherLinks(l)}
      </section>
      <section class="builder-part">
        <h3>On the planner</h3>
        ${plan}
      </section>
      <div class="builder-foot">
        <a class="btn small ghost" href="#/class/${c.id}/lessons/${l.id}" data-action="preview">Preview as a student</a>
        <button class="btn small" data-action="copy-lesson">Copy to another class</button>
        <button class="btn small danger-btn" data-action="delete-lesson">Delete lesson</button>
      </div>
      ${c.copyTo ? copyDialog(c, l) : ''}
    </article>`;
}

// Copy this lesson, or its whole unit, into another of the teacher's classes.
function copyDialog(c, l) {
  const unit = unitById(unitIdOf(c, l));
  const unitCount = unit ? unitLessons(c, unit.id).length : 0;
  return html`
    <dialog id="copy-lesson">
      <form data-form="copy-lesson" method="dialog">
        <h2>Copy to another class</h2>
        ${unit && unitCount > 1 ? html`
          <fieldset class="choice">
            <legend>What to copy</legend>
            <label class="check"><input type="radio" name="what" value="lesson" checked> Just this lesson</label>
            <label class="check"><input type="radio" name="what" value="unit"> The whole unit, ${unit.name} (${plural(unitCount, 'lesson')})</label>
          </fieldset>` : ''}
        <label>Copy to
          <select name="to">
            ${c.copyTo.map((o) => html`<option value="${o.id}">${o.name}${o.archived ? ' (archived)' : ''}</option>`)}
          </select>
        </label>
        <label class="check"><input type="checkbox" name="planner" ${raw(isPlaced(l) ? 'checked' : '')}> Put it on that class's planner too, at the end of the same term</label>
        <p class="hint">Files come too, and teacher-only files stay teacher-only. A single lesson goes into the unit with the same name there, if there is one. Nothing in this class changes.</p>
        <div class="dialog-actions">
          <button class="btn ghost" type="button" data-action="close-dialog">Cancel</button>
          <button class="btn primary" type="submit">Copy</button>
        </div>
      </form>
    </dialog>`;
}

// The lesson as students see it: what it is, when it's on, and its files.
function lessonPage(c, l) {
  const placed = c.placed.get(l.id);
  const unit = unitById(unitIdOf(c, l));
  const order = c.result.lessons;
  const i = order.findIndex((x) => x.id === l.id);
  const prev = i > 0 ? order[i - 1] : null;
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  const when = placed ? sessions(placed) : [];
  return html`
    <article class="lesson-page" style="--unit:${unitColour(c, unit && unit.id)}">
      <a class="lib-back" href="#/class/${c.id}/lessons">← All lessons</a>
      ${c.isOwner ? html`<p class="preview-note">Student preview. <a href="#/class/${c.id}/lessons/${l.id}" data-action="end-preview">Back to editing</a></p>` : ''}
      ${unit ? html`<p class="lp-unit">${unit.name}</p>` : ''}
      <h2>${l.title}</h2>
      <div class="lp-tags">
        ${kindTag(l)}
        ${l.homework ? html`<span class="tag">Homework</span>` : ''}
      </div>
      ${when.length ? html`<p class="lp-when">Term ${when[0].term}, Week ${when[0].week}: ${when.map((s) => s.text).join(' · ')}</p>` : ''}
      ${l.description ? html`<div class="lp-desc">${linkify(l.description)}</div>` : ''}
      <h3>Files</h3>
      ${filesFor(c, l.id).length ? studentFiles(c, l.id) : html`<p class="empty small">No files for this lesson yet.</p>`}
      ${lessonLinks(l).length ? html`<h3>Links</h3>${studentLinks(l)}` : ''}
      <nav class="lp-nav" aria-label="Other lessons">
        ${prev ? html`<a class="btn small" href="${lessonUrl(c, prev.id)}">← ${prev.title}</a>` : html`<span></span>`}
        ${next ? html`<a class="btn small" href="${lessonUrl(c, next.id)}">${next.title} →</a>` : ''}
      </nav>
    </article>`;
}

/* ---------- home: the first thing anyone sees in a class ---------- */

const initials = (name) => (name || 'T').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const fmtPosted = (ms) => new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');

// One week's lessons and cancelled periods, joining consecutive periods of the same lesson on a day.
function weekSessions(c, term, week) {
  const r = c.result;
  const out = [];
  for (const s of r.slots) {
    if (s.term !== term || s.week !== week || (!s.blocked && s.lessonIndex === null)) continue;
    const last = out[out.length - 1];
    if (last && !s.blocked && last.lessonIndex === s.lessonIndex && last.day === s.day && last.to === s.period - 1) {
      last.to = s.period;
      continue;
    }
    out.push({ day: s.day, date: s.date, from: s.period, to: s.period, blocked: s.blocked, label: s.label, lessonIndex: s.blocked ? null : s.lessonIndex });
  }
  return out.map((x) => ({
    ...x,
    lesson: x.lessonIndex === null ? null : r.lessons[x.lessonIndex],
    when: `${x.date ? fmtDay(x.date) : DAYS[x.day - 1]} · ${x.from === x.to ? `P${x.from}` : `P${x.from}–${x.to}`}`,
  }));
}

function upNextCard(c) {
  const today = todayISO();
  const cur = currentWeek(c.plan, today);
  if (!cur || !c.result.meetingsPerWeek) return '';
  const items = weekSessions(c, cur.term, cur.week);
  const range = weekRange(c.plan.terms[cur.term - 1], cur.week);
  const head = { week: 'This week', weekend: 'Next week', holidays: 'First week back', ended: 'Last week' }[cur.state];
  return html`
    <section class="card home-card">
      <h2>${head}</h2>
      <p class="hint">Term ${cur.term}, Week ${cur.week} · ${rangeText(range)}</p>
      ${items.length ? html`<ul class="up-list">${items.map((it) => html`
        <li class="${it.date === today ? 'today' : ''} ${it.date && it.date < today ? 'past' : ''}">
          <span class="up-when">${it.when}</span>
          ${it.blocked
            ? html`<span class="up-title"><span class="tag">Cancelled</span> ${it.label || 'No class'}</span>`
            : html`<a class="up-title" href="${lessonUrl(c, it.lesson.id)}">${kindMark(it.lesson)}${it.lesson.title}</a>`}
        </li>`)}</ul>` : html`<p class="empty small">No lessons this week.</p>`}
      <a class="more" href="#/class/${c.id}/week">Week calendar →</a>
    </section>`;
}

// Homework set in the next fortnight or not yet due, with when it's due (the next lesson after it).
function homeworkCard(c) {
  const today = todayISO();
  const list = homeworkDue(c.result, today).slice(0, 5);
  if (!list.length) return '';
  const dueText = (h) => (!h.due ? 'Due next lesson' : h.due === today ? 'Due today' : `Due ${fmtDay(h.due)}`);
  return html`
    <section class="card home-card">
      <h2>Homework</h2>
      <ul class="up-list hw-list">${list.map((h) => html`
        <li class="${h.due === today ? 'today' : ''}">
          <span class="up-when">${dueText(h)}</span>
          <a class="up-title" href="${lessonUrl(c, h.lesson.id)}">${h.lesson.title}</a>
          <span class="hw-set">${h.set === today ? 'Set today' : `Set ${fmtDay(h.set)}`}</span>
        </li>`)}</ul>
    </section>`;
}

function comingUpCard(c) {
  const today = todayISO();
  const list = c.result.lessons.filter((l) => isAssessmentLike(l) && l.start && l.start.date && l.start.date >= today).slice(0, 3);
  if (!list.length) return '';
  return html`
    <section class="card home-card">
      <h2>Coming up</h2>
      <ul class="up-list">${list.map((l) => html`
        <li><span class="up-when">${fmtDay(l.start.date)}</span><a class="up-title" href="${lessonUrl(c, l.id)}">★ ${l.title}</a></li>`)}</ul>
    </section>`;
}

// Pinned announcements first, then newest first.
const sortedPosts = (posts) => [...posts].sort((a, b) => (!!b.pinned - !!a.pinned) || b.createdAt - a.createdAt);

function homePanel(c) {
  const cls = c.cls;
  const contact = (cls.contact || '').trim();
  const details = [['Subject', cls.subject], ['Year', cls.year]].filter(([, v]) => v);
  return html`
    <div class="home-grid">
      <div class="home-feed">
        ${c.isOwner ? html`
          <form class="card post-form" data-form="post">
            <label for="post-text" class="sr-only">New announcement</label>
            <textarea id="post-text" name="text" rows="3" maxlength="4000" required placeholder="Post an announcement to ${cls.name}"></textarea>
            <div class="row end"><button class="btn primary" type="submit">Post</button></div>
          </form>` : ''}
        <h2 class="feed-head">Announcements</h2>
        ${c.posts.length ? sortedPosts(c.posts).map((p) => html`
          <article class="card post ${p.pinned ? 'pinned' : ''}" data-post="${p.id}">
            <header class="post-head">
              <span class="avatar" style="--class:${colourOf(cls)}" aria-hidden="true">${initials(cls.teacher)}</span>
              <div class="post-who"><strong>${cls.teacher || 'Your teacher'}${p.pinned ? html` <span class="tag pin-tag">Pinned</span>` : ''}</strong>
                <time datetime="${new Date(p.createdAt).toISOString()}">${fmtPosted(p.createdAt)}${p.editedAt ? ' · edited' : ''}</time></div>
              ${c.isOwner && c.editPost !== p.id ? html`<div class="post-tools">
                <button class="btn small ghost" data-action="pin-post" aria-pressed="${!!p.pinned}">${p.pinned ? 'Unpin' : 'Pin to top'}</button>
                <button class="btn small ghost" data-action="edit-post">Edit</button>
                <button class="icon-btn danger" data-action="delete-post" data-post="${p.id}" aria-label="Delete this announcement">✕</button>
              </div>` : ''}
            </header>
            ${c.isOwner && c.editPost === p.id ? html`
              <form class="post-form" data-form="edit-post" data-post="${p.id}">
                <label for="edit-post-text" class="sr-only">Edit announcement</label>
                <textarea id="edit-post-text" name="text" rows="4" maxlength="4000" required>${p.text}</textarea>
                <div class="row end">
                  <button class="btn ghost" type="button" data-action="cancel-edit-post">Cancel</button>
                  <button class="btn primary" type="submit">Save</button>
                </div>
              </form>` : html`<div class="post-text">${linkify(p.text)}</div>`}
          </article>`) : html`<p class="empty">${c.isOwner ? 'No announcements yet. What you post here is the first thing students see.' : 'No announcements yet.'}</p>`}
      </div>
      <aside class="home-side">
        <section class="card home-card">
          <h2>Class information</h2>
          <dl class="info">
            <dt>Teacher</dt><dd>${cls.teacher || (c.isOwner ? html`<span class="hint">Add your name on the Setup tab</span>` : 'Your teacher')}</dd>
            ${contact ? html`<dt>Contact</dt><dd>${isEmail(contact) ? html`<a href="mailto:${contact}">${contact}</a>` : linkify(contact)}</dd>` : ''}
            ${details.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
          </dl>
          ${cls.about ? html`<p class="about">${linkify(cls.about)}</p>` : ''}
          ${c.isOwner && (!contact || !cls.about) ? html`<p class="hint">Add ${[!contact && 'your contact details', !cls.about && 'a short description'].filter(Boolean).join(' and ')} on the <a href="#/class/${c.id}/setup">Setup</a> tab.</p>` : ''}
        </section>
        ${classFilesCard(c)}
        ${upNextCard(c)}
        ${homeworkCard(c)}
        ${comingUpCard(c)}
      </aside>
    </div>`;
}

// Files for the whole class, such as the year's lecture notes, under Class information.
// Stored like lesson files (see CLASS_FILES), so teacher-only and unlock dates work the same way.
function classFilesCard(c) {
  const has = filesFor(c, CLASS_FILES).length || c.uploads.some((u) => u.lessonId === CLASS_FILES);
  if (!c.isOwner && !has) return '';
  return html`
    <section class="card home-card class-files">
      <h2>Class files</h2>
      ${c.isOwner ? html`
        ${has ? '' : html`<p class="hint">Files for the whole year, such as lecture notes, a formula sheet or the course outline. Students can open them here any time.</p>`}
        ${teacherFiles(c, { id: CLASS_FILES })}`
        : studentFiles(c, CLASS_FILES)}
    </section>`;
}

/* ---------- week calendar: days across, periods down, flip between weeks ---------- */

// Every week of the year that has dates, in order.
function allWeeks(plan) {
  const out = [];
  plan.terms.forEach((term, ti) => {
    const n = clampWeeks(term.weeks);
    for (let w = 1; w <= n; w++) {
      const range = weekRange(term, w);
      if (range) out.push({ term: ti + 1, week: w, range });
    }
  });
  return out;
}

// Whole-day events (Period = All) for one day, shown as a chip under the date.
function dayEvents(plan, term, week, day) {
  return (plan.events || []).filter((e) => Number(e.term) === term && Number(e.week) === week &&
    (e.day === 'All' || Number(e.day) === day) && e.period === 'All');
}

function weekCalendar(c) {
  const r = c.result;
  const weeks = allWeeks(c.plan);
  if (!r.meetingsPerWeek || !weeks.length) {
    return html`<p class="empty">${c.isOwner
      ? 'Add term dates and tick when this class meets on the Setup tab to see the week calendar.'
      : "Your teacher hasn't set up the timetable yet."}</p>`;
  }
  const cur = currentWeek(c.plan, todayISO());
  const curPos = Math.max(0, weeks.findIndex((w) => cur && w.term === cur.term && w.week === cur.week));
  if (c.weekPos === undefined || c.weekPos >= weeks.length) c.weekPos = curPos;
  const wk = weeks[c.weekPos];
  const term = c.plan.terms[wk.term - 1];
  const today = todayISO();
  const slots = slotsByWeek(r).get(`${wk.term}-${wk.week}`) || [];
  const at = new Map(slots.map((s) => [`${s.day}-${s.period}`, s]));

  // Week strip: one notch per week, grouped by term.
  const strip = c.plan.terms.map((t, ti) => {
    const mine = weeks.map((w, i) => ({ ...w, i })).filter((w) => w.term === ti + 1);
    if (!mine.length) return '';
    return html`<div class="strip-term">
      <span class="strip-label">T${ti + 1}</span>
      <div class="strip-notches">${mine.map((w) => html`<button class="notch ${w.i === c.weekPos ? 'sel' : ''} ${w.i === curPos && cur && cur.state === 'week' ? 'now' : ''}"
        data-action="week-goto" data-pos="${w.i}" aria-label="Term ${w.term} Week ${w.week}, ${rangeText(w.range)}"
        ${raw(w.i === c.weekPos ? 'aria-current="true"' : '')} title="Term ${w.term} Week ${w.week}"></button>`)}</div>
    </div>`;
  });

  // Day columns. Consecutive periods of the same lesson merge into one tall tile.
  const cells = [];
  for (let day = 1; day <= 5; day++) {
    const date = slotDate(term, wk.week, day);
    const isToday = date === today;
    const chips = dayEvents(c.plan, wk.term, wk.week, day);
    cells.push(html`<div class="cal-day ${isToday ? 'today' : ''}" style="grid-column:${day + 1}">
      <span class="cal-dow">${DAYS[day - 1]}</span>
      <span class="cal-date">${fmt(date, { day: 'numeric' })}</span>
      <span class="cal-month">${fmt(date, { month: 'short' })}</span>
      ${chips.map((e) => html`<span class="cal-chip">${e.label || 'No classes'}</span>`)}
    </div>`);
    if (isToday) cells.push(html`<div class="cal-today-col" style="grid-column:${day + 1}" aria-hidden="true"></div>`);
    let dayTiles = 0;
    for (let p = 1; p <= PERIODS_PER_DAY; p++) {
      const s = at.get(`${day}-${p}`);
      if (!s) continue;
      if (s.blocked) {
        dayTiles++;
        cells.push(html`<div class="tile cancelled" style="grid-column:${day + 1};grid-row:${p + 1}">
          <span class="tile-when">P${p} <span class="tile-day">· ${DAYS[day - 1]}</span></span>
          <span class="tag">Cancelled</span>
          <span class="tile-title">${s.label || 'No class'}</span>
        </div>`);
        continue;
      }
      if (s.lessonIndex === null) continue;
      // Merge with the next periods if they are the same lesson.
      let span = 1;
      while (p + span <= PERIODS_PER_DAY) {
        const n = at.get(`${day}-${p + span}`);
        if (!n || n.blocked || n.lessonIndex !== s.lessonIndex) break;
        span++;
      }
      const last = at.get(`${day}-${p + span - 1}`);
      const l = r.lessons[s.lessonIndex];
      const k = lessonKind(l);
      const part = s.of > 1 ? (span > 1 ? `Parts ${s.part}–${last.part} of ${s.of}` : `Part ${s.part} of ${s.of}`) : '';
      dayTiles++;
      const nFiles = filesFor(c, l.id).length;
      cells.push(html`<a class="tile ${k}" href="${lessonUrl(c, l.id)}" style="grid-column:${day + 1};grid-row:${p + 1} / span ${span}">
        <span class="tile-when">${span > 1 ? `P${p}–${p + span - 1}` : `P${p}`} <span class="tile-day">· ${DAYS[day - 1]}</span></span>
        <span class="tile-title">${kindIcon(k)}${l.title}</span>
        ${part ? html`<span class="tile-part">${part}</span>` : ''}
        ${l.homework ? html`<span class="tag">Homework</span>` : ''}
        ${nFiles ? html`<span class="tile-files">${CLIP_ICON}${plural(nFiles, 'file')}</span>` : ''}
      </a>`);
      p += span - 1;
    }
    if (!dayTiles) cells.push(html`<p class="cal-none" style="grid-column:${day + 1}">${chips.length ? '' : 'No class'}</p>`);
  }
  const periodLabels = Array.from({ length: PERIODS_PER_DAY }, (_, i) => html`<div class="cal-period" style="grid-row:${i + 2}">P${i + 1}</div>`);
  const lines = Array.from({ length: PERIODS_PER_DAY }, (_, i) => html`<div class="cal-line" style="grid-row:${i + 2}" aria-hidden="true"></div>`);

  const label = { week: 'This week', weekend: 'Next week', holidays: 'Next up', ended: 'Last week' };
  return html`
    <section class="cal" style="--class:${colourOf(c.cls)}" aria-label="Week calendar">
      <div class="cal-head">
        <div class="cal-nav">
          <button class="icon-btn big" data-action="week-prev" aria-label="Previous week" ${raw(c.weekPos === 0 ? 'disabled' : '')}>‹</button>
          <button class="icon-btn big" data-action="week-next" aria-label="Next week" ${raw(c.weekPos === weeks.length - 1 ? 'disabled' : '')}>›</button>
          <div class="cal-title">
            <h2>Term ${wk.term} · Week ${wk.week}</h2>
            <span>${fmt(wk.range.from, { day: 'numeric', month: 'short' })} – ${fmt(wk.range.to, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
        </div>
        <div class="cal-tools">
          ${c.weekPos === curPos && cur ? html`<span class="tag now">${label[cur.state]}</span>` : ''}
          <button class="btn" data-action="week-today" ${raw(c.weekPos === curPos ? 'disabled' : '')}>Today</button>
        </div>
      </div>
      <div class="strip" role="group" aria-label="Weeks of the year">${strip}</div>
      <div class="cal-grid" data-cal>
        <div class="cal-corner" aria-hidden="true"></div>
        ${periodLabels}${lines}${cells}
      </div>
      <p class="hint">Use the arrows, the ← → keys or the notches above to flip between weeks. Click a lesson to open it. ★ marks assessments and ↻ marks revision.</p>
    </section>`;
}

/* ---------- lesson files ---------- */

const filesFor = (c, lessonId) => c.files.filter((f) => f.lessonId === lessonId)
  .sort((a, b) => (a.locked - b.locked) || a.name.localeCompare(b.name));
const msToISO = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// "Thu 12 Nov", or "Thu 12 Nov, 4 pm" when the time isn't midnight.
function fmtWhen(ms) {
  const d = new Date(ms);
  const day = fmtDay(msToISO(ms));
  if (!d.getHours() && !d.getMinutes()) return day;
  return `${day}, ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase()}`;
}

// "Open teacher-only files after the lesson": the files unlock at the end of the school day
// (periods have no clock times) on the date of the lesson's last period. Worked out again
// whenever the timetable is, so the unlock moves with the lesson.
const AFTER_LESSON_HOUR = 16;
const AFTER_LESSON_TIME = '4 pm';
function afterLessonAt(c, l) {
  const p = isPlaced(l) ? c.placed.get(l.id) : null;
  const date = p && p.end && p.end.date;
  return date ? new Date(`${date}T${String(AFTER_LESSON_HOUR).padStart(2, '0')}:00:00`).getTime() : null;
}
function syncAfterLesson(c) {
  if (!c.isOwner) return;
  const jobs = [];
  for (const l of c.lessons) {
    if (!l.openAfter) continue;
    const at = afterLessonAt(c, l);
    for (const f of c.files) {
      if (f.lessonId !== l.id || !f.locked || f.unlockAt === at) continue;
      if (c.uploads.some((u) => u.lessonId === f.lessonId && u.name.slice(0, 200) === f.name)) continue; // not stored yet
      f.unlockAt = at;
      jobs.push(store.updateFile(c.id, f, { unlockAt: at }));
    }
  }
  if (jobs.length) {
    Promise.all(jobs).catch((e) => {
      console.error(e);
      toast("Couldn't update when some teacher-only files open. Reload the page to try again.", 'error');
    });
  }
}

// Files in the lesson builder: attach, mark teacher-only, set an unlock date or unlock now.
// Also the Class files card on Home, with l = { id: CLASS_FILES } (no "after the lesson" option).
function teacherFiles(c, l) {
  const ups = c.uploads.filter((u) => u.lessonId === l.id);
  // A file still uploading shows as its progress row only.
  const files = filesFor(c, l.id).filter((f) => !ups.some((u) => u.name.slice(0, 200) === f.name));
  const auto = !!l.openAfter;
  return html`
    <div class="lesson-files">
      ${files.length || ups.length ? html`<ul class="file-list">
        ${files.map((f) => html`<li class="file-row ${f.locked ? 'locked' : ''}" data-file="${f.id}">
          <button class="file-chip" data-action="open-file" data-file="${f.id}" title="Open ${f.name}">
            <span class="file-icon" aria-hidden="true">${fileIcon(f.name)}</span>
            <span class="file-name">${f.name}</span>
            <span class="file-size">${fileSize(f.size)}</span>
          </button>
          <label class="check"><input type="checkbox" data-ffield="locked" ${raw(f.locked ? 'checked' : '')}> Teacher only</label>
          ${f.locked ? html`
            ${auto
              ? html`<span class="unlock-auto">${f.unlockAt ? `Opens ${fmtWhen(f.unlockAt)}` : 'Opens after the lesson, once it\'s on the planner'}</span>`
              : html`<label class="unlock-date">Unlocks <input type="date" data-ffield="unlockAt" value="${f.unlockAt ? msToISO(f.unlockAt) : ''}" aria-label="Unlock date for ${f.name}"></label>`}
            <label class="check"><input type="checkbox" data-ffield="unlocked" ${raw(f.unlocked ? 'checked' : '')}> Unlocked now</label>
            <span class="tag ${isOpen(f) ? '' : 'bad'}">${isOpen(f) ? 'Students can open' : 'Hidden from students'}</span>` : ''}
          <button class="icon-btn danger" data-action="delete-file" aria-label="Delete ${f.name}">✕</button>
        </li>`)}
        ${ups.map((u) => html`<li class="file-row uploading"><span class="file-chip"><span class="file-icon" aria-hidden="true">${fileIcon(u.name)}</span>
          <span class="file-name">${u.name}</span><span class="file-size" id="up-${u.key}">Uploading ${Math.round(u.pct * 100)}%</span></span></li>`)}
      </ul>` : ''}
      ${(files.some((f) => f.locked) || auto) && l.id !== CLASS_FILES ? html`
        <label class="check open-after"><input type="checkbox" data-lfield="openAfter" ${raw(auto ? 'checked' : '')}>
          Open teacher-only files after the lesson</label>
        <p class="hint">${auto
          ? `They open at ${AFTER_LESSON_TIME} on the day of the lesson's last period, and move when the planner moves the lesson.`
          : 'Tick this for answers: they open by themselves once the lesson is over, even when the planner moves it.'}</p>` : ''}
      <div class="file-add">
        <label class="btn small">Attach files<input type="file" multiple accept="${ACCEPT}" data-upload="${l.id}" class="sr-only"></label>
        <label class="btn small">Attach teacher-only file<input type="file" multiple accept="${ACCEPT}" data-upload="${l.id}" data-locked="1" class="sr-only"></label>
      </div>
    </div>`;
}

// A lesson's web links. Only http(s) links are ever drawn, whatever is stored.
const lessonLinks = (l) => (Array.isArray(l.links) ? l.links : []).filter((k) => k && linkUrl(k.url) === k.url);

// Links in the lesson builder: a video, a Desmos activity, a shared document.
function teacherLinks(l) {
  const links = lessonLinks(l);
  return html`
    <div class="lesson-links">
      ${links.length ? html`<ul class="file-list">${links.map((k, i) => html`
        <li class="file-row">
          <a class="file-chip" href="${k.url}" target="_blank" rel="noopener" title="Open ${k.url}">
            <span class="file-icon link-icon" aria-hidden="true">WEB</span>
            <span class="file-name">${k.title || k.url}</span>
            ${k.title ? html`<span class="file-size">${linkHost(k.url)}</span>` : ''}
          </a>
          <button class="icon-btn danger" data-action="delete-link" data-index="${i}" aria-label="Delete the link ${k.title || k.url}">✕</button>
        </li>`)}</ul>` : ''}
      ${links.length < MAX_LINKS ? html`
        <form class="link-add" data-form="add-link" data-lesson-id="${l.id}">
          <input name="linkUrl" inputmode="url" autocomplete="off" required maxlength="2000" placeholder="Paste a link, e.g. a video or Desmos activity" aria-label="Link address">
          <input name="linkTitle" maxlength="200" placeholder="Name (optional)" aria-label="Link name">
          <button class="btn small" type="submit">Add link</button>
        </form>` : html`<p class="hint">That's the most links one lesson can have.</p>`}
    </div>`;
}

function studentLinks(l) {
  return html`<ul class="file-links">${lessonLinks(l).map((k) => html`
    <li><a class="file-link" href="${k.url}" target="_blank" rel="noopener">
      <span class="file-icon link-icon" aria-hidden="true">WEB</span><span class="file-name">${k.title || linkHost(k.url)}</span>
      ${k.title ? html`<span class="file-when">${linkHost(k.url)}</span>` : ''}</a></li>`)}</ul>`;
}

// Files as students see them: a link, or a lock with when it opens.
function studentFiles(c, lessonId) {
  const files = filesFor(c, lessonId);
  if (!files.length) return '';
  return html`<ul class="file-links">${files.map((f) => isOpen(f) || c.isOwner
    ? html`<li><button class="file-link" data-action="open-file" data-file="${f.id}">
        <span class="file-icon" aria-hidden="true">${fileIcon(f.name)}</span><span class="file-name">${f.name}</span></button></li>`
    : html`<li class="file-locked"><span class="file-icon" aria-hidden="true">🔒</span>
        <span class="file-name">${f.name}</span>
        <span class="file-when">${f.unlockAt ? `opens ${fmtWhen(f.unlockAt)}` : 'your teacher will unlock this'}</span></li>`)}</ul>`;
}

async function uploadFiles(input) {
  const c = state.cls;
  const lessonId = input.dataset.upload;
  const locked = input.dataset.locked === '1';
  const picked = [...input.files];
  input.value = '';
  for (const file of picked) {
    const problem = fileProblem(file);
    if (problem) { toast(problem, 'error'); continue; }
    const up = { key: Math.random().toString(36).slice(2), lessonId, name: file.name, pct: 0 };
    c.uploads.push(up);
    renderPanel();
    try {
      const f = await store.uploadFile(c.id, lessonId, file, { locked }, (pct) => {
        up.pct = pct;
        const el = document.getElementById(`up-${up.key}`);
        if (el) el.textContent = `Uploading ${Math.round(pct * 100)}%`;
      });
      // The live listener may have brought the record in already.
      c.files = [...c.files.filter((x) => x.id !== f.id), f];
      c.uploads = c.uploads.filter((u) => u !== up);
      syncAfterLesson(c);
      toast(`Uploaded ${file.name}`);
    } catch (e) {
      console.error(e);
      toast(`Couldn't upload ${file.name}. Check your connection and try again.`, 'error');
    }
    c.uploads = c.uploads.filter((u) => u !== up);
    renderPanel();
  }
}

// classId is given for a file on the Today list (teacher home); otherwise it's the open class's.
async function openFile(fileId, classId) {
  const day = classId && state.today ? state.today.find((d) => d.cls.id === classId) : null;
  const files = day ? day.files || [] : state.cls ? state.cls.files : [];
  const cid = day ? classId : state.cls && state.cls.id;
  const f = files.find((x) => x.id === fileId);
  if (!f) return;
  // Open the tab straight away (pop-up blockers allow it during the click), then fill it in.
  const win = window.open('', '_blank');
  try {
    const url = await store.fileUrl(cid, f);
    if (win) win.location.href = url; else location.href = url;
  } catch (e) {
    if (win) win.close();
    console.error(e);
    toast(e && e.code === 'storage/unauthorized' ? "This file isn't open yet." : "Couldn't open the file. Try again.", 'error');
  }
}

async function updateFile(fileId, field, el) {
  const c = state.cls;
  const f = c.files.find((x) => x.id === fileId);
  if (!f) return;
  const patch = field === 'unlockAt'
    ? { unlockAt: el.value ? new Date(`${el.value}T00:00:00`).getTime() : null }
    : { [field]: el.checked };
  Object.assign(f, patch);
  renderPanel();
  await saving(store.updateFile(c.id, f, patch));
  if (field === 'locked') { syncAfterLesson(c); renderPanel(); }
}

function slotsByWeek(r) {
  const byWeek = new Map();
  for (const s of r.slots) {
    const k = `${s.term}-${s.week}`;
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(s);
  }
  return byWeek;
}

/* ---------- timetable ---------- */

function timetablePanel(c) {
  const r = c.result;
  if (!r.meetingsPerWeek) return setupFirstBanner();
  const cur = currentWeek(c.plan, todayISO());
  const cells = new Map(r.slots.map((s) => [`${s.term}-${s.week}-${s.day}-${s.period}`, s]));
  const head = r.columns.map((col) => html`<th scope="col">${DAYS[col.day - 1]}<span>P${col.period}</span></th>`);
  const tables = c.plan.terms.map((term, ti) => {
    const weeks = clampWeeks(term.weeks);
    if (!weeks) return '';
    const t = r.perTerm[ti];
    const rows = [];
    for (let w = 1; w <= weeks; w++) {
      const isCur = cur && cur.term === ti + 1 && cur.week === w;
      rows.push(html`<tr class="${isCur ? 'current' : ''}">
        <th scope="row">Wk ${w}<span>${rangeText(weekRange(term, w))}</span>${isCur ? html`<span class="tag now">${cur.state === 'week' ? 'This week' : 'Next'}</span>` : ''}</th>
        ${r.columns.map((col) => {
          const s = cells.get(`${ti + 1}-${w}-${col.day}-${col.period}`);
          if (s.blocked) return html`<td class="cancelled"><span class="tag">Cancelled</span> ${s.label}</td>`;
          if (s.lessonIndex === null) return html`<td class="free"><span class="sr-only">Free</span></td>`;
          const l = r.lessons[s.lessonIndex];
          const k = lessonKind(l);
          return html`<td class="${k}"><a href="${lessonUrl(c, l.id)}">${kindIcon(k)}${cellText(s, r.lessons)}</a></td>`;
        })}
      </tr>`);
    }
    return html`
      <section class="term-block">
        <h3>Term ${ti + 1} <span class="term-meta">${t.used} of ${t.available} periods used${t.blocked ? `, ${t.blocked} cancelled` : ''}</span>${c.isOwner && !t.fits ? html` <span class="tag bad">Short by ${-t.spare}</span>` : ''}</h3>
        <div class="table-scroll" tabindex="0" role="region" aria-label="Term ${ti + 1} timetable">
          <table class="timetable"><thead><tr><th scope="col">Week</th>${head}</tr></thead><tbody>${rows}</tbody></table>
        </div>
      </section>`;
  });
  return html`${c.isOwner ? yearBanner(r) : ''}${tables}
    <p class="hint">★ marks assessments, tests, quizzes and exams. ↻ marks revision and review lessons. Multi-period lessons show the part, e.g. (2/3).</p>`;
}

/* ---------- tracker: class list, marks and homework (teacher only) ---------- */

// Which terms a tracker or report view covers.
const PERIOD_CHOICES = [
  ['year', 'Whole year', null], ['s1', 'Semester 1', [1, 2]], ['s2', 'Semester 2', [3, 4]],
  ['t1', 'Term 1', [1]], ['t2', 'Term 2', [2]], ['t3', 'Term 3', [3]], ['t4', 'Term 4', [4]],
];
const periodOf = (p) => PERIOD_CHOICES.find((x) => x[0] === p) || PERIOD_CHOICES[0];

function periodPicker(name, value) {
  return html`<label class="inline">Show <select data-period="${name}">
    ${PERIOD_CHOICES.map(([v, label]) => html`<option value="${v}" ${raw(v === value ? 'selected' : '')}>${label}</option>`)}
  </select></label>`;
}

// Assessment and homework columns for the chosen terms.
function trackerCols(c, period) {
  const all = trackerColumns(c.lessons, c.placed, c.tracker);
  const terms = periodOf(period)[2];
  return { assessment: inTerms(all.assessment, terms), homework: inTerms(all.homework, terms) };
}

const pctText = (p) => (p === null || p === undefined ? '–' : `${p}%`);
const colWhen = (col) => (col.date ? fmtShort(col.date) : col.term ? `Term ${col.term}` : col.lessonId ? 'Not on the planner' : '');
const hwSym = (v) => (v === true ? '✓' : v === false ? '✗' : '');
const hwWord = (v) => (v === true ? 'done' : v === false ? 'not done' : 'not marked');

function noStudents(c) {
  return html`<p class="empty">No students yet. Add your class list on the <a href="#/class/${c.id}/tracker/students">Class list</a> page.</p>`;
}

function trackerPanel(c) {
  const view = ['homework', 'students', 'scale'].includes(c.sub) ? c.sub : 'marks';
  const nav = [['marks', 'Assessments', ''], ['homework', 'Homework', '/homework'], ['students', 'Class list', '/students'], ['scale', 'Grading scale', '/scale']];
  const body = { marks: marksView, homework: homeworkView, students: studentsView, scale: scaleView }[view](c);
  return html`
    <div class="trk-bar">
      <nav class="seg" aria-label="Tracker pages">
        ${nav.map(([v, label, path]) => html`<a href="#/class/${c.id}/tracker${path}" class="${v === view ? 'on' : ''}" ${raw(v === view ? 'aria-current="page"' : '')}>${label}</a>`)}
      </nav>
      ${view === 'marks' || view === 'homework' ? periodPicker('track', c.trackPeriod) : ''}
    </div>
    ${body}`;
}

// A homework or assessment column takes its lesson's unit colour (grey for no unit or no lesson).
function colUnitColour(c, col) {
  const l = col.lessonId && lessonById(col.lessonId);
  return l ? unitColour(c, unitIdOf(c, l)) : 'var(--line-2)';
}

function colHead(c, col) {
  return html`
    <span class="col-title">${col.lessonId ? html`<a href="${lessonUrl(c, col.lessonId)}">${col.title}</a>` : col.title}</span>
    <span class="col-when">${colWhen(col)}${col.lessonId ? '' : html` <button class="icon-btn small danger" data-action="delete-extra" data-col="${col.id}" aria-label="Remove the column ${col.title}" title="Remove this column">✕</button>`}</span>`;
}

// Adds a column that isn't tied to a lesson, e.g. a take-home task.
function extraForm(kind) {
  return html`
    <details class="extra-add">
      <summary>Add ${kind === 'homework' ? 'a homework task' : 'an assessment'} that isn't a lesson</summary>
      <form data-form="extra-col" data-kind="${kind}" class="row">
        <label>Name <input name="title" required maxlength="200"></label>
        <label>Date <span class="optional">(optional)</span> <input name="date" type="date"></label>
        <button class="btn small primary" type="submit">Add column</button>
      </form>
    </details>`;
}

function marksView(c) {
  const list = sortStudents(c.students);
  const cols = trackerCols(c, c.trackPeriod).assessment;
  const manual = manualLevels(c.tracker.scale).map((g) => g.short);
  if (!list.length) return noStudents(c);
  const intro = html`<p class="hint">Every lesson ticked <strong>Assessment</strong> gets a column. Set what each is out of, then type marks${manual.length ? html`, or <strong>${manual.join(' or ')}</strong> to leave a student out of the averages` : ''}. <kbd>Enter</kbd> moves down. You can paste a block of marks copied from a spreadsheet.</p>`;
  if (!cols.length) {
    return html`${intro}<p class="empty">No assessments in ${periodOf(c.trackPeriod)[1].toLowerCase()} yet. Tick <strong>Assessment</strong> on a lesson on the Lessons or Planner tab.</p>${extraForm('assessment')}`;
  }
  return html`
    ${intro}
    <div class="grid-scroll" tabindex="-1">
      <table class="grid">
        <thead><tr>
          <th scope="col" class="name-col">Student</th>
          ${cols.map((col) => html`<th scope="col" class="col-head">
            ${colHead(c, col)}
            <label class="out-of">out of <input type="number" min="0" step="any" inputmode="decimal" data-max="${col.id}" value="${col.max ?? ''}"
              class="${col.max ? '' : 'missing'}" aria-label="What ${col.title} is out of"></label>
          </th>`)}
          <th scope="col" class="sum-col">Average</th>
          <th scope="col" class="sum-col">Standard</th>
        </tr></thead>
        <tbody>${list.map((s) => {
          const a = (c.marks[s.id] || {}).a || {};
          return html`<tr>
            <th scope="row" class="name-col">${s.name}</th>
            ${cols.map((col) => html`<td><input class="mark" data-mark="${s.id}" data-col="${col.id}" value="${a[col.id] ?? ''}"
              inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${s.name}, ${col.title}"><span class="mark-info" data-info="${s.id}|${col.id}"></span></td>`)}
            <td class="sum-col" data-avg="${s.id}"></td>
            <td class="sum-col" data-lvl="${s.id}"></td>
          </tr>`;
        })}</tbody>
        <tfoot><tr>
          <th scope="row" class="name-col">Class average</th>
          ${cols.map((col) => html`<td data-colavg="${col.id}"></td>`)}
          <td class="sum-col"></td><td class="sum-col"></td>
        </tr></tfoot>
      </table>
    </div>
    ${extraForm('assessment')}`;
}

function homeworkView(c) {
  const list = sortStudents(c.students);
  const cols = trackerCols(c, c.trackPeriod).homework;
  if (!list.length) return noStudents(c);
  const intro = html`<p class="hint">Every lesson ticked <strong>Homework</strong> gets a column. Click a box to mark it done (✓), then not done (✗), then clear it. Completion only counts the boxes you've marked.</p>`;
  if (!cols.length) {
    return html`${intro}<p class="empty">No homework in ${periodOf(c.trackPeriod)[1].toLowerCase()} yet. Tick <strong>Homework</strong> on a lesson on the Lessons or Planner tab.</p>${extraForm('homework')}`;
  }
  return html`
    ${intro}
    <div class="grid-scroll" tabindex="-1">
      <table class="grid hw-grid">
        <thead><tr>
          <th scope="col" class="name-col">Student</th>
          ${cols.map((col) => html`<th scope="col" class="col-head unit-col" style="--unit:${colUnitColour(c, col)}">
            ${colHead(c, col)}
            <span class="hw-col-tools">
              <button class="btn tiny" data-action="hw-all" data-col="${col.id}" title="Mark every empty box done">All ✓</button>
              <button class="btn tiny" data-action="hw-clear" data-col="${col.id}" title="Clear every box in this column">Clear</button>
            </span>
          </th>`)}
          <th scope="col" class="sum-col">Done</th>
        </tr></thead>
        <tbody>${list.map((s) => {
          const h = (c.marks[s.id] || {}).h || {};
          return html`<tr>
            <th scope="row" class="name-col">${s.name}</th>
            ${cols.map((col) => html`<td><button class="hw ${h[col.id] === true ? 'done' : h[col.id] === false ? 'miss' : ''}" data-action="hw-toggle"
              data-hw="${s.id}" data-col="${col.id}" aria-label="${s.name}, ${col.title}: ${hwWord(h[col.id])}">${hwSym(h[col.id])}</button></td>`)}
            <td class="sum-col" data-hwrow="${s.id}"></td>
          </tr>`;
        })}</tbody>
        <tfoot><tr>
          <th scope="row" class="name-col">Class</th>
          ${cols.map((col) => html`<td data-colhw="${col.id}"></td>`)}
          <td class="sum-col" data-classhw></td>
        </tr></tfoot>
      </table>
    </div>
    ${extraForm('homework')}`;
}

// Fills in the worked-out numbers (%, levels, averages) without redrawing the grid, so typing isn't interrupted.
function fillNumbers(c) {
  const scale = c.tracker.scale;
  const cols = trackerCols(c, c.trackPeriod);
  const byId = new Map([...cols.assessment, ...cols.homework].map((x) => [x.id, x]));
  const set = (el, text, title = '') => { el.textContent = text; if (title) el.title = title; else el.removeAttribute('title'); };
  document.querySelectorAll('[data-info]').forEach((el) => {
    const [sid, colId] = el.dataset.info.split('|');
    const col = byId.get(colId);
    const r = col && result(scale, ((c.marks[sid] || {}).a || {})[colId], col.max);
    if (!r) set(el, '');
    else if (r.counts) set(el, `${pctText(r.pct)} · ${r.grade.short}`, r.grade.label);
    else if (r.score !== null) set(el, 'needs "out of"');
    else set(el, 'not counted', r.grade ? r.grade.label : '');
  });
  document.querySelectorAll('[data-avg]').forEach((el) => {
    const sum = studentSummary(scale, cols, c.marks[el.dataset.avg]);
    set(el, pctText(sum.avgPct));
    const lvl = document.querySelector(`[data-lvl="${el.dataset.avg}"]`);
    if (lvl) set(lvl, sum.avgLevel ? sum.avgLevel.short : '–', sum.avgLevel ? `${sum.avgLevel.label} (${sum.avgPoints} points)` : '');
  });
  document.querySelectorAll('[data-colavg]').forEach((el) => {
    const s = assessmentSummary(scale, byId.get(el.dataset.colavg), c.students, c.marks);
    set(el, pctText(s.avg), s.count ? `${s.count} counted, median ${pctText(s.median)}` : '');
  });
  document.querySelectorAll('[data-hwrow]').forEach((el) => {
    const sum = studentSummary(scale, cols, c.marks[el.dataset.hwrow]);
    set(el, sum.hwMarked ? `${sum.hwDone}/${sum.hwMarked} · ${sum.hwPct}%` : '–');
  });
  document.querySelectorAll('[data-colhw]').forEach((el) => {
    const s = homeworkSummary(byId.get(el.dataset.colhw), c.students, c.marks);
    set(el, s.marked ? `${s.pct}%` : '–', s.marked ? `${s.done} of ${s.marked} done` : '');
  });
  const all = document.querySelector('[data-classhw]');
  if (all) { const s = classHomework(cols, c.students, c.marks); set(all, s.marked ? `${s.pct}%` : '–'); }
}

function studentsView(c) {
  const list = sortStudents(c.students);
  return html`
    <div class="trk-two">
      <section class="card">
        <h2>Class list <span class="count">${list.length}</span></h2>
        ${list.length ? html`<ol class="roster">${list.map((s) => html`
          <li><input data-sname="${s.id}" value="${s.name}" maxlength="80" aria-label="Name of ${s.name}">
            <button class="icon-btn danger" data-action="delete-student" data-sid="${s.id}" aria-label="Remove ${s.name}">✕</button></li>`)}</ol>`
          : html`<p class="empty small">No students yet.</p>`}
      </section>
      <section class="card">
        <h2>Add students</h2>
        <form data-form="add-students" class="stack">
          <label>One name per line
            <textarea name="names" rows="8" placeholder="Ava Nguyen&#10;Leo Papadopoulos"></textarea></label>
          <p class="hint">You can paste the first-name and last-name columns straight from a spreadsheet. Only names are kept, and only you can see them. A first name and last initial is enough.</p>
          <button class="btn primary" type="submit">Add to the class</button>
        </form>
      </section>
    </div>`;
}

// Edits go into a draft and are checked when saved.
function scaleView(c) {
  const scale = c.scaleDraft || c.tracker.scale;
  return html`
    <section class="card scale-card">
      <h2>Grading scale</h2>
      <p class="hint">A mark gets the highest level whose <strong>lowest %</strong> it reaches. Leave the lowest % empty for a level you type in by hand, like Insufficient Evidence: it's left out of every average. The average standard is the average of the points.</p>
      <div class="table-scroll">
        <table class="scale-table">
          <thead><tr><th scope="col">Level</th><th scope="col">Short</th><th scope="col">Points</th><th scope="col">Lowest %</th><th></th></tr></thead>
          <tbody>${scale.map((g, i) => html`<tr data-level="${i}">
            <td><input data-gfield="label" value="${g.label}" maxlength="40" aria-label="Level name"></td>
            <td><input data-gfield="short" value="${g.short}" maxlength="6" aria-label="Short code for ${g.label}"></td>
            <td><input data-gfield="points" type="number" step="any" value="${g.points}" aria-label="Points for ${g.label}"></td>
            <td><input data-gfield="min" type="number" min="0" max="100" step="any" value="${g.min ?? ''}" placeholder="By hand" aria-label="Lowest % for ${g.label}"></td>
            <td><button class="icon-btn danger" data-action="del-level" aria-label="Remove ${g.label}">✕</button></td>
          </tr>`)}</tbody>
        </table>
      </div>
      <div class="row">
        <button class="btn" data-action="add-level">Add a level</button>
        <button class="btn ghost" data-action="reset-scale">Back to the standard scale</button>
        <button class="btn primary" data-action="save-scale">Save scale</button>
      </div>
    </section>`;
}

/* ---------- reports: student, class summary, assessment analysis ---------- */

function reportHead(c, title, sub) {
  return html`
    <header class="report-head">
      <div>
        <p class="report-class">${[c.cls.name, c.cls.subject, c.cls.year].filter(Boolean).join(' · ')}</p>
        <h2>${title}</h2>
        <p class="report-sub">${sub}</p>
      </div>
      <p class="report-date">${fmt(todayISO(), { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </header>`;
}

const stat = (label, value, note = '') => html`<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${note ? html`<span class="stat-note">${note}</span>` : ''}</div>`;

// Horizontal bars, one per row, with the count written beside each bar.
function barList(items, caption) {
  const top = Math.max(1, ...items.map((it) => it.count));
  return html`
    <figure class="chart">
      <figcaption>${caption}</figcaption>
      <div class="hbars">${items.map((it) => html`
        <div class="hbar-row" title="${it.title || it.label}: ${plural(it.count, 'result')}">
          <span class="hbar-label">${it.label}</span>
          <span class="hbar-track"><span class="hbar-fill" style="width:${(it.count / top) * 100}%"></span></span>
          <span class="hbar-n">${it.count}</span>
        </div>`)}</div>
    </figure>`;
}

// Score spread in 10% bands as columns.
function bandChart(bandList) {
  const top = Math.max(1, ...bandList.map((b) => b.count));
  return html`
    <figure class="chart">
      <figcaption>Score spread (students in each 10% band)</figcaption>
      <div class="vbars">${bandList.map((b) => html`
        <div class="vbar" title="${b.from}–${b.to}%: ${plural(b.count, 'student')}">
          <span class="vbar-plot"><span class="vbar-n">${b.count || ''}</span><span class="vbar-fill" style="height:${(b.count / top) * 85}%"></span></span>
          <span class="vbar-x ${b.from % 20 ? 'odd' : ''}">${b.from}</span>
        </div>`)}</div>
    </figure>`;
}

function studentReport(c, s, cols) {
  const scale = c.tracker.scale;
  const sum = studentSummary(scale, cols, c.marks[s.id]);
  const classAvg = new Map(cols.assessment.map((col) => [col.id, assessmentSummary(scale, col, c.students, c.marks).avg]));
  const counted = sum.rows.filter((x) => x.r && x.r.counts).length;
  const missing = sum.homework.filter((x) => x.done === false);
  return html`
    <article class="card report">
      ${reportHead(c, s.name, `Student report · ${periodOf(c.reportPeriod)[1]}`)}
      <div class="stats">
        ${stat('Average', pctText(sum.avgPct), plural(counted, 'assessment'))}
        ${stat('Average standard', sum.avgLevel ? sum.avgLevel.label : '–', sum.avgPoints !== null ? `${sum.avgPoints} points` : '')}
        ${stat('Homework done', sum.hwPct === null ? '–' : `${sum.hwPct}%`, sum.hwMarked ? `${sum.hwDone} of ${sum.hwMarked}` : 'none marked')}
      </div>
      <h3>Assessments</h3>
      ${sum.rows.length ? html`
        <table class="report-table">
          <thead><tr><th scope="col">Assessment</th><th scope="col">Date</th><th scope="col" class="num">Score</th><th scope="col" class="num">%</th><th scope="col">Standard</th><th scope="col" class="bar-col">Compared with the class</th></tr></thead>
          <tbody>${sum.rows.map(({ col, r }) => {
            const avg = classAvg.get(col.id);
            return html`<tr>
              <th scope="row">${col.title}</th>
              <td>${colWhen(col)}</td>
              <td class="num">${!r ? '–' : r.score !== null ? `${r.score} / ${col.max ?? '?'}` : r.grade ? r.grade.short : '–'}</td>
              <td class="num">${r && r.counts ? pctText(r.pct) : '–'}</td>
              <td>${r && r.grade ? r.grade.label : '–'}</td>
              <td class="bar-col">${r && r.counts ? html`<span class="cmp" role="img" aria-label="${pctText(r.pct)}, class average ${pctText(avg)}">
                <span class="cmp-fill" style="width:${Math.min(100, r.pct)}%"></span>
                ${avg !== null ? html`<span class="cmp-avg" style="left:${Math.min(100, avg)}%"></span>` : ''}</span>` : ''}</td>
            </tr>`;
          })}</tbody>
        </table>
        <p class="hint">Bar: this student's %. Line: the class average.</p>` : html`<p class="empty small">No assessments in this period.</p>`}
      <h3>Homework</h3>
      ${!sum.hwMarked ? html`<p class="empty small">No homework marked in this period.</p>`
        : missing.length ? html`<p>Not done: ${missing.map((x) => x.col.title).join(', ')}.</p>`
        : html`<p>Every marked homework task done.</p>`}
    </article>`;
}

function classReport(c, cols) {
  const scale = c.tracker.scale;
  const per = cols.assessment.map((col) => assessmentSummary(scale, col, c.students, c.marks));
  const pcts = per.flatMap((s) => s.results.filter((x) => x.r && x.r.counts).map((x) => x.r.pct));
  const avg = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null;
  const hw = classHomework(cols, c.students, c.marks);
  const totals = scale.map((g) => ({ label: g.label, count: per.reduce((n, s) => n + s.dist.find((d) => d.grade.short === g.short).count, 0) }));
  return html`
    <article class="card report">
      ${reportHead(c, 'Class summary', periodOf(c.reportPeriod)[1])}
      <div class="stats">
        ${stat('Students', c.students.length)}
        ${stat('Class average', pctText(avg), plural(per.length, 'assessment'))}
        ${stat('Homework done', hw.pct === null ? '–' : `${hw.pct}%`, hw.marked ? `${hw.done} of ${hw.marked} marked` : 'none marked')}
      </div>
      <h3>Assessments</h3>
      ${per.length ? html`
        <div class="table-scroll">
          <table class="report-table">
            <thead><tr><th scope="col">Assessment</th><th scope="col">Date</th><th scope="col" class="num">Results</th><th scope="col" class="num">Average</th><th scope="col" class="num">Median</th><th scope="col" class="num">Highest</th><th scope="col" class="num">Lowest</th>
              ${scale.map((g) => html`<th scope="col" class="num" title="${g.label}"><abbr title="${g.label}">${g.short}</abbr></th>`)}</tr></thead>
            <tbody>${per.map((s) => html`<tr>
              <th scope="row">${s.col.title}</th><td>${colWhen(s.col)}</td>
              <td class="num">${s.entered}/${c.students.length}</td>
              <td class="num">${pctText(s.avg)}</td><td class="num">${pctText(s.median)}</td><td class="num">${pctText(s.high)}</td><td class="num">${pctText(s.low)}</td>
              ${s.dist.map((d) => html`<td class="num">${d.count || ''}</td>`)}
            </tr>`)}</tbody>
          </table>
        </div>
        ${barList(totals, 'Standards across all these assessments')}` : html`<p class="empty small">No assessments in this period.</p>`}
      <h3>Homework</h3>
      ${hw.per.length ? html`
        <div class="table-scroll">
          <table class="report-table">
            <thead><tr><th scope="col">Task</th><th scope="col">Date</th><th scope="col" class="num">Done</th><th scope="col" class="num">Completion</th></tr></thead>
            <tbody>${hw.per.map((h) => html`<tr><th scope="row">${h.col.title}</th><td>${colWhen(h.col)}</td><td class="num">${h.marked ? `${h.done}/${h.marked}` : '–'}</td><td class="num">${pctText(h.pct)}</td></tr>`)}</tbody>
          </table>
        </div>` : html`<p class="empty small">No homework in this period.</p>`}
    </article>`;
}

function assessmentReport(c, col) {
  const scale = c.tracker.scale;
  const s = assessmentSummary(scale, col, sortStudents(c.students), c.marks);
  return html`
    <article class="card report">
      ${reportHead(c, col.title, `Assessment analysis${col.max ? ` · out of ${col.max}` : ''}${colWhen(col) ? ` · ${colWhen(col)}` : ''}`)}
      ${!col.max ? html`<div class="banner info no-print" role="status"><span class="banner-icon" aria-hidden="true">i</span><span>Set what this assessment is out of on the Tracker tab to see percentages.</span></div>` : ''}
      <div class="stats">
        ${stat('Average', pctText(s.avg))}
        ${stat('Median', pctText(s.median))}
        ${stat('Highest', pctText(s.high))}
        ${stat('Lowest', pctText(s.low))}
        ${stat('Results', `${s.entered}/${c.students.length}`, s.entered > s.count ? `${s.entered - s.count} not counted` : '')}
      </div>
      <div class="charts">
        ${bandChart(s.bands)}
        ${barList(s.dist.map((d) => ({ label: d.grade.label, count: d.count })), 'Standards')}
      </div>
      <h3>Results</h3>
      <table class="report-table">
        <thead><tr><th scope="col">Student</th><th scope="col" class="num">Score</th><th scope="col" class="num">%</th><th scope="col">Standard</th></tr></thead>
        <tbody>${s.results.map(({ student, r }) => html`<tr>
          <th scope="row">${student.name}</th>
          <td class="num">${!r ? '–' : r.score !== null ? r.score : r.grade ? r.grade.short : '–'}</td>
          <td class="num">${r && r.counts ? pctText(r.pct) : '–'}</td>
          <td>${r && r.grade ? r.grade.label : '–'}</td>
        </tr>`)}</tbody>
      </table>
    </article>`;
}

function reportsPanel(c) {
  const view = ['class', 'assessment'].includes(c.sub) ? c.sub : 'student';
  const list = sortStudents(c.students);
  const cols = trackerCols(c, c.reportPeriod);
  const nav = [['student', 'Student', ''], ['class', 'Class summary', '/class'], ['assessment', 'Assessment analysis', '/assessment']];
  let pick = '';
  let body;
  if (!list.length) body = noStudents(c);
  else if (view === 'student') {
    const sel = list.find((s) => s.id === c.reportStudent) || list[0];
    pick = html`
      <label class="inline">Student <select data-pick="student">${list.map((s) => html`<option value="${s.id}" ${raw(s === sel ? 'selected' : '')}>${s.name}</option>`)}</select></label>
      <button class="btn" data-action="print-all">Print every student</button>`;
    body = c.printAll ? list.map((s) => studentReport(c, s, cols)) : studentReport(c, sel, cols);
  } else if (view === 'class') {
    body = classReport(c, cols);
  } else if (!cols.assessment.length) {
    body = html`<p class="empty">No assessments in ${periodOf(c.reportPeriod)[1].toLowerCase()}. Tick <strong>Assessment</strong> on a lesson to add one.</p>`;
  } else {
    const sel = cols.assessment.find((x) => x.id === c.reportCol) || cols.assessment[0];
    pick = html`<label class="inline">Assessment <select data-pick="assessment">${cols.assessment.map((x) => html`<option value="${x.id}" ${raw(x === sel ? 'selected' : '')}>${x.title}</option>`)}</select></label>`;
    body = assessmentReport(c, sel);
  }
  return html`
    <div class="trk-bar no-print">
      <nav class="seg" aria-label="Reports">
        ${nav.map(([v, label, path]) => html`<a href="#/class/${c.id}/reports${path}" class="${v === view ? 'on' : ''}" ${raw(v === view ? 'aria-current="page"' : '')}>${label}</a>`)}
      </nav>
      <div class="trk-tools">
        ${periodPicker('report', c.reportPeriod)}
        ${pick}
        ${list.length ? html`<button class="btn primary" data-action="print">Print or save as PDF</button>` : ''}
      </div>
    </div>
    <div class="reports ${c.printAll ? 'print-all' : ''}" style="--class:${colourOf(c.cls)}">${body}</div>`;
}

async function saveTracker(msg = 'Saved') {
  return saving(store.saveTracker(state.cls.id, state.cls.tracker), msg);
}

// Saves one assessment cell from its input. Returns false (and puts the old value back) if it isn't a mark.
async function saveMark(el) {
  const c = state.cls;
  const sid = el.dataset.mark;
  const colId = el.dataset.col;
  const parsed = parseScore(c.tracker.scale, el.value);
  const m = (c.marks[sid] ||= {});
  const a = (m.a ||= {});
  if (parsed.error) {
    toast(parsed.error, 'error');
    el.value = a[colId] ?? '';
    return false;
  }
  el.value = parsed.value ?? '';
  if ((a[colId] ?? null) === parsed.value) return true;
  if (parsed.value === null) delete a[colId]; else a[colId] = parsed.value;
  fillNumbers(c);
  return saving(store.setMark(c.id, sid, 'a', colId, parsed.value), '');
}

// A block pasted from a spreadsheet: rows go down the students, tab-separated values across the columns.
async function pasteMarks(el, text) {
  const c = state.cls;
  const inputs = [...document.querySelectorAll('input.mark')];
  const rows = [...new Set(inputs.map((i) => i.dataset.mark))];
  const colIds = [...new Set(inputs.map((i) => i.dataset.col))];
  const r0 = rows.indexOf(el.dataset.mark);
  const c0 = colIds.indexOf(el.dataset.col);
  const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
  const jobs = [];
  let bad = 0;
  lines.forEach((line, i) => line.split('\t').forEach((cell, j) => {
    const sid = rows[r0 + i];
    const colId = colIds[c0 + j];
    if (!sid || !colId) return;
    const parsed = parseScore(c.tracker.scale, cell);
    if (parsed.error) { bad++; return; }
    const a = ((c.marks[sid] ||= {}).a ||= {});
    if (parsed.value === null) delete a[colId]; else a[colId] = parsed.value;
    const input = inputs.find((x) => x.dataset.mark === sid && x.dataset.col === colId);
    if (input) input.value = parsed.value ?? '';
    jobs.push(store.setMark(c.id, sid, 'a', colId, parsed.value));
  }));
  fillNumbers(c);
  await saving(Promise.all(jobs), `Pasted ${plural(jobs.length, 'mark')}`);
  if (bad) toast(`${plural(bad, 'cell')} skipped: not a mark.`, 'error');
}

/* ---------- setup ---------- */

function setupPanel(c) {
  const p = c.plan;
  const pat = new Set(p.pattern);
  const nums = (n) => Array.from({ length: n }, (_, i) => i + 1);
  return html`
    <div class="setup-grid">
      <!-- Two columns that stack separately: details, meeting times and sharing on the left; terms, class key, downloads and archive on the right. -->
      <div class="setup-col">
        <section class="card">
          <h2>Class details</h2>
          <form data-form="details" class="stack">
            <label>Class name <input name="name" required maxlength="80" value="${c.cls.name}"></label>
            <div class="row2">
              <label>Subject <input name="subject" maxlength="80" value="${c.cls.subject}"></label>
              <label>Year <input name="year" maxlength="20" value="${c.cls.year}"></label>
            </div>
            <div class="row2">
              <label>Teacher name <input name="teacher" maxlength="80" value="${c.cls.teacher || ''}" placeholder="Your name"></label>
              <label>Contact <input name="contact" maxlength="200" value="${c.cls.contact || ''}" placeholder="Your school email"></label>
            </div>
            <label>About this class <span class="optional">(shown on the Home tab)</span>
              <textarea name="about" rows="3" maxlength="1000" placeholder="Room, what to bring, how to get help…">${c.cls.about || ''}</textarea></label>
            <fieldset class="swatches">
              <legend>Banner colour</legend>
              ${CLASS_COLOURS.map((col, i) => html`
                <label class="swatch" style="--class:${col}">
                  <input type="radio" name="colour" value="${i}" ${raw(i === (Number(c.cls.colour) || 0) ? 'checked' : '')}>
                  <span class="sr-only">Colour ${i + 1}</span>
                </label>`)}
            </fieldset>
            <button class="btn primary" type="submit">Save details</button>
          </form>
        </section>

        <section class="card">
          <h2>When this class meets</h2>
          <p class="hint">Tick every period this class has in a normal week. <strong>${pat.size}</strong> per week.</p>
          <div class="table-scroll">
            <table class="pattern">
              <thead><tr><th></th>${DAYS.map((d) => html`<th scope="col">${d}</th>`)}</tr></thead>
              <tbody>
                ${nums(PERIODS_PER_DAY).map((per) => html`<tr>
                  <th scope="row">Period ${per}</th>
                  ${nums(5).map((day) => {
                    const on = pat.has(`${day}-${per}`);
                    return html`<td><button class="pat ${on ? 'on' : ''}" data-action="toggle-pattern" data-key="${day}-${per}"
                      aria-pressed="${on}" aria-label="${DAYS[day - 1]} period ${per}">${on ? '✓' : ''}</button></td>`;
                  })}
                </tr>`)}
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <h2>Share with other teachers</h2>
          ${c.cls.copyKey ? html`
            <p class="hint">Another teacher types this copy key under <strong>New class</strong> to get their own copy of your lessons, units, files (teacher-only ones too) and planner. It doesn't let anyone into this class, and it isn't the key your students use.</p>
            <p class="big-key mono">${formatKey(c.cls.copyKey)}</p>
            <div class="row">
              <button class="btn" data-action="copy-copykey">Copy key</button>
              <button class="btn" data-action="copy-share" data-value="new">Make a new copy key</button>
              <button class="btn danger-btn" data-action="copy-share" data-value="off">Stop sharing</button>
            </div>`
          : html`
            <p class="hint">Other teachers can't copy this class. Turn sharing on to get a copy key, separate from your students' key, that you can give a colleague.</p>
            <button class="btn" data-action="copy-share" data-value="on">Let other teachers copy this class</button>`}
        </section>
      </div>

      <div class="setup-col">
        <section class="card">
          <h2>Terms</h2>
          <p class="hint">The first day of each term, and how many weeks it runs (up to ${MAX_WEEKS}). You choose which term each lesson is in on the Planner tab.</p>
          <table class="terms-table">
            <thead><tr><th scope="col">Term</th><th scope="col">Starts</th><th scope="col">Weeks</th></tr></thead>
            <tbody>
              ${p.terms.map((t, i) => html`<tr>
                <th scope="row">Term ${i + 1}</th>
                <td><input type="date" data-term="${i}" data-field="start" value="${t.start}" aria-label="Term ${i + 1} start date"></td>
                <td><input type="number" min="0" max="${MAX_WEEKS}" data-term="${i}" data-field="weeks" value="${t.weeks}" aria-label="Term ${i + 1} weeks"></td>
              </tr>`)}
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2>Class key</h2>
          ${c.cls.archived ? html`<p>This class is archived, so its key doesn't work. Restore it to let students back in.</p>` : html`
            <p class="hint">Share this with your students, on the board or in Compass.</p>
            <p class="big-key mono">${formatKey(c.cls.currentKey)}</p>
            <div class="row">
              <button class="btn" data-action="copy-key">Copy key</button>
              <button class="btn" data-action="regen-key">Make a new key</button>
            </div>
            <p class="hint">A new key stops the old one working straight away. Students will need to type the new one.</p>`}
        </section>

        <section class="card">
          <h2>Download</h2>
          <p class="hint">Spreadsheet files (CSV) that open in Excel. The marks file has every student's assessment marks, averages and homework for the whole year, ready for Compass or your records.</p>
          <div class="row">
            <button class="btn" data-action="export" data-value="lessons">Lessons and dates</button>
            <button class="btn" data-action="export" data-value="marks">Marks</button>
          </div>
        </section>

        <section class="card">
          <h2>Archive</h2>
          ${c.cls.archived
            ? html`<p>Students can't open this class while it's archived.</p>
              <div class="row">
                <button class="btn" data-action="archive" data-value="0">Restore class</button>
                <button class="btn danger-btn" data-action="delete-class">Delete class</button>
              </div>
              <p class="hint">Deleting removes the class for good: lessons, files, students, marks and all. Download anything you want to keep first.</p>`
            : html`<p class="hint">Archiving closes the class to students at once. You can still open it and restore it. An archived class can also be deleted.</p><button class="btn danger-btn" data-action="archive" data-value="1">Archive class</button>`}
        </section>
      </div>
    </div>`;
}

// The Planner's Events view: camps, excursions and holidays that block periods.
function eventsPanel(c) {
  const p = c.plan;
  const opt = (v, label, sel) => html`<option value="${v}" ${raw(String(v) === String(sel) ? 'selected' : '')}>${label}</option>`;
  const nums = (n) => Array.from({ length: n }, (_, i) => i + 1);
  return html`
    <section class="card">
      <h2>Events and blocked time</h2>
      <p class="hint">Camps, excursions and public holidays. Choose <strong>All</strong> to block a whole day or week. Students see these as Cancelled and lessons move later.</p>
      ${p.events.length ? html`
        <div class="table-scroll">
          <table class="events">
            <thead><tr><th scope="col">Term</th><th scope="col">Week</th><th scope="col">Day</th><th scope="col">Period</th><th scope="col">What's happening</th><th></th></tr></thead>
            <tbody>
              ${p.events.map((e, i) => html`<tr data-event="${i}">
                <td data-label="Term"><select data-field="term" aria-label="Term">${nums(TERM_COUNT).map((n) => opt(n, n, e.term))}</select></td>
                <td data-label="Week"><select data-field="week" aria-label="Week">${nums(MAX_WEEKS).map((n) => opt(n, n, e.week))}</select></td>
                <td data-label="Day"><select data-field="day" aria-label="Day">${opt('All', 'All', e.day)}${nums(5).map((n) => opt(n, DAYS[n - 1], e.day))}</select></td>
                <td data-label="Period"><select data-field="period" aria-label="Period">${opt('All', 'All', e.period)}${nums(PERIODS_PER_DAY).map((n) => opt(n, n, e.period))}</select></td>
                <td><input data-field="label" value="${e.label}" maxlength="80" aria-label="What's happening"></td>
                <td><button class="icon-btn danger" data-action="delete-event" aria-label="Remove event">✕</button></td>
              </tr>`)}
            </tbody>
          </table>
        </div>` : html`<p class="empty small">No events yet.</p>`}
      <div class="row">
        <button class="btn" data-action="add-event">Add event</button>
        <button class="btn" data-action="import-events">Import from another class</button>
      </div>
      ${c.importFrom ? importEventsDialog(c) : ''}
    </section>`;
}

// Pick another of your classes and copy its events and blocked time into this one.
function importEventsDialog(c) {
  return html`
    <dialog id="import-events">
      <form data-form="import-events" method="dialog">
        <h2>Import events</h2>
        <label>Copy events and blocked time from
          <select name="from">
            ${c.importFrom.map((o) => html`<option value="${o.id}">${o.name}${o.archived ? ' (archived)' : ''}</option>`)}
          </select>
        </label>
        <p class="hint">They're added to this class's events, by term, week, day and period. Nothing here is removed or changed, and events this class already has aren't copied twice.</p>
        <div class="dialog-actions">
          <button class="btn ghost" type="button" data-action="close-dialog">Cancel</button>
          <button class="btn primary" type="submit">Import</button>
        </div>
      </form>
    </dialog>`;
}

/* ---------- downloads ---------- */

function downloadFile(name, text, type = 'text/csv') {
  // A byte-order mark so Excel reads names with accents correctly.
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV(c, what) {
  const base = `${c.cls.name}${c.cls.year ? ` ${c.cls.year}` : ''}`.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Class';
  if (what === 'marks') {
    if (!c.students.length) { toast('Add your students on the Tracker tab first.', 'error'); return; }
    const cols = trackerCols(c, 'year');
    downloadFile(`${base} marks.csv`, csvText(marksRows(c.tracker.scale, cols, c.students, c.marks)));
    return;
  }
  const yn = (b) => (b ? 'Yes' : '');
  const rows = [['Term', 'Week', 'First period', 'Last period', 'Unit', 'Lesson', 'Periods', 'Assessment', 'Homework', 'Files', 'Note']];
  for (const l of c.lessons) {
    const p = c.placed.get(l.id);
    const u = unitById(unitIdOf(c, l));
    rows.push([
      isPlaced(l) ? l.term : '', p && p.start ? p.start.week : '',
      p && p.start ? p.start.date || '' : '', p && p.end ? p.end.date || '' : '',
      u ? u.name : '', l.title, clampPeriods(l.periods), yn(isAssessmentLike(l)), yn(l.homework),
      filesFor(c, l.id).length || '', isPlaced(l) ? (statusText(p || {}) || '') : 'Not on the planner',
    ]);
  }
  downloadFile(`${base} lessons.csv`, csvText(rows));
}

async function savePlan(msg = 'Saved') {
  recompute();
  return saving(store.savePlan(state.cls.id, state.cls.plan), msg);
}

/* ---------- events (DOM) ---------- */

$app.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const c = state.cls;

  if (action === 'teacher-sign-in') {
    try { await store.signInTeacher(); } catch (e) {
      if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        console.error(e);
        toast("Couldn't sign in. Check that pop-ups are allowed and try again.", 'error');
      }
    }
  } else if (action === 'sign-out') {
    if (!state.user.isTeacher && !confirm('Leave all your classes on this browser? You will need the class keys to come back.')) return;
    if (!state.user.isTeacher) setJoined([]);
    setCls(null);
    location.hash = '#/';
    await store.signOut();
  } else if (action === 'remove-teacher') {
    const email = btn.dataset.email;
    if (!confirm(`Take ${email} off the teacher list? They won't be able to open their classes until you add them back.`)) return;
    if (await saving(store.removeTeacher(email), 'Removed')) showTeachers();
  } else if (action === 'new-class') {
    document.getElementById('new-class').showModal();
  } else if (action === 'pin-class') {
    // Pinning puts the class at the end of the pinned ones; unpinning puts it first after the line.
    const tile = btn.closest('.class-tile');
    const list = document.getElementById('class-list');
    if (tile.closest('[data-group="pinned"]')) list.querySelector('[data-group="rest"]').prepend(tile);
    else list.querySelector('[data-group="pinned"]').append(tile);
    await saveClassOrder();
    document.querySelector(`.class-pin[data-id="${btn.dataset.id}"]`)?.focus();
  } else if (action === 'close-dialog') {
    btn.closest('dialog').close();
    if (c) c.copyTo = null;
  } else if (action === 'week-prev' || action === 'week-next' || action === 'week-today' || action === 'week-goto') {
    if (action === 'week-prev') c.weekPos--;
    else if (action === 'week-next') c.weekPos++;
    else if (action === 'week-today') c.weekPos = undefined;
    else c.weekPos = Number(btn.dataset.pos);
    renderPanel();
    document.querySelector(action === 'week-goto' ? `[data-pos="${c.weekPos}"]` : `[data-action="${action}"]:not(:disabled)`)?.focus();
  } else if (action === 'pick-term') {
    c.editTerm = Number(btn.dataset.term);
    c.planEvents = false;
    renderPanel();
    document.querySelector(`[data-action="pick-term"][data-term="${c.editTerm}"]`)?.focus();
  } else if (action === 'pick-events') {
    c.planEvents = true;
    renderPanel();
    document.querySelector('[data-action="pick-events"]')?.focus();
  } else if (action === 'move') {
    // Shift moves the lesson together with its neighbours from the same unit.
    const id = btn.closest('[data-id]').dataset.id;
    const ids = ev.shiftKey ? unitBlock(c, id) : [id];
    const list = termLessons(c);
    const first = list.findIndex((l) => l.id === ids[0]);
    const last = first + ids.length - 1;
    const dir = Number(btn.dataset.dir);
    if ((dir < 0 && first === 0) || (dir > 0 && last === list.length - 1)) return;
    await reorder(ids, dir < 0 ? first - 1 : last + 2);
    document.querySelector(`[data-id="${id}"] [data-dir="${dir}"]:not(:disabled)`)?.focus();
  } else if (action === 'unplace') {
    const id = btn.closest('[data-id], [data-lesson]');
    const l = lessonById(id.dataset.id || id.dataset.lesson);
    await placeLessons([l], null, 'Taken off the planner. It\'s still on the Lessons tab.');
  } else if (action === 'place') {
    const l = lessonById(btn.closest('[data-lesson]').dataset.lesson);
    const term = Number(document.getElementById('place-term').value);
    c.editTerm = term;
    c.planEvents = false;
    await placeLessons([l], term, `Added to Term ${term}`);
  } else if (action === 'goto-term') {
    c.editTerm = Number(btn.dataset.term); // the link then opens the planner
    c.planEvents = false;
  } else if (action === 'pick-result') {
    await pickResult(Number(btn.dataset.i));
  } else if (action === 'new-lesson') {
    const cur = c.lessonId && lessonById(c.lessonId);
    const unitId = btn.dataset.unit || (cur ? unitIdOf(c, cur) : null);
    const [l] = await createLessons([{ title: 'New lesson', periods: 1 }], { unitId });
    c.focusTitle = true;
    location.hash = lessonUrl(c, l.id);
  } else if (action === 'delete-lesson') {
    const id = btn.closest('[data-lesson]').dataset.lesson;
    const l = lessonById(id);
    const files = filesFor(c, id);
    const extra = files.length ? ` Its ${files.length === 1 ? 'file' : `${files.length} files`} will be deleted too.` : '';
    if (!confirm(`Delete "${l.title}"?${extra} This can't be undone.`)) return;
    c.lessons = c.lessons.filter((x) => x.id !== id);
    c.files = c.files.filter((f) => f.lessonId !== id);
    recompute();
    location.hash = `#/class/${c.id}/lessons`;
    await saving(Promise.all([store.deleteLesson(c.id, id), ...files.map((f) => store.deleteFile(c.id, f))]), 'Lesson deleted');
  } else if (action === 'preview' || action === 'end-preview') {
    ev.preventDefault();
    c.preview = action === 'preview';
    renderPanel();
  } else if (action === 'toggle-unit') {
    const id = btn.dataset.unit;
    if (c.expanded.has(id)) c.expanded.delete(id); else c.expanded.add(id);
    btn.setAttribute('aria-expanded', String(c.expanded.has(id)));
    applyLibFilter();
  } else if (action === 'new-unit') {
    c.addingUnit = true;
    renderPanel();
    document.getElementById('new-unit-name')?.focus();
  } else if (action === 'cancel-unit') {
    c.addingUnit = false;
    renderPanel();
  } else if (action === 'rename-unit') {
    c.editingUnit = btn.dataset.unit;
    renderPanel();
    document.getElementById('rename-unit')?.select();
  } else if (action === 'cancel-rename') {
    c.editingUnit = null;
    renderPanel();
  } else if (action === 'delete-unit') {
    const u = unitById(btn.dataset.unit);
    const ids = unitLessons(c, u.id).map((l) => l.id);
    const msg = ids.length ? ` Its ${plural(ids.length, 'lesson')} will stay, under No unit.` : '';
    if (!confirm(`Delete the unit "${u.name}"?${msg}`)) return;
    c.units = c.units.filter((x) => x !== u);
    c.lessons.forEach((l) => { if (ids.includes(l.id)) l.unitId = null; });
    recompute();
    renderPanel();
    await saving(store.deleteUnit(c.id, u.id, ids), 'Unit deleted');
  } else if (action === 'pin-post' || action === 'edit-post' || action === 'cancel-edit-post') {
    const id = btn.closest('[data-post]').dataset.post;
    const p = c.posts.find((x) => x.id === id);
    if (!p) return;
    if (action === 'pin-post') {
      p.pinned = !p.pinned;
      renderPanel();
      document.querySelector(`[data-post="${id}"] [data-action="pin-post"]`)?.focus();
      await saving(store.updateAnnouncement(c.id, id, { pinned: p.pinned }), p.pinned ? 'Pinned to the top' : 'Unpinned');
    } else {
      c.editPost = action === 'edit-post' ? id : null;
      renderPanel();
      if (c.editPost) {
        const box = document.getElementById('edit-post-text');
        box?.focus();
        box?.setSelectionRange(box.value.length, box.value.length);
      } else {
        document.querySelector(`[data-post="${id}"] [data-action="edit-post"]`)?.focus();
      }
    }
  } else if (action === 'delete-post') {
    if (!confirm('Delete this announcement?')) return;
    const id = btn.dataset.post;
    c.posts = c.posts.filter((p) => p.id !== id);
    renderPanel();
    await saving(store.deleteAnnouncement(c.id, id), 'Announcement deleted');
  } else if (action === 'open-file') {
    await openFile(btn.dataset.file, btn.dataset.class);
  } else if (action === 'delete-link') {
    const l = lessonById(btn.closest('[data-lesson]').dataset.lesson);
    const links = lessonLinks(l);
    const k = links[Number(btn.dataset.index)];
    if (!k) return;
    l.links = links.filter((x) => x !== k);
    renderPanel();
    await saving(store.saveLesson(c.id, l), 'Link removed');
  } else if (action === 'delete-file') {
    const f = c.files.find((x) => x.id === btn.closest('[data-file]').dataset.file);
    if (!f || !confirm(`Delete ${f.name}? Students won't be able to open it any more.`)) return;
    c.files = c.files.filter((x) => x !== f);
    renderPanel();
    await saving(store.deleteFile(c.id, f), 'File deleted');
  } else if (action === 'toggle-pattern') {
    const set = new Set(c.plan.pattern);
    const k = btn.dataset.key;
    if (set.has(k)) set.delete(k); else set.add(k);
    c.plan.pattern = [...set].sort();
    renderPanel();
    document.querySelector(`[data-key="${k}"]`)?.focus();
    await savePlan();
  } else if (action === 'add-event') {
    const cur = currentWeek(c.plan, todayISO()) || { term: 1, week: 1 };
    c.plan.events.push({ id: Math.random().toString(36).slice(2, 10), term: cur.term, week: cur.week, day: 'All', period: 'All', label: '' });
    renderPanel();
    document.querySelector(`[data-event="${c.plan.events.length - 1}"] [data-field="label"]`)?.focus();
    await savePlan('Event added');
  } else if (action === 'import-events') {
    let others;
    try { others = (await store.listMyClasses()).filter((o) => o.id !== c.id); } catch (e) { console.error(e); toast("Couldn't load your classes.", 'error'); return; }
    if (!others.length) { toast("You don't have another class to import from yet."); return; }
    others.sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name));
    c.importFrom = others;
    renderPanel();
    document.getElementById('import-events')?.showModal();
  } else if (action === 'copy-lesson') {
    let others;
    try { others = (await store.listMyClasses()).filter((o) => o.id !== c.id); } catch (e) { console.error(e); toast("Couldn't load your classes.", 'error'); return; }
    if (!others.length) { toast("You don't have another class to copy to yet."); return; }
    others.sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name));
    c.copyTo = others;
    renderPanel();
    document.getElementById('copy-lesson')?.showModal();
  } else if (action === 'delete-event') {
    const i = Number(btn.closest('[data-event]').dataset.event);
    c.plan.events.splice(i, 1);
    renderPanel();
    await savePlan('Event removed');
  } else if (action === 'copy-key') {
    try { await navigator.clipboard.writeText(formatKey(c.cls.currentKey)); toast('Key copied'); } catch { toast("Couldn't copy. Select the key and copy it instead.", 'error'); }
  } else if (action === 'regen-key') {
    if (!confirm('Make a new class key? The old key stops working straight away, and students will need the new one.')) return;
    try {
      c.cls.currentKey = await store.regenerateKey(c.id);
      showClass(c.id, 'setup');
      toast('New key made');
    } catch (e) { console.error(e); toast("Couldn't make a new key. Try again.", 'error'); }
  } else if (action === 'copy-copykey') {
    try { await navigator.clipboard.writeText(formatKey(c.cls.copyKey)); toast('Copy key copied'); } catch { toast("Couldn't copy. Select the key and copy it instead.", 'error'); }
  } else if (action === 'copy-share') {
    const v = btn.dataset.value;
    if (v === 'new' && !confirm('Make a new copy key? The old one stops working, so a teacher partway through copying will need the new one.')) return;
    if (v === 'off' && !confirm('Stop other teachers copying this class? The copy key stops working straight away. Copies already made are theirs to keep.')) return;
    try {
      c.cls.copyKey = await store.setCopyKey(c.id, v !== 'off');
      showClass(c.id, 'setup');
      toast(v === 'off' ? 'Sharing turned off' : v === 'new' ? 'New copy key made' : 'Sharing turned on');
    } catch (e) { console.error(e); toast("Couldn't change sharing. Republish firestore.rules if this keeps happening.", 'error'); }
  } else if (action === 'export') {
    exportCSV(c, btn.dataset.value);
  } else if (action === 'delete-class') {
    const typed = prompt(`Delete ${c.cls.name} for good? Its lessons, files, students and marks are deleted too, and this can't be undone.\n\nType the class name to confirm.`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== c.cls.name.trim().toLowerCase()) { toast("That isn't the class name, so nothing was deleted.", 'error'); return; }
    const id = c.id;
    const name = c.cls.name;
    setCls(null);
    show($app, frame(html`<div class="loading" id="deleting">Deleting ${name}…</div>`));
    try {
      await store.deleteClass(id, (text) => { const el = document.getElementById('deleting'); if (el) el.textContent = text; });
      toast(`${name} deleted`);
    } catch (e) {
      console.error(e);
      toast(`Couldn't finish deleting ${name}. Open it and try again.`, 'error');
    }
    if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/';
  } else if (action === 'hw-toggle') {
    // Not marked -> done -> not done -> not marked.
    const sid = btn.dataset.hw;
    const colId = btn.dataset.col;
    const h = ((c.marks[sid] ||= {}).h ||= {});
    const next = h[colId] === undefined ? true : h[colId] === true ? false : null;
    if (next === null) delete h[colId]; else h[colId] = next;
    btn.className = `hw ${next === true ? 'done' : next === false ? 'miss' : ''}`;
    btn.textContent = hwSym(next);
    btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace(/: [^:]*$/, `: ${hwWord(next)}`));
    fillNumbers(c);
    await saving(store.setMark(c.id, sid, 'h', colId, next), '');
  } else if (action === 'hw-all') {
    const colId = btn.dataset.col;
    const todo = c.students.filter((s) => ((c.marks[s.id] || {}).h || {})[colId] === undefined);
    if (!todo.length) { toast('Every box in this column is already marked.'); return; }
    todo.forEach((s) => { ((c.marks[s.id] ||= {}).h ||= {})[colId] = true; });
    renderPanel();
    await saving(Promise.all(todo.map((s) => store.setMark(c.id, s.id, 'h', colId, true))), `Marked ${plural(todo.length, 'student')} done`);
  } else if (action === 'hw-clear') {
    const colId = btn.dataset.col;
    const marked = c.students.filter((s) => ((c.marks[s.id] || {}).h || {})[colId] !== undefined);
    if (!marked.length) { toast('This column is already clear.'); return; }
    if (!confirm(`Clear every box in this column? ${marked.length} ${marked.length === 1 ? 'is' : 'are'} marked now.`)) return;
    marked.forEach((s) => { delete c.marks[s.id].h[colId]; });
    renderPanel();
    await saving(Promise.all(marked.map((s) => store.setMark(c.id, s.id, 'h', colId, null))), 'Column cleared');
  } else if (action === 'delete-extra') {
    const x = c.tracker.extra.find((e) => e.id === btn.dataset.col);
    if (!x || !confirm(`Remove the column "${x.title}"? Its marks are kept in case you add it back, but won't show anywhere.`)) return;
    c.tracker.extra = c.tracker.extra.filter((e) => e !== x);
    renderPanel();
    await saveTracker('Column removed');
  } else if (action === 'delete-student') {
    const s = c.students.find((x) => x.id === btn.dataset.sid);
    if (!s || !confirm(`Remove ${s.name} from the class list? Their marks and homework are deleted too. This can't be undone.`)) return;
    c.students = c.students.filter((x) => x !== s);
    delete c.marks[s.id];
    renderPanel();
    await saving(store.deleteStudent(c.id, s.id), `Removed ${s.name}`);
  } else if (action === 'add-level' || action === 'del-level' || action === 'reset-scale') {
    c.scaleDraft = action === 'reset-scale' ? defaultScale() : structuredClone(c.scaleDraft || c.tracker.scale);
    if (action === 'add-level') c.scaleDraft.push({ label: 'New level', short: `L${c.scaleDraft.length + 1}`, points: c.scaleDraft.length, min: null });
    if (action === 'del-level') c.scaleDraft.splice(Number(btn.closest('[data-level]').dataset.level), 1);
    renderPanel();
    if (action === 'reset-scale') toast('Standard scale put back. Save it to keep it.');
  } else if (action === 'save-scale') {
    const draft = c.scaleDraft || c.tracker.scale;
    const problem = scaleProblem(draft);
    if (problem) { toast(problem, 'error'); return; }
    // By-hand levels first, then lowest to highest.
    c.tracker.scale = [...draft].sort((a, b) => (a.min === null ? -1 : a.min) - (b.min === null ? -1 : b.min));
    c.scaleDraft = null;
    renderPanel();
    await saveTracker('Grading scale saved');
  } else if (action === 'print') {
    window.print();
  } else if (action === 'print-all') {
    // Every student's report, one per page, drawn just for printing.
    c.printAll = true;
    renderPanel();
    window.addEventListener('afterprint', () => { c.printAll = false; renderPanel(); }, { once: true });
    window.print();
  } else if (action === 'archive') {
    const archived = btn.dataset.value === '1';
    if (archived && !confirm(`Archive ${c.cls.name}? Students won't be able to open it until you restore it.`)) return;
    if (await saving(store.setArchived(c.id, archived), archived ? 'Class archived' : 'Class restored')) {
      c.cls.archived = archived;
      showClass(c.id, 'setup');
    }
  }
});

$app.addEventListener('submit', async (ev) => {
  const form = ev.target;
  const kind = form.dataset.form;
  if (!kind) return;
  ev.preventDefault();
  const c = state.cls;

  if (kind === 'join') {
    await joinClass(form);
  } else if (kind === 'allow-teacher') {
    const email = form.email.value.trim().toLowerCase();
    if (!/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email)) { toast("That doesn't look like an email address.", 'error'); return; }
    if (await saving(store.allowTeacher(email), `Added ${email}`)) showTeachers();
  } else if (kind === 'new-class') {
    const data = {
      name: form.name.value.trim(),
      subject: form.subject.value.trim(),
      year: form.year.value.trim(),
      colour: Number(form.colour.value) || 0,
    };
    if (!data.name) return;
    let template = form.template ? form.template.value : '';
    const btn = form.querySelector('button[type=submit]');
    const msg = form.querySelector('.form-msg');
    msg.textContent = '';
    // Another teacher's class: find it by key before making anything, so a wrong key leaves no
    // empty class behind.
    let source = null;
    if (template === 'key') {
      const key = normaliseKey(form.importKey.value);
      if (!key) { msg.textContent = 'Type the copy key, like ABCD-2345.'; form.importKey.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Finding the class…';
      try {
        source = await store.startImport(key);
      } catch (e) {
        console.error(e);
      }
      if (!source) {
        btn.disabled = false;
        btn.textContent = 'Create class';
        msg.textContent = "No class has that copy key. Check it with the teacher: it's on their Setup tab under Share with other teachers, and it's not the key their students use.";
        return;
      }
      template = source.classId;
    }
    btn.disabled = true;
    let id;
    try {
      id = await store.createClass(data);
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = 'Create class';
      if (source && !source.own) store.endImport(source.classId);
      toast("Couldn't create the class. Try again.", 'error');
      return;
    }
    if (template) {
      try {
        btn.textContent = 'Copying lessons…';
        const res = await store.copyFromTemplate(template, id, (done, total) => {
          if (total) btn.textContent = `Copying files ${done}/${total}…`;
        });
        if (res.failed.length) {
          toast(`Class made, but ${plural(res.failed.length, 'file')} couldn't be copied: ${res.failed.join(', ')}. Upload ${res.failed.length === 1 ? 'it' : 'them'} again on the Lessons tab.`, 'error');
        } else {
          toast(`Copied ${plural(res.lessons, 'lesson')}${res.units ? `, ${plural(res.units, 'unit')}` : ''}${res.files ? ` and ${plural(res.files, 'file')}` : ''}${source && source.name ? ` from ${source.name}` : ''}`);
        }
      } catch (e) {
        console.error(e);
        toast("The class was made, but copying the lessons didn't finish. Check the Lessons tab.", 'error');
      }
      // The copy is done, so stop being able to read the other teacher's class.
      if (source && !source.own) await store.endImport(source.classId);
    }
    form.closest('dialog').close();
    location.hash = `#/class/${id}/setup`;
  } else if (kind === 'copy-lesson') {
    const to = c.copyTo && c.copyTo.find((o) => o.id === form.to.value);
    const l = lessonById(c.lessonId);
    if (!to || !l) return;
    const unit = unitById(unitIdOf(c, l));
    const whole = !!(unit && form.what && form.what.value === 'unit');
    // The unit's lessons in Lessons-tab order (copyToClass keeps their planner order separately).
    const lessons = whole ? libLessons(c, unit.id) : [l];
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Copying…';
    let res;
    try {
      const [units, theirs] = await Promise.all([store.getUnits(to.id), store.getLessons(to.id)]);
      const copy = copyToClass(
        { unit: whole ? unit : null, lessons, files: c.files, unitName: unit ? unit.name : '' },
        { units, lessons: theirs },
        (k) => store.newId(to.id, k),
        { onPlanner: form.planner.checked },
      );
      res = await store.copyInto(c.id, to.id, copy, (done, total) => {
        if (total) btn.textContent = `Copying files ${done}/${total}…`;
      });
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = 'Copy';
      toast(`Couldn't copy to ${to.name}. Try again.`, 'error');
      return;
    }
    form.closest('dialog').close();
    c.copyTo = null;
    renderPanel();
    const what = whole ? `${unit.name} (${plural(res.lessons, 'lesson')})` : `"${l.title}"`;
    if (res.failed.length) {
      toast(`Copied ${what} to ${to.name}, but ${plural(res.failed.length, 'file')} couldn't be copied: ${res.failed.join(', ')}.`, 'error');
    } else {
      toast(`Copied ${what}${res.files ? ` and ${plural(res.files, 'file')}` : ''} to ${to.name}`);
    }
  } else if (kind === 'import-events') {
    const from = c.importFrom && c.importFrom.find((o) => o.id === form.from.value);
    if (!from) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    let res;
    try {
      const other = await store.getPlan(from.id);
      res = importEvents(c.plan.events, other.events || [], () => Math.random().toString(36).slice(2, 10));
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      toast(`Couldn't read ${from.name}'s events. Try again.`, 'error');
      return;
    }
    form.closest('dialog').close();
    c.importFrom = null;
    const already = res.skipped ? ` (${res.skipped} already here)` : '';
    if (!res.added) { renderPanel(); toast(`Nothing new to import from ${from.name}${already}`); return; }
    const before = c.plan.events;
    c.plan.events = res.events;
    renderPanel();
    if (!await savePlan(`Imported ${plural(res.added, 'event')} from ${from.name}${already}`)) { c.plan.events = before; renderPanel(); }
  } else if (kind === 'details') {
    const patch = {
      name: form.name.value.trim() || c.cls.name,
      subject: form.subject.value.trim(),
      year: form.year.value.trim(),
      colour: Number(form.colour.value) || 0,
      teacher: form.teacher.value.trim().slice(0, 80),
      contact: form.contact.value.trim().slice(0, 200),
      about: form.about.value.trim().slice(0, 1000),
    };
    if (await saving(store.updateClass(c.id, patch))) {
      Object.assign(c.cls, patch);
      showClass(c.id, 'setup');
    }
  } else if (kind === 'paste-lessons') {
    const rows = parsePasted(form.text.value);
    if (!rows.length) { toast('Paste at least one lesson, one per line.', 'error'); return; }
    await createLessons(rows, { term: c.editTerm }, `Added ${plural(rows.length, 'lesson')} to Term ${c.editTerm}`);
  } else if (kind === 'new-unit') {
    const name = form.name.value.trim().slice(0, 80);
    if (!name) return;
    const unit = { id: store.newUnitId(c.id), name, order: c.units.length ? Math.max(...c.units.map((u) => u.order ?? 0)) + 1 : 0, colour: freeUnitColour(c) };
    c.units.push(unit);
    c.addingUnit = false;
    renderPanel();
    await saving(store.saveUnit(c.id, unit), 'Unit added');
  } else if (kind === 'rename-unit') {
    const u = unitById(form.dataset.unit);
    const name = form.name.value.trim().slice(0, 80);
    if (!u || !name) return;
    u.name = name;
    c.editingUnit = null;
    renderPanel();
    await saving(store.saveUnit(c.id, u));
  } else if (kind === 'add-students') {
    const have = new Set(c.students.map((s) => s.name.toLowerCase()));
    const names = parseNames(form.names.value);
    const fresh = [...new Set(names)].filter((n) => !have.has(n.toLowerCase()));
    if (!fresh.length) { toast(names.length ? 'Those names are already on the list.' : 'Type or paste at least one name.', 'error'); return; }
    const added = fresh.map((name) => ({ id: store.newStudentId(c.id), name }));
    c.students.push(...added);
    renderPanel();
    const skipped = names.length - fresh.length;
    await saving(store.saveStudents(c.id, added), `Added ${plural(added.length, 'student')}${skipped ? ` (${skipped} already on the list)` : ''}`);
  } else if (kind === 'extra-col') {
    const title = form.title.value.trim().slice(0, 200);
    if (!title) return;
    const date = form.date.value;
    const term = date ? (currentWeek(c.plan, date) || {}).term || null : null;
    const kindOf = form.dataset.kind === 'homework' ? 'homework' : 'assessment';
    c.tracker.extra.push({ id: `x-${Math.random().toString(36).slice(2, 10)}`, kind: kindOf, title, date, term });
    renderPanel();
    await saveTracker('Column added');
  } else if (kind === 'add-link') {
    const l = lessonById(form.dataset.lessonId);
    if (!l) return;
    const url = linkUrl(form.elements.linkUrl.value);
    if (!url) { toast("That isn't a web address. Links start with https:// (or just paste one from your browser).", 'error'); return; }
    const title = form.elements.linkTitle.value.trim().slice(0, 200);
    l.links = [...lessonLinks(l), { title, url }].slice(0, MAX_LINKS);
    renderPanel();
    document.querySelector('.link-add [name=linkUrl]')?.focus();
    await saving(store.saveLesson(c.id, l), 'Link added');
  } else if (kind === 'edit-post') {
    const id = form.dataset.post;
    const p = c.posts.find((x) => x.id === id);
    const text = form.text.value.trim().slice(0, 4000);
    if (!p || !text) return;
    c.editPost = null;
    if (text !== p.text) {
      const before = { text: p.text, editedAt: p.editedAt };
      Object.assign(p, { text, editedAt: Date.now() });
      renderPanel();
      if (!await saving(store.updateAnnouncement(c.id, id, { text }), 'Announcement updated')) {
        Object.assign(p, before);
        renderPanel();
      }
    } else {
      renderPanel();
    }
  } else if (kind === 'post') {
    const text = form.text.value.trim().slice(0, 4000);
    if (!text) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      c.posts.unshift(await store.addAnnouncement(c.id, text));
      renderPanel();
      toast('Posted');
    } catch (e) {
      console.error(e);
      toast("Couldn't post. Check your connection and try again.", 'error');
      btn.disabled = false;
    }
  }
});

// Inputs save when they change (on blur or Enter), so typing isn't interrupted.
$app.addEventListener('change', async (ev) => {
  const el = ev.target;
  const c = state.cls;
  if (el.name === 'template' && el.form && el.form.dataset.form === 'new-class') {
    const byKey = el.value === 'key';
    const f = el.form;
    f.querySelector('.import-key').hidden = !byKey;
    f.importKey.required = byKey;
    f.querySelector('[data-from-hint=key]').hidden = !byKey;
    f.querySelector('[data-from-hint=copy]').hidden = byKey || el.options.length <= 2; // no classes of their own
    f.querySelector('.form-msg').textContent = '';
    if (byKey) f.importKey.focus();
    return;
  }
  if (c && el.dataset.upload) { await uploadFiles(el); return; }
  if (c && el.dataset.mark) { await saveMark(el); return; }
  if (c && el.dataset.max) {
    const n = Number(el.value);
    if (el.value && n > 0) c.tracker.max[el.dataset.max] = n; else delete c.tracker.max[el.dataset.max];
    el.classList.toggle('missing', !c.tracker.max[el.dataset.max]);
    fillNumbers(c);
    await saveTracker('');
    return;
  }
  if (c && el.dataset.sname) {
    const s = c.students.find((x) => x.id === el.dataset.sname);
    const name = el.value.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!s || !name) { if (s) el.value = s.name; return; }
    s.name = name;
    await saving(store.saveStudents(c.id, [s]));
    return;
  }
  if (c && el.dataset.gfield) {
    c.scaleDraft ||= structuredClone(c.tracker.scale);
    const g = c.scaleDraft[Number(el.closest('[data-level]').dataset.level)];
    const f = el.dataset.gfield;
    g[f] = f === 'min' ? (el.value === '' ? null : Number(el.value)) : f === 'points' ? Number(el.value) : el.value.trim();
    return;
  }
  if (c && el.dataset.period) {
    c[el.dataset.period === 'track' ? 'trackPeriod' : 'reportPeriod'] = el.value;
    renderPanel();
    document.querySelector(`[data-period="${el.dataset.period}"]`)?.focus();
    return;
  }
  if (c && el.dataset.pick) {
    c[el.dataset.pick === 'student' ? 'reportStudent' : 'reportCol'] = el.value;
    renderPanel();
    document.querySelector(`[data-pick="${el.dataset.pick}"]`)?.focus();
    return;
  }
  if (c && el.dataset.ffield) { await updateFile(el.closest('[data-file]').dataset.file, el.dataset.ffield, el); return; }
  const builder = c && el.dataset.lfield && el.closest('[data-lesson]');
  if (builder) {
    const id = builder.dataset.lesson;
    const f = el.dataset.lfield;
    const saved = updateLesson(id, f, el.type === 'checkbox' ? el.checked : el.value);
    if (f === 'title' || f === 'description') {
      // Typing boxes: tidy the sidebar in place, so the next box keeps its focus.
      if (f === 'title') {
        el.value = lessonById(id).title;
        const side = document.querySelector('.lib-lessons a.on .lib-title');
        if (side) side.textContent = kindMark(lessonById(id)) + lessonById(id).title;
      }
    } else {
      renderPanel();
      document.querySelector(`[data-lesson] [data-lfield="${f}"]`)?.focus();
    }
    await saved;
    return;
  }
  if (!c || !el.dataset.field) return;
  const lessonEl = el.closest('[data-id]');
  if (lessonEl) {
    const id = lessonEl.dataset.id;
    if (el.dataset.field === 'term') {
      await placeLessons([lessonById(id)], Number(el.value), `Moved to Term ${el.value}`);
      return;
    }
    const saved = updateLesson(id, el.dataset.field, el.type === 'checkbox' ? el.checked : el.value);
    renderPanel();
    document.querySelector(`[data-id="${id}"] [data-field="${el.dataset.field}"]`)?.focus();
    await saved;
    return;
  }
  if (el.dataset.term !== undefined) {
    const t = c.plan.terms[Number(el.dataset.term)];
    if (el.dataset.field === 'weeks') t.weeks = clampWeeks(el.value);
    else t.start = el.value;
    await savePlan();
    return;
  }
  const evRow = el.closest('[data-event]');
  if (evRow) {
    const e = c.plan.events[Number(evRow.dataset.event)];
    const f = el.dataset.field;
    e[f] = f === 'label' ? el.value.trim().slice(0, 80)
      : (f === 'day' || f === 'period') && el.value === 'All' ? 'All'
      : Number(el.value);
    await savePlan();
  }
});

// Typing in the planner's search box or the Lessons tab's "Find a lesson" box.
$app.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'plan-search') renderResults(el);
  else if (el.dataset.libfilter !== undefined) { state.cls.libFilter = el.value; applyLibFilter(); }
});
$app.addEventListener('scroll', (ev) => {
  if (ev.target.classList && ev.target.classList.contains('lib-side')) state.cls.libScroll = ev.target.scrollTop;
}, true);
$app.addEventListener('focusin', (ev) => { if (ev.target.id === 'plan-search') renderResults(ev.target); });
$app.addEventListener('focusout', (ev) => { if (ev.target.id === 'plan-search') hideResults(); });
// Clicking a search result shouldn't take focus away from the box first.
$app.addEventListener('mousedown', (ev) => { if (ev.target.closest && ev.target.closest('.combo-list')) ev.preventDefault(); });
$app.addEventListener('keydown', (ev) => {
  const c = state.cls;
  if (ev.target.id !== 'plan-search' || !c || !c.search) return;
  const { items, active } = c.search;
  const step = (dir) => {
    for (let i = active + dir; i >= 0 && i < items.length; i += dir) if (!items[i].disabled) return setActive(i);
  };
  if (ev.key === 'ArrowDown') { ev.preventDefault(); if (document.getElementById('plan-results').hidden) renderResults(ev.target); else step(1); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); step(-1); }
  else if (ev.key === 'Enter') { ev.preventDefault(); if (active >= 0) pickResult(active); }
  else if (ev.key === 'Escape') hideResults();
});

// Marks grid: Enter goes down a row (Shift+Enter up), like a spreadsheet.
$app.addEventListener('keydown', (ev) => {
  const el = ev.target;
  if (ev.key !== 'Enter' || !el.classList || !el.classList.contains('mark')) return;
  ev.preventDefault();
  const column = [...document.querySelectorAll(`input.mark[data-col="${el.dataset.col}"]`)];
  const next = column[column.indexOf(el) + (ev.shiftKey ? -1 : 1)];
  if (next) { next.focus(); next.select(); } else el.blur();
});
// Pasting several marks at once fills down (and across) from that cell.
$app.addEventListener('paste', (ev) => {
  const el = ev.target;
  if (!el.classList || !el.classList.contains('mark')) return;
  const text = (ev.clipboardData || window.clipboardData).getData('text');
  if (!/[\t\n]/.test(text.trim())) return;
  ev.preventDefault();
  pasteMarks(el, text);
});

// ← and → flip weeks on the Week tab (unless typing in a box).
document.addEventListener('keydown', (ev) => {
  const c = state.cls;
  if (!c || c.tab !== 'week' || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (ev.target.closest && ev.target.closest('input, select, textarea')) return;
  const btn = document.querySelector(ev.key === 'ArrowLeft' ? '[data-action="week-prev"]' : ev.key === 'ArrowRight' ? '[data-action="week-next"]' : null);
  if (btn && !btn.disabled) { ev.preventDefault(); btn.click(); }
});

/* ---------- drag and drop for lesson cards ---------- */

// The grip itself is what's dragged (a card-wide drag wouldn't start with Shift held in Chrome),
// with the whole card as the picture. Holding Shift drags the lesson with its neighbours from the same unit.
let dragIds = null;
$app.addEventListener('dragstart', (ev) => {
  const grip = ev.target.closest && ev.target.closest('.grip');
  const li = grip && grip.closest('.lesson');
  if (!li) return;
  dragIds = ev.shiftKey ? unitBlock(state.cls, li.dataset.id) : [li.dataset.id];
  dragIds.forEach((id) => document.querySelector(`.lesson[data-id="${id}"]`)?.classList.add('dragging'));
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', li.dataset.id);
  ev.dataTransfer.setDragImage(li, 16, 16);
});
$app.addEventListener('dragend', () => {
  dragIds = null;
  document.querySelectorAll('.lesson.dragging, .lesson.drop-before, .lesson.drop-after')
    .forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
});
function dropTarget(ev) {
  const li = ev.target.closest && ev.target.closest('.lesson');
  if (!li || !dragIds || dragIds.includes(li.dataset.id)) return null;
  const box = li.getBoundingClientRect();
  return { li, after: ev.clientY > box.top + box.height / 2 };
}
$app.addEventListener('dragover', (ev) => {
  const t = dropTarget(ev);
  if (!t) return;
  ev.preventDefault();
  document.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  t.li.classList.add(t.after ? 'drop-after' : 'drop-before');
});
$app.addEventListener('drop', async (ev) => {
  const t = dropTarget(ev);
  if (!t) return;
  ev.preventDefault();
  const ids = dragIds;
  const idx = termLessons(state.cls).findIndex((l) => l.id === t.li.dataset.id);
  await reorder(ids, t.after ? idx + 1 : idx);
});

/* ---------- drag to reorder in the Lessons tab: lessons and whole units (mouse, pen and touch) ---------- */

// Pointer events rather than HTML drag and drop, which phones don't do. Only the ⋮⋮ grip starts a drag
// (it has touch-action: none), so the list still scrolls normally under a finger everywhere else.
// The real row moves through the list as you drag; letting go reads the new order off the page and saves it.

// Saves whatever order the sidebar now shows: unit order, and each lesson's place and unit.
async function saveLibraryOrder() {
  const c = state.cls;
  const side = document.querySelector('.lib-side');
  if (!c || !side) return;
  const colours = new Map(c.units.map((u) => [u.id, unitColourIndex(c, u)])); // colours stay put
  // How things were, so the move can be undone.
  const unitsBefore = new Map(c.units.map((u, i) => [u.id, { order: u.order ?? i, colour: colours.get(u.id) }]));
  const lessonsBefore = new Map(c.lessons.map((l) => [l.id, { libOrder: typeof l.libOrder === 'number' ? l.libOrder : null, unitId: unitIdOf(c, l) || null }]));
  const units = [...side.querySelectorAll('.lib-unit')].map((s) => unitById(s.dataset.unit)).filter(Boolean);
  c.units.forEach((u) => { if (!units.includes(u)) units.push(u); });
  const unitChanges = [];
  units.forEach((u, i) => {
    const colour = colours.get(u.id);
    if (u.order !== i || u.colour !== colour) { u.order = i; u.colour = colour; unitChanges.push(u); }
  });
  const unitsMoved = units.some((u, i) => u !== c.units[i]);
  c.units = units;
  const lessonChanges = [];
  let n = 0;
  side.querySelectorAll('.lib-unit').forEach((sec) => {
    const unitId = sec.dataset.unit || null;
    sec.querySelectorAll('.lib-lessons li[data-id]').forEach((li) => {
      const l = lessonById(li.dataset.id);
      if (!l) return;
      const libOrder = n++;
      const moved = unitIdOf(c, l) !== unitId;
      if (l.libOrder !== libOrder || moved) {
        l.libOrder = libOrder;
        if (moved) l.unitId = unitId;
        lessonChanges.push({ l, moved });
      }
    });
  });
  if (!unitChanges.length && !lessonChanges.length) return;
  const keep = side.scrollTop;
  recompute();
  renderPanel();
  const again = document.querySelector('.lib-side');
  if (again) again.scrollTop = keep;
  const into = lessonChanges.find((x) => x.moved);
  const msg = into ? `Moved to ${into.l.unitId ? unitById(into.l.unitId).name : 'No unit'}`
    : unitsMoved ? 'Unit order saved' : 'Order saved';
  const saved = await saving(store.saveLibrary(c.id, {
    units: unitChanges.map((u) => ({ id: u.id, order: u.order, colour: u.colour })),
    lessons: lessonChanges.map(({ l }) => ({ id: l.id, libOrder: l.libOrder, unitId: l.unitId ?? null })),
  }), '');
  if (!saved) return;
  const undo = {
    units: unitChanges.map((u) => ({ id: u.id, ...unitsBefore.get(u.id) })),
    lessons: lessonChanges.map(({ l }) => ({ id: l.id, ...lessonsBefore.get(l.id) })),
  };
  toast(msg, 'ok', () => undoLibraryOrder(c, undo));
}

// Puts the Lessons tab back to how it was before a drag: unit order and colours, and each
// moved lesson's place and unit.
async function undoLibraryOrder(c, undo) {
  if (state.cls !== c) return;
  undo.units.forEach((x) => { const u = unitById(x.id); if (u) Object.assign(u, { order: x.order, colour: x.colour }); });
  undo.lessons.forEach((x) => { const l = lessonById(x.id); if (l) Object.assign(l, { libOrder: x.libOrder, unitId: x.unitId }); });
  c.units.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const side = document.querySelector('.lib-side');
  const keep = side ? side.scrollTop : 0;
  recompute();
  renderPanel();
  const again = document.querySelector('.lib-side');
  if (again) again.scrollTop = keep;
  await saving(store.saveLibrary(c.id, {
    units: undo.units.filter((x) => unitById(x.id)),
    lessons: undo.lessons.filter((x) => lessonById(x.id)),
  }), 'Move undone');
}

let libDrag = null;

$app.addEventListener('pointerdown', (ev) => {
  const grip = ev.target.closest && ev.target.closest('.lib-grip');
  if (!grip || ev.button > 0 || libDrag || grip.closest('.filtering')) return;
  const unit = grip.dataset.drag === 'unit';
  const el = grip.closest(unit ? '.lib-unit' : 'li');
  if (!el) return;
  ev.preventDefault();
  grip.setPointerCapture(ev.pointerId);
  libDrag = { unit, el, grip, pointer: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, on: false };
});

function startLibDrag(d) {
  d.on = true;
  const side = d.el.closest('.lib-side');
  d.side = side;
  const pic = d.unit ? d.el.querySelector('.lib-unit-head') : d.el;
  const box = pic.getBoundingClientRect();
  d.dy = d.y0 - box.top; // the picture keeps the same grip point under the pointer
  if (d.unit) {
    // Units fold up to their headings while you move one; scroll so the heading stays near the pointer.
    side.classList.add('sorting-units');
    const shift = d.el.getBoundingClientRect().top - box.top;
    const scrolls = side.scrollHeight > side.clientHeight + 1 && getComputedStyle(side).overflowY !== 'visible';
    if (scrolls) side.scrollTop += shift; else window.scrollBy(0, shift);
  }
  // The picture that follows the pointer. A lesson goes in its own list so it keeps the sidebar's look.
  d.ghost = d.unit ? pic.cloneNode(true) : document.createElement('ul');
  if (d.unit) d.ghost.style.setProperty('--unit', getComputedStyle(d.el).getPropertyValue('--unit'));
  else { d.ghost.className = 'lib-lessons'; d.ghost.append(pic.cloneNode(true)); }
  d.ghost.classList.add('lib-ghost');
  Object.assign(d.ghost.style, { left: `${box.left}px`, top: `${d.y - d.dy}px`, width: `${box.width}px` });
  document.body.append(d.ghost);
  d.el.classList.add('lib-drag-src');
  document.body.classList.add('lib-dragging');
  const tick = () => {
    if (libDrag !== d) return;
    autoScroll(d);
    d.frame = requestAnimationFrame(tick);
  };
  d.frame = requestAnimationFrame(tick);
}

// Moves the dragged row to wherever the pointer is.
function placeLibDrag(d) {
  d.ghost.style.top = `${d.y - d.dy}px`;
  const under = document.elementFromPoint(d.x, d.y);
  const sec = under && under.closest('.lib-unit');
  document.querySelectorAll('.lib-unit.drop-into').forEach((s) => s.classList.remove('drop-into'));
  if (!sec || !d.side.contains(sec)) return;
  const below = (el) => d.y > el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
  if (d.unit) {
    if (sec === d.el) return;
    // "No unit" always stays last.
    if (!sec.dataset.unit) sec.before(d.el);
    else if (below(sec)) sec.after(d.el); else sec.before(d.el);
    return;
  }
  const li = under.closest('.lib-lessons li');
  if (li === d.el) return;
  if (li) {
    if (below(li)) li.after(d.el); else li.before(d.el);
  } else {
    const ul = sec.querySelector('.lib-lessons');
    if (!ul) return; // "No unit" isn't shown until it has lessons
    if (!ul.contains(d.el)) ul.append(d.el); // dropped on a unit's heading: goes to the end of that unit
  }
  if (sec.querySelector('.lib-lessons').hidden) sec.classList.add('drop-into'); // folded unit: show where it went
}

// Near the top or bottom edge, scroll the sidebar (laptop) or the page (phone).
function autoScroll(d) {
  const side = d.side;
  const scrolls = side.scrollHeight > side.clientHeight + 1 && getComputedStyle(side).overflowY !== 'visible';
  const top = scrolls ? Math.max(side.getBoundingClientRect().top, 0) : 0;
  const bottom = scrolls ? Math.min(side.getBoundingClientRect().bottom, innerHeight) : innerHeight;
  const edge = 56;
  let step = 0;
  if (d.y < top + edge) step = -Math.ceil((top + edge - d.y) / 4);
  else if (d.y > bottom - edge) step = Math.ceil((d.y - (bottom - edge)) / 4);
  if (!step) return;
  step = Math.max(-24, Math.min(24, step));
  if (scrolls) side.scrollTop += step; else window.scrollBy(0, step);
  placeLibDrag(d);
}

$app.addEventListener('pointermove', (ev) => {
  const d = libDrag;
  if (!d || ev.pointerId !== d.pointer) return;
  d.x = ev.clientX;
  d.y = ev.clientY;
  if (!d.on) {
    if (Math.hypot(d.x - d.x0, d.y - d.y0) < 5) return;
    startLibDrag(d);
  }
  placeLibDrag(d);
});

function endLibDrag(save) {
  const d = libDrag;
  libDrag = null;
  if (!d || !d.on) return;
  cancelAnimationFrame(d.frame);
  d.ghost.remove();
  document.body.classList.remove('lib-dragging');
  if (save) saveLibraryOrder();
  else renderPanel(); // put everything back
}
$app.addEventListener('pointerup', (ev) => { if (libDrag && ev.pointerId === libDrag.pointer) endLibDrag(true); });
$app.addEventListener('pointercancel', (ev) => { if (libDrag && ev.pointerId === libDrag.pointer) endLibDrag(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && libDrag) endLibDrag(false); });

// Keyboard: ↑ and ↓ on a grip move the lesson (into the next unit at the ends) or the unit.
$app.addEventListener('keydown', async (ev) => {
  const grip = ev.target.closest && ev.target.closest('.lib-grip');
  if (!grip || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') || grip.closest('.filtering')) return;
  ev.preventDefault();
  const up = ev.key === 'ArrowUp';
  if (grip.dataset.drag === 'unit') {
    const sec = grip.closest('.lib-unit');
    const other = up ? sec.previousElementSibling : sec.nextElementSibling;
    if (!other || !other.classList.contains('lib-unit') || !other.dataset.unit) return;
    if (up) other.before(sec); else other.after(sec);
  } else {
    const li = grip.closest('li');
    const other = up ? li.previousElementSibling : li.nextElementSibling;
    if (other) {
      if (up) other.before(li); else other.after(li);
    } else {
      const secs = [...document.querySelectorAll('.lib-side .lib-unit')].filter((s) => s.querySelector('.lib-lessons'));
      const next = secs[secs.indexOf(li.closest('.lib-unit')) + (up ? -1 : 1)];
      if (!next) return;
      const ul = next.querySelector('.lib-lessons');
      if (up) ul.append(li); else ul.prepend(li);
    }
  }
  await saveLibraryOrder();
  document.querySelector(`.lib-grip[data-drag="${grip.dataset.drag}"][data-id="${grip.dataset.id}"]`)?.focus();
});

/* ---------- drag to reorder the class list, and to pin or unpin by dragging across the line ---------- */

// Works like the Lessons tab: pointer events, only the ⋮⋮ grip starts a drag, the real card moves
// through the grid as you go and letting go saves the order the page shows.
let classDrag = null;

$app.addEventListener('pointerdown', (ev) => {
  const grip = ev.target.closest && ev.target.closest('.class-grip');
  if (!grip || ev.button > 0 || classDrag) return;
  const el = grip.closest('.class-tile');
  if (!el) return;
  ev.preventDefault();
  grip.setPointerCapture(ev.pointerId);
  classDrag = { el, grip, pointer: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, on: false };
});

function startClassDrag(d) {
  d.on = true;
  d.list = d.el.closest('#class-list');
  const box = d.el.getBoundingClientRect();
  d.dx = d.x0 - box.left;
  d.dy = d.y0 - box.top;
  d.ghost = d.el.cloneNode(true);
  d.ghost.classList.add('class-ghost');
  Object.assign(d.ghost.style, { left: `${d.x - d.dx}px`, top: `${d.y - d.dy}px`, width: `${box.width}px`, height: `${box.height}px` });
  document.body.append(d.ghost);
  d.el.classList.add('class-drag-src');
  d.list.classList.add('dragging');
  document.body.classList.add('lib-dragging');
  classZones(d.list);
  const tick = () => {
    if (classDrag !== d) return;
    const edge = 56;
    let step = 0;
    if (d.y < edge) step = -Math.ceil((edge - d.y) / 4);
    else if (d.y > innerHeight - edge) step = Math.ceil((d.y - (innerHeight - edge)) / 4);
    if (step) { window.scrollBy(0, Math.max(-24, Math.min(24, step))); placeClassDrag(d); }
    d.frame = requestAnimationFrame(tick);
  };
  d.frame = requestAnimationFrame(tick);
}

// Moves the dragged card to wherever the pointer is. Archived classes stay at the end.
function placeClassDrag(d) {
  Object.assign(d.ghost.style, { left: `${d.x - d.dx}px`, top: `${d.y - d.dy}px` });
  const under = document.elementFromPoint(d.x, d.y);
  const grid = under && under.closest('#class-list .class-grid');
  if (!grid) return;
  const firstArchived = grid.querySelector('.class-tile[data-archived]');
  const tile = under.closest('.class-tile');
  if (tile === d.el) return;
  if (!tile) {
    // Empty space in a grid (or an empty drop zone): the end of that group.
    if (grid.contains(d.el) && !firstArchived) return;
    if (firstArchived) firstArchived.before(d.el); else grid.append(d.el);
  } else if (tile.dataset.archived) {
    if (firstArchived.previousElementSibling !== d.el) firstArchived.before(d.el);
  } else {
    const b = tile.getBoundingClientRect();
    // Several cards to a row: left or right half. One to a row (phones): top or bottom half.
    const oneColumn = b.width > grid.clientWidth * 0.6;
    const after = oneColumn ? d.y > b.top + b.height / 2 : d.x > b.left + b.width / 2;
    if (after) tile.after(d.el); else tile.before(d.el);
  }
  classZones(d.list);
}

$app.addEventListener('pointermove', (ev) => {
  const d = classDrag;
  if (!d || ev.pointerId !== d.pointer) return;
  d.x = ev.clientX;
  d.y = ev.clientY;
  if (!d.on) {
    if (Math.hypot(d.x - d.x0, d.y - d.y0) < 5) return;
    startClassDrag(d);
  }
  placeClassDrag(d);
});

function endClassDrag(save) {
  const d = classDrag;
  classDrag = null;
  if (!d || !d.on) return;
  cancelAnimationFrame(d.frame);
  d.ghost.remove();
  d.list.classList.remove('dragging');
  document.body.classList.remove('lib-dragging');
  d.el.classList.remove('class-drag-src');
  if (save) saveClassOrder(); else renderClassList(); // put everything back
}
$app.addEventListener('pointerup', (ev) => { if (classDrag && ev.pointerId === classDrag.pointer) endClassDrag(true); });
$app.addEventListener('pointercancel', (ev) => { if (classDrag && ev.pointerId === classDrag.pointer) endClassDrag(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && classDrag) endClassDrag(false); });

// Keyboard: the arrow keys on a grip move the class one place. Moving up past the first
// unpinned class pins it; moving down past the last pinned class unpins it.
$app.addEventListener('keydown', async (ev) => {
  const grip = ev.target.closest && ev.target.closest('.class-grip');
  if (!grip || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
  ev.preventDefault();
  const up = ev.key === 'ArrowUp' || ev.key === 'ArrowLeft';
  const tile = grip.closest('.class-tile');
  const list = document.getElementById('class-list');
  const group = tile.closest('.class-grid');
  const pinned = group.dataset.group === 'pinned';
  const other = up ? tile.previousElementSibling : tile.nextElementSibling;
  if (other && !other.dataset.archived) {
    if (up) other.before(tile); else other.after(tile);
  } else if (up && !pinned) {
    list.querySelector('[data-group="pinned"]').append(tile);
  } else if (!up && pinned) {
    list.querySelector('[data-group="rest"]').prepend(tile);
  } else return;
  await saveClassOrder();
  document.querySelector(`.class-grip[data-id="${grip.dataset.id}"]`)?.focus();
});

/* ---------- bad Wi-Fi ---------- */

// A bar across the top while the browser has no connection. Firestore keeps working from its
// offline copy, and anything changed meanwhile saves by itself when the connection is back.
function showConnection(changed) {
  let bar = document.getElementById('offline-bar');
  if (navigator.onLine) {
    if (bar) bar.remove();
    if (changed) toast('Back online. Any changes are saving now.');
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offline-bar';
    bar.className = 'offline-bar';
    bar.setAttribute('role', 'status');
    document.body.prepend(bar);
  }
  bar.textContent = state.cls && state.cls.isOwner
    ? "You're offline. You're seeing what was last loaded. Changes you make will save when the connection is back. Files can't be opened or uploaded until then."
    : "You're offline. You're seeing what was last loaded. Files can't be opened until the connection is back.";
}
window.addEventListener('online', () => showConnection(true));
window.addEventListener('offline', () => showConnection(true));
showConnection(false);

// Keep a copy of the website itself, so it opens even when the Wi-Fi drops (see sw.js).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('No offline copy of the site', e));
}

/* ---------- start ---------- */

window.addEventListener('hashchange', route);
store.onAuth(async (user) => {
  // Teachers: the admin, or a Google account on the admin's list (the rules check this too).
  if (user && user.isTeacher) {
    user.isAdmin = store.mode === 'demo' || (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
    user.allowed = user.isAdmin || await store.isAllowedTeacher(user.email || '').catch(() => false);
  }
  const changed = !state.user || !user || state.user.uid !== user.uid;
  state.user = user;
  if (changed) setCls(null);
  if (!state.joining) route();
});
route();
