// Human-readable output for the Rovo action, the MCP tools and the Jira comment.

import { formatShort } from './dates.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bd = (n) => `${n} business ${n === 1 ? 'day' : 'days'}`;

export function headline(result) {
  const { root, slipDays, counts } = result;
  if (result.rootDone) return `${root.key} is already done, so a slip cannot affect anything downstream.`;
  if (counts.downstream === 0) return `Nothing in Jira depends on ${root.key}, so a ${bd(slipDays)} slip stays contained.`;
  const broken = counts.late + counts.later;
  if (broken === 0 && counts.releasesAtRisk === 0) {
    return `If ${root.key} slips ${bd(slipDays)}, ${counts.downstream === 1 ? 'the one downstream issue still makes its' : `all ${counts.downstream} downstream issues still make their`} due date${counts.downstream === 1 ? '' : 's'}.`;
  }
  const parts = [`If ${root.key} slips ${bd(slipDays)}, ${broken} of ${plural(counts.downstream, 'downstream issue')} ${broken === 1 ? 'misses its' : 'miss their'} due date`];
  if (counts.releasesAtRisk > 0) parts.push(`${plural(counts.releasesAtRisk, 'release')} ${counts.releasesAtRisk === 1 ? 'is' : 'are'} at risk`);
  return `${parts.join(' and ')}.`;
}

export function summaryText(result) {
  const lines = [headline(result)];
  if (result.rootDone || result.counts.downstream === 0) return lines.join('\n');
  const { nodes, releases, people, cycles, counts } = result;
  const root = nodes.find((n) => n.state === 'root');
  lines.push(`${root.key} would now finish ${formatShort(root.projectedFinish)}${root.due ? ` (due ${formatShort(root.due)})` : ''}.`);

  const hit = nodes.filter((n) => n.state === 'late' || n.state === 'later');
  if (hit.length) {
    lines.push('', 'Due dates that break:');
    for (const n of hit) {
      const who = n.assignee?.name ?? 'Unassigned';
      const extra = n.state === 'later' ? ` (already ${n.baselineDelayDays} late, now ${n.delayDays})` : '';
      lines.push(`- ${n.key} ${n.summary} - due ${formatShort(n.due)}, now ${formatShort(n.projectedFinish)}: +${bd(n.delayDays)}${extra} [${who}]`);
    }
  }
  const risky = releases.filter((r) => r.overrunDays > 0);
  if (risky.length) {
    lines.push('', 'Releases at risk:');
    for (const r of risky) {
      lines.push(`- ${r.name} (release ${formatShort(r.releaseDate)}): last issue lands ${formatShort(r.projectedFinish)}, +${bd(r.overrunDays)}; driven by ${r.driver}${r.state === 'already-at-risk' ? ' (already at risk before this slip)' : ''}`);
    }
  }
  const absorbed = nodes.filter((n) => n.state === 'absorbed');
  if (absorbed.length) lines.push('', `Absorbed by slack: ${absorbed.map((n) => n.key).join(', ')}.`);
  const alreadyLate = nodes.filter((n) => n.state === 'already-late');
  if (alreadyLate.length) lines.push(`Already late before this slip (unchanged): ${alreadyLate.map((n) => n.key).join(', ')}.`);
  const noDue = nodes.filter((n) => n.state === 'no-due');
  if (noDue.length) lines.push(`No due date, so cannot judge: ${noDue.map((n) => `${n.key} (moves ${n.shiftDays} days)`).join(', ')}.`);
  if (people.length) lines.push('', `People to tell: ${people.map((p) => `${p.name} (${p.issues.join(', ')})`).join('; ')}.`);
  if (cycles.length) lines.push('', `Dependency loop found, not forecast: ${cycles.join(', ')}.`);
  if (result.truncated) lines.push('', 'Note: the dependency graph was larger than the crawl limit; the forecast covers the first part only.');
  if (counts.doneSkipped) lines.push(`${plural(counts.doneSkipped, 'finished issue')} downstream ignored.`);
  return lines.join('\n');
}

export function conflictsText(project, conflicts, { truncated = false } = {}) {
  if (conflicts.length === 0) return `No schedule conflicts found in ${project}: every blocker is due in time for the work it blocks.`;
  const lines = [`${plural(conflicts.length, 'schedule conflict')} in ${project} before anything slips:`];
  for (const c of conflicts) {
    const what =
      c.kind === 'child-after-parent'
        ? `${c.blocker.key} is due ${formatShort(c.blocker.due)}, after its parent ${c.blocked.key} (due ${formatShort(c.blocked.due)})`
        : `${c.blocker.key} (due ${formatShort(c.blocker.due)}${c.kind === 'overdue-blocker' ? ', overdue' : ''}) blocks ${c.blocked.key} (due ${formatShort(c.blocked.due)}, needs ${bd(c.blocked.estimateDays)})`;
    lines.push(`- ${what}: ${bd(c.overrunDays)} short`);
  }
  if (truncated) lines.push('Note: large project, only the first part was scanned.');
  return lines.join('\n');
}

// Atlassian Document Format for a Jira comment.
const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const strong = [{ type: 'strong' }];
const para = (...content) => ({ type: 'paragraph', content });
const bullets = (items) => ({
  type: 'bulletList',
  content: items.map((content) => ({ type: 'listItem', content: [para(...content)] })),
});

export function toAdf(result) {
  const content = [para(text('Knock-On forecast: ', strong), text(headline(result)))];
  if (!result.rootDone && result.counts.downstream > 0) {
    const hit = result.nodes.filter((n) => n.state === 'late' || n.state === 'later');
    if (hit.length) {
      content.push(para(text('Due dates that break', strong)));
      content.push(
        bullets(
          hit.map((n) => [
            text(n.key, strong),
            text(` ${n.summary} - due ${formatShort(n.due)}, now ${formatShort(n.projectedFinish)} (+${bd(n.delayDays)}), ${n.assignee?.name ?? 'Unassigned'}`),
          ]),
        ),
      );
    }
    const risky = result.releases.filter((r) => r.overrunDays > 0);
    if (risky.length) {
      content.push(para(text('Releases at risk', strong)));
      content.push(
        bullets(risky.map((r) => [text(r.name, strong), text(` - release ${formatShort(r.releaseDate)}, last issue lands ${formatShort(r.projectedFinish)} (+${bd(r.overrunDays)})`)])),
      );
    }
    const absorbed = result.nodes.filter((n) => n.state === 'absorbed').map((n) => n.key);
    if (absorbed.length) content.push(para(text(`Absorbed by slack: ${absorbed.join(', ')}.`)));
  }
  content.push(para(text(`Forecast in business days on ${formatShort(result.today)}. Durations come from original estimates (1 day if none).`, [{ type: 'em' }])));
  return { type: 'doc', version: 1, content };
}
