import { invoke, view, router } from '@forge/bridge';
import { forecast, MAX_SLIP_DAYS } from '../../../src/core/forecast.js';
import { headline } from '../../../src/core/report.js';
import { formatShort } from '../../../src/core/dates.js';
import { renderGraph } from './graph.js';
import './styles.css';

const app = document.getElementById('app');
const esc = (s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const days = (n) => `${n} business ${n === 1 ? 'day' : 'days'}`;
const QUICK = [
  { label: '1 day', value: 1 },
  { label: '3 days', value: 3 },
  { label: '1 week', value: 5 },
  { label: '2 weeks', value: 10 },
];

const state = { graph: null, today: null, slip: 5, posting: false, posted: null, error: null };

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
      return `<span class="ko-badge is-late">+${n.delayDays}d late</span>`;
    case 'later':
      return `<span class="ko-badge is-late">+${n.delayDays}d late <small>(was ${n.baselineDelayDays})</small></span>`;
    case 'already-late':
      return `<span class="ko-badge is-warn">${n.baselineDelayDays}d late already</span>`;
    case 'absorbed':
      return `<span class="ko-badge is-ok">${n.slackAfterDays > 0 ? `${n.slackAfterDays}d slack left` : 'just on time'}</span>`;
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
      ? `<span class="ko-dim">no due date</span> → ${formatShort(n.projectedFinish)}`
      : n.delayDays > 0
        ? `${formatShort(n.due)} → <strong>${formatShort(n.projectedFinish)}</strong>`
        : `${formatShort(n.due)}`;
  const shown = n.via.slice(0, 2).map((v) => esc(v.key)).join(', ');
  const more = n.via.length > 2 ? ` +${n.via.length - 2}` : '';
  const via = n.via.length ? `<span class="ko-dim"> · after ${shown}${more}</span>` : '';
  return `<li class="ko-row is-${n.state}" data-key="${esc(n.key)}">
    <button class="ko-key" data-open="${esc(n.key)}" title="Open ${esc(n.key)}">${esc(n.key)}</button>
    <div class="ko-row-main">
      <div class="ko-row-summary">${esc(n.summary)}</div>
      <div class="ko-row-meta"><span class="ko-avatar" aria-hidden="true">${esc(initials(who))}</span>${esc(who)}${via}</div>
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
  const cls = r.overrunDays > 0 ? 'is-late' : 'is-ok';
  const text =
    r.overrunDays > 0
      ? `Last issue lands <strong>${formatShort(r.projectedFinish)}</strong>, ${days(r.overrunDays)} after the release date. Driven by ${esc(r.driver)}.`
      : `Last issue lands ${formatShort(r.projectedFinish)}, still in time.`;
  return `<li class="ko-release ${cls}">
    <div class="ko-release-name">${esc(r.name)} <span class="ko-dim">release ${formatShort(r.releaseDate)}</span></div>
    <div class="ko-release-text">${text}${r.state === 'already-at-risk' ? ' <em>Already at risk before this slip.</em>' : ''}</div>
  </li>`;
}

function controls(key) {
  return `<header class="ko-head">
    <label class="ko-question" for="ko-range">If <strong>${esc(key)}</strong> slips by</label>
    <div class="ko-slip">
      <input id="ko-range" type="range" min="0" max="20" step="1" value="${Math.min(state.slip, 20)}" aria-describedby="ko-slip-out" />
      <span class="ko-slip-num"><input id="ko-num" type="number" min="0" max="${MAX_SLIP_DAYS}" value="${state.slip}" aria-label="Slip in business days" /> <span id="ko-slip-out">business days</span></span>
    </div>
    <div class="ko-quick" role="group" aria-label="Quick picks">
      ${QUICK.map((q) => `<button class="ko-chip${q.value === state.slip ? ' is-on' : ''}" data-slip="${q.value}">${q.label}</button>`).join('')}
    </div>
  </header>`;
}

function renderResult() {
  const result = forecast(state.graph, state.slip, { today: state.today });
  const { counts, root } = result;
  const broken = counts.late + counts.later;
  const tone = result.rootDone || counts.downstream === 0 ? 'is-calm' : broken > 0 || counts.releasesAtRisk > 0 ? 'is-alarm' : 'is-ok';

  if (result.rootDone) {
    return `<div class="ko-empty"><strong>${esc(root.key)} is done.</strong> Finished work cannot slip, so nothing downstream is at risk from it.</div>`;
  }
  if (counts.downstream === 0) {
    return `<div class="ko-empty"><strong>Nothing depends on ${esc(root.key)} yet.</strong> Link the work it blocks (<em>blocks</em> or <em>is depended on by</em>) and Knock-On will show what a slip would break.</div>`;
  }

  const rootNode = result.nodes.find((n) => n.state === 'root');
  const by = (s) => result.nodes.filter((n) => n.state === s);
  const hit = [...by('late'), ...by('later')].sort((a, b) => b.delayDays - a.delayDays);
  const people = result.people;

  return `<p class="ko-headline ${tone}">${esc(headline(result))}</p>
    <p class="ko-sub">${esc(root.key)} would finish <strong>${formatShort(rootNode.projectedFinish)}</strong>${root.due ? ` instead of ${formatShort(root.due)}` : ''}.</p>

    <div class="ko-stats">
      <div class="ko-stat"><b>${counts.downstream}</b><span>downstream</span></div>
      <div class="ko-stat ${broken ? 'is-late' : ''}"><b>${broken}</b><span>miss due date</span></div>
      <div class="ko-stat ${counts.releasesAtRisk ? 'is-late' : ''}"><b>${counts.releasesAtRisk}</b><span>releases at risk</span></div>
      <div class="ko-stat ${counts.absorbed ? 'is-ok' : ''}"><b>${counts.absorbed}</b><span>absorbed</span></div>
    </div>

    <div class="ko-graph">${renderGraph(result)}</div>
    <div class="ko-legend" aria-hidden="true">
      <span class="is-root">slipping</span><span class="is-late">misses due date</span><span class="is-already-late">already late</span><span class="is-absorbed">absorbs it</span><span class="is-no-due">no due date</span><span class="is-parent">part of</span>
    </div>

    ${result.releases.length ? `<section class="ko-group"><h3>Releases</h3><ul class="ko-releases">${result.releases.map(releaseCard).join('')}</ul></section>` : ''}
    ${group('Due dates that break', hit)}
    ${group('Already late before this slip', by('already-late'), 'These miss their date even if nothing slips: their blockers are due too late.')}
    ${group('Absorbed by slack', by('absorbed'))}
    ${group('No due date', by('no-due'), 'Shown with how far they move; set a due date to judge them.')}

    ${
      people.length
        ? `<section class="ko-group"><h3>Who to tell</h3><ul class="ko-people">${people
            .map((p) => `<li><span class="ko-avatar" aria-hidden="true">${esc(initials(p.name))}</span><span>${esc(p.name)}</span><span class="ko-dim">${p.issues.map(esc).join(', ')}</span></li>`)
            .join('')}</ul></section>`
        : ''
    }
    ${result.externalBlockers.length ? `<p class="ko-note">Also waiting on ${result.externalBlockers.map((b) => `${esc(b.key)} (due ${formatShort(b.due)})`).join(', ')}, which ${result.externalBlockers.length === 1 ? 'keeps its' : 'keep their'} own date.</p>` : ''}
    ${result.cycles.length ? `<p class="ko-note is-warn">Dependency loop between ${result.cycles.map(esc).join(', ')}: these are left out of the forecast.</p>` : ''}
    ${result.truncated ? '<p class="ko-note is-warn">The dependency graph is large; only the first 80 issues were read.</p>' : ''}

    <footer class="ko-foot">
      <button class="ko-primary" id="ko-post" ${state.posting ? 'disabled' : ''}>${state.posting ? 'Posting…' : `Post this forecast to ${esc(root.key)}`}</button>
      ${state.posted ? `<span class="ko-posted" role="status">${esc(state.posted)}</span>` : ''}
      <span class="ko-foot-note">Business days (Mon–Fri). Durations from original estimates, 1 day if none.</span>
    </footer>`;
}

function render() {
  if (state.error) {
    app.innerHTML = `<div class="ko-error" role="alert"><strong>Knock-On could not read this issue.</strong> ${esc(state.error)} <button class="ko-chip" id="ko-retry">Try again</button></div>`;
    document.getElementById('ko-retry')?.addEventListener('click', load);
    return;
  }
  if (!state.graph) return;
  if (!document.getElementById('ko-body')) {
    app.innerHTML = `${controls(state.graph.rootKey)}<div id="ko-body"></div>`;
  }
  const range = document.getElementById('ko-range');
  const num = document.getElementById('ko-num');
  if (document.activeElement !== range) range.value = String(Math.min(state.slip, 20));
  if (document.activeElement !== num) num.value = String(state.slip);
  for (const chip of app.querySelectorAll('[data-slip]')) chip.classList.toggle('is-on', Number(chip.dataset.slip) === state.slip);
  document.getElementById('ko-body').innerHTML = renderResult();
}

function setSlip(value) {
  const n = Math.max(0, Math.min(MAX_SLIP_DAYS, Number.parseInt(value, 10) || 0));
  if (n === state.slip) return;
  state.slip = n;
  state.posted = null;
  render();
}

app.addEventListener('input', (e) => {
  if (e.target.id === 'ko-range' || e.target.id === 'ko-num') setSlip(e.target.value);
});

app.addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-slip]');
  if (chip) return setSlip(chip.dataset.slip);
  const open = e.target.closest('[data-open]') ?? e.target.closest('.ko-node');
  if (open) return router.navigate(`/browse/${open.dataset.open ?? open.dataset.key}`);
  if (e.target.closest('#ko-post')) {
    state.posting = true;
    state.posted = null;
    render();
    const res = await invoke('postImpactComment', { slipDays: state.slip });
    state.posting = false;
    state.posted = res?.ok ? 'Posted as a comment on this issue.' : `Not posted: ${res?.error ?? 'unknown error'}`;
    render();
  }
});

app.addEventListener('keydown', (e) => {
  const node = e.target.closest?.('.ko-node');
  if (node && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    router.navigate(`/browse/${node.dataset.key}`);
  }
});

async function load() {
  state.error = null;
  app.innerHTML = '<div class="ko-loading"><span class="ko-spinner" aria-hidden="true"></span> Reading the dependency graph…</div>';
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
