"""Package the prebuilt portable game and the editable project, excluding build caches."""
from pathlib import Path
import hashlib
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
game = root / 'release' / 'Silicon-Valley-Smackdown-Arena'
archive = root / 'release' / 'Silicon-Valley-Smackdown-Arena.zip'
if not (game / 'PLAY.html').is_file():
    raise SystemExit('Run npm run build:portable first.')

# Work in a Git checkout or in the source folder unpacked from a previous ZIP.
if (root / '.git').exists():
    names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
    sources = [root / n for n in names if n]
else:
    excluded = {'.git', 'node_modules', 'release', 'dist', '.scratch', 'test-results', 'playwright-report', '__pycache__'}
    sources = [p for p in root.rglob('*') if p.is_file() and not any(part in excluded for part in p.relative_to(root).parts)]

with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=8) as z:
    for p in sorted(game.iterdir()):
        if p.is_file():
            z.write(p, f'{game.name}/{p.name}')
    for p in sorted(set(sources)):
        if p.is_file() and not any(part in {'release', '.scratch', 'node_modules', '.git'} for part in p.relative_to(root).parts):
            z.write(p, f'{game.name}/Source/{p.relative_to(root).as_posix()}')
    z.writestr(f'{game.name}/Source/SOURCE-ORIGIN.txt', 'Based on sherajr/silicon-valley-smackdown, main commit 595f6d4.\nArena Edition implements an independent 3D platform-fighter mode.\n')
with zipfile.ZipFile(archive) as z:
    bad = z.testzip()
    if bad:
        raise SystemExit(f'Archive integrity failed: {bad}')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.with_suffix('.sha256')).write_text(f'{digest}  {archive.name}\n')
print(f'{archive}\n{archive.stat().st_size / 1024 / 1024:.2f} MiB\nSHA-256 {digest}')
