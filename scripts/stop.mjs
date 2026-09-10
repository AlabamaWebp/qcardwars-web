import { execSync } from 'node:child_process';

const ports = (process.env.STOP_PORTS ?? '3000,4200')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const isWin = process.platform === 'win32';

function pidsForPort(port) {
  if (isWin) {
    const out = execSync(`netstat -ano`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port} `)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/\d+/.test(pid)) pids.add(pid);
    }
    return [...pids];
  }

  try {
    const out = execSync(`lsof -ti:${port}`, { encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
    return [];
  }
}

let killedCount = 0;
for (const port of ports) {
  let pids = [];
  try {
    pids = pidsForPort(port);
  } catch {
    pids = [];
  }

  if (pids.length === 0) {
    console.log(`Port ${port}: nothing to stop`);
    continue;
  }

  for (const pid of pids) {
    try {
      if (isWin) {
        execSync(`taskkill /f /pid ${pid}`, { stdio: 'ignore' });
      } else {
        execSync(`kill ${pid}`, { stdio: 'ignore' });
      }
      console.log(`Stopped pid ${pid} on port ${port}`);
      killedCount++;
    } catch {
      console.error(`Failed to stop pid ${pid} on port ${port}`);
    }
  }
}

console.log(killedCount > 0
  ? `Done. Killed ${killedCount} process(es).`
  : 'Nothing to stop.');
