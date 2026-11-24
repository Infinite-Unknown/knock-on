// Walks the Jira dependency graph downstream of one issue.
// `jira` is a small adapter: { searchJql({ jql, fields, maxResults, nextPageToken }) }.

import { ISSUE_FIELDS, normalizeIssue } from './normalize.js';

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,254}-[1-9]\d*$/;
export const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,254}$/;
const BATCH = 50;

export class NotFoundError extends Error {}

export function assertIssueKey(key) {
  const k = `${key ?? ''}`.trim().toUpperCase();
  if (!ISSUE_KEY.test(k)) throw new RangeError(`"${key}" is not a Jira issue key like ABC-123`);
  return k;
}

export async function searchAll(jira, jql, { limit = 500 } = {}) {
  const out = [];
  let nextPageToken;
  do {
    const page = await jira.searchJql({ jql, fields: ISSUE_FIELDS, maxResults: 100, nextPageToken });
    out.push(...(page.issues ?? []));
    nextPageToken = page.isLast === true ? undefined : page.nextPageToken;
  } while (nextPageToken && out.length < limit);
  return out.slice(0, limit);
}

export async function fetchByKeys(jira, keys) {
  const found = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH);
    const raw = await searchAll(jira, `key in (${chunk.join(', ')})`);
    found.push(...raw.map(normalizeIssue));
  }
  return found;
}

/**
 * Breadth-first walk from rootKey along "depends on me" edges: issues this one
 * blocks, and its parent (a parent finishes only when its children do).
 * Then one extra fetch of the other blockers of everything found, so the
 * forecast knows their due dates too.
 * Returns { rootKey, issues: { [key]: issue }, external: [keys], truncated }.
 */
export async function crawlDownstream(jira, rootKey, { maxIssues = 80 } = {}) {
  const key = assertIssueKey(rootKey);
  const issues = new Map();
  let frontier = [key];
  let truncated = false;

  while (frontier.length > 0) {
    const room = maxIssues - issues.size;
    if (room <= 0) {
      truncated = true;
      break;
    }
    const batch = frontier.slice(0, room);
    if (batch.length < frontier.length) truncated = true;
    const fetched = await fetchByKeys(jira, batch);
    for (const issue of fetched) issues.set(issue.key, issue);
    if (!issues.has(key)) throw new NotFoundError(`Issue ${key} was not found, or you do not have permission to see it.`);

    const next = new Set();
    for (const issue of fetched) {
      if (issue.done && issue.key !== key) continue; // finished work does not pass a slip on
      for (const dep of issue.dependents) if (!issues.has(dep)) next.add(dep);
      if (issue.parent && !issues.has(issue.parent)) next.add(issue.parent);
    }
    frontier = [...next];
  }

  // Other blockers of downstream work: fetched once, not walked further.
  const external = new Set();
  for (const issue of issues.values()) {
    if (issue.key === key) continue;
    for (const b of issue.blockers) if (!issues.has(b)) external.add(b);
  }
  const externalKeys = [...external].slice(0, 50);
  if (external.size > externalKeys.length) truncated = true;
  if (externalKeys.length > 0) {
    for (const issue of await fetchByKeys(jira, externalKeys)) {
      issues.set(issue.key, { ...issue, external: true });
    }
  }

  return {
    rootKey: key,
    issues: Object.fromEntries(issues),
    external: externalKeys.filter((k) => issues.has(k)),
    truncated,
  };
}

/** Issues in a project that take part in a blocking relationship, plus the linked issues outside the result. */
export async function fetchProjectDependencies(jira, projectKey, { limit = 300 } = {}) {
  const project = `${projectKey ?? ''}`.trim().toUpperCase();
  if (!PROJECT_KEY.test(project)) throw new RangeError(`"${projectKey}" is not a Jira project key like ABC`);
  const raw = await searchAll(
    jira,
    `project = "${project}" AND statusCategory != Done AND issueLinkType in (blocks, "is blocked by", "depends on", "is depended on by") ORDER BY duedate ASC`,
    { limit },
  );
  const issues = new Map(raw.map((r) => [r.key, normalizeIssue(r)]));
  const missing = new Set();
  for (const issue of issues.values()) {
    for (const k of [...issue.dependents, ...issue.blockers, issue.parent]) if (k && !issues.has(k)) missing.add(k);
  }
  const extra = [...missing].slice(0, 100);
  for (const issue of await fetchByKeys(jira, extra)) issues.set(issue.key, issue);
  return { project, issues: Object.fromEntries(issues), truncated: raw.length >= limit || missing.size > extra.length };
}
