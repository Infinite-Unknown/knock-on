// An in-memory stand-in for the two Jira Cloud REST calls the app makes
// (POST /rest/api/3/search/jql and POST /rest/api/3/issue/{key}/comment).
// Used by the tests and the local preview; on Forge the real API is used.

const pick = (issue) => ({
  key: issue.key,
  fields: { summary: issue.fields.summary, status: issue.fields.status, priority: issue.fields.priority, issuetype: issue.fields.issuetype },
});

/**
 * @param {Array<object>} specs  [{ key, summary, status: 'new'|'indeterminate'|'done', assignee, due, estimateDays,
 *                                  fixVersions, parent, blocks: [keys], type }]
 */
export function createFakeJira(specs) {
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const comments = [];
  const calls = [];

  function toRaw(s) {
    const issuelinks = [];
    for (const target of s.blocks ?? []) {
      issuelinks.push({ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: pick(toLite(target)) });
    }
    for (const other of specs) {
      if ((other.blocks ?? []).includes(s.key)) {
        issuelinks.push({ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: pick(toLite(other.key)) });
      }
    }
    const statusName = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' }[s.status ?? 'new'];
    return {
      key: s.key,
      fields: {
        summary: s.summary,
        status: { name: s.statusName ?? statusName, statusCategory: { key: s.status ?? 'new' } },
        assignee: s.assignee ? { accountId: `acc-${s.assignee.toLowerCase().replace(/\W+/g, '-')}`, displayName: s.assignee } : null,
        duedate: s.due ?? null,
        timeoriginalestimate: s.estimateDays ? s.estimateDays * 8 * 3600 : null,
        fixVersions: s.fixVersions ?? [],
        issuetype: { name: s.type ?? 'Story' },
        priority: { name: s.priority ?? 'Medium' },
        parent: s.parent ? { key: s.parent } : undefined,
        issuelinks,
      },
    };
  }

  function toLite(key) {
    const s = byKey.get(key);
    return { key, fields: { summary: s?.summary ?? key, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Story' } } };
  }

  function matches(jql, s) {
    const keyIn = jql.match(/key in \(([^)]*)\)/i);
    if (keyIn) return keyIn[1].split(',').map((k) => k.trim()).includes(s.key);
    const project = jql.match(/project = "?([A-Z0-9_]+)"?/i);
    if (project) {
      const linked = (s.blocks ?? []).length > 0 || specs.some((o) => (o.blocks ?? []).includes(s.key));
      return s.key.startsWith(`${project[1]}-`) && s.status !== 'done' && linked;
    }
    throw new Error(`fake Jira cannot run JQL: ${jql}`);
  }

  return {
    calls,
    comments,
    async searchJql({ jql, maxResults = 50, nextPageToken }) {
      calls.push({ op: 'searchJql', jql });
      const all = specs.filter((s) => matches(jql, s));
      const start = nextPageToken ? Number(nextPageToken) : 0;
      const page = all.slice(start, start + maxResults);
      const isLast = start + maxResults >= all.length;
      return { issues: page.map(toRaw), isLast, ...(isLast ? {} : { nextPageToken: String(start + maxResults) }) };
    },
    async addComment(issueKey, body) {
      calls.push({ op: 'addComment', issueKey });
      if (!byKey.has(issueKey)) {
        const err = new Error('Issue does not exist');
        err.status = 404;
        throw err;
      }
      const comment = { id: String(10000 + comments.length), issueKey, body };
      comments.push(comment);
      return comment;
    },
  };
}
