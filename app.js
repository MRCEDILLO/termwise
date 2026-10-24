// Termwise screens. Data goes through `store` (Firebase or the demo store); the
// timetable is always worked out fresh in the browser by planner.js.

import { FIREBASE_CONFIG, SITE_NAME } from './config.js';
import { createDemoStore } from './demo.js';
import { normaliseKey, formatKey } from './keys.js';
import { ACCEPT, fileProblem, isOpen, fileSize, fileIcon } from './files.js';
import {
  schedule, emptyPlan, isAssessmentLike, currentWeek, weekRange, slotLabel, cellText, lessonTerm, slotDate,
  DAYS, PERIODS_PER_DAY, MAX_WEEKS, TERM_COUNT, clampWeeks,
} from './planner.js';

const store = FIREBASE_CONFIG.apiKey
  ? (await import('./firebase.js')).createFirebaseStore(FIREBASE_CONFIG)
  : createDemoStore();

const $app = document.getElementById('app');
const state = { user: undefined, cls: null, view: 'edit' };

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
const fmtLong = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
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
  if (parts[0] === 'class' && parts[1]) return { page: 'class', id: parts[1], tab: parts[2] || '' };
  return { page: 'home' };
}

async function route() {
  if (state.user === undefined) {
    show($app, html`<div class="loading">Loading…</div>`);
    return;
  }
  const r = parseHash();
  if (r.page === 'class') return showClass(r.id, r.tab);
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
        <a class="class-card ${c.archived ? 'archived' : ''}" href="#/class/${c.id}/lessons">
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
          <a class="class-card" href="#/class/${j.classId}/week">
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
    location.hash = `#/class/${classId}/week`;
  } catch (e) {
    console.error(e);
    msg.textContent = "Couldn't reach the server. Check your connection and try again.";
  } finally {
    btn.disabled = false;
    state.joining = false;
  }
}

/* ---------- class page ---------- */

async function showClass(id, tab) {
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
    const [plan, lessons, files] = await Promise.all([
      store.getPlan(id), store.getLessons(id),
      store.listFiles(id).catch((e) => { console.error(e); return []; }),
    ]);
    state.cls = { id, cls, plan, lessons, files, uploads: [], isOwner: cls.owner === state.user.uid };
    sortByTerm(state.cls);
    state.cls.editTerm = (currentWeek(plan, todayISO()) || { term: 1 }).term;
    recompute();
  }
  const c = state.cls;
  const tabs = c.isOwner
    ? [['week', 'Week'], ['lessons', 'Lessons'], ['timetable', 'Timetable'], ['setup', 'Setup']]
    : [['week', 'Week'], ['lessons', 'Lessons'], ['timetable', 'Timetable']];
  if (!tabs.some(([t]) => t === tab)) tab = c.isOwner ? 'lessons' : 'week';
  c.tab = tab;
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
  c.result = schedule(c.plan, c.lessons);
}

function renderPanel() {
  const c = state.cls;
  const panel = document.getElementById('panel');
  if (!panel) return;
  if (c.tab === 'timetable') show(panel, timetablePanel(c));
  else if (c.tab === 'setup') show(panel, setupPanel(c));
  else if (c.tab === 'week') show(panel, weekCalendar(c));
  else if (c.isOwner && state.view === 'edit') show(panel, lessonEditor(c));
  else show(panel, weekList(c));
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
      <span>Add your Term ${t.term} lessons to get started. ${plural(t.available, 'class period')} are free this term.</span></div>`;
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
      <span>Add lessons on the <strong>Lessons</strong> tab to fill the timetable.</span></div>`;
  }
  const short = r.perTerm.filter((t) => !t.fits);
  if (!short.length) {
    return html`<div class="banner good" role="status"><span class="banner-icon" aria-hidden="true">✓</span>
      <span><strong>All lessons fit.</strong> ${r.required} of ${r.available} periods used this year, ${r.spare} spare.</span></div>`;
  }
  return html`<div class="banner bad" role="status"><span class="banner-icon" aria-hidden="true">!</span>
    <span><strong>${short.map((t) => `Term ${t.term} is short by ${plural(-t.spare, 'period')}`).join('. ')}.</strong> Fix it on the Lessons tab.</span></div>`;
}

/* ---------- lessons: teacher editor ---------- */

const statusText = (l) => ({ skipped: 'Skipped', noroom: `No room in Term ${l.term}`, overterm: `Runs past the end of Term ${l.term}` })[l.status];

function viewToggle() {
  return html`
    <div class="seg" role="group" aria-label="Lesson view">
      <button class="${state.view === 'edit' ? 'on' : ''}" aria-pressed="${state.view === 'edit'}" data-action="view" data-view="edit">Edit list</button>
      <button class="${state.view === 'weeks' ? 'on' : ''}" aria-pressed="${state.view === 'weeks'}" data-action="view" data-view="weeks">Student view</button>
    </div>`;
}

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

function lessonEditor(c) {
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
    return html`${sep}
      <li class="lesson ${l.status !== 'scheduled' ? `st-${l.status}` : ''} ${isAssessmentLike(l) ? 'assess' : ''}" data-id="${l.id}">
        <span class="grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
        <span class="num">${i + 1}</span>
        <div class="lesson-main">
          <input class="title-input" data-field="title" value="${l.title}" aria-label="Lesson ${i + 1} title" maxlength="200">
          <div class="lesson-meta">
            ${when ? html`<span class="when">${when}</span>` : ''}
            ${statusText(l) ? html`<span class="tag ${l.status === 'skipped' ? '' : 'bad'}">${statusText(l)}</span>` : ''}
            ${isAssessmentLike(l) ? html`<span class="tag assess-tag">★ Assessment</span>` : ''}
          </div>
        </div>
        <label class="periods">Periods
          <input type="number" min="0" max="20" data-field="periods" value="${l.effective}">
        </label>
        <label class="check as"><input type="checkbox" data-field="assessment" ${raw(l.assessment ? 'checked' : '')}> Assessment</label>
        <label class="check hw"><input type="checkbox" data-field="homework" ${raw(l.homework ? 'checked' : '')}> Homework</label>
        <label class="term-move">Term
          <select data-field="term" aria-label="Move lesson ${i + 1} to another term">
            ${[1, 2, 3, 4].map((n) => html`<option value="${n}" ${raw(n === l.term ? 'selected' : '')}>${n}</option>`)}
          </select>
        </label>
        <div class="lesson-tools">
          <button class="icon-btn" data-action="move" data-dir="-1" aria-label="Move lesson ${i + 1} up" ${raw(i === 0 ? 'disabled' : '')}>↑</button>
          <button class="icon-btn" data-action="move" data-dir="1" aria-label="Move lesson ${i + 1} down" ${raw(i === mine.length - 1 ? 'disabled' : '')}>↓</button>
          <button class="icon-btn danger" data-action="delete-lesson" aria-label="Delete lesson ${i + 1}">✕</button>
        </div>
        ${teacherFiles(c, l)}
      </li>`;
  });
  return html`
    <div class="panel-head">
      <h2>Lessons</h2>
      ${viewToggle()}
    </div>
    ${termPicker(c)}
    ${termBanner(r, t)}
    <p class="hint">Drag cards, or use the arrows, to change the order. Set periods to 0 to skip a lesson. Later lessons move automatically. Use the Term box on a card to move it to another term.</p>
    ${mine.length ? html`<ol class="lesson-list" data-list="lessons">${items}</ol>` : html`<p class="empty">No lessons in Term ${c.editTerm} yet.</p>`}
    <section class="card add-lessons">
      <h3>Add lessons to Term ${c.editTerm}</h3>
      <form class="add-row" data-form="add-lesson">
        <label class="grow">New lesson <input name="title" required maxlength="200" placeholder="e.g. 3A Equivalent fractions"></label>
        <label class="periods">Periods <input name="periods" type="number" min="0" max="20" value="1"></label>
        <button class="btn primary" type="submit">Add lesson</button>
      </form>
      <details>
        <summary>Paste a list of lessons</summary>
        <form data-form="paste-lessons">
          <p class="hint">One lesson per line. Copying the Lesson and Periods columns from your Term Planner spreadsheet works too: a number after a tab or a comma is the periods (1 if left out).</p>
          <textarea name="text" rows="6" placeholder="1A Ordering integers	1&#10;1B Adding and subtracting	2"></textarea>
          <button class="btn" type="submit">Add these lessons to Term ${c.editTerm}</button>
        </form>
      </details>
    </section>`;
}

function lessonById(id) {
  return state.cls.lessons.find((l) => l.id === id);
}

async function updateLesson(id, field, value) {
  const lesson = lessonById(id);
  if (!lesson) return;
  if (field === 'periods') value = Math.max(0, Math.min(20, Math.floor(Number(value)) || 0));
  if (field === 'title') value = String(value).trim().slice(0, 200) || lesson.title;
  if (field === 'term') {
    // Moving to another term puts the lesson at the end of that term's list.
    lesson.term = lessonTerm({ term: value });
    lesson.order = Math.max(...state.cls.lessons.map((l) => l.order)) + 1;
    sortByTerm(state.cls);
    recompute();
    renderPanel();
    await saving(Promise.all([store.saveLesson(state.cls.id, lesson), store.saveOrder(state.cls.id, state.cls.lessons)]), `Moved to Term ${lesson.term}`);
    return;
  }
  lesson[field] = value;
  recompute();
  renderPanel();
  await saving(store.saveLesson(state.cls.id, lesson));
}

// Lessons in term order (stable, so each term keeps its own order), numbered 0, 1, 2…
function sortByTerm(c) {
  c.lessons.sort((a, b) => lessonTerm(a) - lessonTerm(b) || (a.order ?? 0) - (b.order ?? 0));
  c.lessons.forEach((l, i) => { l.order = i; });
}

function termLessons(c) {
  return c.lessons.filter((l) => lessonTerm(l) === c.editTerm);
}

async function addLessons(rows) {
  const c = state.cls;
  const base = c.lessons.length ? Math.max(...c.lessons.map((l) => l.order)) + 1 : 0;
  const added = rows.map((row, i) => ({
    id: store.newLessonId(c.id),
    term: c.editTerm,
    title: row.title,
    periods: row.periods,
    assessment: false,
    homework: false,
    order: base + i,
  }));
  c.lessons.push(...added);
  sortByTerm(c);
  recompute();
  renderPanel();
  const ok = await saving(Promise.all([...added.map((l) => store.saveLesson(c.id, l)), store.saveOrder(c.id, c.lessons)]), added.length > 1 ? `Added ${added.length} lessons` : 'Lesson added');
  if (ok) document.querySelector('[data-form="add-lesson"] input[name="title"]')?.focus();
}

function parsePasted(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = /^(.*?)[\t,]\s*(\d+)\s*$/.exec(line);
    return m ? { title: m[1].trim().slice(0, 200), periods: Math.min(20, Number(m[2])) } : { title: line.slice(0, 200), periods: 1 };
  }).filter((r) => r.title);
}

// toIndex is a position in the chosen term's list.
async function reorder(fromId, toIndex) {
  const c = state.cls;
  const list = termLessons(c);
  const from = list.findIndex((l) => l.id === fromId);
  if (from < 0 || toIndex === from) return;
  const [moved] = list.splice(from, 1);
  list.splice(toIndex > from ? toIndex - 1 : toIndex, 0, moved);
  c.lessons = [...c.lessons.filter((l) => lessonTerm(l) !== c.editTerm), ...list];
  c.lessons.forEach((l, i) => { l.order = i; });
  sortByTerm(c);
  recompute();
  renderPanel();
  await saving(store.saveOrder(c.id, c.lessons), 'Order saved');
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
      cells.push(html`<div class="tile ${a ? 'assess' : ''}" style="grid-column:${day + 1};grid-row:${p + 1} / span ${span}">
        <span class="tile-when">${span > 1 ? `P${p}–${p + span - 1}` : `P${p}`} <span class="tile-day">· ${DAYS[day - 1]}</span></span>
        <span class="tile-title">${a ? html`<span aria-label="Assessment">★ </span>` : ''}${l.title}</span>
        ${part ? html`<span class="tile-part">${part}</span>` : ''}
        ${l.homework ? html`<span class="tag">Homework</span>` : ''}
        ${studentFiles(c, l.id)}
      </div>`);
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
      <p class="hint">Use the arrows, the ← → keys or the notches above to flip between weeks. ★ marks assessments.</p>
    </section>`;
}

/* ---------- lesson files ---------- */

const filesFor = (c, lessonId) => c.files.filter((f) => f.lessonId === lessonId)
  .sort((a, b) => (a.locked - b.locked) || a.name.localeCompare(b.name));
const msToISO = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Files on a lesson card: attach, mark teacher-only, set an unlock date or unlock now.
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

/* ---------- lessons: week by week (students, and teacher preview) ---------- */

function slotsByWeek(r) {
  const byWeek = new Map();
  for (const s of r.slots) {
    const k = `${s.term}-${s.week}`;
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(s);
  }
  return byWeek;
}

// One week's lessons and cancelled periods. Consecutive periods of the same lesson become one entry.
function weekItems(r, slots) {
  const entries = [];
  for (const s of slots) {
    const last = entries[entries.length - 1];
    if (!s.blocked && s.lessonIndex !== null && last && last.lessonIndex === s.lessonIndex) last.slots.push(s);
    else entries.push({ lessonIndex: s.blocked ? null : s.lessonIndex, blocked: s.blocked, slots: [s] });
  }
  const items = entries.filter((e) => e.blocked || e.lessonIndex !== null).map((e) => {
    const times = e.slots.map((s) => `${s.date ? fmtDay(s.date) : DAYS[s.day - 1]} P${s.period}`).join(' · ');
    if (e.blocked) {
      const s = e.slots[0];
      return html`<li class="wk-item cancelled"><span class="tag">Cancelled</span>
        <div><strong>${s.label || 'No class'}</strong><div class="times">${times}</div></div></li>`;
    }
    const l = r.lessons[e.lessonIndex];
    const continued = e.slots[0].part > 1;
    return html`<li class="wk-item ${isAssessmentLike(l) ? 'assess' : ''}">
      <span class="periods-pill" title="Periods">${e.slots.length}P</span>
      <div class="wk-main">
        <strong>${l.title}</strong>
        ${continued ? html`<span class="tag">continued</span>` : ''}
        ${isAssessmentLike(l) ? html`<span class="tag assess-tag">★ Assessment</span>` : ''}
        ${l.homework ? html`<span class="tag">Homework</span>` : ''}
        <div class="times">${times}</div>
        ${studentFiles(state.cls, l.id)}
      </div>
    </li>`;
  });
  return items.length ? html`<ul class="wk-items">${items}</ul>` : html`<p class="empty small">No lessons this week.</p>`;
}

// The panel students see first: today's date and the week that matters now.
function thisWeekPanel(c, cur, byWeek) {
  const today = todayISO();
  const term = c.plan.terms[cur.term - 1];
  const range = weekRange(term, cur.week);
  const heading = {
    week: `This week: Term ${cur.term}, Week ${cur.week}`,
    weekend: `Coming up: Term ${cur.term}, Week ${cur.week}`,
    holidays: `Holidays. Next up: Term ${cur.term}, Week ${cur.week}`,
    ended: `The year has finished. Last week: Term ${cur.term}, Week ${cur.week}`,
  }[cur.state];
  return html`
    <section class="this-week" aria-labelledby="this-week-h">
      <p class="today">Today is ${fmtLong(today)}</p>
      <h2 id="this-week-h">${heading}</h2>
      <p class="wk-range">${range ? `${fmtLong(range.from)} to ${fmtLong(range.to)}` : ''}</p>
      ${weekItems(c.result, byWeek.get(`${cur.term}-${cur.week}`) || [])}
    </section>`;
}

function weekList(c) {
  const r = c.result;
  const cur = currentWeek(c.plan, todayISO());
  const byWeek = slotsByWeek(r);
  const terms = c.plan.terms.map((term, ti) => {
    const weeks = clampWeeks(term.weeks);
    if (!weeks) return '';
    const weekBlocks = [];
    for (let w = 1; w <= weeks; w++) {
      const isCur = cur && cur.term === ti + 1 && cur.week === w;
      const isPast = cur && (ti + 1 < cur.term || (ti + 1 === cur.term && w < cur.week));
      const range = weekRange(term, w);
      weekBlocks.push(html`
        <details class="week ${isCur ? 'current' : ''}" ${raw(isPast ? '' : 'open')}>
          <summary>
            <span class="wk-title">Week ${w}</span>
            <span class="wk-range">${rangeText(range)}</span>
            ${isCur ? html`<span class="tag now">${cur.state === 'week' ? 'This week' : 'Next'}</span>` : ''}
          </summary>
          ${weekItems(r, byWeek.get(`${ti + 1}-${w}`) || [])}
        </details>`);
    }
    return html`<section class="term-block"><h3>Term ${ti + 1}</h3>${weekBlocks}</section>`;
  });
  if (!r.meetingsPerWeek) {
    return html`
      ${c.isOwner ? html`<div class="panel-head"><h2>Week by week</h2>${viewToggle()}</div>` : ''}
      <p class="empty">Your teacher hasn't set up the timetable yet.</p>`;
  }
  return html`
    ${c.isOwner ? html`<div class="panel-head"><h2>Student view</h2>${viewToggle()}</div>` : ''}
    ${cur ? thisWeekPanel(c, cur, byWeek) : ''}
    <h2 class="all-weeks">All weeks</h2>
    <p class="hint">Past weeks are folded up. Click a week to open it.</p>
    ${terms}`;
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
          return html`<td class="${a ? 'assess' : ''}">${a ? html`<span class="star" aria-label="Assessment">★</span> ` : ''}${cellText(s, r.lessons)}</td>`;
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
        <p class="hint">The first day of each term, and how many weeks it runs (up to ${MAX_WEEKS}). You choose which term each lesson is in on the Lessons tab.</p>
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
  } else if (action === 'view') {
    state.view = btn.dataset.view;
    renderPanel();
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
    const id = btn.closest('[data-id]').dataset.id;
    const i = termLessons(c).findIndex((l) => l.id === id);
    const dir = Number(btn.dataset.dir);
    await reorder(id, dir < 0 ? i - 1 : i + 2);
    document.querySelector(`[data-id="${id}"] [data-dir="${dir}"]`)?.focus();
  } else if (action === 'delete-lesson') {
    const id = btn.closest('[data-id]').dataset.id;
    const l = lessonById(id);
    if (!confirm(`Delete "${l.title}"? Lessons after it will move earlier.`)) return;
    const files = filesFor(c, id);
    if (files.length && !confirm(`This also deletes its ${files.length === 1 ? 'file' : `${files.length} files`}.`)) return;
    c.lessons = c.lessons.filter((x) => x.id !== id);
    c.files = c.files.filter((f) => f.lessonId !== id);
    recompute();
    renderPanel();
    await saving(Promise.all([store.deleteLesson(c.id, id), ...files.map((f) => store.deleteFile(c.id, f))]), 'Lesson deleted');
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
    };
    if (await saving(store.updateClass(c.id, patch))) {
      Object.assign(c.cls, patch);
      showClass(c.id, 'setup');
    }
  } else if (kind === 'add-lesson') {
    const title = form.title.value.trim();
    if (!title) return;
    await addLessons([{ title, periods: Math.max(0, Math.min(20, Math.floor(Number(form.periods.value)) || 0)) }]);
  } else if (kind === 'paste-lessons') {
    const rows = parsePasted(form.text.value);
    if (!rows.length) { toast('Paste at least one lesson, one per line.', 'error'); return; }
    await addLessons(rows);
  }
});

// Inputs save when they change (on blur or Enter), so typing isn't interrupted.
$app.addEventListener('change', async (ev) => {
  const el = ev.target;
  const c = state.cls;
  if (c && el.dataset.upload) { await uploadFiles(el); return; }
  if (c && el.dataset.ffield) { await updateFile(el.closest('[data-file]').dataset.file, el.dataset.ffield, el); return; }
  if (!c || !el.dataset.field) return;
  const lessonEl = el.closest('[data-id]');
  if (lessonEl) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    await updateLesson(lessonEl.dataset.id, el.dataset.field, v);
    document.querySelector(`[data-id="${lessonEl.dataset.id}"] [data-field="${el.dataset.field}"]`)?.focus();
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

// ← and → flip weeks on the Week tab (unless typing in a box).
document.addEventListener('keydown', (ev) => {
  const c = state.cls;
  if (!c || c.tab !== 'week' || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (ev.target.closest && ev.target.closest('input, select, textarea')) return;
  const btn = document.querySelector(ev.key === 'ArrowLeft' ? '[data-action="week-prev"]' : ev.key === 'ArrowRight' ? '[data-action="week-next"]' : null);
  if (btn && !btn.disabled) { ev.preventDefault(); btn.click(); }
});

/* ---------- drag and drop for lesson cards ---------- */

// Only the grip starts a drag, so text in the card's inputs can still be selected.
let dragId = null;
$app.addEventListener('pointerdown', (ev) => {
  const grip = ev.target.closest && ev.target.closest('.grip');
  if (grip) grip.closest('.lesson').draggable = true;
});
$app.addEventListener('dragstart', (ev) => {
  const li = ev.target.closest && ev.target.closest('.lesson');
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add('dragging');
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', dragId);
});
$app.addEventListener('dragend', (ev) => {
  dragId = null;
  const li = ev.target.closest && ev.target.closest('.lesson');
  if (li) li.draggable = false;
  document.querySelectorAll('.lesson.dragging, .lesson.drop-before, .lesson.drop-after')
    .forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
});
function dropTarget(ev) {
  const li = ev.target.closest && ev.target.closest('.lesson');
  if (!li || !dragId) return null;
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
  const id = dragId;
  const idx = termLessons(state.cls).findIndex((l) => l.id === t.li.dataset.id);
  await reorder(id, t.after ? idx + 1 : idx);
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
