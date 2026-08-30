import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const projectRoot = path.resolve(__dirname, '../..');
const hookSource = path.join(projectRoot, '.githooks', 'pre-commit');

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function shell() {
    if (process.platform !== 'win32') return 'sh';
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    return path.resolve(execPath, '..', '..', '..', 'bin', 'bash.exe');
}

describe('pre-commit build preparation', () => {
    let repo;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-convergence-'));
        fs.mkdirSync(path.join(repo, '.githooks'));
        fs.mkdirSync(path.join(repo, 'scripts'));
        fs.mkdirSync(path.join(repo, 'js', 'modules', 'config'), { recursive: true });
        fs.copyFileSync(hookSource, path.join(repo, '.githooks', 'pre-commit'));
        fs.copyFileSync(path.join(projectRoot, 'scripts', 'check-state-writes.mjs'), path.join(repo, 'scripts', 'check-state-writes.mjs'));
        fs.writeFileSync(path.join(repo, 'scripts', 'state-writes-baseline.json'), '{}\n');
        fs.writeFileSync(path.join(repo, 'sw.js'), "const CACHE_VERSION = '2026.0101.000000';\n");
        fs.writeFileSync(
            path.join(repo, 'js', 'modules', 'config', 'BuildInfo.js'),
            "export const BUILD = '2026.0101.000000';\n"
        );
        fs.writeFileSync(path.join(repo, 'index.html'), '<main>base</main>\n');

        git(repo, 'init', '--quiet');
        git(repo, 'config', 'user.name', 'Hook Test');
        git(repo, 'config', 'user.email', 'hook@example.invalid');
        git(repo, 'add', '.');
        git(repo, 'commit', '--quiet', '--no-verify', '-m', 'base');
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    test('generate/stage then run again preserves the exact staged tree and diff', () => {
        fs.appendFileSync(path.join(repo, 'index.html'), '<main>candidate</main>\n');
        git(repo, 'add', 'index.html');

        const swPath = path.join(repo, 'sw.js');
        const buildPath = path.join(repo, 'js', 'modules', 'config', 'BuildInfo.js');
        fs.appendFileSync(swPath, '// unrelated working edit\n');
        fs.appendFileSync(buildPath, '// unrelated working edit\n');
        const workingBefore = [fs.readFileSync(swPath), fs.readFileSync(buildPath)];
        const runHook = () => execFileSync(shell(), ['.githooks/pre-commit'], { cwd: repo });

        runHook();
        const firstTree = git(repo, 'write-tree');
        const firstDiff = execFileSync('git', ['diff', '--cached', '--binary'], { cwd: repo });
        const stagedSw = git(repo, 'show', ':sw.js');
        const stagedBuild = git(repo, 'show', ':js/modules/config/BuildInfo.js');
        const version = stagedSw.match(/CACHE_VERSION = '([^']+)'/)[1];

        expect(stagedBuild).toContain(`BUILD = '${version}'`);
        expect(version).toMatch(/^\d{4}\.(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\.([01]\d|2[0-3])[0-5]\d[0-5]\d$/);

        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
        runHook();

        const secondTree = git(repo, 'write-tree');
        console.info(`pre-commit convergence trees: ${firstTree} ${secondTree}`);
        expect(secondTree).toBe(firstTree);
        expect(execFileSync('git', ['diff', '--cached', '--binary'], { cwd: repo })).toEqual(firstDiff);
        expect(fs.readFileSync(swPath)).toEqual(workingBefore[0]);
        expect(fs.readFileSync(buildPath)).toEqual(workingBefore[1]);
    });
});
