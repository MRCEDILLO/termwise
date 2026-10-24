// Termwise screens. Data goes through `store` (Firebase or the demo store); the
// timetable is always worked out fresh in the browser by planner.js.

import { FIREBASE_CONFIG, SITE_NAME } from './config.js';
import { createDemoStore } from './demo.js';
import { normaliseKey, formatKey } from './keys.js';
import { ACCEPT, fileProblem, isOpen, fileSize, fileIcon } from './files.js';
import {
  schedule, emptyPlan, isAssessmentLike, currentWeek, weekRange, slotLabel, cellText, slotDate,
  DAYS, PERIODS_PER_DAY, MAX_WEEKS, TERM_COUNT, clampWeeks,
} from './planner.js';

const store = FIREBASE_CONFIG.apiKey
  ? (await import('./firebase.js')).createFirebaseStore(FIREBASE_CONFIG)
  : createDemoStore();

const $app = document.getElementById('app');
const state = { user: undefined, cls: null };

export const CLASS_COLOURS = ['#1F6FD1', '#0D8466', '#C2410C', '#7C3AED', '#BE185D', '#0E7490', '#4D7C0F', '#A16207'];
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
function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 1800);
}

async function saving(promise, ok = 'Saved') {
  try {
    await promise;
    if (ok) toast(ok);
    return true;
  } catch (e) {
    console.error(e);
    toast("Couldn't save. Check your connection and try again.", 'error');
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
        ${u ? html`<button class="btn ghost" data-action="sign-out">${u.isTeacher ? 'Sign out' : 'Leave'}</button>` : ''}
      </div>
    </header>
    <main class="${wide ? 'wrap wide' : 'wrap'}" id="main">${body}</main>`;
}

/* ---------- routing ---------- */

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'class' && parts[1]) return { page: 'class', id: parts[1], tab: parts[2] || '', sub: parts[3] || '' };
  return { page: 'home' };
}

async function route() {
  if (state.user === undefined) {
    show($app, html`<div class="loading">Loading…</div>`);
    return;
  }
  const r = parseHash();
  if (r.page === 'class') return showClass(r.id, r.tab, r.sub);
  state.cls = null;
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

/* ---------- teacher home ---------- */

async function showTeacherHome() {
  show($app, frame(html`<div class="loading">Loading your classes…</div>`));
  let classes = [];
  try { classes = await store.listMyClasses(); } catch (e) { console.error(e); toast("Couldn't load your classes.", 'error'); }
  classes.sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name));
  show($app, frame(html`
    <div class="page-head">
      <h1>Your classes</h1>
      <button class="btn primary" data-action="new-class">New class</button>
    </div>
    ${classes.length ? '' : html`<p class="empty">No classes yet. Make your first one with <strong>New class</strong>.</p>`}
    <div class="class-grid">
      ${classes.map((c) => html`
        <a class="class-card ${c.archived ? 'archived' : ''}" href="#/class/${c.id}">
          <div class="class-card-banner" style="--class:${colourOf(c)}">
            <span class="class-card-name">${c.name}</span>
            <span class="class-card-sub">${[c.subject, c.year].filter(Boolean).join(' · ')}</span>
          </div>
          <div class="class-card-foot">
            ${c.archived ? html`<span class="tag">Archived</span>` : html`<span>Key <span class="mono">${formatKey(c.currentKey)}</span></span>`}
          </div>
        </a>`)}
    </div>
    ${newClassDialog()}`, { wide: true }));
}

function newClassDialog() {
  return html`
    <dialog id="new-class">
      <form data-form="new-class" method="dialog">
        <h2>New class</h2>
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

async function showClass(id, tab, sub = '') {
  if (!state.user) { location.hash = '#/'; return; }
  if (!state.cls || state.cls.id !== id) {
    show($app, frame(html`<div class="loading">Opening class…</div>`, { wide: true }));
    let cls = null;
    try { cls = await store.getClass(id); } catch (e) { console.error(e); }
    if (!cls) {
      if (!state.user.isTeacher) setJoined(getJoined().filter((j) => j.classId !== id));
      show($app, frame(html`
        <section class="card narrow">
          <h1>This class isn't available</h1>
          <p>The class key may have changed, or the class has been archived. Ask your teacher for the current key.</p>
          <a class="btn primary" href="#/">Back to your classes</a>
        </section>`));
      return;
    }
    const quiet = (p) => p.catch((e) => { console.error(e); return []; });
    const [plan, lessons, units, files, posts] = await Promise.all([
      store.getPlan(id), store.getLessons(id), quiet(store.getUnits(id)),
      quiet(store.listFiles(id)), quiet(store.getAnnouncements(id)),
    ]);
    // Lessons saved before terms were chosen are Term 1; a null term means "not on the planner".
    lessons.forEach((l) => { if (l.term === undefined) l.term = 1; });
    state.cls = { id, cls, plan, lessons, units, files, posts, uploads: [], collapsed: new Set(), isOwner: cls.owner === state.user.uid };
    sortLessons(state.cls);
    state.cls.editTerm = (currentWeek(plan, todayISO()) || { term: 1 }).term;
    recompute();
  }
  const c = state.cls;
  const tabs = c.isOwner
    ? [['home', 'Home'], ['lessons', 'Lessons'], ['planner', 'Planner'], ['week', 'Week'], ['timetable', 'Timetable'], ['setup', 'Setup']]
    : [['home', 'Home'], ['week', 'Week'], ['lessons', 'Lessons'], ['timetable', 'Timetable']];
  if (!tabs.some(([t]) => t === tab)) tab = 'home';
  const lessonId = tab === 'lessons' && sub && c.lessons.some((l) => l.id === sub) ? sub : null;
  if (lessonId !== c.lessonId) c.preview = false;
  c.tab = tab;
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
}

function renderPanel() {
  const c = state.cls;
  const panel = document.getElementById('panel');
  if (!panel) return;
  const views = { home: homePanel, lessons: libraryPanel, planner: plannerPanel, week: weekCalendar, timetable: timetablePanel, setup: setupPanel };
  show(panel, views[c.tab](c));
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
const unitColour = (c, unitId) => {
  const i = c.units.findIndex((u) => u.id === unitId);
  return i < 0 ? 'var(--line-2)' : CLASS_COLOURS[i % CLASS_COLOURS.length];
};

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
  if (field === 'unitId') value = value || null;
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
  next.forEach((l, i) => { l.order = orders[i]; });
  sortLessons(c);
  recompute();
  renderPanel();
  await saving(store.saveOrder(c.id, c.lessons), ids.length > 1 ? `Moved ${ids.length} lessons` : 'Order saved');
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
    <div class="term-picker" role="group" aria-label="Choose a term">
      ${c.result.perTerm.map((t) => html`
        <button class="${t.term === c.editTerm ? 'on' : ''}" aria-pressed="${t.term === c.editTerm}" data-action="pick-term" data-term="${t.term}">
          <span class="tp-name">Term ${t.term}</span>
          <span class="tp-meta">${plural(t.lessons, 'lesson')}${t.fits ? '' : html` · <span class="tp-short">short ${-t.spare}</span>`}</span>
        </button>`)}
    </div>`;
}

function plannerPanel(c) {
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
      <li class="lesson ${l.status !== 'scheduled' ? `st-${l.status}` : ''} ${isAssessmentLike(l) ? 'assess' : ''}" data-id="${l.id}" style="--unit:${unitColour(c, unitId)}">
        <span class="grip" draggable="true" aria-hidden="true" title="Drag to reorder. Hold Shift to bring the rest of the unit.">⋮⋮</span>
        <span class="num">${i + 1}</span>
        <div class="lesson-main">
          <a class="lesson-title" href="${lessonUrl(c, l.id)}">${l.title}</a>
          <div class="lesson-meta">
            ${unit ? html`<span class="unit-tag">${unit.name}</span>` : ''}
            ${when ? html`<span class="when">${when}</span>` : ''}
            ${statusText(l) ? html`<span class="tag ${l.status === 'skipped' ? '' : 'bad'}">${statusText(l)}</span>` : ''}
            ${isAssessmentLike(l) ? html`<span class="tag assess-tag">★ Assessment</span>` : ''}
            ${nFiles ? html`<span class="file-count" title="${plural(nFiles, 'file')}">📎 ${nFiles}</span>` : ''}
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
    const list = unitLessons(c, it.id).filter((l) => !isPlaced(l));
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
    ...c.units.map((u) => ({ unit: u, lessons: unitLessons(c, u.id) })),
    { unit: null, lessons: unitLessons(c, null) },
  ].filter((g) => (g.unit && (c.isOwner || g.lessons.length)) || (!g.unit && g.lessons.length));
  const whenShort = (l) => {
    const p = c.placed.get(l.id);
    if (p && p.start) return `T${p.start.term} Wk ${p.start.week}`;
    return isPlaced(l) ? `Term ${l.term}` : c.isOwner ? 'Not planned' : '';
  };
  const side = html`
    <aside class="lib-side" aria-label="Units and lessons">
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
        const open = !c.collapsed.has(id) || g.lessons.some((l) => l.id === c.lessonId);
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
                <h3><button class="lib-toggle" data-action="toggle-unit" data-unit="${id}" aria-expanded="${open}">${name}</button></h3>
                <span class="lib-count" aria-label="${plural(g.lessons.length, 'lesson')}">${g.lessons.length}</span>
                ${c.isOwner && g.unit ? html`
                  <button class="icon-btn" data-action="new-lesson" data-unit="${id}" aria-label="New lesson in ${name}" title="New lesson in this unit">+</button>
                  <button class="icon-btn" data-action="rename-unit" data-unit="${id}" aria-label="Rename ${name}" title="Rename">✎</button>
                  <button class="icon-btn danger" data-action="delete-unit" data-unit="${id}" aria-label="Delete the unit ${name}" title="Delete unit">✕</button>` : ''}
              </div>`}
            ${g.lessons.length ? html`<ul class="lib-lessons" ${raw(open ? '' : 'hidden')}>${g.lessons.map((l) => html`
              <li data-title="${l.title.toLowerCase()}">
                <a href="${lessonUrl(c, l.id)}" class="${l.id === c.lessonId ? 'on' : ''} ${isPlaced(l) ? '' : 'unplaced'}" ${raw(l.id === c.lessonId ? 'aria-current="page"' : '')}>
                  <span class="lib-title">${isAssessmentLike(l) ? '★ ' : ''}${l.title}</span>
                  <span class="lib-when">${whenShort(l)}</span>
                </a>
              </li>`)}</ul>` : html`<p class="lib-empty">No lessons yet</p>`}
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
        <h3>On the planner</h3>
        ${plan}
      </section>
      <div class="builder-foot">
        <a class="btn small ghost" href="#/class/${c.id}/lessons/${l.id}" data-action="preview">Preview as a student</a>
        <button class="btn small danger-btn" data-action="delete-lesson">Delete lesson</button>
      </div>
    </article>`;
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
        ${isAssessmentLike(l) ? html`<span class="tag assess-tag">★ Assessment</span>` : ''}
        ${l.homework ? html`<span class="tag">Homework</span>` : ''}
      </div>
      ${when.length ? html`<p class="lp-when">Term ${when[0].term}, Week ${when[0].week}: ${when.map((s) => s.text).join(' · ')}</p>` : ''}
      ${l.description ? html`<div class="lp-desc">${linkify(l.description)}</div>` : ''}
      <h3>Files</h3>
      ${filesFor(c, l.id).length ? studentFiles(c, l.id) : html`<p class="empty small">No files for this lesson yet.</p>`}
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
            : html`<a class="up-title" href="${lessonUrl(c, it.lesson.id)}">${isAssessmentLike(it.lesson) ? '★ ' : ''}${it.lesson.title}</a>`}
        </li>`)}</ul>` : html`<p class="empty small">No lessons this week.</p>`}
      <a class="more" href="#/class/${c.id}/week">Week calendar →</a>
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
        ${c.posts.length ? c.posts.map((p) => html`
          <article class="card post">
            <header class="post-head">
              <span class="avatar" style="--class:${colourOf(cls)}" aria-hidden="true">${initials(cls.teacher)}</span>
              <div class="post-who"><strong>${cls.teacher || 'Your teacher'}</strong><time datetime="${new Date(p.createdAt).toISOString()}">${fmtPosted(p.createdAt)}</time></div>
              ${c.isOwner ? html`<button class="icon-btn danger" data-action="delete-post" data-post="${p.id}" aria-label="Delete this announcement">✕</button>` : ''}
            </header>
            <div class="post-text">${linkify(p.text)}</div>
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
        ${upNextCard(c)}
        ${comingUpCard(c)}
      </aside>
    </div>`;
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
      const a = isAssessmentLike(l);
      const part = s.of > 1 ? (span > 1 ? `Parts ${s.part}–${last.part} of ${s.of}` : `Part ${s.part} of ${s.of}`) : '';
      dayTiles++;
      const nFiles = filesFor(c, l.id).length;
      cells.push(html`<a class="tile ${a ? 'assess' : ''}" href="${lessonUrl(c, l.id)}" style="grid-column:${day + 1};grid-row:${p + 1} / span ${span}">
        <span class="tile-when">${span > 1 ? `P${p}–${p + span - 1}` : `P${p}`} <span class="tile-day">· ${DAYS[day - 1]}</span></span>
        <span class="tile-title">${a ? html`<span aria-label="Assessment">★ </span>` : ''}${l.title}</span>
        ${part ? html`<span class="tile-part">${part}</span>` : ''}
        ${l.homework ? html`<span class="tag">Homework</span>` : ''}
        ${nFiles ? html`<span class="tile-files">📎 ${plural(nFiles, 'file')}</span>` : ''}
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
      <p class="hint">Use the arrows, the ← → keys or the notches above to flip between weeks. Click a lesson to open it. ★ marks assessments.</p>
    </section>`;
}

/* ---------- lesson files ---------- */

const filesFor = (c, lessonId) => c.files.filter((f) => f.lessonId === lessonId)
  .sort((a, b) => (a.locked - b.locked) || a.name.localeCompare(b.name));
const msToISO = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Files in the lesson builder: attach, mark teacher-only, set an unlock date or unlock now.
function teacherFiles(c, l) {
  const files = filesFor(c, l.id);
  const ups = c.uploads.filter((u) => u.lessonId === l.id);
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
            <label class="unlock-date">Unlocks <input type="date" data-ffield="unlockAt" value="${f.unlockAt ? msToISO(f.unlockAt) : ''}" aria-label="Unlock date for ${f.name}"></label>
            <label class="check"><input type="checkbox" data-ffield="unlocked" ${raw(f.unlocked ? 'checked' : '')}> Unlocked now</label>
            <span class="tag ${isOpen(f) ? '' : 'bad'}">${isOpen(f) ? 'Students can open' : 'Hidden from students'}</span>` : ''}
          <button class="icon-btn danger" data-action="delete-file" aria-label="Delete ${f.name}">✕</button>
        </li>`)}
        ${ups.map((u) => html`<li class="file-row uploading"><span class="file-chip"><span class="file-icon" aria-hidden="true">${fileIcon(u.name)}</span>
          <span class="file-name">${u.name}</span><span class="file-size" id="up-${u.key}">Uploading ${Math.round(u.pct * 100)}%</span></span></li>`)}
      </ul>` : ''}
      <div class="file-add">
        <label class="btn small">Attach files<input type="file" multiple accept="${ACCEPT}" data-upload="${l.id}" class="sr-only"></label>
        <label class="btn small">Attach teacher-only file<input type="file" multiple accept="${ACCEPT}" data-upload="${l.id}" data-locked="1" class="sr-only"></label>
      </div>
    </div>`;
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
        <span class="file-when">${f.unlockAt ? `opens ${fmtDay(msToISO(f.unlockAt))}` : 'your teacher will unlock this'}</span></li>`)}</ul>`;
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
      c.files.push(f);
      toast(`Uploaded ${file.name}`);
    } catch (e) {
      console.error(e);
      toast(`Couldn't upload ${file.name}. Check your connection and try again.`, 'error');
    }
    c.uploads = c.uploads.filter((u) => u !== up);
    renderPanel();
  }
}

async function openFile(fileId) {
  const c = state.cls;
  const f = c.files.find((x) => x.id === fileId);
  if (!f) return;
  // Open the tab straight away (pop-up blockers allow it during the click), then fill it in.
  const win = window.open('', '_blank');
  try {
    const url = await store.fileUrl(c.id, f);
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
  await saving(store.updateFile(c.id, fileId, patch));
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
          const a = isAssessmentLike(l);
          return html`<td class="${a ? 'assess' : ''}"><a href="${lessonUrl(c, l.id)}">${a ? html`<span class="star" aria-label="Assessment">★</span> ` : ''}${cellText(s, r.lessons)}</a></td>`;
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
    <p class="hint">★ marks assessments, tests, quizzes, exams and reviews. Multi-period lessons show the part, e.g. (2/3).</p>`;
}

/* ---------- setup ---------- */

function setupPanel(c) {
  const p = c.plan;
  const pat = new Set(p.pattern);
  const opt = (v, label, sel) => html`<option value="${v}" ${raw(String(v) === String(sel) ? 'selected' : '')}>${label}</option>`;
  const nums = (n) => Array.from({ length: n }, (_, i) => i + 1);
  return html`
    <div class="setup-grid">
      <section class="card">
        <h2>Class details</h2>
        <form data-form="details" class="stack">
          <label>Class name <input name="name" required maxlength="80" value="${c.cls.name}"></label>
          <div class="row2">
            <label>Subject <input name="subject" maxlength="80" value="${c.cls.subject}"></label>
            <label>Year <input name="year" maxlength="20" value="${c.cls.year}"></label>
          </div>
          <div class="row2">
            <label>Teacher name <input name="teacher" maxlength="80" value="${c.cls.teacher || ''}" placeholder="Mr Cedillo"></label>
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

      <section class="card span2">
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
        <button class="btn" data-action="add-event">Add event</button>
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
        <h2>Archive</h2>
        ${c.cls.archived
          ? html`<p>Students can't open this class while it's archived.</p><button class="btn" data-action="archive" data-value="0">Restore class</button>`
          : html`<p class="hint">Archiving closes the class to students at once. You can still open it and restore it.</p><button class="btn danger-btn" data-action="archive" data-value="1">Archive class</button>`}
      </section>
    </div>`;
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
    state.cls = null;
    location.hash = '#/';
    await store.signOut();
  } else if (action === 'new-class') {
    document.getElementById('new-class').showModal();
  } else if (action === 'close-dialog') {
    btn.closest('dialog').close();
  } else if (action === 'week-prev' || action === 'week-next' || action === 'week-today' || action === 'week-goto') {
    if (action === 'week-prev') c.weekPos--;
    else if (action === 'week-next') c.weekPos++;
    else if (action === 'week-today') c.weekPos = undefined;
    else c.weekPos = Number(btn.dataset.pos);
    renderPanel();
    document.querySelector(action === 'week-goto' ? `[data-pos="${c.weekPos}"]` : `[data-action="${action}"]:not(:disabled)`)?.focus();
  } else if (action === 'pick-term') {
    c.editTerm = Number(btn.dataset.term);
    renderPanel();
    document.querySelector(`[data-action="pick-term"][data-term="${c.editTerm}"]`)?.focus();
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
    await placeLessons([l], term, `Added to Term ${term}`);
  } else if (action === 'goto-term') {
    c.editTerm = Number(btn.dataset.term); // the link then opens the planner
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
    if (c.collapsed.has(id)) c.collapsed.delete(id); else c.collapsed.add(id);
    btn.setAttribute('aria-expanded', String(!c.collapsed.has(id)));
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
  } else if (action === 'delete-post') {
    if (!confirm('Delete this announcement?')) return;
    const id = btn.dataset.post;
    c.posts = c.posts.filter((p) => p.id !== id);
    renderPanel();
    await saving(store.deleteAnnouncement(c.id, id), 'Announcement deleted');
  } else if (action === 'open-file') {
    await openFile(btn.dataset.file);
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
  } else if (kind === 'new-class') {
    const data = {
      name: form.name.value.trim(),
      subject: form.subject.value.trim(),
      year: form.year.value.trim(),
      colour: Number(form.colour.value) || 0,
    };
    if (!data.name) return;
    try {
      const id = await store.createClass(data);
      form.closest('dialog').close();
      location.hash = `#/class/${id}/setup`;
    } catch (e) { console.error(e); toast("Couldn't create the class. Try again.", 'error'); }
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
    const unit = { id: store.newUnitId(c.id), name, order: c.units.length ? Math.max(...c.units.map((u) => u.order ?? 0)) + 1 : 0 };
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
  if (c && el.dataset.upload) { await uploadFiles(el); return; }
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
        if (side) side.textContent = (isAssessmentLike(lessonById(id)) ? '★ ' : '') + lessonById(id).title;
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

/* ---------- start ---------- */

window.addEventListener('hashchange', route);
store.onAuth((user) => {
  const changed = !state.user || !user || state.user.uid !== user.uid;
  state.user = user;
  if (changed) state.cls = null;
  if (!state.joining) route();
});
route();
