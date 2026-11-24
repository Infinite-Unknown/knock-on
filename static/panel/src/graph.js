// Layered SVG of the downstream graph: the slipping issue on the left, each
// column one step further downstream (longest path). The structure is drawn
// once per issue; `paintGraph` only swaps state classes and badges, so colour
// changes can transition and ripple outwards column by column.

const COL_W = 128;
const ROW_H = 44;
const NODE_W = 100;
const NODE_H = 28;
const PAD = 10;
export const RIPPLE_MS = 70; // delay per column for the spreading colour change

const esc = (s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const STATE_LABEL = {
  root: 'slipping',
  late: 'misses its due date',
  later: 'already late, gets later',
  'already-late': 'already late',
  absorbed: 'absorbs the slip',
  'no-due': 'no due date',
};

function reduce(edges) {
  // Draw the transitive reduction: an edge implied by a longer path adds only clutter.
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const implied = (from, to) => {
    const stack = (out.get(from) ?? []).filter((k) => k !== to);
    const seen = new Set(stack);
    while (stack.length) {
      const k = stack.pop();
      if (k === to) return true;
      for (const n of out.get(k) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
    }
    return false;
  };
  return edges.filter((e) => !implied(e.from, e.to));
}

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
    col.forEach((n, i) => pos.set(n.key, { x: PAD + depth * COL_W, y: PAD + offset + i * ROW_H, depth }));
  }

  const edges = reduce(result.edges)
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return '';
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x - 4;
      const y2 = b.y + NODE_H / 2;
      const mid = (x1 + x2) / 2;
      return `<path class="ko-edge${e.type === 'parent' ? ' is-parent' : ''}" data-to="${esc(e.to)}" style="--d:${b.depth}"${e.type === 'parent' ? '' : ' pathLength="1"'}
        d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"><title>${esc(e.from)} ${e.type === 'parent' ? 'is part of' : 'blocks'} ${esc(e.to)}</title></path>`;
    })
    .join('');

  const boxes = nodes
    .map((n) => {
      const p = pos.get(n.key);
      return `<g class="ko-node" data-key="${esc(n.key)}" style="--d:${p.depth}" transform="translate(${p.x},${p.y})" tabindex="0" role="button">
        <title></title>
        <g class="ko-node-body">
          <rect width="${NODE_W}" height="${NODE_H}" rx="7"></rect>
          <text x="10" y="18" class="ko-node-key">${esc(n.key)}</text>
          <text x="${NODE_W - 9}" y="18" class="ko-node-badge" text-anchor="end"></text>
        </g>
      </g>`;
    })
    .join('');

  return `<svg class="ko-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Dependency graph downstream of ${esc(result.root.key)}">
    ${edges}${boxes}
  </svg>`;
}

/** Update colours and badges in place for a new forecast of the same graph. */
export function paintGraph(svg, result) {
  if (!svg) return;
  const byKey = new Map(result.nodes.map((n) => [n.key, n]));
  for (const g of svg.querySelectorAll('.ko-node')) {
    const n = byKey.get(g.dataset.key);
    if (!n) continue;
    g.setAttribute('class', `ko-node is-${n.state}`);
    const badge = n.state === 'root' ? `+${result.slipDays}d` : n.delayDays > 0 ? `+${n.delayDays}d` : n.state === 'no-due' && n.shiftDays > 0 ? `+${n.shiftDays}d` : '';
    g.querySelector('.ko-node-badge').textContent = badge;
    const label = `${n.key} ${n.summary}: ${STATE_LABEL[n.state]}${n.delayDays > 0 ? `, ${n.delayDays} business days late` : ''}`;
    g.querySelector('title').textContent = label;
    g.setAttribute('aria-label', label);
  }
  for (const p of svg.querySelectorAll('.ko-edge')) {
    const t = byKey.get(p.dataset.to);
    p.classList.toggle('is-hot', Boolean(t && (t.state === 'late' || t.state === 'later')));
  }
}
