import { execSync } from 'node:child_process';

const commands = ['node --version', 'pnpm --version'];
for (const command of commands) {
  try {
    console.log(`$ ${command}`);
    console.log(execSync(command, { encoding: 'utf8' }).trim());
  } catch (error) {
    console.error(`FAILED: ${command}`);
    process.exitCode = 1;
  }
}
