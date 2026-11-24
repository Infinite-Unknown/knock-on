// Builds assets/demo-jira.mp4 from screenshots of the app running in a real Jira site
// (assets/raw/jira/*.png), with captions and a narrated voice-over.
// Needs macOS `say` and ffmpeg on PATH.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cardHtml } from './demo-card.mjs';

const root = resolve(import.meta.dirname, '..');
const frames = join(root, 'assets', 'raw', 'jira');
const work = join(root, 'assets', 'raw', 'jira-video');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const W = 1280;
const H = 720;

const img = (name) => `data:image/png;base64,${readFileSync(join(frames, name)).toString('base64')}`;

const SCENES = [
  { card: 'title', text: 'Knock-On is a Forge app for Jira. It answers the question every standup skips: if this issue slips, what else breaks?' },
  { frames: ['01-issue.png'], step: 'Jira Cloud', text: 'This is a real Jira site. CHK-2, the payment API migration, blocks two stories. They block the test suite, the beta rollout, and the epic.' },
  { frames: ['02-week.png'], step: 'Slip: 1 week', text: 'The Knock-On panel reads those links from Jira. If CHK-2 slips a week, five of six downstream issues miss their due dates, and the Checkout 2.0 release lands three business days late.' },
  { frames: ['03-day.png'], step: 'Slip: 1 day', text: 'At one day, every downstream issue still makes its date. The slack absorbs it.' },
  { frames: ['04-three-mid.png', '05-three.png'], step: 'Slip: 3 days', text: 'At three days, the red spreads down the chain. Four due dates break and the release is one day late. The analytics story has slack, so it keeps its date.' },
  { frames: ['06-lists.png'], step: 'Who is affected', text: 'Every broken date is listed with its new finish date, and the people to tell.' },
  { frames: ['07-posted.png'], step: 'Share it', text: 'One click posts the forecast to the issue.' },
  { frames: ['08-comment.png'], step: 'Jira comment', text: 'Here it is in the issue activity, so the whole team works from the same numbers.' },
  { frames: ['09-chk5.png'], step: 'Follow the chain', text: 'Click any issue to follow the chain. If the test suite itself slips a week, the beta rollout and the epic both miss their dates.' },
  { card: 'close', text: 'Knock-On, built on Forge. Know the knock-on effect before the standup ends.' },
];

// Narration, one file per scene.
SCENES.forEach((s, i) => {
  s.audio = join(work, `${i}.aiff`);
  execFileSync('say', ['-r', '180', '-o', s.audio, s.text]);
  s.seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', s.audio]).toString().trim());
});

const player = `<!doctype html><html><head><style>
  *{box-sizing:border-box} body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#161a1d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#dee4ea}
  .stage{position:absolute;left:48px;top:40px;width:726px;height:640px;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.06)}
  .stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;opacity:0;transform:scale(1.0);transition:opacity 450ms ease}
  .stage img.on{opacity:1;animation:push 9s linear forwards}
  @keyframes push{to{transform:scale(1.035)}}
  .side{position:absolute;left:822px;top:40px;width:410px;height:640px;display:flex;flex-direction:column;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.01em}
  .brand svg{width:34px;height:34px}
  .step{font-size:15px;font-weight:600;color:#f87168;margin-bottom:14px}
  .cap{font-size:27px;line-height:1.38;font-weight:500;color:#f1f2f4;transition:opacity 300ms ease}
  .foot{font-size:14px;color:#8c9bab}
</style></head><body>
  <div class="stage" id="stage"></div>
  <div class="side">
    <div class="brand"><svg viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0C66E4"/><circle cx="6" cy="12" r="2.6" fill="#fff"/><circle cx="12.5" cy="7.5" r="2.1" fill="#fff" opacity=".9"/><circle cx="12.5" cy="16.5" r="2.1" fill="#fff" opacity=".9"/><circle cx="18.5" cy="12" r="1.7" fill="#FF8F73"/><path d="M8.3 11l2.4-2.2M8.3 13l2.4 2.2M14.4 8.6l2.6 2.4M14.4 15.4l2.6-2.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>Knock-On</div>
    <div><div class="step" id="step"></div><div class="cap" id="cap"></div></div>
    <div class="foot">Recorded in Jira Cloud · Forge development build</div>
  </div>
</body></html>`;

const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: work, size: { width: W, height: H } } });
const page = await context.newPage();
const started = Date.now();
const marks = [];
let playerLoaded = false;

for (const [i, s] of SCENES.entries()) {
  marks.push({ i, at: (Date.now() - started) / 1000 });
  const t0 = Date.now();
  if (s.card) {
    playerLoaded = false;
    const lines =
      s.card === 'title'
        ? ['If this issue slips, <b>what else breaks?</b>', 'Forge app for Jira &middot; recorded on a live Jira Cloud site']
        : ['Which due dates break, which releases slip, <b>and who to tell.</b>', 'Jira issue panel &middot; Forge &middot; business-day forecasts'];
    await page.setContent(cardHtml('Knock-On', lines));
  } else {
    if (!playerLoaded) {
      await page.setContent(player);
      playerLoaded = true;
    }
    await page.evaluate(
      ([src, step, cap]) => {
        const stage = document.getElementById('stage');
        const im = document.createElement('img');
        im.src = src;
        stage.appendChild(im);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          for (const o of stage.querySelectorAll('img.on')) {
            o.classList.remove('on');
            setTimeout(() => o.remove(), 600);
          }
          im.classList.add('on');
        }));
        document.getElementById('step').textContent = step;
        document.getElementById('cap').textContent = cap;
      },
      [img(s.frames[0]), s.step, s.text],
    );
    if (s.frames[1]) {
      await page.waitForTimeout(900);
      await page.evaluate((src) => {
        const stage = document.getElementById('stage');
        const im = document.createElement('img');
        im.src = src;
        stage.appendChild(im);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          for (const o of stage.querySelectorAll('img.on')) {
            o.classList.remove('on');
            setTimeout(() => o.remove(), 600);
          }
          im.classList.add('on');
        }));
      }, img(s.frames[1]));
    }
  }
  const left = s.seconds * 1000 + 700 - (Date.now() - t0);
  if (left > 0) await page.waitForTimeout(left);
}

const total = (Date.now() - started) / 1000;
await page.close();
await context.close();
await browser.close();

const webm = readdirSync(work).find((f) => f.endsWith('.webm'));
const inputs = ['-i', join(work, webm)];
const filters = [];
marks.forEach((m, k) => {
  inputs.push('-i', SCENES[m.i].audio);
  const ms = Math.round(m.at * 1000);
  filters.push(`[${k + 1}:a]adelay=${ms}|${ms}[a${k}]`);
});
filters.push(`${marks.map((_, k) => `[a${k}]`).join('')}amix=inputs=${marks.length}:normalize=0[aout]`);
writeFileSync(join(work, 'marks.json'), JSON.stringify({ total, marks }, null, 2));
execFileSync(
  'ffmpeg',
  ['-y', '-v', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-t', total.toFixed(2), join(root, 'assets', 'demo-jira.mp4')],
  { stdio: 'inherit' },
);
console.log(`Wrote assets/demo-jira.mp4 (${total.toFixed(1)} s)`);
