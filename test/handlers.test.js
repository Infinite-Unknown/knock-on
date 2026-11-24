import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, parseSlip } from '../src/handlers.js';
import { createFakeJira } from '../harness/fake-jira.js';
import { sampleProject } from '../harness/sample-project.js';

const TODAY = '2026-11-24';
const setup = () => {
  const jira = createFakeJira(sampleProject(TODAY));
  return { jira, h: createHandlers({ jira, today: () => TODAY }) };
};

test('Rovo action: forecast-slip-impact returns a readable summary', async () => {
  const { h } = setup();
  const text = await h.forecastSlipImpact({ issueKey: 'CHK-12', slipDays: 3 });
  assert.match(text, /^If CHK-12 slips 3 business days, 4 of 7 downstream issues miss their due date and 1 release is at risk\./);
  assert.match(text, /CHK-24 Beta rollout to 5% of traffic — due Dec 11, now Dec 15: \+2 business days \[Dev Patel\]/);
  assert.match(text, /Checkout 2.0 \(release Dec 14\): last issue lands Dec 15, \+1 business day; driven by CHK-24/);
  assert.match(text, /Absorbed by slack: CHK-22, CHK-10\./);
  assert.match(text, /OPS-7 \(moves 2 days\)/);
});

test('Rovo action: falls back to the issue in context and reports bad input', async () => {
  const { h } = setup();
  const text = await h.forecastSlipImpact({ slipDays: '5 days', context: { jira: { issueKey: 'CHK-12' } } });
  assert.match(text, /^If CHK-12 slips 5 business days/);
  assert.match(await h.forecastSlipImpact({ issueKey: 'nope', slipDays: 2 }), /not a Jira issue key/);
  assert.match(await h.forecastSlipImpact({ issueKey: 'CHK-999', slipDays: 2 }), /was not found/);
});

test('Rovo action: find-schedule-conflicts', async () => {
  const { h } = setup();
  const text = await h.findScheduleConflicts({ projectKey: 'CHK' });
  assert.match(text, /1 schedule conflict in CHK/);
  assert.match(text, /CHK-31 \(due Dec 9\) blocks CHK-32 \(due Dec 8, needs 2 business days\): 3 business days short/);
});

test('panel: loadGraph then postImpactComment writes an ADF comment', async () => {
  const { h, jira } = setup();
  const loaded = await h.loadGraph({ issueKey: 'CHK-12' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.today, TODAY);
  const posted = await h.postImpactComment({ issueKey: 'CHK-12', slipDays: 3 });
  assert.equal(posted.ok, true);
  assert.equal(jira.comments.length, 1);
  const { body } = jira.comments[0];
  assert.equal(body.type, 'doc');
  assert.equal(body.version, 1);
  const flat = JSON.stringify(body);
  assert.match(flat, /Knock-On forecast/);
  assert.match(flat, /Releases at risk/);
});

test('panel: errors come back as messages, not exceptions', async () => {
  const { h } = setup();
  const r = await h.postImpactComment({ issueKey: 'CHK-12', slipDays: 1000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /from 0 to 260/);
});

test('parseSlip', () => {
  assert.equal(parseSlip(undefined), 5);
  assert.equal(parseSlip('3'), 3);
  assert.equal(parseSlip('a week: 5'), 5);
  assert.throws(() => parseSlip(-2), RangeError);
});
