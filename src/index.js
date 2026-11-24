// Forge entry points: wires the Jira REST API (as the current user) into the handlers.

import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { createHandlers } from './handlers.js';

class JiraError extends Error {
  constructor(status, body) {
    super(`Jira returned ${status}: ${`${body}`.slice(0, 200)}`);
    this.status = status;
  }
}

async function readJson(response) {
  if (!response.ok) throw new JiraError(response.status, await response.text());
  return response.status === 204 ? null : response.json();
}

const jira = {
  async searchJql({ jql, fields, maxResults, nextPageToken }) {
    const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, maxResults, ...(nextPageToken ? { nextPageToken } : {}) }),
    });
    return readJson(response);
  },
  async addComment(issueKey, body) {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    return readJson(response);
  },
};

const handlers = createHandlers({ jira });

const resolver = new Resolver();

resolver.define('loadGraph', ({ context }) => handlers.loadGraph({ issueKey: context.extension.issue.key }));

resolver.define('postImpactComment', ({ payload, context }) =>
  handlers.postImpactComment({ issueKey: context.extension.issue.key, slipDays: payload?.slipDays }),
);

export const handler = resolver.getDefinitions();

export async function forecastAction(payload) {
  return handlers.forecastSlipImpact(payload);
}

export async function conflictsAction(payload) {
  return handlers.findScheduleConflicts(payload);
}
