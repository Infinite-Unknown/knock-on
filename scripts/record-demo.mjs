// Records a narrated walkthrough of the local preview to assets/demo.mp4.
// Usage: npm run preview (in another terminal), then: npm run demo [-- http://localhost:5178]
// Needs macOS `say` and ffmpeg on PATH.
import { chromium } from 'playwright-core';
import { cardHtml } from './demo-card.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = (process.argv[2] || 'http://localhost:5178').replace(/\/$/, '');
const root = resolve(import.meta.dirname, '..');
const raw = join(root, 'assets', 'raw');
const W = 1280;
const H = 720;
rmSync(raw, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });

const SEGMENTS = {
  title: 'Knock-On is a Forge app for Jira. It answers the question every standup skips: if this issue slips, what else breaks?',
  intro: 'This is a checkout project. CHK-12, the payment API migration, blocks two stories. They block the test suite, the beta rollout, and the epic. Knock-On reads the blocks links and parent issues from Jira and walks everything downstream.',
  oneDay: 'If it slips one business day, every downstream issue still makes its due date. Slack absorbs it, and the panel shows how much slack is left.',
  threeDays: 'Three days is different. Four issues now miss their due dates, and the Checkout 2.0 release is at risk. The forecast counts business days and uses each issue’s original estimate.',
  drag: 'Drag the slider and the red spreads as you go. At eight days, the epic slips too.',
  lists: 'Every broken date is listed with its owner and the new finish date. The analytics story also waits on fraud sign-off, so it keeps its own date, and Knock-On says so.',
  post: 'It names the people to tell. One click posts the forecast to the issue as a comment, so the whole team works from the same numbers.',
  tools: 'The same engine is exposed as two Rovo actions, used by the Knock-On agent, and published through the Rovo MCP module. This is the function those tools run, here on the sample data.',
  conflicts: 'The second tool scans a whole project for plans that are already broken. Here, a tax update is due after the invoice work it blocks.',
  navigate: 'Click any issue to see its own knock-on effect.',
  close: 'Knock-On: a Jira issue panel, a Rovo agent and an MCP server, built on Forge. This recording is the local preview with sample data. The same build deploys to Jira with forge deploy.',
};

// 1. Narration audio, one file per segment, so each scene lasts as long as its line.
const audio = {};
for (const [name, text] of Object.entries(SEGMENTS)) {
  const aiff = join(raw, `${name}.aiff`);
  execFileSync('say', ['-r', '182', '-o', aiff, text]);
  const seconds = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', aiff]).toString().trim(),
  );
  audio[name] = { file: aiff, seconds };
}

const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: raw, size: { width: W, height: H } } });
const page = await context.newPage();
const started = Date.now();
const marks = [];
const wait = (ms) => page.waitForTimeout(ms);

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText =
        'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:980px;padding:8px 16px;border-radius:10px;background:rgba(23,43,77,.92);color:#fff;font:500 17px/24px -apple-system,BlinkMacSystemFont,sans-serif;z-index:99999;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.25)';
      document.body.appendChild(el);
    }
    el.textContent = t;
    el.style.display = t ? 'block' : 'none';
  }, text);
}

/** Start a scene: mark the audio offset, show the caption, run actions spread over the line's length. */
async function scene(name, actions = async () => {}) {
  marks.push({ name, at: (Date.now() - started) / 1000 });
  await caption(SEGMENTS[name]);
  const t0 = Date.now();
  await actions();
  const left = audio[name].seconds * 1000 + 500 - (Date.now() - t0);
  if (left > 0) await wait(left);
}

async function card(title, lines) {
  await page.setContent(cardHtml(title, lines));
}

const zoom = () => page.addStyleTag({ content: 'html{zoom:1.3}' });
const scrollTo = (selector, offset = 90) =>
  page.evaluate(
    ([s, o]) => {
      const el = document.querySelector(s);
      if (el) window.scrollTo({ top: (el.getBoundingClientRect().top + window.scrollY) * 1 - o, behavior: 'smooth' });
    },
    [selector, offset],
  );
const scrollBy = (y) => page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'smooth' }), y);
const chip = (label) => page.locator('.ko-chip', { hasText: label }).click();

await card('Knock-On', ['If this issue slips, <b>what else breaks?</b>', 'Forge app for Jira &middot; issue panel &middot; Rovo agent &middot; MCP tools']);
await scene('title');

await page.goto(`${base}/?issue=CHK-12`);
await zoom();
await page.waitForSelector('.ko-svg');
await scene('intro', async () => {
  await scrollTo('.ko-graph', 160);
  await wait(4000);
  for (const k of ['CHK-15', 'CHK-21', 'CHK-24', 'CHK-10']) {
    await page.locator(`.ko-node[data-key="${k}"]`).hover();
    await wait(900);
  }
});

await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await scene('oneDay', async () => {
  await wait(600);
  await chip('1 day');
  await wait(2500);
  await scrollTo('.ko-group', 120);
});

await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await scene('threeDays', async () => {
  await wait(600);
  await chip('3 days');
  await wait(1200);
  await scrollTo('#ko-summary', 24);
});

await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await scene('drag', async () => {
  await wait(500);
  const box = await page.locator('#ko-range').boundingBox();
  const y = box.y + box.height / 2;
  const at = (v) => box.x + (box.width * v) / 20;
  await page.mouse.move(at(3), y);
  await page.mouse.down();
  for (let v = 3; v <= 8; v += 0.25) {
    await page.mouse.move(at(v), y);
    await wait(70);
  }
  await page.mouse.up();
});

await scene('lists', async () => {
  await scrollTo('.ko-releases', 140);
  await wait(3500);
  await scrollBy(300);
});

await scene('post', async () => {
  await scrollTo('.ko-people', 260);
  await wait(3200);
  await page.locator('#ko-post').click();
  await wait(1200);
  await scrollTo('#hx-comments', 120);
});

await scene('tools', async () => {
  await scrollTo('#hx-form', 160);
  await wait(1500);
  await page.fill('input[name="slipDays"]', '5');
  await page.locator('#hx-form button').click();
  await wait(1500);
  await scrollBy(260);
});

await scene('conflicts', async () => {
  await scrollTo('#hx-form', 160);
  await page.selectOption('select[name="action"]', 'find-schedule-conflicts');
  await wait(700);
  await page.locator('#hx-form button').click();
});

await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await wait(800);
await scene('navigate', async () => {
  await scrollTo('.ko-rows', 160);
  await wait(1200);
  await page.locator('.ko-key', { hasText: 'CHK-21' }).first().click();
  await page.waitForSelector('.ko-svg');
  await zoom();
  await chip('1 week');
});

await card('Knock-On', [
  'Which due dates break, which releases slip, <b>and who to tell.</b>',
  'Jira issue panel (Custom UI) &middot; Rovo agent with 2 actions &middot; rovo:mcp server',
  'Shown: local preview with sample data and an in-memory Jira API',
]);
await scene('close');

const total = (Date.now() - started) / 1000;
await page.close();
await context.close();
await browser.close();

// 2. Mix the narration onto the silent screen capture at the recorded offsets.
const webm = readdirSync(raw).find((f) => f.endsWith('.webm'));
const inputs = ['-i', join(raw, webm)];
const filters = [];
marks.forEach((m, i) => {
  inputs.push('-i', audio[m.name].file);
  const ms = Math.round(m.at * 1000);
  filters.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`);
});
filters.push(`${marks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${marks.length}:normalize=0[aout]`);
writeFileSync(join(raw, 'marks.json'), JSON.stringify({ total, marks }, null, 2));
execFileSync(
  'ffmpeg',
  ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-t', total.toFixed(2), join(root, 'assets', 'demo.mp4')],
  { stdio: 'inherit' },
);
console.log(`Wrote assets/demo.mp4 (${total.toFixed(1)} s)`);
