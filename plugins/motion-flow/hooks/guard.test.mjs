// Tests for the PreToolUse guard. Each rule from spec 4.20 plus the evasive command forms.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, parseShell } from './guard.mjs';

const GUARD = fileURLToPath(new URL('./guard.mjs', import.meta.url));
const HOOKS_JSON = fileURLToPath(new URL('./hooks.json', import.meta.url));

let base; let home; let drive; let project; let env;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mf-guard-'));
  home = join(base, 'home');
  drive = join(home, 'Google Drive', 'Studio', 'Assets');
  project = join(base, 'project');
  for (const dir of [drive, join(home, '.motion-flow'), join(project, 'work', 'a'), join(project, '.claude')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(drive, 'a.txt'), 'x');
  writeFileSync(join(project, 'notes.md'), 'afterfx notes');
  writeFileSync(join(home, '.motion-flow', 'roots.json'), JSON.stringify({ roots: { assets: drive }, work_dir: 'work' }));
  env = { home, roots: [drive], workDir: 'work', projectDir: project, pluginRoot: join(base, 'plugin') };
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const tool = (tool_name, tool_input, cwd = project) => evaluate({ tool_name, tool_input, cwd }, env);
const bash = (command, cwd) => tool('Bash', { command }, cwd);
const esc = (path) => path.replace(/ /g, '\\ ');
const D = () => esc(drive); // Drive root as a shell word
const GD = () => esc(join(home, 'Google Drive'));

function expectAll(cases, expected, run = bash) {
  for (const command of cases) {
    const result = run(typeof command === 'function' ? command() : command);
    assert.equal(result.decision, expected, `${typeof command === 'function' ? command() : command}\n -> ${result.decision}: ${result.reason}`);
  }
}

// ---------- Drive access is blocked in every form ----------

test('Bash: direct paths into Drive are denied', () => {
  expectAll([
    () => `cat ${D()}/a.txt`,
    () => `cat "${drive}/a.txt"`,
    () => `cat '${drive}'/a.txt`,
    () => `ls ${D()}`,
    () => `ls -la "${drive}/"`,
    () => `cd ${D()} && ls`,
    () => `cd "${drive}"; cat a.txt`,
    () => `cat ${D()}/../Assets/a.txt`,
    () => `cat ${D()}//a.txt`,
    () => `cat ${D()}/./a.txt`,
    () => `cp ${D()}/a.txt work/`,
    () => `rsync -a ${D()}/ work/`,
    () => `open ${D()}`,
    () => `head -c 5 ${D()}/a.txt`,
    '~/"Google Drive"/Studio/Assets/a.txt',
  ].map((c) => (typeof c === 'string' && c.startsWith('~') ? `cat ${c}` : c)), 'deny');
});

test('Bash: ~, $HOME and ${HOME} forms are resolved', () => {
  expectAll([
    'cat ~/Google\\ Drive/Studio/Assets/a.txt',
    'cat "$HOME/Google Drive/Studio/Assets/a.txt"',
    'cat ${HOME}/"Google Drive"/Studio/Assets/a.txt',
    'cat ~/"Google Drive"/Studio/Assets/a.txt',
  ], 'deny');
});

test('Bash: evasive wrappers and nesting are analysed', () => {
  expectAll([
    () => `sh -c 'cat ${D()}/a.txt'`,
    () => `bash -lc "cat '${drive}/a.txt'"`,
    () => `zsh -c "sh -c 'cat ${D()}/a.txt'"`,
    () => `env FOO=1 cat ${D()}/a.txt`,
    () => `sudo cat ${D()}/a.txt`,
    () => `nohup cat ${D()}/a.txt`,
    () => `timeout 5 cat ${D()}/a.txt`,
    () => `/bin/cat ${D()}/a.txt`,
    () => `\\cat ${D()}/a.txt`,
    () => `'cat' ${D()}/a.txt`,
    () => `echo ok; cat ${D()}/a.txt`,
    () => `echo ok && cat ${D()}/a.txt`,
    () => `false || cat ${D()}/a.txt`,
    () => `echo hi | cat ${D()}/a.txt`,
    () => `echo $(cat ${D()}/a.txt)`,
    () => `echo \`cat ${D()}/a.txt\``,
    () => `echo "$(cat ${D()}/a.txt)"`,
    () => `eval "cat ${D()}/a.txt"`,
    () => `xargs cat ${D()}/a.txt`,
    () => `find . -name x -exec cat ${D()}/a.txt \;`,
    () => `cat <(cat ${D()}/a.txt)`,
    () => `cat <<EOF\n$(cat ${D()}/a.txt)\nEOF`,
    () => `(cat ${D()}/a.txt)`,
    () => `{ cat ${D()}/a.txt; }`,
  ], 'deny');
});

test('Bash: redirections and option values that point into Drive', () => {
  expectAll([
    () => `echo x > ${D()}/new.txt`,
    () => `echo x >> ${D()}/a.txt`,
    () => `echo x >${D()}/a.txt`,
    () => `echo x 2> ${D()}/err.txt`,
    () => `echo x &> ${D()}/err.txt`,
    () => `cat < ${D()}/a.txt`,
    () => `tee ${D()}/a.txt`,
    () => `dd if=${D()}/a.txt of=work/x`,
    () => `dd if=work/x of=${D()}/a.txt`,
    () => `tar -czf work/x.tgz -C ${D()} .`,
    () => `ffmpeg -i ${D()}/a.mov work/a.mp4`,
    () => `convert --input=${D()}/a.png work/a.jpg`,
  ], 'deny');
});

test('Bash: searching from a folder that contains Drive is denied', () => {
  expectAll([
    () => `find ${home} -name '*.aep'`,
    () => `grep -r foo ${GD()}`,
    () => `ls -R ${home}`,
    () => `du -sh ${GD()}/Studio`,
    'find ~ -name "*.aep"',
    () => `rg foo ${home}`,
  ], 'deny');
  // but plain listing of the parent folder is fine
  assert.equal(bash(`stat ${GD()}`).decision, 'allow');
});

test('Bash: globs that expand into Drive are denied', () => {
  expectAll([
    () => `cat ${D()}/*.txt`,
    () => `ls ${GD()}/*/Assets`,
    () => `cat ${D()}/a.tx?`,
    () => `cat ${D()}/[a].txt`,
  ], 'deny');
});

test('Bash: a symlink in the project that points into Drive is followed', () => {
  symlinkSync(drive, join(project, 'work', 'shortcut'));
  expectAll(['cat work/shortcut/a.txt', 'ls work/shortcut', 'cd work/shortcut && cat a.txt'], 'deny');
});

test('Bash: cd tracking makes later relative paths count', () => {
  expectAll([() => `cd ${GD()} && cat Studio/Assets/a.txt`], 'deny');
});

test('Bash: unresolvable variables in paths ask instead of passing silently', () => {
  assert.equal(bash('cat $SOMEWHERE/a.txt').decision, 'ask');
  assert.equal(bash('cat "$(pwd)/a.txt"').decision, 'ask');
});

test('cwd inside Drive denies everything', () => {
  for (const name of ['Bash', 'Read', 'Grep']) {
    const input = name === 'Bash' ? { command: 'ls' } : { file_path: 'a.txt', pattern: 'x' };
    assert.equal(tool(name, input, drive).decision, 'deny', name);
  }
});

// ---------- file tools ----------

test('file tools: paths inside Drive are denied for read, write and search', () => {
  const file = join(drive, 'a.txt');
  assert.equal(tool('Read', { file_path: file }).decision, 'deny');
  assert.equal(tool('Write', { file_path: join(drive, 'n.txt'), content: 'x' }).decision, 'deny');
  assert.equal(tool('Edit', { file_path: file, old_string: 'x', new_string: 'y' }).decision, 'deny');
  assert.equal(tool('NotebookEdit', { notebook_path: join(drive, 'n.ipynb') }).decision, 'deny');
  assert.equal(tool('Grep', { pattern: 'x', path: drive }).decision, 'deny');
  assert.equal(tool('Grep', { pattern: 'x', path: home }).decision, 'deny'); // contains Drive
  assert.equal(tool('Glob', { pattern: `${drive}/**/*.aep` }).decision, 'deny');
  assert.equal(tool('Glob', { pattern: '*.aep', path: drive }).decision, 'deny');
});

test('file tools: ~, relative and ".." forms are resolved', () => {
  assert.equal(tool('Read', { file_path: '~/Google Drive/Studio/Assets/a.txt' }).decision, 'deny');
  assert.equal(tool('Read', { file_path: '../home/Google Drive/Studio/Assets/a.txt' }).decision, 'deny');
  assert.equal(tool('Read', { file_path: join(project, 'work', '..', '..', 'home', 'Google Drive', 'Studio', 'Assets', 'a.txt') }).decision, 'deny');
});

test('file tools: normal project files are allowed', () => {
  assert.equal(tool('Read', { file_path: join(project, 'notes.md') }).decision, 'allow');
  assert.equal(tool('Write', { file_path: join(project, 'work', 'out.txt'), content: 'x' }).decision, 'allow');
  assert.equal(tool('Edit', { file_path: join(project, 'notes.md'), old_string: 'a', new_string: 'b' }).decision, 'allow');
  assert.equal(tool('Grep', { pattern: 'x' }).decision, 'allow');
  assert.equal(tool('Glob', { pattern: '**/*.md' }).decision, 'allow');
});

test('case and Unicode variants of a Drive path are still Drive (case-insensitive systems)', (t) => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return t.skip('case-insensitive file systems only');
  assert.equal(tool('Read', { file_path: join(drive, 'A.TXT').toUpperCase() }).decision, 'deny');
});

// ---------- protecting the allowlist and the safety settings ----------

test('the drive-gate config can be read but not changed', () => {
  const config = join(home, '.motion-flow', 'roots.json');
  assert.equal(tool('Read', { file_path: config }).decision, 'allow');
  assert.equal(bash(`cat ${config}`).decision, 'allow');
  assert.equal(tool('Write', { file_path: config, content: '{}' }).decision, 'deny');
  assert.equal(tool('Edit', { file_path: config, old_string: 'a', new_string: 'b' }).decision, 'deny');
  expectAll([
    () => `echo '{}' > ${config}`,
    () => `echo '{}' >> ~/.motion-flow/roots.json`,
    () => `cp roots.json ${config}`,
    () => `sed -i '' s/a/b/ ${config}`,
    () => `mv work/x ${home}/.motion-flow/`,
    () => `tee ${config}`,
    () => `rm ${config}`,
  ], 'deny');
});

test('changing HOME or MOTION_FLOW_HOME for a command is denied', () => {
  expectAll([
    'HOME=/tmp/evil drive-gate ls assets',
    'env HOME=/tmp/evil drive-gate ls assets',
    'export HOME=/tmp/evil',
    'MOTION_FLOW_HOME=/tmp/evil drive-gate ls assets',
    'USERPROFILE=C:\\evil drive-gate ls assets',
    'sh -c "HOME=/tmp/evil drive-gate ls assets"',
  ], 'deny');
});

test('Claude Code settings and plugins need confirmation to be changed', () => {
  assert.equal(tool('Edit', { file_path: join(project, '.claude', 'settings.json'), old_string: 'a', new_string: 'b' }).decision, 'ask');
  assert.equal(tool('Write', { file_path: join(project, '.claude', 'settings.local.json'), content: '{}' }).decision, 'ask');
  assert.equal(tool('Write', { file_path: join(home, '.claude', 'settings.json'), content: '{}' }).decision, 'ask');
  assert.equal(tool('Write', { file_path: join(home, '.claude', 'plugins', 'x', 'hooks.json'), content: '{}' }).decision, 'ask');
  assert.equal(bash(`echo '{}' > ${project}/.claude/settings.json`).decision, 'ask');
  assert.equal(tool('Read', { file_path: join(project, '.claude', 'settings.json') }).decision, 'allow');
});

// ---------- approvals belong to a person ----------

test('mf-gate approve asks for confirmation; the read-only gate commands do not', () => {
  expectAll(['mf-gate approve plan', 'mf-gate approve check', 'sudo mf-gate approve plan', 'node bin/mf-gate approve plan', 'sh -c "mf-gate approve check"'], 'ask');
  expectAll(['mf-gate require build', 'mf-gate hash plan', 'mf-gate status'], 'allow');
});

test('auto mode: turning it on asks, approving with --auto asks only until it is on, and auto.json is not writable', () => {
  expectAll(['mf-gate auto on', 'sudo mf-gate auto on', 'sh -c "mf-gate auto on"'], 'ask');
  expectAll(['mf-gate auto off', 'mf-gate auto status'], 'allow');
  expectAll(['mf-gate approve plan --auto', 'mf-gate approve --auto check'], 'ask');
  mkdirSync(join(project, '.motion'), { recursive: true });
  writeFileSync(join(project, '.motion', 'auto.json'), JSON.stringify({ enabled: true }));
  expectAll(['mf-gate approve plan --auto', 'mf-gate approve --auto check'], 'allow');
  expectAll(['mf-gate approve plan', 'mf-gate approve check'], 'ask');
  assert.equal(tool('Write', { file_path: join(project, '.motion', 'auto.json'), content: '{"enabled":true}' }).decision, 'deny');
  assert.equal(bash(`echo '{"enabled":true}' > ${project}/.motion/auto.json`).decision, 'deny');
});

test('the file tools cannot write an approval into plan.md or check.md, but can write them otherwise', () => {
  const plan = join(project, '.motion', 'plan.md');
  const check = join(project, '.motion', 'check.md');
  const approvals = ['status: approved', '---\nstatus: approved\n---', 'approved: true', 'plan_sha256: ' + 'a'.repeat(64), 'approved_at: 2026-10-19T10:00:00Z', '  approved: true'];
  for (const text of approvals) {
    assert.equal(tool('Write', { file_path: plan, content: `task_id: x\n${text}\n` }).decision, 'deny', text);
    assert.equal(tool('Edit', { file_path: check, old_string: 'approved: false', new_string: text }).decision, 'deny', text);
  }
  assert.equal(tool('Write', { file_path: plan, content: '---\ntask_id: x\nstatus: draft\napproved_at: null\nplan_sha256: null\n---\n## Steps\n' }).decision, 'allow');
  assert.equal(tool('Write', { file_path: check, content: '---\nverdict: PASS\napproved: false\n---\n' }).decision, 'allow');
  assert.equal(tool('Write', { file_path: join(project, '.motion', 'task.md'), content: 'status: approved\n' }).decision, 'allow', 'only plan.md and check.md hold approvals');
  assert.equal(tool('Write', { file_path: join(project, 'notes.md'), content: 'approved: true\n' }).decision, 'allow');
});

test('shell writes to plan.md or check.md ask; reads do not', () => {
  expectAll([`sed -i '' 's/draft/approved/' .motion/plan.md`, `echo "approved: true" >> .motion/check.md`, `tee .motion/plan.md`, `cp x .motion/plan.md`], 'ask');
  expectAll(['cat .motion/plan.md', 'grep approved .motion/check.md', 'mf-gate hash plan'], 'allow');
});

// ---------- studio rules from a folder ----------

test('mf-init --studio and --no-studio are allowed: the studio is a name, not a plugin', () => {
  writeFileSync(join(project, '.claude', 'settings.json'), '{}');
  expectAll(['mf-init --studio acme', 'mf-init --no-studio', 'node bin/mf-init --studio acme'], 'allow');
});

// ---------- the build log is written only by ae-run ----------

test('the build log cannot be written by hand: file tools are denied, shell writes are denied, reads are fine', () => {
  const log = join(project, '.motion', 'build.log.jsonl');
  assert.equal(tool('Write', { file_path: log, content: '{"step":1,"ok":true}\n' }).decision, 'deny');
  assert.equal(tool('Edit', { file_path: log, old_string: 'false', new_string: 'true' }).decision, 'deny');
  expectAll([`echo '{"step":1,"ok":true}' >> .motion/build.log.jsonl`, 'tee .motion/build.log.jsonl', 'cp x .motion/build.log.jsonl', `sed -i '' s/false/true/ .motion/build.log.jsonl`, 'rm .motion/build.log.jsonl'], 'deny');
  assert.equal(tool('Read', { file_path: log }).decision, 'allow');
  expectAll(['cat .motion/build.log.jsonl', 'tail -n 3 .motion/build.log.jsonl', 'mf-gate require check', 'ae-run --project work/p.aep --script jsx/01.jsx --undo x --step 1'], 'allow');
});

// ---------- mf-setup writes the allowlist ----------

test('mf-setup: confirmation only when it changes an existing allowlist', () => {
  const write = ['mf-setup --root assets=/x/y', 'mf-setup --root a=/x --replace', 'sudo mf-setup --root a=/x',
    'node bin/mf-setup --root a=/x', 'node "/plugin/bin/mf-setup" --root a=/x', 'sh -c "mf-setup --root a=/x"'];
  // config exists (the beforeEach roots.json): writing asks
  expectAll(write, 'ask');
  // read-only forms never ask
  expectAll(['mf-setup --detect', 'mf-setup --show', 'mf-setup --dry-run --root assets=/x/y'], 'allow');
  // first setup (no config yet): no prompt, the designer already chose the folders in the skill
  rmSync(join(home, '.motion-flow', 'roots.json'));
  expectAll(write, 'allow');
});

test('the per-project Drive choice: first choice is free, changing it or editing the file directly asks', () => {
  const driveFile = join(project, '.motion', 'drive.json');
  // no choice yet: mf-init --drive just runs
  expectAll(['mf-init --drive assets', 'mf-init --no-drive', 'mf-init', 'mf-init --dry-run --drive assets'], 'allow');
  mkdirSync(join(project, '.motion'), { recursive: true });
  writeFileSync(driveFile, '{"aliases":[]}');
  // a choice exists: changing it asks; narrowing, dry runs and plain init do not
  expectAll(['mf-init --drive assets', 'node bin/mf-init --drive assets', 'sudo mf-init --drive a,b', `mf-init --project ${project} --drive assets`], 'ask');
  expectAll(['mf-init --no-drive', 'mf-init', 'mf-init --dry-run --drive assets'], 'allow');
  // editing the file with the file tools or the shell asks
  assert.equal(tool('Write', { file_path: driveFile, content: '{}' }).decision, 'ask');
  assert.equal(tool('Edit', { file_path: driveFile, old_string: 'a', new_string: 'b' }).decision, 'ask');
  assert.equal(bash(`echo '{"aliases":["assets"]}' > ${driveFile}`).decision, 'ask');
  assert.equal(tool('Read', { file_path: driveFile }).decision, 'allow');
});

test('commands that mention ~/.motion-flow in their arguments cannot write the config', () => {
  expectAll([`node -e "require('fs').writeFileSync(require('os').homedir()+'/.motion-flow/roots.json','{}')"`,
    `python3 -c "open('/tmp/.motion-flow/roots.json','w')"`, 'cp x.json ~/.motion-flow/roots.json'], 'deny');
  expectAll([`cat ~/.motion-flow/roots.json`, 'ls ~/.motion-flow', 'jq . ~/.motion-flow/roots.json'], 'allow');
});

// ---------- rm / mv ----------

test('rm and mv inside work/ ask for confirmation', () => {
  expectAll(['rm work/a/x', 'rm -rf work/a', 'rm -f -- work/a/x', 'mv work/a work/b', 'rmdir work/a', 'unlink work/a/x',
    'find work/a -delete', 'find work/a -name x -exec rm {} \;', 'echo x | xargs rm work/a/x', 'sudo rm work/a/x', 'sh -c "rm work/a/x"'], 'ask');
});

test('rm and mv outside work/ are denied', () => {
  expectAll(['rm notes.md', 'rm -rf .', 'rm -rf work', 'rm -rf work/', 'rm -rf work/..', 'mv work/a ../elsewhere', 'mv notes.md work/',
    'rm -rf /tmp/x', 'rm -rf ~', 'find work -delete', 'find . -delete', 'find . -name x -exec rm {} \;', 'rm work/../notes.md',
    () => `rm ${D()}/a.txt`, () => `mv ${D()}/a.txt work/`, 'sudo rm notes.md', '/bin/rm notes.md', 'sh -c "rm notes.md"'], 'deny');
});

test('rm with an unresolvable target asks', () => {
  assert.equal(bash('rm $TARGET/x').decision, 'ask');
  assert.equal(bash('rm "$(ls)"').decision, 'ask');
});

test('rm of a symlink path that resolves outside work/ is denied', () => {
  symlinkSync(project, join(project, 'work', 'back'));
  assert.equal(bash('rm -rf work/back/notes.md').decision, 'deny');
});

// ---------- git ----------

test('dangerous git commands ask for confirmation', () => {
  expectAll(['git push', 'git push origin main', 'git push --force', 'git -C . push', 'git --no-pager push', 'git reset --hard', 'git reset --hard HEAD~1',
    'git clean -fd', 'git clean -f', 'git clean -xdf', 'git clean --force', 'git checkout --force main', 'git checkout -f', 'git switch --discard-changes main',
    'git branch -D x', 'git -c alias.p=push p', 'sh -c "git push"', 'sudo git push', 'env GIT_X=1 git push', 'echo x && git push', 'git -c core.x=1 push'], 'ask');
});

test('harmless git commands are allowed', () => {
  expectAll(['git status', 'git diff', 'git log --oneline', 'git commit -m "push the button"', 'git add -A', 'git checkout main', 'git checkout -b feature',
    'git clean -n', 'git reset --soft HEAD~1', 'git branch -d x', 'git pull', 'git fetch', 'echo git push'], 'allow');
});

// ---------- After Effects ----------

test('direct After Effects and ExtendScript launches are denied', () => {
  expectAll([
    'afterfx -r script.jsx', 'AfterFX.exe -r x.jsx', 'aerender -project x.aep -comp Main',
    '"/Applications/Adobe After Effects 2024/Adobe After Effects 2024.app/Contents/MacOS/AfterFX" -r x.jsx',
    `osascript -e 'tell application "Adobe After Effects 2024" to DoScriptFile "/x.jsx"'`,
    `osascript -e 'tell app "AfterFX" to DoScript "alert(1)"'`,
    'open -a "Adobe After Effects 2024" work/x.aep', 'open work/x.aep',
    `node -e "require('child_process').exec('afterfx -r x.jsx')"`,
    'bash -c "afterfx -r x.jsx"', 'sudo afterfx -r x.jsx', 'python3 -c "import os; os.system(\'aerender -x\')"',
    'powershell -Command "& afterfx.exe -r x.jsx"',
  ], 'deny');
});

test('the sanctioned AE tools and mentions of AE in plain text are allowed', () => {
  expectAll(['ae-run --ping', 'ae-run --project work/x.aep --script jsx/01.jsx --undo "step"', 'ae-dump --project work/x.aep --out work/d.json',
    'ae-render-frame --project work/x.aep --comp Main --time 1 --out work/f.png', 'aep-version x_v01.aep', 'ae-lint dump.json',
    'grep afterfx notes.md', 'echo afterfx', 'cat notes.md'], 'allow');
});

// ---------- normal work stays possible ----------

test('everyday commands are allowed', () => {
  expectAll(['ls', 'ls -la work', 'node --test', 'npm test', 'cat README.md', 'echo hi > work/out.txt', 'echo hi > /dev/null', 'ls 2>&1', 'ls work 2>/dev/null',
    'drive-gate ls assets', 'drive-gate fetch assets p/a.aep --to work/ --with-deps --deps-from work/dump.json', 'drive-gate log --tail 5',
    `cat ${join(home, '.motion-flow', 'roots.json')}`, 'mkdir -p work/frames', 'cp notes.md work/notes.md', 'ffmpeg -i work/a.mov work/a.mp4',
    'git status && git diff', 'printf "%s" "$(date)"', 'echo "a;b" | wc -c', 'cd work && ls', 'FOO=1 node x.mjs'], 'allow');
});

test('Windows and PowerShell removers are treated like rm', () => {
  assert.equal(tool('PowerShell', { command: 'Remove-Item work/a/x' }).decision, 'ask');
  assert.equal(tool('PowerShell', { command: 'Remove-Item notes.md' }).decision, 'deny');
  assert.equal(tool('PowerShell', { command: `Get-Content '${drive}/a.txt'` }).decision, 'deny');
  assert.equal(tool('Monitor', { command: `tail -f '${drive}/a.txt'` }).decision, 'deny');
});

test('bad tool input fails closed', () => {
  assert.equal(tool('Bash', {}).decision, 'deny');
  assert.equal(tool('Bash', { command: 42 }).decision, 'deny');
});

test('excessive nesting asks instead of being ignored', () => {
  let command = 'cat x';
  for (let i = 0; i < 9; i++) command = `sh -c '${command.replace(/'/g, `'\\''`)}'`;
  assert.notEqual(bash(command).decision, 'allow');
});

// ---------- parser ----------

test('parseShell splits commands, handles quotes and finds substitutions', () => {
  const { commands, nested } = parseShell(`echo "a b" 'c d' e\\ f; ls | wc && cat $(pwd)/x`);
  assert.deepEqual(commands.map((c) => c.words), [['echo', 'a b', 'c d', 'e f'], ['ls'], ['wc'], ['cat', '$(…)/x']]);
  assert.deepEqual(nested, ['pwd']);
  const redirect = parseShell('echo x 2>&1 > out.txt >> log').commands[0];
  assert.deepEqual(redirect.redirects.map((r) => r.target), ['out.txt', 'log']);
});

// ---------- the hook protocol (separate process) ----------

function runHook(payload, { homeDir = home, input } = {}) {
  return spawnSync(process.execPath, [GUARD], {
    input: input ?? JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: join(base, 'plugin') },
  });
}

test('protocol: allow exits 0 silently, deny exits 2 with a reason, ask exits 0 with JSON', () => {
  const allow = runHook({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: project });
  assert.equal(allow.status, 0);
  assert.equal(allow.stdout, '');
  const deny = runHook({ tool_name: 'Bash', tool_input: { command: `cat '${drive}/a.txt'` }, cwd: project });
  assert.equal(deny.status, 2);
  assert.match(deny.stderr, /drive-gate/);
  const ask = runHook({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: project });
  assert.equal(ask.status, 0);
  const output = JSON.parse(ask.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'ask');
  assert.match(output.permissionDecisionReason, /git push/);
});

test('protocol: garbage, empty or malformed input is denied (fail closed)', () => {
  for (const input of ['', 'not json', '[]', 'null', '{"tool_name":5}', '{}']) {
    const result = runHook(null, { input });
    assert.equal(result.status, 2, JSON.stringify(input));
  }
});

test('protocol: a broken roots.json is denied, a missing one just means no Drive roots', () => {
  writeFileSync(join(home, '.motion-flow', 'roots.json'), '{ nope');
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: project }).status, 2);
  rmSync(join(home, '.motion-flow', 'roots.json'));
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: project }).status, 0);
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'git reset --hard' }, cwd: project }).status, 0); // ask, not deny
});

test('protocol: tools the guard does not care about pass through', () => {
  assert.equal(runHook({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' }, cwd: project }).status, 0);
});

// ---------- hooks.json ----------

test('hooks.json registers the guard for every file and shell tool', () => {
  const config = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const [entry] = config.hooks.PreToolUse;
  for (const toolName of ['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'Bash', 'PowerShell', 'Monitor']) {
    assert.ok(entry.matcher.split('|').includes(toolName), toolName);
  }
  const [handler] = entry.hooks;
  assert.equal(handler.type, 'command');
  assert.ok(JSON.stringify(handler).includes('${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs'));
  assert.ok(handler.timeout > 0);
});
