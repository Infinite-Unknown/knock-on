// Layered SVG of the downstream graph: the slipping issue on the left,
// each column one step further downstream (longest path).

const COL_W = 132;
const ROW_H = 40;
const NODE_W = 104;
const NODE_H = 26;
const PAD = 8;

const esc = (s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATE_LABEL = {
  root: 'slipping',
  late: 'misses due date',
  later: 'already late, gets later',
  'already-late': 'already late',
  absorbed: 'absorbs the slip',
  'no-due': 'no due date',
};

export function renderGraph(result) {
  const nodes = result.nodes;
  if (nodes.length <= 1) return '';
  const columns = new Map();
  for (const n of nodes) {
    if (!columns.has(n.depth)) columns.set(n.depth, []);
    columns.get(n.depth).push(n);
  }
  const maxRows = Math.max(...[...columns.values()].map((c) => c.length));
  const width = PAD * 2 + (columns.size - 1) * COL_W + NODE_W;
  const height = PAD * 2 + (maxRows - 1) * ROW_H + NODE_H;

  const pos = new Map();
  for (const [depth, col] of columns) {
    const offset = ((maxRows - col.length) * ROW_H) / 2;
    col.forEach((n, i) => pos.set(n.key, { x: PAD + depth * COL_W, y: PAD + offset + i * ROW_H }));
  }

  // Draw the transitive reduction: an edge implied by a longer path adds only clutter.
  const out = new Map();
  for (const e of result.edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const reachesWithout = (from, to, skip) => {
    const stack = (out.get(from) ?? []).filter((k) => k !== skip);
    const seen = new Set(stack);
    while (stack.length) {
      const k = stack.pop();
      if (k === to) return true;
      for (const n of out.get(k) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
    }
    return false;
  };
  const drawn = result.edges.filter((e) => !reachesWithout(e.from, e.to, e.to));

  const edges = drawn
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return '';
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const mid = (x1 + x2) / 2;
      const target = nodes.find((n) => n.key === e.to);
      const hot = target && (target.state === 'late' || target.state === 'later') ? ' is-hot' : '';
      return `<path class="ko-edge${e.type === 'parent' ? ' is-parent' : ''}${hot}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 3},${y2}" marker-end="url(#ko-arrow${hot ? '-hot' : ''})"><title>${esc(e.from)} ${e.type === 'parent' ? 'is part of' : 'blocks'} ${esc(e.to)}</title></path>`;
    })
    .join('');

  const boxes = nodes
    .map((n) => {
      const p = pos.get(n.key);
      const badge = n.state === 'root' ? `+${result.slipDays}` : n.delayDays > 0 ? `+${n.delayDays}` : n.state === 'no-due' ? `→${n.shiftDays}` : '';
      return `<g class="ko-node is-${n.state}" transform="translate(${p.x},${p.y})" tabindex="0" data-key="${esc(n.key)}" role="button" aria-label="${esc(n.key)}: ${STATE_LABEL[n.state]}">
        <title>${esc(n.key)} ${esc(n.summary)} — ${STATE_LABEL[n.state]}</title>
        <rect width="${NODE_W}" height="${NODE_H}" rx="6"></rect>
        <text x="9" y="17" class="ko-node-key">${esc(n.key)}</text>
        ${badge ? `<text x="${NODE_W - 8}" y="17" class="ko-node-badge" text-anchor="end">${esc(badge)}</text>` : ''}
      </g>`;
    })
    .join('');

  return `<svg class="ko-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Dependency graph downstream of ${esc(result.root.key)}">
    <defs>
      <marker id="ko-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="ko-arrow"></path></marker>
      <marker id="ko-arrow-hot" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" class="ko-arrow is-hot"></path></marker>
    </defs>
    ${edges}${boxes}
  </svg>`;
}
