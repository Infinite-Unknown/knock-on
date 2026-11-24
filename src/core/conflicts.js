// Finds dependencies whose dates already contradict each other in the plan,
// before anything slips: a blocker due after the work it blocks can start,
// or a child issue due after its parent.

import { addBusinessDays, businessDaysBetween, maxDate, todayIso } from './dates.js';

export function findConflicts(issues, { today = todayIso(), defaultDuration = 1 } = {}) {
  const conflicts = [];
  for (const u of Object.values(issues)) {
    if (u.done || !u.due) continue;
    const blockerFinish = maxDate(u.due, today);
    for (const k of u.dependents) {
      const v = issues[k];
      if (!v || v.done || !v.due) continue;
      const duration = v.estimateDays ?? defaultDuration;
      const earliest = addBusinessDays(blockerFinish, duration);
      const overrun = businessDaysBetween(v.due, earliest);
      if (overrun > 0) {
        conflicts.push({
          kind: u.due < today ? 'overdue-blocker' : 'blocker-too-late',
          blocker: { key: u.key, summary: u.summary, due: u.due, assignee: u.assignee },
          blocked: { key: v.key, summary: v.summary, due: v.due, assignee: v.assignee, estimateDays: duration },
          earliestFinish: earliest,
          overrunDays: overrun,
        });
      }
    }
    const p = u.parent ? issues[u.parent] : null;
    if (p && !p.done && p.due) {
      const overrun = businessDaysBetween(p.due, blockerFinish);
      if (overrun > 0) {
        conflicts.push({
          kind: 'child-after-parent',
          blocker: { key: u.key, summary: u.summary, due: u.due, assignee: u.assignee },
          blocked: { key: p.key, summary: p.summary, due: p.due, assignee: p.assignee, estimateDays: 0 },
          earliestFinish: blockerFinish,
          overrunDays: overrun,
        });
      }
    }
  }
  return conflicts.sort((a, b) => b.overrunDays - a.overrunDays || a.blocked.key.localeCompare(b.blocked.key));
}
