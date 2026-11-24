// Renders assets/demo-jira.mp4: the Knock-On panel in a live Jira Cloud site, plus a real-time
// slider drag captured from the local preview, with an eased zoom-to-focus camera, an animated
// cursor, callouts synced to the narration (spotlight, ring, label, number pulse), captions and a
// voice-over.
//
// Inputs (not in the repo, see assets/raw/ in .gitignore):
//   assets/raw/jira-live/*.png        full-resolution captures of the app in Jira (1912x980)
//   assets/raw/preview-frames/        frames from scripts/capture-preview.mjs
// Callout boxes for the Jira captures were measured on those images (pixel coordinates below);
// boxes for the preview come from getBoundingClientRect in the preview page.
// Voice-over: Kokoro TTS. Set KOKORO_PYTHON (python with kokoro-onnx) and TTS_SCRIPT
// (a script called as: TTS_SCRIPT "text" out.wav --voice af_heart).
// Needs ffmpeg and ffprobe on PATH.
//
// Usage: node scripts/record-jira-demo.mjs [--upload]   (--upload also writes a <9.5 MB copy)
//        ONLY_FRAMES=12.5,40 node scripts/record-jira-demo.mjs   (debug stills)
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const raw = join(root, 'assets', 'raw');
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
const XF = 0.5; // dissolve between shots

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
  lists: "Every broken date is listed with its owner, the old date and the new one, what it's waiting on, and who to tell.",
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
  vo[name] = { file, seconds, text, words: wordTimes(file, text, seconds) };
}

/**
 * Word timings for one narration line. Pauses in the audio (silencedetect) are matched to the
 * clause breaks in the text; inside each clause, words get time in proportion to their length.
 */
function wordTimes(file, text, seconds) {
  const log = execFileSync('sh', ['-c', '"$0" "$@" 2>&1', 'ffmpeg', '-v', 'info', '-i', file, '-af', 'silencedetect=noise=-38dB:d=0.1', '-f', 'null', '-']).toString();
  const sil = [];
  for (const m of log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) sil.push([Number(m[1]), Number(m[2])]);
  // speech segments between silences
  let segs = [];
  let at = 0;
  for (const [a, b] of sil) {
    if (a - at > 0.05) segs.push([at, a]);
    at = b;
  }
  if (seconds - at > 0.05) segs.push([at, seconds]);
  const clauses = text.split(/(?<=[,.;:!?])\s+/).map((c) => c.split(/\s+/).filter(Boolean));
  const weight = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5;
  // merge the shortest gaps until there are as many segments as clauses
  while (segs.length > clauses.length) {
    let k = 0;
    for (let i = 1; i < segs.length - 1; i++) if (segs[i + 1][0] - segs[i][1] < segs[k + 1][0] - segs[k][1]) k = i;
    segs.splice(k, 2, [segs[k][0], segs[k + 1][1]]);
  }
  const groups = segs.length === clauses.length ? clauses : [clauses.flat()];
  if (groups.length !== segs.length) segs = [[segs[0]?.[0] ?? 0, segs.at(-1)?.[1] ?? seconds]];
  const words = [];
  groups.forEach((g, i) => {
    const [a, b] = segs[i];
    const total = g.reduce((n, w) => n + weight(w), 0);
    let t = a;
    for (const w of g) {
      const d = ((b - a) * weight(w)) / total;
      words.push({ w: w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, ''), t, end: t + d });
      t += d;
    }
  });
  return words;
}

/** Offset (s) of a phrase within a line; `n` picks the n-th occurrence. */
function wordAt(name, phrase, n = 1) {
  const words = vo[name].words;
  const want = phrase.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''));
  let seen = 0;
  for (let i = 0; i + want.length <= words.length; i++) {
    if (want.every((w, j) => words[i + j].w === w) && ++seen === n) return words[i].t;
  }
  throw new Error(`phrase not found in ${name}: ${phrase}`);
}

// ---------------------------------------------------------------- helpers
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

/** Camera track: keys [{t, cx, cy, s, dur}]; each key eases in over `dur` seconds ending at t (absolute). */
function track(keys) {
  keys = [...keys].sort((a, b) => (a.t ?? -1e9) - (b.t ?? -1e9));
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

/** Cursor path: points [{t, x, y}] (absolute times) with eased moves, plus clicks [t]. */
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
const union = (boxes) => {
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
const pad = (b, px, py = px) => [b[0] - px, b[1] - py, b[2] + 2 * px, b[3] + 2 * py];
/** Camera that shows `frame` above the caption area, zoomed no further than `cap`. */
function camFor(frame, cap) {
  const s = Math.min(cap, 1700 / frame[2], 780 / frame[3]);
  return { cx: frame[0] + frame[2] / 2, cy: frame[1] + frame[3] / 2 + 70 / s, s };
}

// ---------------------------------------------------------------- measured boxes (Jira captures, px)
const node = (x, y) => [x, y, 126, 36];
const BOX = {
  top: { title: [440, 132, 676, 48], blocks: [445, 720, 848, 132] },
  p5: {
    panel: [440, 116, 858, 514], header: [440, 118, 152, 34], num: [1089, 162, 79, 38], chipWeek: [615, 262, 79, 34], thumb: [652, 216, 30, 30],
    headline: [446, 326, 530, 60], hot: [776, 329, 60, 26], graph: [450, 472, 843, 155],
    late: [node(650, 504), node(650, 559), node(809, 559), node(969, 531), node(1129, 531)],
    release: [450, 689, 843, 82], badge: [1224, 706, 50, 24], newDate: [586, 735, 52, 22],
  },
  p1: { chipDay: [450, 262, 67, 34], headline: [446, 326, 836, 32], graph: [450, 442, 843, 155] },
  p3: {
    chip3: [527, 262, 78, 34], late: [node(650, 504), node(650, 559), node(809, 559), node(969, 531)], graph: [450, 472, 843, 155],
    release: [450, 689, 843, 82], badge: [1224, 706, 50, 24], newDate: [586, 735, 46, 22], chk7: node(809, 504), chk1: node(1129, 531),
  },
  lists: {
    list: [446, 98, 851, 334], owner: [592, 172, 118, 26], oldDate: [1008, 158, 48, 26], newDate: [1077, 158, 48, 26], after: [724, 172, 92, 26],
    tell: [446, 664, 422, 82], post: [450, 803, 250, 40], posted: [712, 808, 288, 32],
  },
  comment: { body: [500, 250, 800, 640], head: [508, 318, 788, 64] },
  nav: { link: [484, 305, 64, 28], row: [450, 282, 843, 74] },
  c5top: { title: [440, 132, 452, 48] },
  c5: {
    num: [1089, 164, 79, 38], chipWeek: [615, 264, 79, 34], hot: [776, 331, 60, 26], late: [node(809, 506), node(969, 506)], graph: [450, 474, 843, 100],
    release: [450, 636, 843, 82], badge: [1224, 653, 50, 25], newDate: [587, 682, 52, 22],
  },
};

// ---------------------------------------------------------------- preview clip time map
const pv = JSON.parse(readFileSync(join(prevDir, 'timeline.json'), 'utf8'));
const PDPR = pv.dpr;
const PW = pv.view.width * PDPR;
const PH = pv.view.height * PDPR;
const P = (b) => b.map((n) => n * PDPR); // css box -> preview frame px
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
const pieces = [
  { v0: 0, v1: 0, hold: true, min: vo.prevIntro.seconds + 0.5 },
  { v0: 0, v1: 1.0 },
  { v0: 1.0, v1: 2.8, say: 'prevDrag', sayAt: 0.0 },
  { v0: 2.8, v1: 2.8, hold: true, min: 0 },
  { v0: 2.8, v1: 4.95, say: 'prevTwo', sayAt: 0.6 },
  { v0: 4.95, v1: 4.95, hold: true, min: 0 },
  { v0: 4.95, v1: 11.5, say: 'prevEight', sayAt: 2.0 },
];
for (let i = 0; i < pieces.length; i++) {
  const p = pieces[i];
  if (p.say && pieces[i + 1]?.hold) pieces[i + 1].min = Math.max(pieces[i + 1].min, p.sayAt + vo[p.say].seconds + 0.25 - (p.v1 - p.v0));
}
{
  let acc = 0;
  for (const p of pieces) {
    p.start = acc;
    p.dur = p.hold ? p.min : p.v1 - p.v0;
    acc += p.dur;
  }
}
const PREVIEW_LEN = pieces.at(-1).start + pieces.at(-1).dur;
const previewV = (t) => {
  for (const p of pieces) if (t < p.start + p.dur || p === pieces.at(-1)) return p.hold ? p.v0 : Math.min(p.v1, p.v0 + (t - p.start));
  return pieces.at(-1).v1;
};
const g = pv.geo;
const graphY = (slip) => (slip >= 3 ? 358.5 : g.graph.y); // the headline wraps to two lines from 3 days
const nodeBox = (key, slip) => {
  const n = g.nodes[key];
  return [n.x, n.y - g.graph.y + graphY(slip), n.w, n.h];
};

// ---------------------------------------------------------------- timeline
// Shots have absolute start `at` and length `len`; lines are placed at absolute times; callouts
// are tied to words in the lines.
const shots = [];
const says = [];
const say = (name, t) => {
  says.push({ name, t });
  return { t, end: t + vo[name].seconds, w: (phrase, n) => t + wordAt(name, phrase, n) };
};
const callouts = []; // {shot, t, end, boxes, label, side, pulse, spot}

/** Adds a shot; `fn(shot)` fills frame(t) etc. Shots overlap the previous one by XF. */
function shot(name, start, end, def) {
  const s = { name, at: start, len: end - start, ...def };
  shots.push(s);
  return s;
}
/** Callouts for a shot: [{t, boxes, label, side, pulse, frame, end}] -> camera keys + callout list. */
function addCallouts(s, list, cap, view) {
  const keys = [];
  list.forEach((c, i) => {
    const next = list[i + 1];
    const end = c.end ?? (next ? next.t - 0.05 : s.at + s.len - 0.15);
    callouts.push({ shot: s.name, t: c.t, end, boxes: c.boxes, label: c.label, side: c.side ?? 'above', pulse: c.pulse, view });
    if (c.frame !== false) {
      const frame = c.frame ?? pad(union(c.boxes), view === 'preview' ? 90 : 70, view === 'preview' ? 75 : 60);
      keys.push({ t: c.t + 0.35, dur: 0.85, ...camFor(frame, cap) });
    }
  });
  return keys;
}

// 1. title card
{
  const l = say('title', 0.35);
  shot('title', 0, l.end + 0.6, { frame: () => ({ layers: [], card: 'title' }) });
}

// 2. CHK-2 in Jira
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('top', start + 0.5);
  const s = shot('top', start, l.end + 0.5, {});
  const keys = addCallouts(s, [
    { t: l.w('CHK-2'), boxes: [BOX.top.title], label: 'CHK-2', side: 'below' },
    { t: l.w('blocks two stories'), boxes: [BOX.top.blocks], label: 'blocks CHK-3 and CHK-4' },
  ], 1.9, 'jira');
  const cam = track([{ ...WIDE }, ...keys]);
  s.frame = (t) => ({ layers: [{ view: J('top'), cam: cam(t) }], tag: 'jira' });
}

// 3. panel at one week
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('panel', start + 0.45);
  const s = shot('panel', start, l.end + 0.5, {});
  const b = BOX.p5;
  const keys = addCallouts(s, [
    { t: l.w('the knock-on panel'), boxes: [b.panel], label: 'Knock-On issue panel', frame: pad(b.panel, 30, 20) },
    { t: l.w('reads those links'), boxes: [b.graph], label: 'downstream issues, from the Jira links' },
    { t: l.w('slips a week'), boxes: [b.num, b.chipWeek], label: 'slip: 5 business days', frame: [440, 150, 860, 170] },
    { t: l.w('five of its six'), boxes: [b.hot], pulse: true, label: '5 of 6 miss their date', frame: [600, 300, 420, 110] },
    { t: l.w('miss their dates'), boxes: b.late, label: 'late because of the slip' },
    { t: l.w('the checkout 2.0 release'), boxes: [b.release], label: 'release at risk', side: 'above' },
    { t: l.w('three business days late'), boxes: [b.badge, b.newDate], pulse: true, label: '+3 business days', frame: [560, 660, 740, 130] },
  ], 1.9, 'jira');
  const cam = track([{ cx: 900, cy: 440, s: 1.15 }, ...keys]);
  s.frame = (t) => ({ layers: [{ view: J('p5'), cam: cam(t) }], tag: 'jira' });
}

// 4. one day
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('oneDay', start + 1.3);
  const click = l.w('one day') - 0.05;
  const s = shot('oneDay', start, l.end + 0.6, {});
  const b = BOX.p1;
  const keys = addCallouts(s, [
    { t: click + 0.05, boxes: [b.chipDay], label: '1 day', side: 'below', frame: [440, 150, 860, 260] },
    { t: l.w('every downstream issue'), boxes: [b.headline, b.graph], label: 'all 6 still on time', frame: [440, 310, 860, 300] },
  ], 1.9, 'jira');
  const cam = track([{ ...camFor([440, 150, 860, 260], 1.9) }, ...keys]);
  const cur = cursorPath([{ t: start + 0.3, x: 760, y: 470 }, { t: click - 0.05, x: 486, y: 283 }], [click], { in: start + 0.3 });
  s.frame = (t) => ({
    layers: [{ view: J('p5'), cam: cam(t) }, { view: J('p1'), cam: cam(t), alpha: clamp01((t - click - 0.05) / 0.35) }],
    cursor: { ...cur(t), size: 26 },
    tag: 'jira',
  });
}

// 5. the same panel in the local preview, dragged in real time
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const s = shot('preview', start, start + PREVIEW_LEN, {});
  const l0 = say('prevIntro', start + 0.35);
  const lines = {};
  for (const p of pieces.filter((x) => x.say)) lines[p.say] = say(p.say, start + p.start + p.sayAt);
  const css = (b) => P(b);
  const keys = addCallouts(s, [
    { t: l0.w('the same panel'), boxes: [css([136, 16, 728, 36])], label: 'local preview, sample data', side: 'below', frame: css([120, 8, 760, 520]) },
    { t: lines.prevDrag.w('drag the slip'), boxes: [css([150, 148, 700, 36])], label: 'slip slider', side: 'below', frame: css([130, 100, 740, 240]) },
    { t: lines.prevDrag.w('absorbed by slack'), boxes: [css([156, 335, 688, 168])], label: 'slack absorbs 1 day', frame: css([130, 230, 740, 290]) },
    { t: lines.prevTwo.w('four dates break'), boxes: [css([424, 243, 47, 21])], pulse: true, label: '4 of 7 miss their date', side: 'below', frame: css([280, 200, 440, 150]) },
    { t: lines.prevTwo.w('the red spreads'), boxes: [css([156, 335, 688, 192])], label: 'red spreads column by column', frame: css([130, 230, 740, 310]) },
    { t: lines.prevEight.w('the epic'), boxes: [css(nodeBox('CHK-10', 8))], label: 'the epic, CHK-10', side: 'above', frame: css([430, 300, 430, 230]) },
  ], 1.0, 'preview');
  const cam = track([{ cx: PW / 2, cy: PH / 2, s: 0.6 }, ...keys, { t: s.at + s.len, dur: 1.2, ...camFor(css([130, 100, 740, 440]), 1.0) }]);
  const thumb0 = { x: (g.range.x + 10) * PDPR, y: (g.range.y + g.range.h / 2) * PDPR };
  const approach = cursorPath([{ t: 0, x: 720 * PDPR, y: 470 * PDPR }, { t: start + pieces[1].start, x: 720 * PDPR, y: 470 * PDPR }, { t: start + pieces[1].start + pieces[1].dur, ...thumb0 }], [], { in: start + pieces[1].start - 0.3 });
  s.frame = (t) => {
    const v = previewV(t - start);
    const m = previewMouseAt(v);
    const cursor = m ? { x: m.x, y: m.y, press: m.down, alpha: 1 } : approach(t);
    return { layers: [{ view: { base: previewFrameAt(v), w: PW, h: PH, patches: [] }, cam: cam(t), light: true }], cursor: { ...cursor, size: 54 }, tag: 'preview' };
  };
}

// 6. three days, back in Jira
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('threeDays', start + 0.6);
  const click = l.w('three days') - 0.05;
  const s = shot('threeDays', start, l.end + 0.5, {});
  const b = BOX.p3;
  const keys = addCallouts(s, [
    { t: click + 0.05, boxes: [b.chip3], label: '3 days', side: 'below', frame: [440, 150, 860, 260] },
    { t: l.w('four due dates break'), boxes: b.late, label: '4 due dates break', frame: [440, 460, 860, 330] },
    { t: l.w('the release slips'), boxes: [b.release, b.badge], label: 'release +1 business day', frame: [440, 460, 860, 330] },
    { t: l.w('the analytics story'), boxes: [b.chk7], label: 'analytics story: slack left', side: 'above', frame: [440, 460, 860, 330] },
    { t: l.w('the epic'), boxes: [b.chk1], label: 'epic: just in time', side: 'above', frame: [440, 460, 860, 330] },
  ], 1.9, 'jira');
  const cam = track([{ ...camFor([440, 310, 860, 300], 1.9) }, ...keys]);
  const cur = cursorPath([{ t: start + 0.2, x: 640, y: 420 }, { t: click - 0.05, x: 566, y: 283 }, { t: click + 0.9, x: 566, y: 283 }, { t: click + 1.8, x: 1240, y: 900 }], [click], { in: start + 0.2, out: click + 1.5 });
  s.frame = (t) => ({
    layers: [{ view: J('p1'), cam: cam(t) }, { view: J('p3'), cam: cam(t), alpha: clamp01((t - click - 0.05) / 0.35) }],
    cursor: { ...cur(t), size: 26 },
    tag: 'jira',
  });
}

// 7. lists
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('lists', start + 0.45);
  const s = shot('lists', start, l.end + 0.4, {});
  const b = BOX.lists;
  const keys = addCallouts(s, [
    { t: l.w('every broken date'), boxes: [b.list], label: 'due dates that break' },
    { t: l.w('its owner'), boxes: [b.owner], label: 'owner', side: 'below', frame: [560, 120, 740, 130] },
    { t: l.w('the old date'), boxes: [b.oldDate], pulse: true, label: 'was due', side: 'below', frame: [560, 120, 740, 130] },
    { t: l.w('the new one'), boxes: [b.newDate], pulse: true, label: 'now lands', side: 'below', frame: [560, 120, 740, 130] },
    { t: l.w("what it's waiting on"), boxes: [b.after], label: 'waits on', side: 'below', frame: [560, 120, 740, 130] },
    { t: l.w('who to tell'), boxes: [b.tell], label: 'who to tell' },
  ], 1.9, 'jira');
  const cam = track([{ ...camFor([440, 98, 860, 340], 1.9) }, ...keys]);
  s.frame = (t) => ({ layers: [{ view: J('lists'), cam: cam(t) }], tag: 'jira' });
}

// 8. post the forecast
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('post', start + 1.1);
  const click = l.w('click') + 0.1;
  const posted = click + 0.75;
  const s = shot('post', start, l.end + 0.35, {});
  const b = BOX.lists;
  const keys = addCallouts(s, [
    { t: l.w('one click'), boxes: [b.post], label: 'Post forecast', side: 'above', frame: [440, 700, 620, 200] },
    { t: Math.max(posted + 0.2, l.w('as a comment')), boxes: [b.posted], label: 'posted', side: 'above', frame: [440, 700, 620, 200] },
  ], 1.9, 'jira');
  const cam = track([{ ...camFor([440, 640, 860, 260], 1.9) }, ...keys]);
  const cur = cursorPath([{ t: start + 0.3, x: 980, y: 640 }, { t: click - 0.05, x: 560, y: 826 }], [click], { in: start + 0.3 });
  s.frame = (t) => {
    const layers = [{ view: J('lists'), cam: cam(t) }];
    if (t >= click + 0.08 && t < posted + 0.25) layers.push({ view: J('lists', [['patch-posting', 424, 775]]), cam: cam(t), alpha: clamp01((t - click - 0.08) / 0.15) });
    if (t >= posted) layers.push({ view: J('lists', [['posted-left', 0, 0], ['patch-posted-right', 956, 775]]), cam: cam(t), alpha: clamp01((t - posted) / 0.25) });
    return { layers, cursor: { ...cur(t), size: 26 }, tag: 'jira' };
  };
}

// 9. the comment in the issue activity
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('comment', start + 0.3);
  const s = shot('comment', start, l.end + 0.9, {});
  const b = BOX.comment;
  const keys = addCallouts(s, [
    { t: start + 0.35, boxes: [b.body], label: 'forecast posted as a Jira comment', frame: [470, 240, 860, 520] },
    { t: l.w('the same numbers'), boxes: [b.head], label: 'same numbers as the panel', side: 'above', frame: [480, 250, 840, 220] },
  ], 1.9, 'jira');
  const cam = track([{ cx: 900, cy: 470, s: 1.3 }, ...keys]);
  s.frame = (t) => ({ layers: [{ view: J('comment'), cam: cam(t) }], tag: 'jira' });
}

// 10-12. follow the chain to CHK-5
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('nav', start + 1.2);
  const click = l.w('click') + 0.15;
  const toTop = l.w('follow the chain') - 0.25;
  const toPanel = l.w('if the test suite') - 0.3;
  const sl = shot('navList', start, toTop + XF, {});
  const kl = addCallouts(sl, [{ t: l.w('click any issue'), boxes: [BOX.nav.link], label: 'CHK-5', side: 'below', frame: [440, 220, 700, 220] }], 1.9, 'jira');
  const camL = track([{ ...camFor([440, 98, 860, 420], 1.9) }, ...kl]);
  const cur = cursorPath([{ t: start + 0.3, x: 900, y: 600 }, { t: click - 0.05, x: 512, y: 322 }], [click], { in: start + 0.3, out: click + 0.4 });
  sl.frame = (t) => ({ layers: [{ view: J('nav'), cam: camL(t) }], cursor: { ...cur(t), size: 26 }, tag: 'jira' });

  const st = shot('navTop', toTop, toPanel + XF, {});
  const kt = addCallouts(st, [{ t: toTop + 0.3, boxes: [BOX.c5top.title], label: 'CHK-5: Checkout end-to-end test suite', side: 'below', frame: [430, 80, 760, 260] }], 1.9, 'jira');
  const camT = track([{ ...camFor([430, 80, 900, 420], 1.9) }, ...kt]);
  st.frame = (t) => ({ layers: [{ view: J('c5top'), cam: camT(t) }], tag: 'jira' });

  const sp = shot('navPanel', toPanel, l.end + 0.6, {});
  const b = BOX.c5;
  const kp = addCallouts(sp, [
    { t: l.w('slips a week'), boxes: [b.num, b.chipWeek], label: 'slip: 5 business days', frame: [440, 150, 860, 170] },
    { t: l.w('the beta rollout'), boxes: b.late, label: 'beta rollout and epic miss their dates' },
    { t: l.w('the release lands'), boxes: [b.release, b.badge], label: 'release +4 business days' },
  ], 1.9, 'jira');
  const camP = track([{ ...camFor([440, 110, 860, 520], 1.9) }, ...kp]);
  sp.frame = (t) => ({ layers: [{ view: J('c5'), cam: camP(t) }], tag: 'jira' });
}

// 13. end card
{
  const start = shots.at(-1).at + shots.at(-1).len - XF;
  const l = say('end', start + 0.5);
  shot('end', start, l.end + 1.8, { frame: () => ({ layers: [], card: 'end' }) });
}
const TOTAL = shots.at(-1).at + shots.at(-1).len;

// Captions: one sentence at a time, spread over the line by word timing.
const captions = [];
for (const s of says) {
  const line = vo[s.name];
  const parts = line.text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const merged = [];
  for (const p of parts) {
    if (merged.length && (merged.at(-1).length < 26 || p.length < 22)) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }
  let wi = 0;
  for (const p of merged) {
    const n = p.split(/\s+/).length;
    const from = s.t + line.words[wi].t;
    const to = s.t + line.words[Math.min(line.words.length, wi + n) - 1].end;
    captions.push({ text: p, from, to });
    wi += n;
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
const toScreen = (cam, [x, y, w, h]) => [(x - cam.cx) * cam.s + W / 2, (y - cam.cy) * cam.s + H / 2, w * cam.s, h * cam.s];

function frameState(t) {
  const active = shots.filter((s) => t >= s.at && t < s.at + s.len);
  const out = { layers: [], cursor: null, tag: null, cards: [], caption: null, captionAlpha: 0, callout: null };
  for (const s of active) {
    const fadeIn = s === shots[0] ? 1 : clamp01((t - s.at) / XF);
    const f = s.frame(t);
    const layers = f.layers.map((l) => ({ ...l, cam: clampCam(l.cam, l.view), alpha: (l.alpha ?? 1) * fadeIn }));
    out.layers.push(...layers);
    if (f.card) out.cards.push({ id: f.card, alpha: fadeIn, local: t - s.at });
    if (fadeIn > 0.5) {
      if (f.cursor) out.cursor = { ...f.cursor, cam: layers[0].cam };
      if (f.tag) out.tag = f.tag;
      const c = callouts.filter((x) => x.shot === s.name && t >= x.t && t < x.end).at(-1);
      if (c && layers.length) {
        const cam = layers[0].cam;
        const local = t - c.t;
        const alpha = Math.min(clamp01(local / 0.25), clamp01((c.end - t) / 0.2), clamp01((t - s.at - XF * 0.6) / 0.2));
        out.callout = { boxes: c.boxes.map((b) => toScreen(cam, b)), label: c.label, side: c.side, pulse: !!c.pulse, draw: easeOut(clamp01((local - 0.05) / 0.35)), local, alpha, light: !!layers[0].light };
      }
    }
  }
  const cap = captions.find((x) => t >= x.from - 0.05 && t < x.to + 0.15);
  if (cap) {
    out.caption = cap.text;
    out.captionAlpha = Math.min(clamp01((t - cap.from + 0.05) / 0.2), clamp01((cap.to + 0.15 - t) / 0.2));
  }
  if (t > TOTAL - 0.6) out.fadeOut = clamp01((t - (TOTAL - 0.6)) / 0.6);
  return out;
}

console.log(shots.map((s) => `${s.name} ${s.at.toFixed(2)}+${s.len.toFixed(2)}`).join(' | '), `total ${TOTAL.toFixed(2)} s, ${callouts.length} callouts`);

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
#tag .dot{width:10px;height:10px;border-radius:50%;background:#4bce97;box-shadow:0 0 0 4px rgba(75,206,151,.18)}
#tag .sub{font-weight:500;color:#9fadbc}
#cap{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);max-width:1320px;padding:12px 26px;border-radius:14px;background:rgba(10,12,14,.86);color:#f1f2f4;font-size:30px;line-height:1.32;font-weight:500;text-align:center;letter-spacing:-.008em;box-shadow:0 0 0 1px rgba(255,255,255,.07),0 12px 30px rgba(0,0,0,.4);opacity:0}
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
const dim=document.createElement('canvas'); dim.width=W; dim.height=H; const dctx=dim.getContext('2d');
const cache=new Map();
async function img(src){ let e=cache.get(src); if(!e){ e=new Image(); e.src=src; cache.set(src,e); if(cache.size>40){ const k=[...cache.keys()].find(k=>k.startsWith('preview-frames/')&&k!==src); if(k) cache.delete(k);} } if(!e.complete||!e.naturalWidth) await e.decode(); return e; }
function rr(c,x,y,w,h,r){ r=Math.min(r,w/2,h/2); c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
const TAGS={
  jira:'<span class="dot"></span><span>Live in Jira Cloud</span><span class="sub">&middot; Forge development build</span>',
  preview:'<span class="dot" style="background:#579dff;box-shadow:0 0 0 4px rgba(87,157,255,.2)"></span><span>Same panel code</span><span class="sub">&middot; local preview, sample data, real time</span>',
};
const ACCENT='#388bff';
function drawCallout(c){
  const P=10; // ring padding (px)
  const boxes=c.boxes.map(([x,y,w,h])=>[x-P,y-P,w+2*P,h+2*P]);
  // spotlight: dim everything except the named element(s), soft edge
  dctx.clearRect(0,0,W,H); dctx.globalCompositeOperation='source-over'; dctx.filter='none';
  dctx.fillStyle='rgba(6,8,10,'+(0.6*c.alpha)+')'; dctx.fillRect(0,0,W,H);
  dctx.globalCompositeOperation='destination-out'; dctx.filter='blur(14px)'; dctx.fillStyle='#000';
  for(const [x,y,w,h] of boxes){ rr(dctx,x-4,y-4,w+8,h+8,16); dctx.fill(); }
  dctx.filter='none'; dctx.globalCompositeOperation='source-over';
  ctx.drawImage(dim,0,0);
  // rings that draw on
  const pulse=c.pulse? 1+0.06*Math.sin(Math.min(1,c.local/0.9)*Math.PI*2)*Math.max(0,1-c.local/1.2) : 1;
  ctx.save(); ctx.globalAlpha=c.alpha; ctx.lineWidth=4; ctx.strokeStyle=ACCENT; ctx.lineCap='round';
  ctx.shadowColor='rgba(56,139,255,0.6)'; ctx.shadowBlur=14;
  for(const [x,y,w,h] of boxes){
    const cx=x+w/2, cy=y+h/2, ww=w*pulse, hh=h*pulse;
    const per=2*(ww+hh); ctx.setLineDash([per*c.draw, per]);
    rr(ctx,cx-ww/2,cy-hh/2,ww,hh,12); ctx.stroke();
  }
  ctx.setLineDash([]);
  if(c.pulse){ // underline the number being read
    ctx.lineWidth=5; ctx.shadowBlur=10; ctx.strokeStyle='#ffd166';
    for(const [x,y,w,h] of c.boxes){ const u=Math.min(1,Math.max(0,(c.local-0.15)/0.35)); ctx.beginPath(); ctx.moveTo(x,y+h+P+9); ctx.lineTo(x+w*u,y+h+P+9); ctx.stroke(); }
  }
  ctx.restore();
  // label with a leader line
  if(c.label){
    const u=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),0,0];
    u[2]=Math.max(...boxes.map(b=>b[0]+b[2]))-u[0]; u[3]=Math.max(...boxes.map(b=>b[1]+b[3]))-u[1];
    ctx.save(); ctx.font='600 26px -apple-system,BlinkMacSystemFont,sans-serif';
    const tw=ctx.measureText(c.label).width, lw=tw+36, lh=46, gap=40;
    let side=c.side; if(side==='above' && u[1]-gap-lh<84) side='below'; if(side==='below' && u[1]+u[3]+gap+lh>H-140) side='above';
    const ax=Math.max(24+lw/2,Math.min(W-24-lw/2,u[0]+Math.min(u[2]/2, 220)));
    const ay= side==='above'? u[1] : u[1]+u[3];
    const ly= side==='above'? ay-gap-lh : ay+gap;
    const lx=ax-lw/2;
    const lt=Math.min(1,Math.max(0,(c.local-0.12)/0.25)), pt=Math.min(1,Math.max(0,(c.local-0.25)/0.25));
    ctx.globalAlpha=c.alpha; ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
    const y0= side==='above'? ay : ay, y1= side==='above'? ay-gap*lt : ay+gap*lt;
    ctx.beginPath(); ctx.moveTo(ax,y0); ctx.lineTo(ax,y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(ax,y0,5,0,Math.PI*2); ctx.fillStyle=ACCENT; ctx.fill();
    ctx.globalAlpha=c.alpha*pt; const dy=(1-pt)*(side==='above'?8:-8);
    ctx.shadowColor='rgba(0,0,0,0.45)'; ctx.shadowBlur=16; ctx.shadowOffsetY=4;
    rr(ctx,lx,ly+dy,lw,lh,23); ctx.fillStyle=ACCENT; ctx.fill(); ctx.shadowColor='transparent';
    ctx.fillStyle='#ffffff'; ctx.textBaseline='middle'; ctx.fillText(c.label,lx+18,ly+dy+lh/2+1);
    ctx.restore();
  }
}
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
    rr(ctx,x,y,w,h,18); ctx.fillStyle=l.light?'#f7f8f9':'#1d2125'; ctx.fill();
    ctx.shadowColor='transparent';
    rr(ctx,x,y,w,h,18); ctx.clip();
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(await img(v.base),x,y,w,h);
    for(const p of v.patches){ const im=await img(p.src); ctx.drawImage(im,x+p.x*c.s,y+p.y*c.s,im.naturalWidth*c.s,im.naturalHeight*c.s); }
    ctx.restore();
    ctx.save(); ctx.globalAlpha=l.alpha*0.9; rr(ctx,x+0.5,y+0.5,w-1,h-1,18); ctx.strokeStyle='rgba(255,255,255,0.09)'; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
  }
  if(st.callout && st.callout.alpha>0) drawCallout(st.callout);
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
writeFileSync(join(work, 'timeline.json'), JSON.stringify({ total: TOTAL, shots: shots.map((s) => ({ name: s.name, at: s.at, len: s.len })), says, captions, callouts: callouts.map((c) => ({ shot: c.shot, t: c.t, end: c.end, label: c.label })) }, null, 1));

if (only) {
  for (const t of only) {
    await page.evaluate((st) => window.renderFrame(st), frameState(t));
    await page.screenshot({ path: join(work, `still-${t.toFixed(2)}.png`) });
  }
  await browser.close();
  console.log(`stills written to ${work}`);
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
