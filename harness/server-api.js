// Local preview backend: the real handlers from src/handlers.js, wired to the
// in-memory Jira with the sample project instead of the Forge Jira API.

import { createHandlers } from '../src/handlers.js';
import { createFakeJira } from './fake-jira.js';
import { sampleProject } from './sample-project.js';
import { todayIso } from '../src/core/dates.js';

export function createHarness({ today = todayIso() } = {}) {
  const jira = createFakeJira(sampleProject(today));
  const handlers = createHandlers({ jira, today: () => today });

  return {
    jira,
    async handle(url, data) {
      const path = url.split('?')[0];
      if (path === '/invoke') {
        const { fn, payload = {}, issueKey } = data;
        // On Forge the issue key comes from the panel's context, not the payload.
        if (fn === 'loadGraph') return handlers.loadGraph({ issueKey });
        if (fn === 'postImpactComment') return handlers.postImpactComment({ issueKey, slipDays: payload.slipDays });
        return { ok: false, error: `Unknown resolver function ${fn}` };
      }
      if (path === '/action') {
        const { action, payload = {} } = data;
        if (action === 'forecast-slip-impact') return { ok: true, text: await handlers.forecastSlipImpact(payload) };
        if (action === 'find-schedule-conflicts') return { ok: true, text: await handlers.findScheduleConflicts(payload) };
        return { ok: false, error: `Unknown action ${action}` };
      }
      if (path === '/comments') return { ok: true, comments: jira.comments };
      return { ok: false, error: `Unknown harness path ${path}` };
    },
  };
}
