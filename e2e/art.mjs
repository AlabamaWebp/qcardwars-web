/**
 * Art audit (request: verify card art in a REAL game state, DOM included).
 *
 * Spawns isolated servers, plays a short solo match (units + buildings reach
 * the board), then audits:
 *  - hand art frames: identical boxes, all images loaded with natural size;
 *  - mean luminance of every art (canvas sample; flags muddy/dark art);
 *  - board thumbs: identical boxes, all loaded;
 *  - tooltip reveals on hover; full-log modal opens;
 *  - mobile 390x844: no page scroll;
 *  - screenshots → e2e/artifacts/ for human review.
 *
 * Run: `pnpm e2e:art` (needs system Chrome, same `CHROME_PATH` rule as e2e).
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER_PORT = Number(process.env.E2E_ART_SERVER_PORT ?? 3113);
const WEB_PORT = Number(process.env.E2E_ART_WEB_PORT ?? 4224);
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS = path.join(ROOT, 'e2e', 'artifacts');

function report(msg) {
  console.log(`[art] ${msg}`);
}
function fail(msg) {
  throw new Error(msg);
}

const procs = [];
function spawnProc(name, cmd, env = {}) {
  const child = spawn(cmd, { cwd: ROOT, shell: true, env: { ...process.env, ...env } });
  let buf = '';
  child.stdout.on('data', (d) => { buf += String(d); });
  child.stderr.on('data', (d) => { buf += String(d); });
  procs.push({ name, child, buffer: () => buf });
  return child;
}
function killAll() {
  for (const { child } of procs) {
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }
}
async function waitForHttp(url, timeout, label) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeout) fail(`${label} never came up at ${url}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  report('building game-core');
  execSync('pnpm --filter @qcw/game-core build', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  report(`spawning server :${SERVER_PORT} and web :${WEB_PORT}`);
  spawnProc('server', 'pnpm --filter @qcw/server exec nest start', { PORT: String(SERVER_PORT) });
  spawnProc('web', `pnpm --filter @qcw/web exec ng serve --host 127.0.0.1 --port ${WEB_PORT}`);
  let browser = null;
  const errors = [];
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,900', '--lang=en-US'],
    });
    await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/`, 120000, 'server');
    await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, 240000, 'web');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${WEB_PORT}/?backendPort=${SERVER_PORT}`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`http://127.0.0.1:${WEB_PORT}/?backendPort=${SERVER_PORT}`, { waitUntil: 'networkidle0' });

    // Start a solo match with default (mirrored) lanes.
    await page.waitForSelector('qcw-lobby', { timeout: 30000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Play solo'));
      if (!b) throw new Error('no solo button');
      b.click();
    });
    await page.waitForSelector('qcw-game .board .lane', { timeout: 30000 });

    const laneSide = (lane) => {
      const name = lane.querySelector('.lane-name').textContent.replace(/\s+/g, ' ').trim();
      const m = name.match(/you:\s*(\w+)/i);
      return (m ? m[1] : name.split(' ')[0]).toLowerCase();
    };
    // Play a few turns so units AND buildings reach the board.
    for (let round = 0; round < 10; round += 1) {
      const acted = await page.evaluate((laneSideSrc) => {
        const laneSide = new Function('lane', `return (${laneSideSrc})(lane)`);
        const turn = document.querySelector('.turn')?.textContent ?? '';
        if (!turn.includes('YOUR TURN')) return 'wait';
        const cards = [...document.querySelectorAll('qcw-card .card')].map((c) => ({
          name: c.querySelector('.art-name')?.textContent ?? c.querySelector('strong')?.textContent ?? '?',
          faction: (c.querySelector('small')?.textContent ?? '').split('·')[0].trim().toLowerCase(),
          kind: (c.querySelector('.kind')?.textContent ?? '').trim().toLowerCase(),
          cost: Number(c.querySelector('.cost')?.textContent ?? 99),
          el: c,
        }));
        const manaText = document.querySelector('.self.playerbar')?.textContent ?? '';
        const manaMatch = manaText.match(/(\d+)\/(\d+)/);
        const mana = manaMatch ? Number(manaMatch[1]) : NaN;
        const lanes = [...document.querySelectorAll('.board .lane')];
        for (const card of cards) {
          if (card.cost > mana || card.el.disabled) continue;
          if (card.kind === 'power') continue; // keep the board focused on units/buildings
          for (const lane of lanes) {
            const side = lane.querySelector('.slot.own');
            if (card.kind === 'unit' && side.querySelector('.unit')) continue;
            if (card.kind === 'building' && side.querySelector('.building')) continue;
            if (card.faction !== 'universal' && card.faction !== laneSide(lane)) continue;
            card.el.click();
            lane.click();
            return `played:${card.name}`;
          }
        }
        const end = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'End turn');
        if (end && !end.disabled) { end.click(); return 'ended'; }
        return 'wait';
      }, laneSide.toString());
      if (acted.startsWith('played')) { await new Promise((r) => setTimeout(r, 400)); continue; }
      report(`round ${round}: ${acted}`);
      // Wait for our next turn (AI ticks ~700ms per action).
      try {
        await page.waitForFunction(
          () => (document.querySelector('.turn')?.textContent ?? '').includes('YOUR TURN'),
          { timeout: 25000 },
        );
      } catch { break; }
      const units = await page.$$eval('.board .unit', (n) => n.length);
      if (units >= 4) break;
    }

    const audit = await page.evaluate(async () => {
      // Wait for every art image to finish decoding — sampling a half-ready
      // image yields black pixels and a bogus luminance of 0.
      const pending = [...document.querySelectorAll('qcw-card img.art, .board img.thumb')];
      await Promise.all(pending.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }));
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      };
      // Mean luminance per art via canvas (same-origin /cards → not tainted).
      const luminance = (img) => {
        try {
          const c = document.createElement('canvas');
          const w = 32; const h = 32;
          c.width = w; c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          return Math.round(sum / (w * h));
        } catch { return -1; }
      };
      const frames = [...document.querySelectorAll('qcw-card .art-frame')];
      const handImgs = [...document.querySelectorAll('qcw-card img.art')];
      const cards = [...document.querySelectorAll('qcw-card .card')];
      const thumbs = [...document.querySelectorAll('.board .unit img.thumb')];
      const bthumbs = [...document.querySelectorAll('.board .building img.thumb')];
      return {
        handCards: cards.length,
        cardBoxes: [...new Set(cards.map(box))],
        frameBoxes: [...new Set(frames.map(box))],
        handLoaded: handImgs.filter((i) => i.naturalWidth > 0).length + '/' + handImgs.length,
        handLuminance: handImgs.map((i) => ({
          src: i.src.split('/').pop(), lum: luminance(i), shown: box(i),
        })),
        boardUnits: document.querySelectorAll('.board .unit').length,
        thumbBoxes: [...new Set(thumbs.map(box))],
        thumbsLoaded: thumbs.filter((t) => t.naturalWidth > 0).length + '/' + thumbs.length,
        thumbLuminance: thumbs.map((t) => ({ src: t.src.split('/').pop(), lum: luminance(t) })),
        boardBuildings: document.querySelectorAll('.board .building').length,
        bthumbBoxes: [...new Set(bthumbs.map(box))],
        bthumbsLoaded: bthumbs.filter((t) => t.naturalWidth > 0).length + '/' + bthumbs.length,
        logEntries: document.querySelectorAll('.full-log div, .log div').length,
        pageScroll: {
          x: document.documentElement.scrollWidth - window.innerWidth,
          y: document.documentElement.scrollHeight - window.innerHeight,
        },
      };
    });

    // Tooltip must reveal on real hover.
    const chip = await page.$('.board .unit');
    if (!chip) {
      await page.screenshot({ path: path.join(ARTIFACTS, 'audit-debug-no-units.png') });
      const dbg = await page.evaluate(() => ({
        turn: document.querySelector('.turn')?.textContent,
        hand: [...document.querySelectorAll('qcw-card .card')].map((c) => c.querySelector('.art-name')?.textContent),
        log: [...document.querySelectorAll('.log div')].map((d) => d.textContent).slice(0, 8),
      }));
      report(`debug state: ${JSON.stringify(dbg)}`);
      fail('no board units reached — cannot audit chips/tooltips');
    }
    await chip.hover();
    const tipVisible = await page.evaluate(() => {
      const u = document.querySelector('.board .unit');
      return u ? getComputedStyle(u.querySelector('.tip')).display : 'missing';
    });
    // Full-log modal opens.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Full log'));
      if (!b) throw new Error('no full-log button');
      b.click();
    });
    await page.waitForSelector('.log-modal', { timeout: 5000 });
    await page.screenshot({ path: path.join(ARTIFACTS, 'audit-board.png') });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.log-modal button')].find((x) => x.textContent.trim() === 'Close');
      if (b) b.click();
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'audit-hand.png') });

    // Mobile: no page scroll.
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 500));
    const mobile = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
      thumbs: [...new Set([...document.querySelectorAll('.board .unit img.thumb')].map((t) => {
        const r = t.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      }))],
    }));
    await page.screenshot({ path: path.join(ARTIFACTS, 'audit-mobile.png') });

    const checks = [];
    const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) fail(`CHECK FAILED: ${name} ${detail}`); };
    report(`audit JSON:\n${JSON.stringify({ ...audit, tipVisible, mobile }, null, 1)}`);
    check('hand cards present', audit.handCards >= 3, `saw ${audit.handCards}`);
    check('hand cards uniform size', audit.cardBoxes.length === 1, audit.cardBoxes.join(','));
    check('art frames uniform size', audit.frameBoxes.length === 1, audit.frameBoxes.join(','));
    const handLoaded = audit.handLoaded.split('/');
    check('hand art all loaded', handLoaded[0] === handLoaded[1], audit.handLoaded);
    const dark = audit.handLuminance.filter((x) => x.lum >= 0 && x.lum < 35);
    check('no muddy-dark art (lum>=35)', dark.length === 0, dark.map((x) => `${x.src}:${x.lum}`).join(','));
    check('board units present', audit.boardUnits >= 2, `saw ${audit.boardUnits}`);
    check('board thumbs uniform', audit.thumbBoxes.length === 1, audit.thumbBoxes.join(','));
    const thLoaded = audit.thumbsLoaded.split('/');
    check('board thumbs all loaded', thLoaded[0] === thLoaded[1], audit.thumbsLoaded);
    check('tooltip reveals on hover', tipVisible === 'block', tipVisible);
    check('full-log modal opens', true);
    check('mobile no page scroll', mobile.x <= 0 && mobile.y <= 1, JSON.stringify(mobile));
    check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 500));

    report(`screenshots → e2e/artifacts/ (audit-board.png, audit-hand.png, audit-mobile.png)`);
    report('all art checks passed');
  } finally {
    if (browser) await browser.close().catch(() => {});
    killAll();
  }
}

main().catch((err) => {
  report(`FAILED: ${err?.stack ?? err}`);
  process.exitCode = 1;
}).finally(() => {
  // Spawned dev servers (shell:true grandchildren) can keep the loop alive on
  // Windows even after killAll — exit explicitly like the main e2e runner does.
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref?.();
});
