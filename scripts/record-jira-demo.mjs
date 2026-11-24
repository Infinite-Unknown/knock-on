// Renders assets/demo-jira.mp4: the Knock-On panel in a live Jira Cloud site, plus a real-time
// slider drag captured from the local preview, with an eased zoom-to-focus camera, an animated
// cursor, captions and a narrated voice-over.
//
// Inputs (not in the repo, see assets/raw/ in .gitignore):
//   assets/raw/jira-live/*.png        full-resolution captures of the app in Jira (1912x980)
//   assets/raw/preview-frames/        frames from scripts/capture-preview.mjs
// Voice-over: Kokoro TTS. Set KOKORO_PYTHON (python with kokoro-onnx) and TTS_SCRIPT
// (a script called as: TTS_SCRIPT "text" out.wav --voice af_heart).
// Needs ffmpeg and ffprobe on PATH.
//
// Usage: node scripts/record-jira-demo.mjs [--upload]   (--upload also writes a <9.5 MB copy)
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const raw = join(root, 'assets', 'raw');
const jiraDir = join(raw, 'jira-live');
const prevDir = join(raw, 'preview-frames');
const voDir = join(raw, 'vo');
const work = join(raw, 'jira-render');
mkdirSync(voDir, { recursive: true });
mkdirSync(work, { recursive: true });

const FPS = 60;
const W = 1920;
const H = 1080;
const JW = 1912; // Jira capture size
const JH = 980;

// ---------------------------------------------------------------- narration
const LINES = {
  title: 'Every standup has someone saying: this one will be a few days late. Knock-On shows you what that actually breaks.',
  top: 'This is a live Jira site. CHK-2, the move to a new payments API, blocks two stories, and a whole chain of work depends on them.',
  panel: 'The Knock-On panel sits right on the issue, and reads those links and due dates from Jira. If CHK-2 slips a week, five of its six downstream issues miss their dates, and the Checkout 2.0 release lands three business days late.',
  oneDay: 'Make it one day, and every downstream issue still makes its date.',
  prevIntro: "Here's the same panel running locally on sample data, so you can watch it move.",
  prevDrag: 'Drag the slip. One day is absorbed by slack.',
  prevTwo: 'At two, four dates break, and the red spreads down the chain.',
  prevEight: 'At eight, the epic slips too.',
  threeDays: 'Back in Jira, at three days, four due dates break and the release slips a day. The analytics story and the epic still make it.',
  lists: "Every broken date is listed, with the old date, the new one, what it's waiting on, and who to tell.",
  post: 'One click posts the forecast to the issue as a comment,',
  comment: 'so the whole team works from the same numbers.',
  nav: 'Click any issue to follow the chain. If the test suite slips a week, the beta rollout and the epic miss their dates, and the release lands four business days late.',
  end: 'Knock-On. Know the knock-on effect before the standup ends.',
};

const py = process.env.KOKORO_PYTHON;
const tts = process.env.TTS_SCRIPT;
const vo = {};
for (const [name, text] of Object.entries(LINES)) {
  const hash = createHash('sha1').update(`af_heart|${text}`).digest('hex').slice(0, 10);
  const file = join(voDir, `${name}-${hash}.wav`);
  if (!existsSync(file)) {
    if (!py || !tts) throw new Error('Set KOKORO_PYTHON and TTS_SCRIPT to generate the voice-over');
    execFileSync(py, ['-I', tts, text, file, '--voice', 'af_heart'], { stdio: 'inherit' });
  }
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
  vo[name] = { file, seconds, text };
}

// ---------------------------------------------------------------- helpers
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

/** Camera track: keyframes [{t, cx, cy, s, dur}] — each key eases in over `dur` seconds ending at t. */
function track(keys) {
  return (t) => {
    let cur = keys[0];
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      const start = k.t - (k.dur ?? 1);
      if (t <= start) break;
      const p = easeInOut(clamp01((t - start) / (k.dur ?? 1)));
      cur = { cx: lerp(cur.cx, k.cx, p), cy: lerp(cur.cy, k.cy, p), s: Math.exp(lerp(Math.log(cur.s), Math.log(k.s), p)) };
    }
    return cur;
  };
}

/** Cursor path: points [{t, x, y}] with eased moves between them, plus clicks [t]. */
function cursorPath(points, clicks = [], fade = {}) {
  return (t) => {
    let pos = points[0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (t >= b.t) pos = b;
      else if (t > a.t) {
        const p = easeInOut((t - a.t) / (b.t - a.t));
        pos = { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
        break;
      } else break;
    }
    const click = clicks.map((c) => t - c).filter((d) => d >= 0 && d < 0.6).sort((x, y) => x - y)[0];
    const press = clicks.some((c) => t >= c - 0.06 && t < c + 0.12);
    let alpha = 1;
    if (fade.in != null) alpha *= clamp01((t - fade.in) / 0.25);
    if (fade.out != null) alpha *= 1 - clamp01((t - fade.out) / 0.25);
    return { x: pos.x, y: pos.y, click, press, alpha };
  };
}

const J = (name, patches = []) => ({ base: `jira-live/${name}.png`, w: JW, h: JH, patches: patches.map(([img, x, y]) => ({ src: `jira-live/${img}.png`, x, y })) });
const WIDE = { cx: JW / 2, cy: JH / 2, s: 0.9 };

// ---------------------------------------------------------------- preview clip time map
const pv = JSON.parse(readFileSync(join(prevDir, 'timeline.json'), 'utf8'));
const PDPR = pv.dpr;
const PW = pv.view.width * PDPR;
const PH = pv.view.height * PDPR;
function previewFrameAt(v) {
  const f = pv.frames;
  let lo = 0;
  let hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f[mid].t <= v) lo = mid;
    else hi = mid - 1;
  }
  return `preview-frames/${f[lo].file}`;
}
function previewMouseAt(v) {
  const m = pv.mouse;
  if (!m.length || v < m[0].t) return null;
  let i = 0;
  while (i + 1 < m.length && m[i + 1].t <= v) i++;
  const a = m[i];
  const b = m[i + 1];
  if (!b) return { x: a.x * PDPR, y: a.y * PDPR, down: a.down };
  const p = (v - a.t) / (b.t - a.t);
  return { x: lerp(a.x, b.x, p) * PDPR, y: lerp(a.y, b.y, p) * PDPR, down: a.down };
}
// Pieces of animation time [v0, v1]; holds (static, nothing moving) may be stretched to fit the voice.
// Motion pieces always play at real speed.
const pieces = [
  { v0: 0, v1: 0.0, hold: true, min: vo.prevIntro.seconds + 0.5 }, // static first frame while the intro line plays
  { v0: 0, v1: 1.0 }, // cursor reaches the thumb
  { v0: 1.0, v1: 2.8, say: 'prevDrag', sayAt: 0.0 },
  { v0: 2.8, v1: 2.8, hold: true, min: 0 },
  { v0: 2.8, v1: 4.95, say: 'prevTwo', sayAt: 0.6 },
  { v0: 4.95, v1: 4.95, hold: true, min: 0 },
  { v0: 4.95, v1: 11.5, say: 'prevEight', sayAt: 2.0 },
];
// stretch holds so each line finishes before the next one starts
{
  let carry = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.say) {
      const needed = p.sayAt + vo[p.say].seconds + 0.25;
      const len = p.v1 - p.v0;
      const next = pieces[i + 1];
      if (next?.hold) next.min = Math.max(next.min, needed - len);
      else carry = Math.max(0, needed - len);
    }
  }
  if (carry) pieces.push({ v0: 11.5, v1: 11.5, hold: true, min: carry });
}
let acc = 0;
for (const p of pieces) {
  p.start = acc;
  p.dur = p.hold ? p.min : p.v1 - p.v0;
  acc += p.dur;
}
const PREVIEW_LEN = acc;
const previewV = (t) => {
  for (const p of pieces) if (t < p.start + p.dur || p === pieces.at(-1)) return p.hold ? p.v0 : Math.min(p.v1, p.v0 + (t - p.start));
  return pieces.at(-1).v1;
};
const previewSays = [{ name: 'prevIntro', at: 0.35 }, ...pieces.filter((p) => p.say).map((p) => ({ name: p.say, at: p.start + p.sayAt }))];

// ---------------------------------------------------------------- shots
// Each shot: { len, say: [{name, at}], frame(t) -> { layers: [{view, cam, alpha}], cursor, tag, card } }
const XF = 0.5; // dissolve between shots
const g = pv.geo;
const P = (css) => css * PDPR;
const thumb0 = { x: P(g.range.x + 10), y: P(g.range.y + g.range.h / 2) };

const shots = [];
const add = (s) => shots.push(s);

add({
  name: 'title', len: vo.title.seconds + 0.9, say: [{ name: 'title', at: 0.35 }],
  frame: () => ({ layers: [], card: 'title' }),
});

{
  const len = vo.top.seconds + 0.8;
  const cam = track([{ ...WIDE }, { t: 1.6, dur: 1.3, cx: 860, cy: 640, s: 1.28 }, { t: len, dur: 1.2, cx: 900, cy: 800, s: 1.2 }]);
  add({ name: 'top', len, say: [{ name: 'top', at: 0.4 }], frame: (t) => ({ layers: [{ view: J('top'), cam: cam(t) }], tag: 'jira' }) });
}

{
  const len = vo.panel.seconds + 0.9;
  const head = 0.5 + vo.panel.seconds * 0.42;
  const cam = track([
    { cx: 900, cy: 440, s: 1.15 },
    { t: 1.6, dur: 1.2, cx: 860, cy: 470, s: 1.5 },
    { t: head + 0.2, dur: 1.0, cx: 760, cy: 400, s: 1.75 },
    { t: head + 2.3, dur: 1.1, cx: 871, cy: 640, s: 1.55 },
    { t: len, dur: 1.1, cx: 871, cy: 400, s: 1.65 },
  ]);
  add({ name: 'panel', len, say: [{ name: 'panel', at: 0.45 }], frame: (t) => ({ layers: [{ view: J('p5'), cam: cam(t) }], tag: 'jira' }) });
}

{
  const click = 0.9;
  const len = click + 0.45 + vo.oneDay.seconds + 0.6;
  const cam = track([{ cx: 871, cy: 400, s: 1.65 }, { t: len, dur: 1.4, cx: 880, cy: 410, s: 1.7 }]);
  const cur = cursorPath([{ t: 0, x: 760, y: 470 }, { t: 0.85, x: 486, y: 283 }], [click], { in: 0 });
  add({
    name: 'oneDay', len, say: [{ name: 'oneDay', at: click + 0.45 }],
    frame: (t) => {
      const a = clamp01((t - click - 0.05) / 0.35);
      return {
        layers: [{ view: J('p5'), cam: cam(t) }, { view: J('p1'), cam: cam(t), alpha: a }],
        cursor: { ...cur(t), size: 26 },
        tag: 'jira',
      };
    },
  });
}

{
  const len = PREVIEW_LEN;
  const dragStart = pieces[2].start;
  const lastMove = pieces.find((p) => p.v0 === 4.95 && !p.hold);
  const cam = track([
    { cx: PW / 2, cy: PH / 2, s: 0.6 },
    { t: dragStart - 0.15, dur: 1.4, cx: P(500), cy: P(300), s: 0.78 },
    { t: lastMove.start + 2.6, dur: 1.6, cx: P(520), cy: P(330), s: 0.8 },
    { t: len, dur: 1.4, cx: P(500), cy: P(290), s: 0.7 },
  ]);
  const approach = cursorPath([{ t: 0, x: P(720), y: P(470) }, { t: pieces[1].start, x: P(720), y: P(470) }, { t: pieces[1].start + pieces[1].dur, x: thumb0.x, y: thumb0.y }], [], { in: pieces[1].start - 0.3 });
  add({
    name: 'preview', len, say: previewSays,
    frame: (t) => {
      const v = previewV(t);
      const m = previewMouseAt(v);
      let cursor = approach(t);
      if (m) cursor = { x: m.x, y: m.y, press: m.down, alpha: 1 };
      return {
        layers: [{ view: { base: previewFrameAt(v), w: PW, h: PH, patches: [] }, cam: cam(t), light: true }],
        cursor: { ...cursor, size: 54 },
        tag: 'preview',
      };
    },
  });
}

{
  const click = 1.0;
  const len = click + 0.5 + vo.threeDays.seconds + 0.7;
  const t2 = click + 0.5 + vo.threeDays.seconds * 0.55;
  const cam = track([
    { cx: 880, cy: 410, s: 1.7 },
    { t: click + 1.4, dur: 1.1, cx: 871, cy: 520, s: 1.6 },
    { t: t2 + 0.9, dur: 1.1, cx: 860, cy: 640, s: 1.55 },
  ]);
  const cur = cursorPath([{ t: 0, x: 640, y: 420 }, { t: 0.95, x: 566, y: 283 }, { t: click + 0.9, x: 566, y: 283 }, { t: click + 1.8, x: 1240, y: 900 }], [click], { in: 0, out: click + 1.6 });
  add({
    name: 'threeDays', len, say: [{ name: 'threeDays', at: click + 0.5 }],
    frame: (t) => ({
      layers: [{ view: J('p1'), cam: cam(t) }, { view: J('p3'), cam: cam(t), alpha: clamp01((t - click - 0.05) / 0.35) }],
      cursor: { ...cur(t), size: 26 },
      tag: 'jira',
    }),
  });
}

{
  const len = vo.lists.seconds + 0.8;
  const cam = track([{ cx: 860, cy: 420, s: 1.42 }, { t: len, dur: len - 0.6, cx: 860, cy: 560, s: 1.42 }]);
  add({ name: 'lists', len, say: [{ name: 'lists', at: 0.35 }], frame: (t) => ({ layers: [{ view: J('lists'), cam: cam(t) }], tag: 'jira' }) });
}

{
  const click = 1.05;
  const posted = click + 0.75;
  const len = Math.max(posted + 0.8, click + 0.15 + vo.post.seconds + 0.15);
  const cam = track([{ cx: 860, cy: 560, s: 1.42 }, { t: 1.0, dur: 1.0, cx: 760, cy: 790, s: 1.75 }]);
  const cur = cursorPath([{ t: 0, x: 980, y: 640 }, { t: 0.95, x: 560, y: 826 }], [click], { in: 0 });
  add({
    name: 'post', len, say: [{ name: 'post', at: click + 0.15 }],
    frame: (t) => {
      const layers = [{ view: J('lists'), cam: cam(t) }];
      if (t >= click + 0.08 && t < posted + 0.25) layers.push({ view: J('lists', [['patch-posting', 424, 775]]), cam: cam(t), alpha: clamp01((t - click - 0.08) / 0.15) });
      if (t >= posted) layers.push({ view: J('lists', [['posted-left', 0, 0], ['patch-posted-right', 956, 775]]), cam: cam(t), alpha: clamp01((t - posted) / 0.25) });
      return { layers, cursor: { ...cur(t), size: 26 }, tag: 'jira' };
    },
  });
}

{
  const len = vo.comment.seconds + 1.4;
  const cam = track([{ cx: 900, cy: 470, s: 1.3 }, { t: len, dur: len - 0.4, cx: 880, cy: 430, s: 1.45 }]);
  add({ name: 'comment', len, say: [{ name: 'comment', at: 0.1 }], frame: (t) => ({ layers: [{ view: J('comment'), cam: cam(t) }], tag: 'jira' }) });
}

{
  const click = 1.1;
  const toTop = click + 0.35;
  const toPanel = click + 0.5 + vo.nav.seconds * 0.28;
  const len = click + 0.4 + vo.nav.seconds + 0.9;
  const camList = track([{ cx: 860, cy: 420, s: 1.42 }, { t: 1.0, dur: 0.9, cx: 760, cy: 360, s: 1.6 }]);
  const camTop = track([{ cx: 760, cy: 360, s: 1.6 }, { t: 1.4, dur: 1.2, cx: 870, cy: 400, s: 1.25 }]);
  const camPanel = track([
    { cx: 871, cy: 420, s: 1.25 },
    { t: 1.2, dur: 1.1, cx: 720, cy: 370, s: 1.7 },
    { t: 3.6, dur: 1.2, cx: 871, cy: 560, s: 1.5 },
    { t: 5.6, dur: 1.1, cx: 871, cy: 700, s: 1.5 },
  ]);
  const cur = cursorPath([{ t: 0, x: 900, y: 600 }, { t: 1.0, x: 512, y: 322 }], [click], { in: 0, out: click + 0.3 });
  add({
    name: 'nav', len, say: [{ name: 'nav', at: click + 0.4 }],
    frame: (t) => {
      const layers = [{ view: J('nav'), cam: camList(t) }];
      if (t >= toTop) layers.push({ view: J('c5top'), cam: camTop(t - toTop), alpha: clamp01((t - toTop) / 0.35) });
      if (t >= toPanel) layers.push({ view: J('c5'), cam: camPanel(t - toPanel), alpha: clamp01((t - toPanel) / XF) });
      return { layers, cursor: { ...cur(t), size: 26 }, tag: 'jira' };
    },
  });
}

add({ name: 'end', len: vo.end.seconds + 2.2, say: [{ name: 'end', at: 0.5 }], frame: () => ({ layers: [], card: 'end' }) });

// absolute times; consecutive shots overlap by XF for a dissolve
let at = 0;
for (const [i, s] of shots.entries()) {
  s.at = i === 0 ? 0 : at - XF;
  at = s.at + s.len;
}
const TOTAL = at;
const says = shots.flatMap((s) => s.say.map((x) => ({ ...x, t: s.at + x.at, shot: s.name })));

// Captions: one sentence at a time, spread over the line by length.
const captions = [];
for (const s of says) {
  const line = vo[s.name];
  const parts = line.text.match(/[^.!?]+[.!?,]?(\s|$)/g).map((x) => x.trim()).filter(Boolean);
  const merged = [];
  for (const p of parts) {
    if (merged.length && (merged.at(-1).length < 40 || p.length < 22)) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }
  const total = merged.reduce((n, p) => n + p.length, 0);
  let t = s.t;
  for (const p of merged) {
    const d = (line.seconds * p.length) / total;
    captions.push({ text: p, from: t, to: t + d });
    t += d;
  }
}

/** Keep the camera inside the capture when zoomed in; centre it when the whole capture fits. */
function clampCam(c, v) {
  const vw = W / c.s;
  const vh = H / c.s;
  const cx = vw >= v.w ? v.w / 2 : Math.min(Math.max(c.cx, vw / 2), v.w - vw / 2);
  const cy = vh >= v.h ? v.h / 2 : Math.min(Math.max(c.cy, vh / 2), v.h - vh / 2);
  return { ...c, cx, cy };
}

function frameState(t) {
  const active = shots.filter((s) => t >= s.at && t < s.at + s.len);
  const out = { layers: [], cursor: null, tag: null, cards: [], caption: null, captionAlpha: 0 };
  for (const s of active) {
    const local = t - s.at;
    const fadeIn = s === shots[0] ? 1 : clamp01(local / XF);
    const f = s.frame(local);
    const layers = f.layers.map((l) => ({ ...l, cam: clampCam(l.cam, l.view), alpha: (l.alpha ?? 1) * fadeIn }));
    out.layers.push(...layers);
    if (f.card) out.cards.push({ id: f.card, alpha: fadeIn, local });
    if (f.cursor && fadeIn > 0.5) out.cursor = { ...f.cursor, cam: layers[0].cam };
    if (f.tag && fadeIn > 0.5) out.tag = f.tag;
  }
  const c = captions.find((x) => t >= x.from - 0.05 && t < x.to + 0.15);
  if (c) {
    out.caption = c.text;
    out.captionAlpha = Math.min(clamp01((t - c.from + 0.05) / 0.2), clamp01((c.to + 0.15 - t) / 0.2));
  }
  if (t > TOTAL - 0.6) out.fadeOut = clamp01((t - (TOTAL - 0.6)) / 0.6);
  return out;
}

console.log(shots.map((s) => `${s.name} ${s.at.toFixed(2)}+${s.len.toFixed(2)}`).join(' | '), `total ${TOTAL.toFixed(2)} s`);

// ---------------------------------------------------------------- compositor page
const logo = `<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0C66E4"/><circle cx="6" cy="12" r="2.6" fill="#fff"/><circle cx="12.5" cy="7.5" r="2.1" fill="#fff" opacity=".9"/><circle cx="12.5" cy="16.5" r="2.1" fill="#fff" opacity=".9"/><circle cx="18.5" cy="12" r="1.7" fill="#FF8F73"/><path d="M8.3 11l2.4-2.2M8.3 13l2.4 2.2M14.4 8.6l2.6 2.4M14.4 15.4l2.6-2.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>`;

function chainSvg() {
  const cols = [[['CHK-2', 'root']], [['CHK-3', 'late'], ['CHK-4', 'late']], [['CHK-7', 'ok'], ['CHK-5', 'late']], [['CHK-6', 'late']], [['Release', 'late']]];
  const nodes = [];
  const edges = [];
  const pos = {};
  cols.forEach((col, c) =>
    col.forEach(([k, s], r) => {
      const x = 20 + c * 176;
      const y = 110 + (r - (col.length - 1) / 2) * 70;
      pos[k] = { x, y };
      nodes.push(`<g class="n ${s}" style="--c:${c}"><rect x="${x}" y="${y - 20}" width="128" height="40" rx="9"/><text x="${x + 18}" y="${y + 6}">${k}</text></g>`);
    }),
  );
  for (const [a, b, c] of [['CHK-2', 'CHK-3', 1], ['CHK-2', 'CHK-4', 1], ['CHK-3', 'CHK-7', 2], ['CHK-3', 'CHK-5', 2], ['CHK-4', 'CHK-5', 2], ['CHK-5', 'CHK-6', 3], ['CHK-6', 'Release', 4]]) {
    const p = pos[a];
    const q = pos[b];
    const m = (p.x + 128 + q.x) / 2;
    edges.push(`<path class="e ${b === 'CHK-7' ? 'okedge' : ''}" style="--c:${c}" d="M${p.x + 128},${p.y} C${m},${p.y} ${m},${q.y} ${q.x},${q.y}"/>`);
  }
  return `<svg class="g" viewBox="0 0 860 220">${edges.join('')}${nodes.join('')}</svg>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0e1012;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
canvas{position:absolute;inset:0}
#tag{position:absolute;left:36px;top:30px;display:flex;align-items:center;gap:10px;padding:8px 16px 8px 12px;border-radius:999px;background:rgba(14,16,18,.82);color:#dee4ea;font-size:19px;font-weight:600;letter-spacing:-.005em;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 8px 24px rgba(0,0,0,.35);opacity:0}
#tag svg{width:30px;height:30px}
#tag .dot{width:10px;height:10px;border-radius:50%;background:#4bce97;box-shadow:0 0 0 4px rgba(75,206,151,.18)}
#tag .sub{font-weight:500;color:#9fadbc}
#cap{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);max-width:1320px;padding:12px 26px;border-radius:14px;background:rgba(10,12,14,.84);color:#f1f2f4;font-size:30px;line-height:1.32;font-weight:500;text-align:center;letter-spacing:-.008em;box-shadow:0 0 0 1px rgba(255,255,255,.07),0 12px 30px rgba(0,0,0,.4);opacity:0}
.card{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(1200px 700px at 30% 20%,#1b2430 0%,#121519 55%,#0e1012 100%);opacity:0}
.card .wrap{width:1360px;display:grid;gap:44px}
.card .mark{display:flex;align-items:center;gap:22px}
.card .mark svg{width:76px;height:76px}
.card h1{margin:0;font-size:104px;line-height:1;font-weight:750;letter-spacing:-.035em;color:#fff}
.card p{margin:0;font-size:46px;line-height:1.25;color:#b6c2cf;font-weight:550;letter-spacing:-.015em}
.card p b{color:#fd9891;font-weight:650}
.card .meta{font-size:26px;color:#8c9bab;font-weight:500}
.card .in{animation:rise 700ms cubic-bezier(.23,1,.32,1) both}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.g{width:1000px;height:256px;overflow:visible}
.n{opacity:0;animation:nin 460ms cubic-bezier(.23,1,.32,1) forwards;animation-delay:calc(400ms + var(--c)*110ms)}
.n rect{fill:#22272b;stroke:#738496;stroke-width:2;animation:paint 420ms ease forwards;animation-delay:calc(1500ms + var(--c)*180ms)}
.n text{font:650 19px -apple-system,BlinkMacSystemFont,sans-serif;fill:#b6c2cf;animation:ink 420ms ease forwards;animation-delay:calc(1500ms + var(--c)*180ms)}
.n.root rect{fill:#579dff;stroke:#579dff;animation:none}.n.root text{fill:#1d2125;animation:none}
.n.ok rect{animation-name:paintok}.n.ok text{animation-name:inkok}
.e{fill:none;stroke:#738496;stroke-width:2;opacity:.7;stroke-dasharray:420;stroke-dashoffset:420;animation:draw 700ms cubic-bezier(.23,1,.32,1) forwards,hot 420ms ease forwards;animation-delay:calc(450ms + var(--c)*110ms),calc(1500ms + var(--c)*180ms)}
.e.okedge{animation:draw 700ms cubic-bezier(.23,1,.32,1) forwards;animation-delay:calc(450ms + var(--c)*110ms)}
@keyframes nin{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes paint{to{fill:#42221f;stroke:#f87168}}
@keyframes ink{to{fill:#fd9891}}
@keyframes paintok{to{fill:#1c3329;stroke:#4bce97}}
@keyframes inkok{to{fill:#7ee2b8}}
@keyframes hot{to{stroke:#f87168;opacity:1}}
#fade{position:absolute;inset:0;background:#0e1012;opacity:0}
</style></head><body>
<canvas id="c" width="${W}" height="${H}"></canvas>
<div class="card" id="card-title"><div class="wrap">
  <div class="mark in">${logo}<h1>Knock-On</h1></div>
  <p class="in" style="animation-delay:150ms">If this Jira issue slips, <b>what else breaks?</b></p>
  ${chainSvg()}
</div></div>
<div class="card" id="card-end"><div class="wrap">
  <div class="mark in">${logo}<h1>Knock-On</h1></div>
  <p class="in" style="animation-delay:150ms">Which due dates break, which releases slip, <b>and who to tell.</b></p>
  ${chainSvg()}
  <div class="meta in" style="animation-delay:500ms">Forge app for Jira &middot; issue panel &middot; business-day forecasts from your dependency links</div>
</div></div>
<div id="tag"></div>
<div id="cap"></div>
<div id="fade"></div>
<script>
const W=${W},H=${H};
const cv=document.getElementById('c'); const ctx=cv.getContext('2d');
const cache=new Map();
async function img(src){ let e=cache.get(src); if(!e){ e=new Image(); e.src=src; cache.set(src,e); if(cache.size>40){ const k=[...cache.keys()].find(k=>k.startsWith('preview-frames/')&&k!==src); if(k) cache.delete(k);} } if(!e.complete||!e.naturalWidth) await e.decode(); return e; }
function rr(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
const TAGS={
  jira:'<span class="dot"></span><span>Live in Jira Cloud</span><span class="sub">&middot; Forge development build</span>',
  preview:'<span class="dot" style="background:#579dff;box-shadow:0 0 0 4px rgba(87,157,255,.2)"></span><span>Same panel code</span><span class="sub">&middot; local preview, sample data, real time</span>',
};
let lastTag=null;
window.renderFrame=async function(st){
  ctx.setTransform(1,0,0,1,0,0);
  const bg=ctx.createRadialGradient(W*0.3,H*0.15,50,W*0.5,H*0.5,W*0.8); bg.addColorStop(0,'#1a2129'); bg.addColorStop(1,'#0e1012');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  for(const l of st.layers){
    if(l.alpha<=0.001) continue;
    const v=l.view, c=l.cam;
    const x=(0-c.cx)*c.s+W/2, y=(0-c.cy)*c.s+H/2, w=v.w*c.s, h=v.h*c.s;
    ctx.save(); ctx.globalAlpha=l.alpha;
    ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=60; ctx.shadowOffsetY=18;
    rr(x,y,w,h,18); ctx.fillStyle=l.light?'#f7f8f9':'#1d2125'; ctx.fill();
    ctx.shadowColor='transparent';
    rr(x,y,w,h,18); ctx.clip();
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(await img(v.base),x,y,w,h);
    for(const p of v.patches){ const im=await img(p.src); ctx.drawImage(im,x+p.x*c.s,y+p.y*c.s,im.naturalWidth*c.s,im.naturalHeight*c.s); }
    ctx.restore();
    ctx.save(); ctx.globalAlpha=l.alpha*0.9; rr(x+0.5,y+0.5,w-1,h-1,18); ctx.strokeStyle='rgba(255,255,255,0.09)'; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
  }
  const cu=st.cursor;
  if(cu && cu.alpha>0){
    const c=cu.cam, px=(cu.x-c.cx)*c.s+W/2, py=(cu.y-c.cy)*c.s+H/2, k=cu.size*c.s/24;
    if(cu.click!=null){ const p=cu.click/0.6; ctx.save(); ctx.globalAlpha=(1-p)*0.75*cu.alpha; ctx.strokeStyle='#ffffff'; ctx.lineWidth=3*k; ctx.beginPath(); ctx.arc(px,py,(8+40*(1-Math.pow(1-p,3)))*k,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=(1-p)*0.25*cu.alpha; ctx.fillStyle='#579dff'; ctx.fill(); ctx.restore(); }
    ctx.save(); ctx.globalAlpha=cu.alpha; ctx.translate(px,py); const sc=k*(cu.press?0.9:1); ctx.scale(sc,sc);
    ctx.shadowColor='rgba(0,0,0,0.45)'; ctx.shadowBlur=8; ctx.shadowOffsetY=3;
    const path=new Path2D('M0 0 L0 19.5 L4.6 15.3 L7.6 22.4 L11 21 L8 14 L14.2 14 Z');
    ctx.fillStyle='#ffffff'; ctx.fill(path); ctx.shadowColor='transparent'; ctx.lineWidth=1.4; ctx.lineJoin='round'; ctx.strokeStyle='#101214'; ctx.stroke(path);
    ctx.restore();
  }
  const tag=document.getElementById('tag');
  if(st.tag!==lastTag && st.tag){ tag.innerHTML=TAGS[st.tag]; lastTag=st.tag; }
  tag.style.opacity = st.tag ? (st.cards.length? String(1-Math.max(...st.cards.map(c=>c.alpha))) : '1') : '0';
  for(const id of ['title','end']){
    const el=document.getElementById('card-'+id); const c=st.cards.find(c=>c.id===id);
    el.style.opacity=c?String(c.alpha):'0';
    for(const a of el.getAnimations({subtree:true})){ a.pause(); a.currentTime=c?c.local*1000:0; }
  }
  const cap=document.getElementById('cap');
  if(st.caption){ if(cap.textContent!==st.caption) cap.textContent=st.caption; }
  cap.style.opacity=String(st.captionAlpha);
  document.getElementById('fade').style.opacity=String(st.fadeOut||0);
};
</script></body></html>`;
writeFileSync(join(raw, 'compositor.html'), html);

// ---------------------------------------------------------------- render
const silent = join(work, 'video.mp4');
const frames = Math.ceil(TOTAL * FPS);
const only = process.env.ONLY_FRAMES?.split(',').map(Number); // debug: render stills for these times (s)
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`file://${join(raw, 'compositor.html')}`);
await page.evaluate(() => document.fonts.ready);

if (only) {
  for (const t of only) {
    await page.evaluate((st) => window.renderFrame(st), frameState(t));
    await page.screenshot({ path: join(work, `still-${t.toFixed(2)}.png`) });
  }
  await browser.close();
  console.log(`stills written to ${work} (total ${TOTAL.toFixed(2)} s)`);
  process.exit(0);
}

const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent], { stdio: ['pipe', 'inherit', 'inherit'] });
const started = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate((st) => window.renderFrame(st), frameState(i / FPS));
  const buf = await page.screenshot({ type: 'jpeg', quality: 98 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % 600 === 0) console.log(`frame ${i}/${frames} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();

// ---------------------------------------------------------------- audio
const inputs = [];
const filters = [];
says.forEach((s, k) => {
  inputs.push('-i', vo[s.name].file);
  const ms = Math.round(s.t * 1000);
  filters.push(`[${k}:a]aresample=48000,adelay=${ms}|${ms}[a${k}]`);
});
const mix = join(work, 'voice.wav');
filters.push(`${says.map((_, k) => `[a${k}]`).join('')}amix=inputs=${says.length}:normalize=0:duration=longest,apad=whole_dur=${TOTAL.toFixed(3)}[m]`);
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[m]', '-ac', '2', '-t', TOTAL.toFixed(3), mix]);
// two-pass loudness normalisation to -16 LUFS (ffmpeg prints the measurement on stderr)
const report = execFileSync('sh', ['-c', '"$0" "$@" 2>&1', 'ffmpeg', '-v', 'info', '-i', mix, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).toString();
const stats = JSON.parse(report.slice(report.lastIndexOf('{'), report.lastIndexOf('}') + 1));
const norm = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
const final = join(root, 'assets', 'demo-jira.mp4');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', `${norm},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', final]);
console.log(`Wrote assets/demo-jira.mp4 (${TOTAL.toFixed(1)} s, ${(statSync(final).size / 1e6).toFixed(1)} MB)`);
writeFileSync(join(work, 'timeline.json'), JSON.stringify({ total: TOTAL, shots: shots.map((s) => ({ name: s.name, at: s.at, len: s.len })), says, captions }, null, 1));

if (process.argv.includes('--upload')) {
  // Small copy for a browser upload limit: two-pass H.264 to a size budget.
  const budgetBits = 9.3e6 * 8;
  const audioK = 96;
  const videoK = Math.floor(budgetBits / TOTAL / 1000 - audioK - 8);
  const small = join(root, 'assets', 'demo-jira-upload.mp4');
  const pass = join(work, 'x264pass');
  const vf = process.env.UPLOAD_HEIGHT ? ['-vf', `scale=-2:${process.env.UPLOAD_HEIGHT}:flags=lanczos`] : [];
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', final, ...vf, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${videoK}k`, '-pass', '1', '-passlogfile', pass, '-an', '-f', 'mp4', '/dev/null']);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', final, ...vf, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${videoK}k`, '-pass', '2', '-passlogfile', pass, '-c:a', 'aac', '-b:a', `${audioK}k`, '-movflags', '+faststart', small]);
  console.log(`Wrote assets/demo-jira-upload.mp4 (${(statSync(small).size / 1e6).toFixed(2)} MB, video ${videoK} kb/s)`);
}
