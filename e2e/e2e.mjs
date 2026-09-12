// QCardWars Web — browser e2e suite (puppeteer-core + system Chrome).
//
// Spawns isolated dev servers (Nest on 3111, Angular on 4222 — neither is the
// default dev port, so a running dev session is not disturbed), then drives
// real Chrome with isolated browser contexts (a shared context shares
// localStorage and would hijack the other client's rejoin session):
//
//   A. two-client match smoke — create/join, lock-step play, shared outcome
//   B. reload rejoin — two-client room, reload mid-match, session restored, no lobby flash
//   C. solo AI — AI acts without any human input
//
// The app is loaded with `?backendPort=3111`, which points Socket.IO at the
// isolated server port (the default dev mapping 4200 -> 3000 is unchanged
// without the parameter — see game-client.service.ts).
//
// Run: `pnpm e2e` (root script). Deliberately NOT part of `pnpm verify`
// (server + first ng compile make it slow).

import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3111);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4222);
const APP_URL = `http://127.0.0.1:${WEB_PORT}/?backendPort=${SERVER_PORT}`;

const report = (msg) => process.stdout.write(`[e2e] ${msg}\n`);
const fail = (msg) => {
  throw new Error(msg);
};

// ---------------------------------------------------------------------------
// Process management (Windows: pnpm/nest/ng are .cmd shims -> shell: true, and
// the whole tree is killed with taskkill /T).
// ---------------------------------------------------------------------------

const children = [];

function spawnProc(label, cmd, env = {}) {
  const child = spawn(cmd, {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  let buf = '';
  child.stdout.on('data', (d) => (buf += d));
  child.stderr.on('data', (d) => (buf += d));
  child.label = label;
  child.buffer = () => buf;
  children.push(child);
  return child;
}

function killAll() {
  for (const child of children) {
    try {
      if (child.exitCode === null) {
        execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: 'ignore' });
      }
    } catch {
      // Already gone.
    }
  }
}

process.on('exit', killAll);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await sleep(1000);
  }
  fail(`${label} not reachable at ${url} within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function openPage(browser) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  return { context, page, consoleErrors };
}

async function waitSel(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { visible: true, timeout });
}

async function textOf(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  return page.$eval(selector, (el) => el.textContent.trim());
}

/** Room code from the in-game header ("Room ABCD"). */
async function roomCodeOf(page) {
  const raw = await textOf(page, 'qcw-game header strong');
  return raw.replace(/^room\s+/i, '');
}

/**
 * Play one move on a page that is currently that seat's turn: the cheapest
 * playable unit on a legal (empty, faction-matching or universal) lane, else
 * end turn. Deliberately unit-only and boring: combat against an empty lane
 * deals direct hero damage every turn, so a match always terminates. Returns
 * 'unit' | 'end-turn' | null (null = nothing actionable found).
 */
async function playOneMove(page) {
  const state = await page.evaluate(() => {
    const hand = [...document.querySelectorAll('.hand .card')].map((node) => ({
      name: node.querySelector('strong')?.textContent.trim() ?? '',
      cost: Number(node.querySelector('.cost')?.textContent.trim() ?? NaN),
      kind: node.querySelector('.kind')?.textContent.trim() ?? '',
      faction: (node.querySelector('small')?.textContent ?? '').split('·')[0].trim(),
      playable: !node.disabled,
    }));
    const lanes = [...document.querySelectorAll('.board .lane')].map((node) => ({
      index: Number(node.getAttribute('data-lane-index')),
      type: (node.querySelector('.lane-name')?.childNodes[0]?.textContent ?? '').trim(),
      ownUnitEmpty: Boolean(node.querySelector('.slot.own .empty')),
    }));
    const units = hand
      .filter((c) => c.playable && c.kind === 'unit' && Number.isFinite(c.cost))
      .sort((a, b) => a.cost - b.cost);
    let move = null;
    for (const card of units) {
      const lane = lanes.find((l) => l.ownUnitEmpty && (card.faction === 'universal' || l.type === card.faction));
      if (lane) {
        move = { name: card.name, laneIndex: lane.index };
        break;
      }
    }
    const endBtn = document.querySelector('button.end');
    return { move, endTurnEnabled: Boolean(endBtn && !endBtn.disabled) };
  });

  if (state.move) {
    const cardClicked = await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.hand .card')].find(
        (c) => !c.disabled && c.querySelector('strong')?.textContent.trim() === name,
      );
      if (!card) return false;
      card.click();
      return true;
    }, state.move.name);
    if (cardClicked) {
      await sleep(150); // let Angular apply the selection state
      const before = await page.$$eval('.hand .card', (nodes) => nodes.length);
      const laneClicked = await page.evaluate((laneIndex) => {
        const lane = document.querySelector(`.board .lane[data-lane-index="${laneIndex}"]`);
        if (!lane) return false;
        lane.click();
        return true;
      }, state.move.laneIndex);
      if (laneClicked) {
        // A successful play removes the card from the hand (server broadcast).
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const now = await page.$$eval('.hand .card', (nodes) => nodes.length);
          if (now < before) return 'unit';
          await sleep(150);
        }
        // Rejected by the server (should not happen — the lane was validated
        // from the same view). Cancel the selection and fall through.
        await page.evaluate(() => document.querySelector('.hand .card.selected')?.click());
      }
    }
  }

  if (state.endTurnEnabled) {
    await page.click('button.end');
    return 'end-turn';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Spec A — two-client match smoke
// ---------------------------------------------------------------------------

async function specTwoClientMatch(browser) {
  const a = await openPage(browser);
  const b = await openPage(browser);
  const { page: pageA } = a;
  const { page: pageB } = b;

  await pageA.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitSel(pageA, 'qcw-lobby .connection.online');
  await pageA.type('qcw-lobby label input', 'Alice');
  await pageA.click('qcw-lobby button.primary');
  const roomCode = await textOf(pageA, 'qcw-lobby .room strong');

  await pageB.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitSel(pageB, 'qcw-lobby .connection.online');
  await pageB.type('qcw-lobby label input', 'Bob');
  await pageB.type('qcw-lobby input.code', roomCode);
  await pageB.click('qcw-lobby .join-row button');

  await waitSel(pageA, 'qcw-game .board');
  await waitSel(pageB, 'qcw-game .board');
  for (const [page, who] of [
    [pageA, 'A'],
    [pageB, 'B'],
  ]) {
    const lanes = await page.$$eval('.board .lane', (nodes) => nodes.length);
    if (lanes !== 4) fail(`client ${who}: expected 4 lanes, saw ${lanes}`);
  }

  // Drive the match: whoever has the turn plays the cheapest unit (or ends).
  let actions = 0;
  const deadline = Date.now() + 240000;
  for (;;) {
    if (await pageA.$('.modal')) break;
    if (Date.now() > deadline) fail('match did not finish within 240s');
    let acted = null;
    if (await pageA.$('qcw-game .turn.mine')) acted = await playOneMove(pageA);
    else if (await pageB.$('qcw-game .turn.mine')) acted = await playOneMove(pageB);
    if (acted === null) {
      await sleep(250); // transient: view in flight
      continue;
    }
    actions += 1;
    if (actions % 20 === 0) report(`  ... ${actions} actions`);
  }

  await waitSel(pageA, '.modal');
  await waitSel(pageB, '.modal');
  const headingA = await textOf(pageA, '.modal h2');
  const headingB = await textOf(pageB, '.modal h2');
  const sorted = [headingA, headingB].sort();
  if (sorted[0] !== 'Defeat' || sorted[1] !== 'Victory') {
    fail(`clients disagree on the outcome: A="${headingA}" B="${headingB}" (expected one Victory, one Defeat)`);
  }
  report(`A two-client match finished in lock-step after ${actions} actions (A=${headingA}, B=${headingB})`);
  await a.context.close();
  await b.context.close();
}

// ---------------------------------------------------------------------------
// Spec B — reload mid-match, auto-rejoin, no lobby flash
//
// Uses a real two-player room: solo rooms are deliberately destroyed the
// moment the human disconnects (no rejoin grace in solo), so a solo reload
// can never rejoin. Two-player rooms arm the 120s rejoin grace window.
// ---------------------------------------------------------------------------

async function specReloadRejoin(browser) {
  const a = await openPage(browser);
  const b = await openPage(browser);
  const { page: pageA } = a;
  const { page: pageB } = b;

  // Count, across documents, how many times the lobby ever rendered in A's
  // context. The first document legitimately renders it once (room creation);
  // the rejoin after reload must NOT render it again. Polling (rather than a
  // MutationObserver) because the script runs before documentElement exists.
  await pageA.evaluateOnNewDocument(() => {
    const tick = setInterval(() => {
      if (document.querySelector('qcw-lobby')) {
        localStorage.setItem('qcw.e2e.lobbyDocs', String(Number(localStorage.getItem('qcw.e2e.lobbyDocs') ?? '0') + 1));
        clearInterval(tick); // count at most once per document
      }
    }, 50);
  });

  await pageA.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitSel(pageA, 'qcw-lobby .connection.online');
  await pageA.type('qcw-lobby label input', 'Carol');
  await pageA.click('qcw-lobby button.primary');
  const roomCode = await textOf(pageA, 'qcw-lobby .room strong');

  await pageB.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitSel(pageB, 'qcw-lobby .connection.online');
  await pageB.type('qcw-lobby label input', 'Dave');
  await pageB.type('qcw-lobby input.code', roomCode);
  await pageB.click('qcw-lobby .join-row button');

  const isMyTurn = (page) =>
    page.waitForFunction(
      () => {
        const t = document.querySelector('qcw-game .turn');
        return Boolean(t) && t.classList.contains('mine');
      },
      { timeout: 15000 },
    );

  try {
    await waitSel(pageA, 'qcw-game .board');
    await waitSel(pageB, 'qcw-game .board');

    // Whichever turn is current is stable (no AI, nobody else acts), so
    // reload A right away — the rejoin lands in a known state.
    await pageA.reload({ waitUntil: 'domcontentloaded' });

    // Auto-rejoin: board restored, same room, no lobby flash.
    await waitSel(pageA, 'qcw-game .board', 30000);
    const roomAfter = await roomCodeOf(pageA);
    if (roomAfter !== roomCode) fail(`room code changed across reload: "${roomCode}" -> "${roomAfter}"`);

    // B's client must still be in lock-step in the same room.
    await waitSel(pageB, 'qcw-game .board');
    if ((await roomCodeOf(pageB)) !== roomCode) fail('client B lost the room across the reload');

    // Prove the match is live and the re-joined seat is actionable: whoever's
    // turn it is ends it, then A (the rejoiner) ends its own turn. Explicit
    // end turns — a unit play would not pass the turn.
    if (await pageA.$('qcw-game .turn.mine')) {
      await pageA.click('qcw-game button.end');
      await isMyTurn(pageB);
    } else {
      await isMyTurn(pageB); // confirm B's turn is visible on B
      await pageB.click('qcw-game button.end');
      await isMyTurn(pageA); // turn returned to A
      await pageA.click('qcw-game button.end');
      await isMyTurn(pageB); // A's action reached the server
    }

    // Exactly 1: the initial document (room creation). 0 would mean the
    // counter itself never worked; 2+ means the lobby flashed on reload.
    const lobbyDocs = Number(await pageA.evaluate(() => localStorage.getItem('qcw.e2e.lobbyDocs') ?? '0'));
    if (lobbyDocs !== 1) fail(`lobby rendered in ${lobbyDocs} document(s) — expected exactly 1 (no lobby flash on reload)`);
    report(`B reload rejoin: board restored in room ${roomCode}, re-joined seat acted (turn passed to B); lobby rendered in ${lobbyDocs} document(s)`);
  } catch (err) {
    // Diagnostics: what does the reloaded page actually show?
    const body = await pageA.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '<unreadable>');
    const errors = a.consoleErrors.slice(0, 5).join(' | ') || '<none>';
    report(`page A body after reload:\n${body}`);
    report(`page A console errors: ${errors}`);
    throw err;
  } finally {
    await a.context.close();
    await b.context.close();
  }
}

// ---------------------------------------------------------------------------
// Spec C — solo vs AI, no human input
// ---------------------------------------------------------------------------

async function specSoloAi(browser) {
  const { context, page, consoleErrors } = await openPage(browser);

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitSel(page, 'qcw-lobby .connection.online');
  await page.type('qcw-lobby label input', 'Dan');

  // END-1 — lane picker: swap the default antlion lane for wraith.
  const toggleLane = (label) =>
    page.evaluate((text) => {
      const chip = [...document.querySelectorAll('qcw-lobby .lane-chip')].find(
        (c) => c.querySelector('.lane-chip__name')?.textContent?.trim().toLowerCase() === text,
      );
      if (!chip) throw new Error(`lane chip "${text}" not found`);
      chip.click();
    }, label);
  // Wait for the rendered count instead of reading it immediately: the
  // synthetic chip.click() updates the signal synchronously, but Angular's
  // change detection can land on a microtask after the evaluate round-trip.
  const readCount = () => textOf(page, 'qcw-lobby .lane-heading .count');
  const expectCount = async (expected, label) => {
    try {
      await page.waitForFunction(
        (exp) => (document.querySelector('qcw-lobby .lane-heading .count')?.textContent ?? '').includes(exp),
        { timeout: 5000 },
        expected,
      );
    } catch {
      fail(`${label}: expected ${expected}, saw "${(await readCount()).trim()}"`);
    }
  };
  // At 4/4 selecting a fifth lane is ignored.
  await toggleLane('wraith');
  await expectCount('4/4', 'picker should hold at 4/4 when selecting a fifth lane');
  // Deselect antlion (4→3), then select wraith (3→4).
  await toggleLane('antlion');
  await expectCount('3/4', 'after deselecting antlion');
  await toggleLane('wraith');
  await expectCount('4/4', 'after selecting wraith');

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('qcw-lobby .create-row button')].find((b) => /solo/i.test(b.textContent ?? ''));
    if (!btn) throw new Error('solo button not found');
    btn.click();
  });
  await waitSel(page, 'qcw-game .board');
  const oppName = await textOf(page, 'qcw-game .opponent.playerbar b');
  if (!/ai/i.test(oppName)) fail(`expected the AI opponent bar, saw "${oppName}"`);

  // The board reflects the selection: a wraith lane exists, antlion is gone.
  const laneNames = await page.$$eval('qcw-game .lane .lane-name', (nodes) =>
    nodes.map((n) => (n.textContent ?? '').trim().toLowerCase()),
  );
  if (laneNames.length !== 4) fail(`expected 4 lanes, saw: ${laneNames.join(', ')}`);
  if (!laneNames.some((n) => n.startsWith('wraith'))) fail(`expected a wraith lane on the board, saw: ${laneNames.join(', ')}`);
  if (laneNames.some((n) => n.startsWith('antlion'))) fail(`antlion lane should have been swapped out: ${laneNames.join(', ')}`);

  // RU smoke: card identities and structural fields come from I18nService,
  // while game-core keeps canonical English definitions unchanged.
  await page.click('qcw-game button.lang');
  await page.waitForFunction(() => (document.querySelector('qcw-card .kind')?.textContent ?? '').match(/юнит|здание|сила/i));
  const ruCardMeta = await page.$eval('qcw-card .kind', (node) => node.textContent ?? '');
  const ruCardSubmeta = await page.$eval('qcw-card small', (node) => node.textContent ?? '');
  if (!/юнит|здание|сила/i.test(ruCardMeta) || !/уровень/i.test(ruCardSubmeta)) {
    fail(`RU card metadata missing: kind="${ruCardMeta}", submeta="${ruCardSubmeta}"`);
  }

  // Every hand card, including disabled ones, has a non-gameplay details
  // action. Opening it must not select/play the card, and Escape closes it.
  await waitSel(page, 'qcw-card .inspect');
  await page.click('qcw-card .inspect');
  await waitSel(page, 'qcw-game .card-detail[role="dialog"]');
  const detailText = await textOf(page, 'qcw-game .card-detail');
  if (!/card details/i.test(detailText) || !(await page.$('qcw-game .detail-description'))) {
    fail(`card details dialog is incomplete: "${detailText.trim()}"`);
  }
  if (await page.$('qcw-card .card.selected')) fail('inspecting a card selected it for play');
  await page.keyboard.press('Escape');
  await page.waitForSelector('qcw-game .card-detail', { hidden: true, timeout: 5000 });

  // Every deployed piece has an independent inspect anchor. This catches the
  // unit+building overlap regression and verifies the same modal path works
  // for a public board card.
  await page.waitForSelector('qcw-game .board .chip-inspect', { timeout: 15000 });
  await page.click('qcw-game .board .chip-inspect');
  await waitSel(page, 'qcw-game .card-detail[role="dialog"]');
  const deployedDetail = await textOf(page, 'qcw-game .card-detail');
  if (!/юнит|здание|сила/i.test(deployedDetail) || !/уровень/i.test(deployedDetail)) {
    fail(`RU deployed card details missing localized fields: "${deployedDetail.trim()}"`);
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('qcw-game .card-detail', { hidden: true, timeout: 5000 });

  // The structured card metadata on a public play log entry is rendered as a
  // localized button; clicking it must open the same details dialog.
  await page.waitForSelector('qcw-game .log-card', { timeout: 15000 });
  await page.click('qcw-game .log-card');
  await waitSel(page, 'qcw-game .card-detail[role="dialog"]');
  const playedLogDetail = await textOf(page, 'qcw-game .card-detail');
  if (!/юнит|здание|сила/i.test(playedLogDetail) || !/уровень/i.test(playedLogDetail)) {
    fail(`RU played-card log details missing localized fields: "${playedLogDetail.trim()}"`);
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('qcw-game .card-detail', { hidden: true, timeout: 5000 });

  // At least one unit with a special should be present in the opening hand;
  // inspect actions are non-gameplay, so iterate safely until its detail block
  // appears and assert that the special name is localized as well.
  const handInspects = await page.$$('qcw-card .inspect');
  let specialSeen = false;
  for (const inspect of handInspects) {
    await inspect.click();
    await waitSel(page, 'qcw-game .card-detail[role="dialog"]');
    const special = await page.$('qcw-game .detail-special strong');
    if (special) {
      const specialText = await special.evaluate((node) => node.textContent ?? '');
      if (!/[А-Яа-яЁё]/.test(specialText)) fail(`special name was not localized in RU: "${specialText}"`);
      specialSeen = true;
      await page.keyboard.press('Escape');
      await page.waitForSelector('qcw-game .card-detail', { hidden: true, timeout: 5000 });
      break;
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('qcw-game .card-detail', { hidden: true, timeout: 5000 });
  }
  // The opening hand is seeded by the server and may contain no special-unit
  // card in a short smoke match; when present, the branch above asserts it.

  // Hand the AI the turn (if it is ours), then observe for AI activity with
  // zero further human input.
  if (await page.$('qcw-game .turn.mine')) {
    await page.click('qcw-game button.end');
  }
  await page.waitForFunction(
    () => {
      const t = document.querySelector('qcw-game .turn');
      return Boolean(t) && !t.classList.contains('mine');
    },
    { timeout: 15000 },
  );

  const snapshot = () =>
    page.evaluate(() => ({
      log: document.querySelector('qcw-game .log')?.textContent ?? '',
      turn: document.querySelector('qcw-game .turn')?.className ?? '',
      bars: [...document.querySelectorAll('qcw-game .playerbar')].map((n) => n.textContent).join('|'),
    }));
  const before = JSON.stringify(await snapshot());
  const deadline = Date.now() + 15000;
  let changed = false;
  while (Date.now() < deadline) {
    await sleep(500);
    if (JSON.stringify(await snapshot()) !== before) {
      changed = true;
      break;
    }
  }
  if (!changed) fail('AI produced no observable activity (log/turn/player bars unchanged for 15s)');
  if (consoleErrors.length > 0) fail(`console errors during solo flow: ${consoleErrors.join(' | ')}`);
  report(`C solo AI acted without human input (opponent "${oppName}"), no console errors`);
  await context.close();
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  report(`building game-core (server compiles against its dist)`);
  execSync('pnpm --filter @qcw/game-core build', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  report(`spawning server on :${SERVER_PORT} and web on :${WEB_PORT}`);
  const server = spawnProc('server', 'pnpm --filter @qcw/server exec nest start', { PORT: String(SERVER_PORT) });
  const web = spawnProc('web', `pnpm --filter @qcw/web exec ng serve --host 127.0.0.1 --port ${WEB_PORT}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // Pin the UI locale to en-US: the app auto-detects the browser language
    // for its EN/RU toggle, and the specs assert English lane names.
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,900', '--lang=en-US'],
  });

  let failed = 0;
  try {
    await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/`, 120000, 'server');
    report('server up');
    await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, 240000, 'web (first ng serve compile can be slow)');
    report('web up');

    const specs = [
      ['A two-client match', specTwoClientMatch],
      ['B reload rejoin', specReloadRejoin],
      ['C solo AI', specSoloAi],
    ];
    for (const [name, fn] of specs) {
      report(`-- spec ${name} --`);
      try {
        await fn(browser);
      } catch (err) {
        failed += 1;
        report(`FAILED ${name}: ${err.message}`);
        const buf = server.buffer();
        if (buf) report(`server output (tail):\n${buf.slice(-2000)}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    killAll();
  }

  if (failed > 0) {
    report(`${failed} spec(s) failed`);
    process.exitCode = 1;
  } else {
    report('all e2e specs passed');
  }
}

main().catch((err) => {
  report(`runner error: ${err?.stack ?? err}`);
  process.exitCode = 1;
});
