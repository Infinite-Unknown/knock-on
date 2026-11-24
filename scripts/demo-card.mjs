// Title / closing card for the demo videos: a small dependency chain that turns red column by column.
export function cardHtml(title, lines) {
  // Title card in the panel's own language: a small dependency chain that turns red column by column.
  const cols = [[['CHK-12', 'root']], [['CHK-15', 'late'], ['CHK-18', 'late']], [['CHK-21', 'late'], ['CHK-22', 'ok']], [['CHK-24', 'late']], [['Release', 'late']]];
  const nodes = [];
  const edges = [];
  const pos = {};
  cols.forEach((col, c) =>
    col.forEach(([k, s], r) => {
      const x = 40 + c * 150;
      const y = 120 + (r - (col.length - 1) / 2) * 64;
      pos[k] = { x, y };
      nodes.push(`<g class="n ${s}" style="--c:${c}"><rect x="${x}" y="${y - 18}" width="112" height="36" rx="9"/><text x="${x + 16}" y="${y + 6}">${k}</text></g>`);
    }),
  );
  for (const [a, b] of [['CHK-12', 'CHK-15'], ['CHK-12', 'CHK-18'], ['CHK-15', 'CHK-21'], ['CHK-18', 'CHK-21'], ['CHK-15', 'CHK-22'], ['CHK-21', 'CHK-24'], ['CHK-24', 'Release']]) {
    const p = pos[a];
    const q = pos[b];
    const m = (p.x + 112 + q.x) / 2;
    edges.push(`<path class="e" style="--c:${cols.findIndex((col) => col.some(([k]) => k === b))}" d="M${p.x + 112},${p.y} C${m},${p.y} ${m},${q.y} ${q.x},${q.y}"/>`);
  }
  return `<!doctype html><html><head><style>
    body{margin:0;height:100vh;box-sizing:border-box;padding-bottom:110px;display:grid;place-items:center;background:#f7f8f9;color:#172b4d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .wrap{width:1080px;display:grid;gap:36px}
    .mark{display:flex;align-items:center;gap:16px}
    .mark svg{width:52px;height:52px}
    h1{margin:0;font-size:64px;line-height:1;font-weight:700;letter-spacing:-.03em}
    p{margin:0;font-size:26px;line-height:1.35;color:#44546f;max-width:900px}
    p b{color:#ae2e24;font-weight:650}
    .g{width:780px;height:240px;overflow:visible}
    .n rect{fill:#fff;stroke:#758195;stroke-width:1.5;animation:paint 500ms ease forwards;animation-delay:calc(1100ms + var(--c)*260ms)}
    .n text{font:600 16px -apple-system,BlinkMacSystemFont,sans-serif;fill:#172b4d;animation:ink 500ms ease forwards;animation-delay:calc(1100ms + var(--c)*260ms)}
    .n.root rect{fill:#0c66e4;stroke:#0c66e4;animation:none}.n.root text{fill:#fff;animation:none}
    .n{opacity:0;animation:in 420ms cubic-bezier(.23,1,.32,1) forwards;animation-delay:calc(var(--c)*90ms)}
    .e{fill:none;stroke:#758195;stroke-width:1.5;opacity:.6;stroke-dasharray:400;stroke-dashoffset:400;animation:draw 600ms cubic-bezier(.23,1,.32,1) forwards, hot 400ms ease forwards;animation-delay:calc(var(--c)*90ms + 150ms), calc(1100ms + var(--c)*260ms)}
    .n.ok rect{animation-name:paintok}.n.ok text{animation-name:inkok}
    @keyframes in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
    @keyframes draw{to{stroke-dashoffset:0}}
    @keyframes paint{to{fill:#ffeceb;stroke:#e2483d}}
    @keyframes ink{to{fill:#ae2e24}}
    @keyframes paintok{to{fill:#dcfff1;stroke:#22a06b}}
    @keyframes inkok{to{fill:#216e4e}}
    @keyframes hot{to{stroke:#e2483d;opacity:1}}
    .meta{font-size:18px;color:#626f86}
  </style></head><body><div class="wrap">
    <div class="mark"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0C66E4"/><circle cx="6" cy="12" r="2.6" fill="#fff"/><circle cx="12.5" cy="7.5" r="2.1" fill="#fff" opacity=".9"/><circle cx="12.5" cy="16.5" r="2.1" fill="#fff" opacity=".9"/><circle cx="18.5" cy="12" r="1.7" fill="#FF8F73"/><path d="M8.3 11l2.4-2.2M8.3 13l2.4 2.2M14.4 8.6l2.6 2.4M14.4 15.4l2.6-2.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg><h1>${title}</h1></div>
    ${lines[0] ? `<p>${lines[0]}</p>` : ''}
    <svg class="g" viewBox="0 0 780 240">${edges.join('')}${nodes.join('')}</svg>
    ${lines.slice(1).map((l) => `<div class="meta">${l}</div>`).join('')}
  </div></body></html>`;
}
