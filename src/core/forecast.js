// Knock-On forecaster: propagate a slip through the dependency graph.
//
// Model (all in business days):
//   - The slipping issue now finishes `slipDays` after its due date (or after today if it has none / is overdue).
//   - A "blocks" edge u -> v: v can finish no earlier than finish(u) + duration(v).
//   - A "parent" edge child -> parent: the parent finishes no earlier than its child (no extra duration).
//   - Blockers of v that are not downstream of the slip keep their own due date.
//   - finish(v) = latest of: v's due date, every constraint above, today (unfinished work cannot finish in the past).
//   - duration(v) = original estimate in 8 h days, else `defaultDuration`.
// The same pass is run with slip 0 (the plan as it stands) and with the slip, so the
// result separates "newly late because of this slip" from "already late in the plan".

import { addBusinessDays, businessDaysBetween, maxDate, todayIso } from './dates.js';

export const MAX_SLIP_DAYS = 260;

function buildEdges(issues) {
  const edges = [];
  for (const u of Object.values(issues)) {
    if (u.external) continue;
    for (const d of u.dependents) {
      if (issues[d] && !issues[d].external) edges.push({ from: u.key, to: d, type: 'blocks' });
    }
    if (u.parent && issues[u.parent] && !issues[u.parent].external) {
      edges.push({ from: u.key, to: u.parent, type: 'parent' });
    }
  }
  return edges;
}

function reachableFrom(rootKey, issues, out) {
  const seen = new Set([rootKey]);
  const doneSkipped = new Set();
  const stack = [rootKey];
  while (stack.length) {
    const u = stack.pop();
    for (const e of out.get(u) ?? []) {
      if (seen.has(e.to)) continue;
      if (issues[e.to].done) {
        doneSkipped.add(e.to);
        continue;
      }
      seen.add(e.to);
      stack.push(e.to);
    }
  }
  return { seen, doneSkipped };
}

/** Kahn's algorithm restricted to `nodes`; whatever cannot be ordered sits on or behind a cycle. */
function topoOrder(nodes, edges) {
  const indeg = new Map([...nodes].map((k) => [k, 0]));
  const out = new Map([...nodes].map((k) => [k, []]));
  for (const e of edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    indeg.set(e.to, indeg.get(e.to) + 1);
    out.get(e.from).push(e.to);
  }
  const queue = [...nodes].filter((k) => indeg.get(k) === 0).sort();
  const order = [];
  while (queue.length) {
    const k = queue.shift();
    order.push(k);
    for (const t of out.get(k)) {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  const blocked = [...nodes].filter((k) => !order.includes(k));
  return { order, blocked };
}

function runPass({ order, rootKey, issues, inEdges, fixedBlockers, rootStart, slip, today, defaultDuration }) {
  const finish = new Map();
  const earliest = new Map();
  for (const key of order) {
    if (key === rootKey) {
      finish.set(key, addBusinessDays(rootStart, slip));
      continue;
    }
    const v = issues[key];
    const duration = v.estimateDays ?? defaultDuration;
    let ef = null;
    for (const e of inEdges.get(key) ?? []) {
      if (!finish.has(e.from)) continue;
      ef = maxDate(ef, e.type === 'blocks' ? addBusinessDays(finish.get(e.from), duration) : finish.get(e.from));
    }
    for (const b of fixedBlockers.get(key) ?? []) {
      ef = maxDate(ef, addBusinessDays(maxDate(b.due, today), duration));
    }
    earliest.set(key, ef);
    finish.set(key, maxDate(v.due, ef, today));
  }
  return { finish, earliest };
}

function lateness(due, finish) {
  if (!due || !finish) return null;
  return Math.max(0, businessDaysBetween(due, finish));
}

function classify(node) {
  if (node.key === node.rootKey) return 'root';
  if (!node.due) return 'no-due';
  if (node.delayDays > 0 && node.baselineDelayDays === 0) return 'late';
  if (node.delayDays > node.baselineDelayDays) return 'later';
  if (node.baselineDelayDays > 0) return 'already-late';
  return 'absorbed';
}

/**
 * @param {{rootKey: string, issues: Record<string, object>, truncated?: boolean}} graph  from crawlDownstream
 * @param {number} slipDays  business days the root issue slips
 * @param {{today?: string, defaultDuration?: number}} [options]
 */
export function forecast(graph, slipDays, { today = todayIso(), defaultDuration = 1 } = {}) {
  const slip = Number(slipDays);
  if (!Number.isInteger(slip) || slip < 0 || slip > MAX_SLIP_DAYS) {
    throw new RangeError(`Slip must be a whole number of business days from 0 to ${MAX_SLIP_DAYS}`);
  }
  const { rootKey, issues } = graph;
  const root = issues[rootKey];
  if (!root) throw new RangeError(`Root issue ${rootKey} is not in the graph`);

  const edges = buildEdges(issues);
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
  }

  const base = {
    rootKey,
    slipDays: slip,
    today,
    root: {
      key: root.key,
      summary: root.summary,
      due: root.due,
      done: root.done,
      assignee: root.assignee,
    },
    truncated: Boolean(graph.truncated),
  };

  if (root.done) {
    return {
      ...base,
      rootDone: true,
      nodes: [],
      edges: [],
      releases: [],
      people: [],
      cycles: [],
      externalBlockers: [],
      counts: { downstream: 0, late: 0, later: 0, alreadyLate: 0, absorbed: 0, noDue: 0, releasesAtRisk: 0, doneSkipped: 0 },
    };
  }

  const { seen, doneSkipped } = reachableFrom(rootKey, issues, out);
  const { order, blocked } = topoOrder(seen, edges);
  const cycleSet = new Set(blocked);
  const ordered = new Set(order);

  const inEdges = new Map();
  const liveEdges = edges.filter((e) => ordered.has(e.from) && ordered.has(e.to));
  for (const e of liveEdges) {
    if (!inEdges.has(e.to)) inEdges.set(e.to, []);
    inEdges.get(e.to).push(e);
  }

  // Blockers that are not downstream of the slip keep their own dates.
  const fixedBlockers = new Map();
  const externalBlockers = new Map();
  for (const key of order) {
    if (key === rootKey) continue;
    for (const b of issues[key].blockers) {
      const blocker = issues[b];
      if (!blocker || seen.has(b) || blocker.done || !blocker.due) continue;
      if (!fixedBlockers.has(key)) fixedBlockers.set(key, []);
      fixedBlockers.get(key).push(blocker);
      if (!externalBlockers.has(b)) {
        externalBlockers.set(b, { key: b, summary: blocker.summary, due: blocker.due, assignee: blocker.assignee, blocks: [] });
      }
      externalBlockers.get(b).blocks.push(key);
    }
  }

  const rootStart = maxDate(root.due ?? today, today);
  const pass = (s) => runPass({ order, rootKey, issues, inEdges, fixedBlockers, rootStart, slip: s, today, defaultDuration });
  const before = pass(0);
  const after = pass(slip);

  // Longest-path depth for layout.
  const depth = new Map([[rootKey, 0]]);
  for (const key of order) {
    for (const e of inEdges.get(key) ?? []) {
      depth.set(key, Math.max(depth.get(key) ?? 0, (depth.get(e.from) ?? 0) + 1));
    }
  }

  const nodes = order.map((key) => {
    const v = issues[key];
    const baselineFinish = before.finish.get(key);
    const projectedFinish = after.finish.get(key);
    const earliestBase = before.earliest.get(key) ?? null;
    const node = {
      key,
      rootKey,
      summary: v.summary,
      type: v.type,
      status: v.status,
      statusCategory: v.statusCategory,
      assignee: v.assignee,
      due: v.due,
      estimateDays: v.estimateDays,
      baselineFinish,
      projectedFinish,
      shiftDays: businessDaysBetween(baselineFinish, projectedFinish),
      baselineDelayDays: lateness(v.due, baselineFinish),
      delayDays: lateness(v.due, projectedFinish),
      slackDays: key !== rootKey && v.due && earliestBase ? businessDaysBetween(earliestBase, v.due) : null,
      depth: depth.get(key) ?? 0,
      via: (inEdges.get(key) ?? []).map((e) => ({ key: e.from, type: e.type })),
      fixVersions: v.fixVersions,
    };
    node.state = classify(node);
    delete node.rootKey;
    return node;
  });

  const byKey = new Map(nodes.map((n) => [n.key, n]));

  const versions = new Map();
  for (const n of nodes) {
    for (const fv of n.fixVersions ?? []) {
      if (!fv.releaseDate || fv.released) continue;
      if (!versions.has(fv.id)) versions.set(fv.id, { ...fv, issues: [] });
      versions.get(fv.id).issues.push(n.key);
    }
  }
  const releases = [...versions.values()].map((v) => {
    const latest = (field) => v.issues.reduce((acc, k) => maxDate(acc, byKey.get(k)[field]), null);
    const baselineFinish = latest('baselineFinish');
    const projectedFinish = latest('projectedFinish');
    const driver = v.issues.reduce((a, k) => (byKey.get(k).projectedFinish > byKey.get(a).projectedFinish ? k : a), v.issues[0]);
    const baselineOverrunDays = lateness(v.releaseDate, baselineFinish);
    const overrunDays = lateness(v.releaseDate, projectedFinish);
    let state = 'safe';
    if (overrunDays > 0 && baselineOverrunDays === 0) state = 'newly-at-risk';
    else if (overrunDays > baselineOverrunDays) state = 'worse';
    else if (baselineOverrunDays > 0) state = 'already-at-risk';
    return {
      id: v.id,
      name: v.name,
      releaseDate: v.releaseDate,
      issues: v.issues,
      baselineFinish,
      projectedFinish,
      baselineOverrunDays,
      overrunDays,
      driver,
      state,
    };
  });
  releases.sort((a, b) => b.overrunDays - a.overrunDays || a.releaseDate.localeCompare(b.releaseDate));

  const people = new Map();
  for (const n of nodes) {
    if (n.state !== 'late' && n.state !== 'later') continue;
    const id = n.assignee?.id ?? 'unassigned';
    if (!people.has(id)) people.set(id, { id, name: n.assignee?.name ?? 'Unassigned', issues: [], worstDelayDays: 0 });
    const p = people.get(id);
    p.issues.push(n.key);
    p.worstDelayDays = Math.max(p.worstDelayDays, n.delayDays);
  }

  const downstream = nodes.filter((n) => n.state !== 'root');
  const count = (s) => downstream.filter((n) => n.state === s).length;

  return {
    ...base,
    rootDone: false,
    root: { ...base.root, baselineFinish: before.finish.get(rootKey), projectedFinish: after.finish.get(rootKey) },
    nodes,
    edges: liveEdges.map(({ from, to, type }) => ({ from, to, type })),
    releases,
    people: [...people.values()].sort((a, b) => b.worstDelayDays - a.worstDelayDays || a.name.localeCompare(b.name)),
    cycles: [...cycleSet].sort(),
    externalBlockers: [...externalBlockers.values()],
    counts: {
      downstream: downstream.length,
      late: count('late'),
      later: count('later'),
      alreadyLate: count('already-late'),
      absorbed: count('absorbed'),
      noDue: count('no-due'),
      releasesAtRisk: releases.filter((r) => r.overrunDays > 0).length,
      doneSkipped: doneSkipped.size,
    },
  };
}
