// Sample data for the local preview: a fictional "Checkout 2.0" project.
// Dates are business-day offsets from today so the preview never goes stale.

import { addBusinessDays, todayIso } from '../src/core/dates.js';

export function sampleProject(today = todayIso()) {
  const d = (n) => addBusinessDays(today, n);
  const release = { id: '10020', name: 'Checkout 2.0', releaseDate: d(14), released: false };
  return [
    { key: 'CHK-10', type: 'Epic', summary: 'Checkout 2.0', assignee: 'Priya Raman', due: d(16), status: 'indeterminate' },
    { key: 'CHK-11', summary: 'Sandbox credentials for new payment provider', assignee: 'Sam Okafor', status: 'done', blocks: ['CHK-12'], parent: 'CHK-10' },
    {
      key: 'CHK-12',
      summary: 'Migrate card payments to the new provider API',
      assignee: 'Priya Raman',
      due: d(6),
      estimateDays: 3,
      status: 'indeterminate',
      parent: 'CHK-10',
      blocks: ['CHK-15', 'CHK-18'],
      fixVersions: [release],
      priority: 'High',
    },
    { key: 'CHK-15', summary: 'Saved cards UI on the new API', assignee: 'Marco Bianchi', due: d(9), estimateDays: 2, parent: 'CHK-10', blocks: ['CHK-21', 'CHK-22'], fixVersions: [release] },
    { key: 'CHK-18', summary: 'Refund flow on the new API', assignee: 'Priya Raman', due: d(10), estimateDays: 3, parent: 'CHK-10', blocks: ['CHK-21', 'OPS-7'], fixVersions: [release] },
    { key: 'CHK-21', summary: 'Checkout end-to-end test suite', assignee: 'Lena Fischer', due: d(12), estimateDays: 2, parent: 'CHK-10', blocks: ['CHK-24'], fixVersions: [release] },
    { key: 'CHK-22', summary: 'Analytics events for payment steps', assignee: 'Marco Bianchi', due: d(18), estimateDays: 2 },
    { key: 'CHK-24', summary: 'Beta rollout to 5% of traffic', assignee: 'Dev Patel', due: d(13), estimateDays: 1, parent: 'CHK-10', fixVersions: [release], type: 'Task' },
    { key: 'CHK-27', summary: 'Fraud rule thresholds signed off', assignee: 'Ana Costa', due: d(15), blocks: ['CHK-22'], type: 'Task' },
    { key: 'CHK-30', summary: 'Promo banner copy for launch', assignee: 'Ana Costa', due: d(11) },
    { key: 'CHK-31', summary: 'Tax service rate update', assignee: 'Sam Okafor', due: d(11), estimateDays: 2, blocks: ['CHK-32'] },
    { key: 'CHK-32', summary: 'Invoice PDF redesign', assignee: 'Lena Fischer', due: d(10), estimateDays: 2 },
    { key: 'OPS-7', summary: 'Update support runbook for refunds', assignee: null, estimateDays: 1, type: 'Task' },
  ];
}
