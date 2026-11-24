import { invoke, view, router } from '@forge/bridge';
import { forecast, MAX_SLIP_DAYS } from '../../../src/core/forecast.js';
import { headline } from '../../../src/core/report.js';
import { formatShort } from '../../../src/core/dates.js';
import { renderGraph, paintGraph } from './graph.js';
import './styles.css';

const app = document.getElementById('app');
const esc = (s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const days = (n) => `${n} business ${n === 1 ? 'day' : 'days'}`;
const RANGE_MAX = 20;
const QUICK = [
  { label: '1 day', value: 1 },
  { label: '3 days', value: 3 },
  { label: '1 week', value: 5 },
  { label: '2 weeks', value: 10 },
];

const icon = {
  arrow: '<svg class="ko-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  comment: '<svg class="ko-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  check: '<svg class="ko-i" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg class="ko-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 14 13H2L8 2.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3M8 11.3v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  link: '<svg class="ko-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

const state = { graph: null, today: null, slip: 5, posting: false, error: null };

function initials(name) {
  return `${name ?? '?'}`
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

function badge(n) {
  switch (n.state) {
    case 'late':
    case 'later':
      return `<span class="ko-badge is-late">+${n.delayDays}d late</span>`;
    case 'already-late':
      return `<span class="ko-badge is-warn">${n.baselineDelayDays}d late already</span>`;
    case 'absorbed':
      return `<span class="ko-badge is-ok">${n.slackAfterDays > 0 ? `${n.slackAfterDays}d slack left` : 'just in time'}</span>`;
    case 'no-due':
      return `<span class="ko-badge is-muted">moves ${n.shiftDays}d</span>`;
    default:
      return '';
  }
}

function row(n) {
  const who = n.assignee?.name ?? 'Unassigned';
  const dates =
    n.state === 'no-due'
      ? `<span class="ko-dim">No due date</span>${icon.arrow}<span>${formatShort(n.projectedFinish)}</span>`
      : n.delayDays > 0
        ? `<span class="ko-was">${formatShort(n.due)}</span>${icon.arrow}<strong>${formatShort(n.projectedFinish)}</strong>`
        : `<span>${formatShort(n.due)}</span>`;
  const shown = n.via.slice(0, 2).map((v) => esc(v.key)).join(', ');
  const more = n.via.length > 2 ? ` +${n.via.length - 2}` : '';
  const via = n.via.length ? `<span class="ko-dim">after ${shown}${more}</span>` : '';
  return `<li class="ko-row is-${n.state}">
    <span class="ko-state" aria-hidden="true"></span>
    <button class="ko-key" data-open="${esc(n.key)}" title="Open ${esc(n.key)}">${esc(n.key)}</button>
    <div class="ko-row-main">
      <div class="ko-row-summary">${esc(n.summary)}</div>
      <div class="ko-row-meta"><span class="ko-avatar" aria-hidden="true">${esc(initials(who))}</span><span>${esc(who)}</span>${via}</div>
    </div>
    <div class="ko-row-dates">${dates}</div>
    <div class="ko-row-badge">${badge(n)}</div>
  </li>`;
}

function group(title, list, hint) {
  if (!list.length) return '';
  return `<section class="ko-group">
    <h3>${esc(title)} <span class="ko-count">${list.length}</span></h3>
    ${hint ? `<p class="ko-hint">${hint}</p>` : ''}
    <ul class="ko-rows">${list.map(row).join('')}</ul>
  </section>`;
}

function releaseCard(r) {
  const late = r.overrunDays > 0;
  const text = late
    ? `Last issue lands <strong>${formatShort(r.projectedFinish)}</strong>, ${days(r.overrunDays)} after the release date. Driven by ${esc(r.driver)}.`
    : `Last issue lands ${formatShort(r.projectedFinish)}, in time for the release.`;
  return `<li class="ko-release ${late ? 'is-late' : 'is-ok'}">
    <div class="ko-release-head"><span class="ko-release-name">${esc(r.name)}</span><span class="ko-dim">Release ${formatShort(r.releaseDate)}</span>
      <span class="ko-badge ${late ? 'is-late' : 'is-ok'}">${late ? `+${r.overrunDays}d` : 'on track'}</span></div>
    <div class="ko-release-text">${text}${r.state === 'already-at-risk' ? ' Already at risk before this slip.' : ''}</div>
  </li>`;
}

function controls(key) {
  return `<header class="ko-head">
    <div class="ko-question"><label for="ko-range">If <strong>${esc(key)}</strong> slips by</label>
      <span class="ko-slip-num"><input id="ko-num" type="number" inputmode="numeric" min="0" max="${MAX_SLIP_DAYS}" value="${state.slip}" aria-label="Slip in business days" /> business days</span>
    </div>
    <input id="ko-range" class="ko-range" type="range" min="0" max="${RANGE_MAX}" step="1" value="${Math.min(state.slip, RANGE_MAX)}" />
    <div class="ko-quick" role="group" aria-label="Quick picks">
      ${QUICK.map((q) => `<button class="ko-chip" data-slip="${q.value}" aria-pressed="false">${q.label}</button>`).join('')}
    </div>
  </header>`;
}

function headlineHtml(result) {
  return esc(headline(result)).replace(/(\d+ of \d+|\d+ releases?(?= (?:is|are) at risk))/g, '<span class="ko-hot">$1</span>');
}

function tally(result) {
  const { counts } = result;
  const items = [
    ['late', counts.late + counts.later, 'miss their date'],
    ['already-late', counts.alreadyLate, 'already late'],
    ['absorbed', counts.absorbed, 'absorb it'],
    ['no-due', counts.noDue, 'no due date'],
  ].filter(([, n]) => n > 0);
  return `<ul class="ko-tally" aria-label="Downstream issues by outcome">${items
    .map(([s, n, label]) => `<li class="is-${s}"><span class="ko-dot" aria-hidden="true"></span><b>${n}</b> ${label}</li>`)
    .join('')}<li class="is-parent"><span class="ko-dash" aria-hidden="true"></span>part of</li></ul>`;
}

function details(result) {
  const by = (s) => result.nodes.filter((n) => n.state === s);
  const hit = [...by('late'), ...by('later')].sort((a, b) => b.delayDays - a.delayDays);
  const people = result.people;
  return `
    ${result.releases.length ? `<section class="ko-group"><h3>Releases</h3><ul class="ko-releases">${result.releases.map(releaseCard).join('')}</ul></section>` : ''}
    ${group('Due dates that break', hit)}
    ${group('Already late before this slip', by('already-late'), 'These miss their date even if nothing slips: a blocker is due too late.')}
    ${group('Absorbed by slack', by('absorbed'))}
    ${group('No due date', by('no-due'), 'Shown with how far they move. Set a due date to judge them.')}
    ${
      people.length
        ? `<section class="ko-group"><h3>Who to tell <span class="ko-count">${people.length}</span></h3><ul class="ko-people">${people
            .map((p) => `<li><span class="ko-avatar" aria-hidden="true">${esc(initials(p.name))}</span><span>${esc(p.name)}</span><span class="ko-dim">${p.issues.map(esc).join(', ')}</span></li>`)
            .join('')}</ul></section>`
        : ''
    }
    ${result.externalBlockers.length ? `<p class="ko-note">${icon.link}<span>Also waiting on ${result.externalBlockers.map((b) => `${esc(b.key)} (due ${formatShort(b.due)})`).join(', ')}, which ${result.externalBlockers.length === 1 ? 'keeps its' : 'keep their'} own date.</span></p>` : ''}
    ${result.cycles.length ? `<p class="ko-note is-warn">${icon.alert}<span>Dependency loop between ${result.cycles.map(esc).join(', ')}. These are left out of the forecast.</span></p>` : ''}
    ${result.truncated ? `<p class="ko-note is-warn">${icon.alert}<span>The dependency graph is large. Only the first 80 issues were read.</span></p>` : ''}`;
}

function footer(key) {
  return `<footer class="ko-foot">
    <button class="ko-primary" id="ko-post">${icon.comment}<span id="ko-post-label">Post forecast to ${esc(key)}</span></button>
    <span class="ko-posted" id="ko-posted" role="status" aria-live="polite"></span>
    <p class="ko-foot-note">Business days, Monday to Friday. Durations come from original estimates, or 1 day if none.</p>
  </footer>`;
}

function mount(result) {
  const key = result.root.key;
  if (result.rootDone) {
    app.innerHTML = `<div class="ko-empty ko-enter">${icon.check}<div><strong>${esc(key)} is done.</strong><p>Finished work cannot slip, so nothing downstream is at risk from it.</p></div></div>`;
    return;
  }
  if (result.counts.downstream === 0) {
    app.innerHTML = `<div class="ko-empty ko-enter">${icon.link}<div><strong>Nothing depends on ${esc(key)} yet.</strong><p>Link the work it blocks with <em>blocks</em> or <em>is depended on by</em>, and Knock-On will show what a slip would break.</p></div></div>`;
    return;
  }
  app.innerHTML = `${controls(key)}
    <section class="ko-summary ko-enter" style="--i:1" id="ko-summary" aria-live="polite"></section>
    <figure class="ko-graph ko-enter" style="--i:2">${renderGraph(result)}</figure>
    <div id="ko-details" class="ko-enter" style="--i:3"></div>
    ${footer(key)}`;
}

function update() {
  if (!document.getElementById('ko-summary')) return; // empty or done state: nothing to update
  const result = forecast(state.graph, state.slip, { today: state.today });
  const range = document.getElementById('ko-range');
  const num = document.getElementById('ko-num');
  if (document.activeElement !== range) range.value = String(Math.min(state.slip, RANGE_MAX));
  if (document.activeElement !== num) num.value = String(state.slip);
  range.style.setProperty('--fill', `${(Math.min(state.slip, RANGE_MAX) / RANGE_MAX) * 100}%`);
  for (const chip of app.querySelectorAll('[data-slip]')) chip.setAttribute('aria-pressed', String(Number(chip.dataset.slip) === state.slip));

  const rootNode = result.nodes.find((n) => n.state === 'root');
  const broken = result.counts.late + result.counts.later;
  const tone = broken > 0 || result.counts.releasesAtRisk > 0 ? 'is-alarm' : 'is-calm';
  document.getElementById('ko-summary').innerHTML = `
    <p class="ko-headline ${tone}">${headlineHtml(result)}</p>
    <p class="ko-sub">${esc(result.root.key)} would finish <strong>${formatShort(rootNode.projectedFinish)}</strong>${result.root.due ? ` instead of ${formatShort(result.root.due)}` : ''}.</p>
    ${tally(result)}`;
  paintGraph(app.querySelector('.ko-svg'), result);
  fitGraph();
  document.getElementById('ko-details').innerHTML = details(result);
}

function fitGraph() {
  const fig = app.querySelector('.ko-graph');
  if (!fig) return;
  const check = () => {
    fig.classList.toggle('is-scrollable', fig.scrollWidth > fig.clientWidth + 1);
    fig.classList.toggle('is-end', fig.scrollLeft + fig.clientWidth >= fig.scrollWidth - 2);
  };
  if (!fig.dataset.watched) {
    fig.dataset.watched = 'true';
    fig.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
  }
  check();
}

function render() {
  if (state.error) {
    app.innerHTML = `<div class="ko-empty is-error ko-enter" role="alert">${icon.alert}<div><strong>Knock-On could not read this issue.</strong><p>${esc(state.error)}</p><button class="ko-chip" id="ko-retry">Try again</button></div></div>`;
    document.getElementById('ko-retry')?.addEventListener('click', load);
    return;
  }
  if (!state.graph) return;
  if (!app.dataset.mounted) {
    mount(forecast(state.graph, state.slip, { today: state.today }));
    app.dataset.mounted = 'true';
  }
  update();
}

function setSlip(value) {
  const n = Math.max(0, Math.min(MAX_SLIP_DAYS, Number.parseInt(value, 10) || 0));
  if (n === state.slip) return;
  state.slip = n;
  const posted = document.getElementById('ko-posted');
  if (posted) posted.textContent = '';
  update();
}

app.addEventListener('input', (e) => {
  if (e.target.id === 'ko-range' || e.target.id === 'ko-num') setSlip(e.target.value);
});

app.addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-slip]');
  if (chip) return setSlip(chip.dataset.slip);
  const open = e.target.closest('[data-open]') ?? e.target.closest('.ko-node');
  if (open) return router.navigate(`/browse/${open.dataset.open ?? open.dataset.key}`);
  const post = e.target.closest('#ko-post');
  if (post && !state.posting) {
    const label = document.getElementById('ko-post-label');
    const status = document.getElementById('ko-posted');
    state.posting = true;
    post.disabled = true;
    post.classList.add('is-busy');
    label.textContent = 'Posting…';
    status.textContent = '';
    const res = await invoke('postImpactComment', { slipDays: state.slip }).catch((error) => ({ ok: false, error: error.message }));
    state.posting = false;
    post.disabled = false;
    post.classList.remove('is-busy');
    label.textContent = `Post forecast to ${state.graph.rootKey}`;
    status.className = `ko-posted ${res?.ok ? 'is-ok' : 'is-error'}`;
    status.innerHTML = res?.ok ? `${icon.check}<span>Posted as a comment on this issue</span>` : `${icon.alert}<span>Not posted: ${esc(res?.error ?? 'unknown error')}</span>`;
  }
});

app.addEventListener('keydown', (e) => {
  const node = e.target.closest?.('.ko-node');
  if (node && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    router.navigate(`/browse/${node.dataset.key}`);
  }
});

function skeleton() {
  app.innerHTML = `<div class="ko-skeleton" aria-label="Reading the dependency graph" role="status">
    <span class="ko-bone w-60"></span><span class="ko-bone w-90 tall"></span><span class="ko-bone block"></span><span class="ko-bone w-75"></span><span class="ko-bone w-75"></span>
  </div>`;
}

async function load() {
  state.error = null;
  delete app.dataset.mounted;
  skeleton();
  try {
    const res = await invoke('loadGraph');
    if (!res?.ok) throw new Error(res?.error ?? 'No response from the app.');
    state.graph = res.graph;
    state.today = res.today;
  } catch (error) {
    state.error = error.message;
  }
  render();
}

view.theme?.enable?.().catch(() => {});
load();
