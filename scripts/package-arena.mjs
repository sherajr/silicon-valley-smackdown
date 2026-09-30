// Runs scripts/package-arena.py with whichever Python 3 is installed. On Windows, `python3` is often a Microsoft Store
// shortcut that is not a real interpreter, so try `python3`, then `python`, then the `py -3` launcher.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'package-arena.py');
for (const [command, ...args] of [['python3'], ['python'], ['py', '-3']]) {
  const probe = spawnSync(command, [...args, '--version'], { encoding: 'utf8' });
  if (probe.status === 0 && /Python 3/.test(`${probe.stdout}${probe.stderr}`)) {
    const run = spawnSync(command, [...args, script], { stdio: 'inherit' });
    process.exit(run.status ?? 1);
  }
}
console.error('Python 3 was not found (tried python3, python and py -3). Install it from python.org, or run scripts/package-arena.py with any Python 3.');
process.exit(1);
