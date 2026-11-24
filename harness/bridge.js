// Local preview only: stands in for @forge/bridge (aliased in vite.config.mjs --mode harness).
// It also frames the page so it is obvious this is not Jira: a banner, the comments
// the in-memory Jira received, and a runner for the two Rovo action / MCP tool functions.

const params = new URLSearchParams(location.search);
const issueKey = (params.get('issue') ?? 'CHK-12').toUpperCase();

async function call(path, body) {
  const res = await fetch(`/__harness${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return res.json();
}

export async function invoke(fn, payload) {
  const out = await call('/invoke', { fn, payload, issueKey });
  if (fn === 'postImpactComment') refreshComments();
  return out;
}

export const view = {
  theme: { enable: async () => {} },
  getContext: async () => ({ extension: { issue: { key: issueKey } } }),
};

export const router = {
  navigate: async (url) => {
    const key = url.split('/browse/')[1];
    if (key) location.search = `?issue=${encodeURIComponent(key)}`;
  },
  open: async (url) => router.navigate(url),
};

// ---- page frame -------------------------------------------------------------

const esc = (s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function adfToHtml(node) {
  if (!node) return '';
  if (node.type === 'text') {
    let t = esc(node.text);
    for (const m of node.marks ?? []) t = m.type === 'strong' ? `<strong>${t}</strong>` : m.type === 'em' ? `<em>${t}</em>` : t;
    return t;
  }
  const inner = (node.content ?? []).map(adfToHtml).join('');
  if (node.type === 'paragraph') return `<p>${inner}</p>`;
  if (node.type === 'bulletList') return `<ul>${inner}</ul>`;
  if (node.type === 'listItem') return `<li>${inner}</li>`;
  return inner;
}

async function refreshComments() {
  const box = document.getElementById('hx-comments');
  if (!box) return;
  const { comments } = await call('/comments');
  const mine = comments.filter((c) => c.issueKey === issueKey);
  box.innerHTML = mine.length
    ? mine.map((c) => `<article class="hx-comment"><header>Comment #${esc(c.id)} on ${esc(c.issueKey)}</header>${adfToHtml(c.body)}</article>`).join('')
    : '<p class="hx-dim">No comments yet. Use “Post this forecast” in the panel.</p>';
}

function frame() {
  const style = document.createElement('style');
  style.textContent = `
    body { background: #f1f2f4 !important; }
    .hx-wrap { color-scheme: light; max-width: 760px; margin: 0 auto; padding: 16px; }
    .hx-banner { font: 12px/18px ui-monospace, SFMono-Regular, Menlo, monospace; color: #44546f; background: #fff; border: 1px dashed #8590a2; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 4px 16px; justify-content: space-between; }
    .hx-banner b { color: #172b4d; }
    .hx-card { background: #fff; border-radius: 8px; box-shadow: 0 1px 1px #091e4240, 0 0 1px #091e424f; padding: 14px 16px; margin-bottom: 14px; }
    .hx-title { font: 600 13px/18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #44546f; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
    .hx-title img { width: 18px; height: 18px; }
    .hx-dim { color: #626f86; font-size: 13px; }
    .hx-comment { border-left: 3px solid #0c66e4; padding: 2px 0 2px 12px; margin: 8px 0; font-size: 13px; }
    .hx-comment header { font-size: 11px; color: #626f86; }
    .hx-comment p { margin: 4px 0; } .hx-comment ul { margin: 4px 0; padding-left: 20px; }
    .hx-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; font-size: 12px; color: #44546f; }
    .hx-form label { display: flex; flex-direction: column; gap: 2px; }
    .hx-form input, .hx-form select { font: inherit; font-size: 13px; padding: 4px 6px; border: 2px solid #091e4224; border-radius: 4px; }
    .hx-form button { font: inherit; font-size: 13px; padding: 5px 12px; border: 0; border-radius: 3px; background: #0c66e4; color: #fff; cursor: pointer; }
    .hx-out { white-space: pre-wrap; font: 12px/18px ui-monospace, SFMono-Regular, Menlo, monospace; background: #f7f8f9; border-radius: 6px; padding: 10px; margin: 10px 0 0; color: #172b4d; min-height: 40px; }
  `;
  document.head.appendChild(style);

  const app = document.getElementById('app');
  const wrap = document.createElement('div');
  wrap.className = 'hx-wrap';
  wrap.innerHTML = `
    <div class="hx-banner"><span><b>Local preview</b> · sample project data · in-memory Jira API</span><span>issue: <b>${esc(issueKey)}</b></span></div>
    <section class="hx-card"><h2 class="hx-title"><img src="./icon.svg" alt="" /> Knock-On (issue panel)</h2><div id="hx-panel"></div></section>
    <section class="hx-card"><h2 class="hx-title">Comments on ${esc(issueKey)} (in-memory Jira)</h2><div id="hx-comments"></div></section>
    <section class="hx-card"><h2 class="hx-title">Rovo action / MCP tool functions</h2>
      <form class="hx-form" id="hx-form">
        <label>Tool<select name="action"><option value="forecast-slip-impact">forecast-slip-impact</option><option value="find-schedule-conflicts">find-schedule-conflicts</option></select></label>
        <label>issueKey<input name="issueKey" value="${esc(issueKey)}" size="8" /></label>
        <label>slipDays<input name="slipDays" value="5" size="3" /></label>
        <label>projectKey<input name="projectKey" value="${esc(issueKey.split('-')[0])}" size="5" /></label>
        <button type="submit">Run</button>
      </form>
      <pre class="hx-out" id="hx-out" aria-live="polite"></pre>
    </section>`;
  app.replaceWith(wrap);
  wrap.querySelector('#hx-panel').appendChild(app);

  wrap.querySelector('#hx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const action = f.get('action');
    const payload = action === 'forecast-slip-impact' ? { issueKey: f.get('issueKey'), slipDays: f.get('slipDays') } : { projectKey: f.get('projectKey') };
    const out = wrap.querySelector('#hx-out');
    out.textContent = 'Running…';
    const res = await call('/action', { action, payload });
    out.textContent = `${action}(${JSON.stringify(payload)})\n\n${res.ok ? res.text : res.error}`;
  });
  refreshComments();
}

frame();
