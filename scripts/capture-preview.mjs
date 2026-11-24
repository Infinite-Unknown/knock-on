// Captures the issue panel in the local preview while the slip slider is dragged, frame by frame,
// for the demo video. CSS animations are slowed down through the DevTools protocol so every
// step of the ripple is caught; each frame is stamped with its animation-time position, and
// the video renderer plays them back at real speed.
// Usage: npm run preview (in another terminal), then: node scripts/capture-preview.mjs [base-url]
// Writes assets/raw/preview-frames/*.jpg and assets/raw/preview-frames/timeline.json
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = (process.argv[2] || 'http://localhost:5178').replace(/\/$/, '');
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'assets', 'raw', 'preview-frames');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const VIEW = { width: 1000, height: 562 };
const DPR = 3;
const RATE = 0.08; // animation playback rate while capturing
const END = 11.5; // seconds of animation time to capture

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: DPR });
await page.goto(`${base}/?issue=CHK-12`);
await page.waitForSelector('.ko-svg');
await page.waitForTimeout(1500);
await page.fill('#ko-num', '0');
await page.locator('#ko-num').blur();
await page.mouse.move(VIEW.width - 2, VIEW.height - 2);
await page.waitForTimeout(1200);

const geo = await page.evaluate(() => {
  const r = (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const q = (s) => (document.querySelector(s) ? r(document.querySelector(s)) : null);
  const nodes = {};
  for (const n of document.querySelectorAll('.ko-node')) nodes[n.dataset.key] = r(n);
  return { range: q('#ko-range'), graph: q('.ko-graph'), summary: q('#ko-summary'), controls: q('.ko-question'), nodes };
});
const thumbX = (v) => geo.range.x + 10 + (v / 20) * (geo.range.w - 20);
const thumbY = geo.range.y + geo.range.h / 2;

// Drag plan in animation-time seconds: [start, end, fromValue, toValue]
const moves = [
  [1.15, 2.1, 0, 1],
  [3.1, 4.3, 1, 3],
  [5.3, 7.3, 3, 8],
];
const DOWN = 1.0;
const UP = 7.45;

const cdp = await page.context().newCDPSession(page);
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: RATE });

const frames = [];
const mouse = [];
let down = false;
let up = false;
const t0 = Date.now();
const now = () => ((Date.now() - t0) / 1000) * RATE;

for (let i = 0; ; i++) {
  const v = now();
  if (v > END) break;
  if (!down && v >= DOWN) {
    await page.mouse.move(thumbX(0), thumbY);
    await page.mouse.down();
    down = true;
    mouse.push({ t: v, x: thumbX(0), y: thumbY, down: true });
  }
  if (down && !up) {
    const m = moves.find(([a, b]) => v >= a && v <= b) ?? [...moves].reverse().find(([, b]) => v > b);
    if (m) {
      const [a, b, from, to] = m;
      const p = Math.min(1, Math.max(0, (v - a) / (b - a)));
      const x = thumbX(from + (to - from) * ease(p));
      await page.mouse.move(x, thumbY);
      mouse.push({ t: v, x, y: thumbY, down: true });
    }
    if (v >= UP) {
      await page.mouse.up();
      up = true;
      mouse.push({ t: v, x: thumbX(8), y: thumbY, down: false });
    }
  }
  const before = now();
  const file = `${String(i).padStart(5, '0')}.jpg`;
  await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 92 });
  frames.push({ file, t: (before + now()) / 2 });
}

await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
writeFileSync(join(out, 'timeline.json'), JSON.stringify({ view: VIEW, dpr: DPR, rate: RATE, end: END, geo, frames, mouse }, null, 1));
await browser.close();
console.log(`Captured ${frames.length} frames over ${END}s of animation time`);
