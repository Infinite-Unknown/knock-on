// App logic with the Jira adapter injected, so the same code runs on Forge
// (src/index.js) and in tests / the local preview (harness/).

import { crawlDownstream, fetchProjectDependencies, assertIssueKey, NotFoundError } from './jira/crawl.js';
import { forecast, MAX_SLIP_DAYS } from './core/forecast.js';
import { findConflicts } from './core/conflicts.js';
import { summaryText, conflictsText, toAdf, headline } from './core/report.js';
import { todayIso } from './core/dates.js';

export function parseSlip(value, fallback = 5) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number.parseInt(`${value}`.replace(/[^0-9-]/g, ''), 10);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SLIP_DAYS) {
    throw new RangeError(`Slip must be a whole number of business days from 0 to ${MAX_SLIP_DAYS}`);
  }
  return n;
}

function friendly(error) {
  if (error instanceof RangeError || error instanceof NotFoundError) return error.message;
  if (error?.status === 401 || error?.status === 403) return 'Jira refused the request: you may not have permission to browse these issues.';
  return `Something went wrong while reading Jira (${error?.message ?? error}).`;
}

export function createHandlers({ jira, today = () => todayIso(), maxIssues = 80 }) {
  async function loadGraph(issueKey) {
    return crawlDownstream(jira, issueKey, { maxIssues });
  }

  return {
    /** Issue panel: crawl once, the panel re-forecasts locally as the slip changes. */
    async loadGraph({ issueKey }) {
      try {
        const graph = await loadGraph(issueKey);
        return { ok: true, graph, today: today() };
      } catch (error) {
        return { ok: false, error: friendly(error) };
      }
    },

    /** Issue panel: re-run the forecast server-side and post it as a comment on the issue. */
    async postImpactComment({ issueKey, slipDays }) {
      try {
        const key = assertIssueKey(issueKey);
        const graph = await loadGraph(key);
        const result = forecast(graph, parseSlip(slipDays), { today: today() });
        const comment = await jira.addComment(key, toAdf(result));
        return { ok: true, commentId: comment?.id ?? null, headline: headline(result) };
      } catch (error) {
        return { ok: false, error: friendly(error) };
      }
    },

    /** Rovo action / MCP tool: forecast-slip-impact. */
    async forecastSlipImpact(payload = {}) {
      try {
        const key = assertIssueKey(payload.issueKey ?? payload.context?.jira?.issueKey);
        const graph = await loadGraph(key);
        const result = forecast(graph, parseSlip(payload.slipDays), { today: today() });
        return summaryText(result);
      } catch (error) {
        return `Knock-On could not forecast: ${friendly(error)}`;
      }
    },

    /** Rovo action / MCP tool: find-schedule-conflicts. */
    async findScheduleConflicts(payload = {}) {
      try {
        const projectKey = payload.projectKey ?? payload.context?.jira?.projectKey ?? `${payload.context?.jira?.issueKey ?? ''}`.split('-')[0];
        const { project, issues, truncated } = await fetchProjectDependencies(jira, projectKey);
        return conflictsText(project, findConflicts(issues, { today: today() }), { truncated });
      } catch (error) {
        return `Knock-On could not scan the project: ${friendly(error)}`;
      }
    },
  };
}
