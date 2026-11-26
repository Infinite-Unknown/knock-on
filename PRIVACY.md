# Knock-On - Privacy Policy

Last updated: 26 November 2026

Knock-On is an Atlassian Forge app for Jira. It forecasts how a slipped issue pushes back the issues that depend on it.

## What data the app reads

When you open the Knock-On panel, run a forecast, or ask the Rovo agent or MCP tools, the app reads Jira issues through the Jira API, acting as you. It can only see issues you can already browse. It reads these fields: summary, status, assignee (account ID and display name), due date, original estimate, fix versions, issue type, priority, parent and issue links.

## What data the app stores

None. Knock-On has no database and uses no Forge storage. Each forecast is worked out in memory for that one request and then thrown away.

The only thing the app writes is a forecast comment on an issue, and only when you click the button to post it. That comment is stored by Jira like any comment you write yourself.

## Where data goes

Knock-On sends no data outside Atlassian. It makes no calls to outside servers.

If you use the Rovo agent or connect an MCP client, the forecast text is returned to that tool, because you asked for it there.

## Logs and retention

The app does not log personal data. It keeps no data between requests.

## Contact

Questions: open an issue at https://github.com/Infinite-Unknown/knock-on/issues
