// Turns raw Jira Cloud REST issues into the small shape the forecaster needs.

export const ISSUE_FIELDS = [
  'summary',
  'status',
  'assignee',
  'duedate',
  'timeoriginalestimate',
  'fixVersions',
  'issuetype',
  'priority',
  'parent',
  'issuelinks',
];

const WORKDAY_SECONDS = 8 * 60 * 60;

/**
 * Which side of a link depends on which.
 * "Blocks"   (outward "blocks"):      this --blocks--> outwardIssue, so outwardIssue depends on this.
 * "Depends"  (outward "depends on"):  this depends on outwardIssue, so inwardIssue depends on this.
 * Returns { dependentSide, blockerSide } as 'outward' | 'inward', or null for unrelated link types.
 */
export function classifyLinkType(type = {}) {
  const outward = `${type.outward ?? ''}`.toLowerCase();
  const inward = `${type.inward ?? ''}`.toLowerCase();
  const name = `${type.name ?? ''}`.toLowerCase();
  if (outward.includes('depends on') || inward.includes('is depended on')) {
    return { dependentSide: 'inward', blockerSide: 'outward' };
  }
  if (outward.includes('block') || inward.includes('blocked by') || name === 'blocks') {
    return { dependentSide: 'outward', blockerSide: 'inward' };
  }
  return null;
}

function estimateToDays(seconds) {
  if (typeof seconds !== 'number' || seconds <= 0) return null;
  return Math.max(1, Math.ceil(seconds / WORKDAY_SECONDS));
}

export function normalizeIssue(raw) {
  const f = raw.fields ?? {};
  const dependents = [];
  const blockers = [];
  for (const link of f.issuelinks ?? []) {
    const kind = classifyLinkType(link.type);
    if (!kind) continue;
    const outwardKey = link.outwardIssue?.key;
    const inwardKey = link.inwardIssue?.key;
    if (outwardKey) (kind.dependentSide === 'outward' ? dependents : blockers).push(outwardKey);
    if (inwardKey) (kind.dependentSide === 'inward' ? dependents : blockers).push(inwardKey);
  }
  const statusCategory = f.status?.statusCategory?.key ?? 'new';
  return {
    key: raw.key,
    project: raw.key.split('-')[0],
    summary: f.summary ?? '',
    type: f.issuetype?.name ?? 'Issue',
    priority: f.priority?.name ?? null,
    status: f.status?.name ?? 'Unknown',
    statusCategory,
    done: statusCategory === 'done',
    assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName } : null,
    due: f.duedate ?? null,
    estimateDays: estimateToDays(f.timeoriginalestimate),
    fixVersions: (f.fixVersions ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      releaseDate: v.releaseDate ?? null,
      released: Boolean(v.released),
    })),
    parent: f.parent?.key ?? null,
    dependents: [...new Set(dependents)],
    blockers: [...new Set(blockers)],
  };
}
