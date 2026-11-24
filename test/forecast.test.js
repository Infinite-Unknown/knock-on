import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeJira } from '../harness/fake-jira.js';
import { sampleProject } from '../harness/sample-project.js';
import { crawlDownstream } from '../src/jira/crawl.js';
import { forecast } from '../src/core/forecast.js';
import { addBusinessDays } from '../src/core/dates.js';

const TODAY = '2026-11-24'; // a Tuesday
const d = (n) => addBusinessDays(TODAY, n);

async function sampleGraph(mutate = (s) => s) {
  const jira = createFakeJira(mutate(sampleProject(TODAY)));
  return crawlDownstream(jira, 'CHK-12');
}

const byKey = (result) => Object.fromEntries(result.nodes.map((n) => [n.key, n]));

test('crawl walks blocks links and parents, and fetches outside blockers once', async () => {
  const graph = await sampleGraph();
  assert.deepEqual(Object.keys(graph.issues).sort(), ['CHK-10', 'CHK-12', 'CHK-15', 'CHK-18', 'CHK-21', 'CHK-22', 'CHK-24', 'CHK-27', 'OPS-7']);
  assert.deepEqual(graph.external, ['CHK-27']);
  assert.equal(graph.truncated, false);
});

test('slip of 0 is the plan as it stands: nothing breaks', async () => {
  const r = forecast(await sampleGraph(), 0, { today: TODAY });
  assert.equal(r.counts.late, 0);
  assert.equal(r.counts.releasesAtRisk, 0);
  assert.equal(r.counts.downstream, 7);
});

test('slip of 3 business days breaks the chain and the release', async () => {
  const r = forecast(await sampleGraph(), 3, { today: TODAY });
  const n = byKey(r);
  assert.equal(n['CHK-12'].projectedFinish, d(9));
  assert.equal(n['CHK-15'].projectedFinish, d(11));
  assert.equal(n['CHK-15'].delayDays, 2);
  assert.equal(n['CHK-15'].slackDays, 1);
  assert.equal(n['CHK-18'].delayDays, 2);
  assert.equal(n['CHK-21'].projectedFinish, d(14));
  assert.equal(n['CHK-21'].delayDays, 2);
  assert.equal(n['CHK-24'].delayDays, 2);
  for (const k of ['CHK-15', 'CHK-18', 'CHK-21', 'CHK-24']) assert.equal(n[k].state, 'late', k);

  // CHK-22 waits for CHK-27 (not downstream) anyway, so the slip is absorbed.
  assert.equal(n['CHK-22'].state, 'absorbed');
  assert.equal(n['CHK-22'].slackDays, 1);
  assert.deepEqual(r.externalBlockers.map((b) => b.key), ['CHK-27']);

  // Epic finishes when its children do; still inside its due date.
  assert.equal(n['CHK-10'].state, 'absorbed');
  assert.equal(n['OPS-7'].state, 'no-due');
  assert.equal(n['OPS-7'].shiftDays, 2);

  assert.equal(r.counts.late, 4);
  assert.equal(r.counts.absorbed, 2);
  assert.equal(r.counts.noDue, 1);

  const [release] = r.releases;
  assert.equal(release.name, 'Checkout 2.0');
  assert.equal(release.state, 'newly-at-risk');
  assert.equal(release.overrunDays, 1);
  assert.equal(release.driver, 'CHK-24');

  assert.deepEqual(r.people.map((p) => p.name), ['Dev Patel', 'Lena Fischer', 'Marco Bianchi', 'Priya Raman']);
  assert.ok(r.edges.some((e) => e.from === 'CHK-24' && e.to === 'CHK-10' && e.type === 'parent'));
  assert.equal(n['CHK-24'].depth, 3);
});

test('a bigger slip reaches the epic too', async () => {
  const r = forecast(await sampleGraph(), 5, { today: TODAY });
  const n = byKey(r);
  assert.equal(n['CHK-10'].state, 'late');
  assert.equal(n['CHK-10'].delayDays, 1);
  assert.equal(r.releases[0].overrunDays, 3);
});

test('work already late in the plan is reported separately', async () => {
  const graph = await sampleGraph((specs) =>
    specs.map((s) => (s.key === 'CHK-24' ? { ...s, due: d(11) } : s)),
  );
  const zero = byKey(forecast(graph, 0, { today: TODAY }));
  assert.equal(zero['CHK-24'].state, 'already-late');
  assert.equal(zero['CHK-24'].baselineDelayDays, 2);
  const three = byKey(forecast(graph, 3, { today: TODAY }));
  assert.equal(three['CHK-24'].state, 'later');
  assert.equal(three['CHK-24'].delayDays, 4);
});

test('finished downstream work stops the ripple', async () => {
  const graph = await sampleGraph((specs) => specs.map((s) => (s.key === 'CHK-15' ? { ...s, status: 'done' } : s)));
  const r = forecast(graph, 3, { today: TODAY });
  const keys = r.nodes.map((n) => n.key);
  assert.ok(!keys.includes('CHK-15'));
  assert.ok(!keys.includes('CHK-22'));
  assert.ok(keys.includes('CHK-21')); // still reached through CHK-18
  assert.equal(r.counts.doneSkipped, 1);
});

test('done root issue cannot slip', async () => {
  const graph = await sampleGraph((specs) => specs.map((s) => (s.key === 'CHK-12' ? { ...s, status: 'done' } : s)));
  const r = forecast(graph, 3, { today: TODAY });
  assert.equal(r.rootDone, true);
  assert.equal(r.nodes.length, 0);
});

test('overdue root starts from today', async () => {
  const graph = await sampleGraph((specs) => specs.map((s) => (s.key === 'CHK-12' ? { ...s, due: '2026-11-20' } : s)));
  const r = forecast(graph, 2, { today: TODAY });
  assert.equal(byKey(r)['CHK-12'].projectedFinish, d(2));
});

test('dependency loops are reported, not forecast', async () => {
  const jira = createFakeJira([
    { key: 'A-1', summary: 'a', due: d(3), blocks: ['A-2'] },
    { key: 'A-2', summary: 'b', due: d(5), blocks: ['A-3'] },
    { key: 'A-3', summary: 'c', due: d(7), blocks: ['A-2'] },
  ]);
  const r = forecast(await crawlDownstream(jira, 'A-1'), 1, { today: TODAY });
  assert.deepEqual(r.cycles, ['A-2', 'A-3']);
  assert.deepEqual(r.nodes.map((n) => n.key), ['A-1']);
});

test('crawl stops at the issue limit and says so', async () => {
  const specs = Array.from({ length: 120 }, (_, i) => ({ key: `L-${i + 1}`, summary: `step ${i + 1}`, due: d(i + 1), blocks: i < 119 ? [`L-${i + 2}`] : [] }));
  const graph = await crawlDownstream(createFakeJira(specs), 'L-1', { maxIssues: 80 });
  assert.equal(graph.truncated, true);
  assert.equal(Object.values(graph.issues).filter((i) => !i.external).length, 80);
  const r = forecast(graph, 1, { today: TODAY });
  assert.equal(r.truncated, true);
});

test('isolated issue has nothing downstream', async () => {
  const graph = await crawlDownstream(createFakeJira(sampleProject(TODAY)), 'CHK-30');
  const r = forecast(graph, 10, { today: TODAY });
  assert.equal(r.counts.downstream, 0);
});

test('rejects bad slip values', async () => {
  const graph = await sampleGraph();
  assert.throws(() => forecast(graph, -1), RangeError);
  assert.throws(() => forecast(graph, 2.5), RangeError);
  assert.throws(() => forecast(graph, 999), RangeError);
});
