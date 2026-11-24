import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLinkType, normalizeIssue } from '../src/jira/normalize.js';
import { assertIssueKey, searchAll, fetchProjectDependencies } from '../src/jira/crawl.js';
import { createFakeJira } from '../harness/fake-jira.js';
import { sampleProject } from '../harness/sample-project.js';
import { findConflicts } from '../src/core/conflicts.js';

test('link types: blocks and depends-on point the right way', () => {
  assert.deepEqual(classifyLinkType({ name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }), { dependentSide: 'outward', blockerSide: 'inward' });
  assert.deepEqual(classifyLinkType({ name: 'Dependency', inward: 'is depended on by', outward: 'depends on' }), { dependentSide: 'inward', blockerSide: 'outward' });
  assert.equal(classifyLinkType({ name: 'Relates', inward: 'relates to', outward: 'relates to' }), null);
  assert.equal(classifyLinkType({ name: 'Duplicate', inward: 'is duplicated by', outward: 'duplicates' }), null);
});

test('normalizeIssue reads the Jira REST shape', () => {
  const issue = normalizeIssue({
    key: 'APP-9',
    fields: {
      summary: 'Ship it',
      status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
      assignee: { accountId: 'abc', displayName: 'Kim' },
      duedate: '2026-12-01',
      timeoriginalestimate: 3 * 8 * 3600 + 60,
      fixVersions: [{ id: '1', name: 'v1', releaseDate: '2026-12-10', released: false }],
      issuetype: { name: 'Bug' },
      parent: { key: 'APP-1' },
      issuelinks: [
        { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'APP-10' } },
        { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'APP-8' } },
        { type: { name: 'Dependency', inward: 'is depended on by', outward: 'depends on' }, inwardIssue: { key: 'WEB-2' } },
        { type: { name: 'Dependency', inward: 'is depended on by', outward: 'depends on' }, outwardIssue: { key: 'API-4' } },
        { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'APP-99' } },
      ],
    },
  });
  assert.equal(issue.estimateDays, 4); // rounds part days up
  assert.equal(issue.done, false);
  assert.equal(issue.parent, 'APP-1');
  assert.deepEqual(issue.dependents, ['APP-10', 'WEB-2']);
  assert.deepEqual(issue.blockers, ['APP-8', 'API-4']);
  assert.deepEqual(issue.assignee, { id: 'abc', name: 'Kim' });
});

test('issue keys are validated', () => {
  assert.equal(assertIssueKey(' chk-12 '), 'CHK-12');
  assert.throws(() => assertIssueKey('CHK-0'), RangeError);
  assert.throws(() => assertIssueKey('12'), RangeError);
  assert.throws(() => assertIssueKey('CHK-1) OR project = SECRET'), RangeError);
});

test('searchAll follows nextPageToken', async () => {
  const specs = Array.from({ length: 230 }, (_, i) => ({ key: `P-${i + 1}`, summary: `${i}` }));
  const jira = createFakeJira(specs);
  const raw = await searchAll(jira, `key in (${specs.map((s) => s.key).join(', ')})`);
  assert.equal(raw.length, 230);
  assert.equal(jira.calls.length, 3);
});

test('project scan finds plans that already contradict themselves', async () => {
  const today = '2026-11-24';
  const jira = createFakeJira(sampleProject(today));
  const { issues } = await fetchProjectDependencies(jira, 'chk');
  const conflicts = findConflicts(issues, { today });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].blocker.key, 'CHK-31');
  assert.equal(conflicts[0].blocked.key, 'CHK-32');
  assert.equal(conflicts[0].overrunDays, 3);
});

test('child due after its parent is a conflict', () => {
  const issues = {
    'E-1': normalizeIssue({ key: 'E-1', fields: { summary: 'epic', duedate: '2026-12-01', status: { statusCategory: { key: 'new' } } } }),
    'E-2': normalizeIssue({ key: 'E-2', fields: { summary: 'story', duedate: '2026-12-03', parent: { key: 'E-1' }, status: { statusCategory: { key: 'new' } } } }),
  };
  const [c] = findConflicts(issues, { today: '2026-11-24' });
  assert.equal(c.kind, 'child-after-parent');
  assert.equal(c.overrunDays, 2);
});
