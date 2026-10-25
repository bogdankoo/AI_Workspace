#!/usr/bin/env node
/**
 * Project Claude Code hook (repository-level).
 *
 * PostToolUse (Edit|Write|MultiEdit|NotebookEdit)
 *   Запоминает путь изменённого файла для текущей сессии.
 * Stop
 *   Берёт записанные файлы, определяет язык по расширению и запускает проверки
 *   в корне соответствующего проекта. Если проверки упали — блокирует остановку
 *   и возвращает ошибки Claude, чтобы он их исправил.
 *
 * Ручной запуск для отладки:
 *   echo '{"hook_event_name":"Stop","session_id":"manual","cwd":"C:/proj"}' | node turn-checks.mjs
 *   TURN_CHECKS_DEBUG=1 — писать лог в %TEMP%/claude-turn-checks/debug.log
 *
 * Скрипт не печатает ничего, кроме итогового JSON, и всегда завершается с кодом 0:
 * иначе сломается сам Stop-хук.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEBUG = process.env.TURN_CHECKS_DEBUG === '1';
const STATE_DIR = path.join(os.tmpdir(), 'claude-turn-checks');
const CHECK_TIMEOUT_MS = 120_000;
const MAX_REPORT_CHARS = 8_000; // у Stop лимит на reason — 10 000 символов
const MAX_CHECK_OUTPUT_CHARS = 2_500;
const MAX_FILES_PER_CHECK = 100;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage',
  'vendor', '.turbo', '.cache', 'target', '.venv', 'venv', '__pycache__',
]);

const EXT = {
  js: new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro']),
  py: new Set(['.py', '.pyi']),
  go: new Set(['.go']),
  rs: new Set(['.rs']),
  lua: new Set(['.lua', '.luau']),
  cs: new Set(['.cs']),
  c: new Set(['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh']),
  php: new Set(['.php']),
  sh: new Set(['.sh', '.bash', '.zsh']),
  rb: new Set(['.rb']),
  dart: new Set(['.dart']),
  zig: new Set(['.zig']),
};

const commandCache = new Map();

try {
  const input = JSON.parse(readStdin() || '{}');
  if (input.hook_event_name === 'PostToolUse') recordEdit(input);
  else if (input.hook_event_name === 'Stop') handleStop(input);
} catch (error) {
  debug(`fatal: ${error && error.stack ? error.stack : error}`);
}
// Без process.exit: stdout с решением должен успеть дописаться в пайп.

// ---------------------------------------------------------------------------
// События

function recordEdit(input) {
  const raw = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof raw !== 'string' || raw.length === 0) return;
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(input.cwd || process.cwd(), raw);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(statePath(input.session_id), JSON.stringify({ path: absolute }) + '\n', 'utf8');
  debug(`recorded: ${absolute}`);
}

function handleStop(input) {
  const stateFile = statePath(input.session_id);
  let paths = readRecordedPaths(stateFile);
  if (paths.length === 0) paths = editsFromTranscript(input.transcript_path);

  const files = [...new Map(paths.map((p) => [p.toLowerCase(), p])).values()].filter(isRelevantFile);
  debug(`stop: ${files.length} relevant file(s): ${files.join(', ')}`);
  if (files.length === 0) return;

  const problems = runChecks(files);
  if (problems.length === 0) return;

  const report = formatProblems(problems).slice(0, MAX_REPORT_CHARS);
  if (input.stop_hook_active) {
    // Уже исправляли после этого хука: не блокируем второй раз, чтобы не зациклиться.
    debug('stop_hook_active=true: report without blocking');
    writeJson({
      systemMessage:
        'Проверки после правок всё ещё не проходят (хук остановился, чтобы не зациклиться):\n\n' +
        stripPrefix(report),
    });
  } else {
    writeJson({ decision: 'block', reason: report });
  }
}

// ---------------------------------------------------------------------------
// Состояние сессии и транскрипт

function statePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(STATE_DIR, `edits-${safe}.jsonl`);
}

function readRecordedPaths(file) {
  if (!fs.existsSync(file)) return [];
  const result = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (typeof entry?.path === 'string') result.push(entry.path);
      } catch {
        // битая строка — пропускаем
      }
    }
  } finally {
    try { fs.unlinkSync(file); } catch { /* уже удалён */ }
  }
  return result;
}

/** Запасной путь, если PostToolUse не успел записать файлы (например, хук подключили посреди сессии). */
function editsFromTranscript(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) return [];
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch { return []; }
  if (text.length > 50 * 1024 * 1024) return [];

  const lines = text.split('\n').filter(Boolean);
  let turnStart = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    const isHumanPrompt =
      entry.type === 'user' &&
      entry.isMeta !== true &&
      typeof entry.message?.content === 'string';
    if (isHumanPrompt) { turnStart = i; break; }
  }

  const files = [];
  for (let i = turnStart; i < lines.length; i++) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.type !== 'assistant' || entry.isSidechain === true) continue;
    const blocks = Array.isArray(entry.message?.content) ? entry.message.content : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_use') continue;
      if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) continue;
      const file = block.input?.file_path ?? block.input?.notebook_path;
      if (typeof file === 'string') files.push(file);
    }
  }
  return files;
}

function isRelevantFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  return !path.resolve(file).split(/[\\/]/).some((part) => SKIP_DIRS.has(part));
}

// ---------------------------------------------------------------------------
// Проверки

function runChecks(files) {
  const groups = {};
  for (const key of Object.keys(EXT)) groups[key] = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    for (const [key, exts] of Object.entries(EXT)) {
      if (exts.has(ext)) { groups[key].push(file); break; }
    }
  }

  const problems = [];
  const checks = [
    ['js', checkJs],
    ['py', checkPython],
    ['go', checkGo],
    ['rs', checkRust],
    ['lua', checkLua],
    ['cs', checkDotnet],
    ['c', checkClangTidy],
    ['php', checkPhp],
    ['sh', checkShell],
    ['rb', checkRuby],
    ['dart', checkDart],
    ['zig', checkZig],
  ];
  for (const [key, check] of checks) {
    if (groups[key].length === 0) continue;
    try {
      problems.push(...check(groups[key]));
    } catch (error) {
      debug(`check ${key} failed internally: ${error && error.stack ? error.stack : error}`);
    }
  }
  return problems.filter(Boolean);
}

function checkJs(files) {
  const problems = [];
  const byRoot = groupBy(files, (file) => nearestWith(file, ['package.json']) || path.dirname(file));

  for (const [root, group] of byRoot) {
    const pkg = readJson(path.join(root, 'package.json')) || {};
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const pm = detectPackageManager(root);
    const eslintEntry = findLocalBin(root, 'eslint/bin/eslint.js');
    const targets = group.slice(0, MAX_FILES_PER_CHECK);

    const lintScript = typeof scripts.lint === 'string' ? scripts.lint.trim() : '';
    const directEslint = /^eslint(?:\s+(.*))?$/.exec(lintScript);
    if (directEslint && eslintEntry) {
      const flags = directEslint[1] ? directEslint[1].split(/\s+/).filter(Boolean) : [];
      push(problems, execCheck(`eslint (${root})`, process.execPath, [eslintEntry, ...flags, ...targets], root));
    } else if (lintScript) {
      // Сложный скрипт (например, `next lint`) — запускаем как есть, на весь проект.
      push(problems, runPackageScript(pm, 'lint', root));
    } else if (eslintEntry) {
      push(problems, execCheck(`eslint (${root})`, process.execPath, [eslintEntry, ...targets], root));
    }

    if (typeof scripts.typecheck === 'string') {
      push(problems, runPackageScript(pm, 'typecheck', root));
    } else {
      const tsconfigDir = walkUp(root, (dir) => fs.existsSync(path.join(dir, 'tsconfig.json')));
      const tscEntry = tsconfigDir ? findLocalBin(tsconfigDir, 'typescript/bin/tsc') : null;
      if (tsconfigDir && tscEntry) {
        push(problems, execCheck(
          `tsc (${tsconfigDir})`,
          process.execPath,
          [tscEntry, '--noEmit', '-p', tsconfigDir],
          tsconfigDir,
        ));
      }
    }
  }
  return problems;
}

function checkPython(files) {
  const problems = [];
  const byRoot = groupBy(
    files,
    (file) =>
      nearestWith(file, ['pyproject.toml', 'setup.cfg', 'setup.py', 'requirements.txt']) ||
      nearestWith(file, ['.git']) ||
      path.dirname(file),
  );

  for (const [root, group] of byRoot) {
    const targets = group.slice(0, MAX_FILES_PER_CHECK);
    if (commandExists('ruff')) {
      push(problems, execCheck(`ruff (${root})`, 'ruff', ['check', ...targets], root));
    }
    if (commandExists('mypy') && hasMypyConfig(root)) {
      push(problems, execCheck(`mypy (${root})`, 'mypy', targets, root));
    }
  }
  return problems;
}

function checkGo(files) {
  const problems = [];
  if (!commandExists('go')) return problems;
  const byRoot = groupBy(files, (file) => nearestWith(file, ['go.mod']) || path.dirname(file));

  for (const [root, group] of byRoot) {
    if (!fs.existsSync(path.join(root, 'go.mod'))) continue;
    const dirs = [
      ...new Set(
        group.map((file) => {
          const rel = path.relative(root, path.dirname(file));
          return rel ? './' + rel.split(path.sep).join('/') : '.';
        }),
      ),
    ];
    push(problems, execCheck(`go vet (${root})`, 'go', ['vet', ...dirs], root));
  }
  return problems;
}

function checkRust(files) {
  const problems = [];
  if (!commandExists('cargo')) return problems;
  const byRoot = groupBy(files, (file) => nearestWith(file, ['Cargo.toml']) || path.dirname(file));

  for (const [root] of byRoot) {
    if (!fs.existsSync(path.join(root, 'Cargo.toml'))) continue;
    push(problems, execCheck(
      `cargo check (${root})`,
      'cargo',
      ['check', '--message-format', 'short'],
      root,
    ));
  }
  return problems;
}

function checkLua(files) {
  const problems = [];
  const byRoot = groupBy(
    files,
    (file) =>
      nearestWith(file, ['selene.toml', '.selene.toml', 'stylua.toml', 'default.project.json']) ||
      nearestWith(file, ['.git']) ||
      path.dirname(file),
  );

  for (const [root, group] of byRoot) {
    const targets = group.slice(0, MAX_FILES_PER_CHECK);
    if (!commandExists('selene')) continue;

    // Без selene.toml (std = "roblox") неизвестные глобалы вроде game/workspace
    // дают предупреждения — не валим ход из-за них.
    const configured = walkUp(
      root,
      (dir) => fs.existsSync(path.join(dir, 'selene.toml')) || fs.existsSync(path.join(dir, '.selene.toml')),
    );
    const args = configured ? targets : ['--allow-warnings', ...targets];
    push(problems, execCheck(`selene (${root})`, 'selene', args, root));
  }
  return problems;
}

function checkDotnet(files) {
  const problems = [];
  if (!commandExists('dotnet')) return problems;
  const byRoot = groupBy(
    files,
    (file) => walkUp(path.dirname(file), (dir) => dirHas(dir, ['.sln', '.csproj'])) || path.dirname(file),
  );

  for (const [root] of byRoot) {
    push(problems, execCheck(
      `dotnet build (${root})`,
      'dotnet',
      ['build', '--nologo', '-v', 'q'],
      root,
    ));
  }
  return problems;
}

function checkClangTidy(files) {
  const problems = [];
  if (!commandExists('clang-tidy')) return problems;
  const byRoot = groupBy(
    files,
    (file) =>
      walkUp(path.dirname(file), (dir) =>
        fs.existsSync(path.join(dir, 'compile_commands.json')) ||
        fs.existsSync(path.join(dir, 'build', 'compile_commands.json')),
      ) || path.dirname(file),
  );

  for (const [root, group] of byRoot) {
    const dbDir = fs.existsSync(path.join(root, 'compile_commands.json'))
      ? root
      : fs.existsSync(path.join(root, 'build', 'compile_commands.json'))
        ? path.join(root, 'build')
        : null;
    if (!dbDir) continue;
    push(problems, execCheck(
      `clang-tidy (${root})`,
      'clang-tidy',
      ['-p', dbDir, ...group.slice(0, 20)],
      root,
    ));
  }
  return problems;
}

function checkPhp(files) {
  if (!commandExists('php')) return [];
  const outputs = [];
  for (const file of files.slice(0, 50)) {
    const result = spawnSync('php', ['-l', file], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      outputs.push(`${file}\n${((result.stdout || '') + (result.stderr || '')).trim()}`);
    }
  }
  return outputs.length > 0
    ? [{ name: 'php -l', output: truncate(outputs.join('\n\n'), MAX_CHECK_OUTPUT_CHARS) }]
    : [];
}

function checkShell(files) {
  if (!commandExists('shellcheck')) return [];
  return toProblems(execCheck(
    'shellcheck',
    'shellcheck',
    ['-f', 'gcc', ...files.slice(0, MAX_FILES_PER_CHECK)],
    commonDir(files),
  ));
}

function checkRuby(files) {
  if (!commandExists('rubocop')) return [];
  const problems = [];
  const byRoot = groupBy(
    files,
    (file) => walkUp(path.dirname(file), (dir) => fs.existsSync(path.join(dir, '.rubocop.yml'))) || path.dirname(file),
  );
  for (const [root, group] of byRoot) {
    if (!fs.existsSync(path.join(root, '.rubocop.yml'))) continue;
    push(problems, execCheck(
      `rubocop (${root})`,
      'rubocop',
      ['--format', 'simple', ...group.slice(0, MAX_FILES_PER_CHECK)],
      root,
    ));
  }
  return problems;
}

function checkDart(files) {
  if (!commandExists('dart')) return [];
  const problems = [];
  const byRoot = groupBy(files, (file) => nearestWith(file, ['pubspec.yaml']) || path.dirname(file));
  for (const [root, group] of byRoot) {
    if (!fs.existsSync(path.join(root, 'pubspec.yaml'))) continue;
    push(problems, execCheck(
      `dart analyze (${root})`,
      'dart',
      ['analyze', ...group.slice(0, MAX_FILES_PER_CHECK)],
      root,
    ));
  }
  return problems;
}

function checkZig(files) {
  if (!commandExists('zig')) return [];
  return toProblems(execCheck(
    'zig ast-check',
    'zig',
    ['ast-check', ...files.slice(0, MAX_FILES_PER_CHECK)],
    commonDir(files),
  ));
}

// ---------------------------------------------------------------------------
// Запуск команд

function execCheck(name, command, args, cwd, shell = false) {
  debug(`> ${command} ${args.join(' ')}  [cwd=${cwd}]`);
  const result = spawnSync(command, args, {
    cwd,
    shell,
    encoding: 'utf8',
    timeout: CHECK_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error && result.error.code === 'ENOENT') {
    debug(`${name}: skipped (command not found)`);
    return null;
  }

  const output = ((result.stdout || '') + (result.stderr || '')).trim();
  if (!result.error && result.status === 0) {
    debug(`${name}: ok`);
    return null;
  }

  const note = result.error
    ? `\n[${result.error.code || 'error'}: ${result.error.message}]`
    : '';
  debug(`${name}: failed (status=${result.status})`);
  return { name, output: truncate(output, MAX_CHECK_OUTPUT_CHARS) + note };
}

function runPackageScript(pm, script, cwd) {
  const args = pm === 'yarn' ? [script] : ['run', script];
  return execCheck(`${pm} run ${script} (${cwd})`, pm, args, cwd, process.platform === 'win32');
}

function toProblems(value) {
  return value ? [value] : [];
}

function push(target, value) {
  if (value) target.push(value);
}

// ---------------------------------------------------------------------------
// Утилиты

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function debug(message) {
  if (!DEBUG) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(STATE_DIR, 'debug.log'),
      `[${new Date().toISOString()}] ${message}\n`,
      'utf8',
    );
  } catch {
    // отладка не должна ломать хук
  }
}

function truncate(text, limit) {
  if (!text) return '';
  return text.length > limit ? text.slice(0, limit) + '\n… (обрезано)' : text;
}

function formatProblems(problems) {
  const lines = [
    'Проверки после правок не прошли. Исправь эти ошибки и заверши ход:',
  ];
  for (const problem of problems) {
    lines.push('', `=== ${problem.name} ===`, problem.output || '(без вывода)');
  }
  return lines.join('\n');
}

function stripPrefix(report) {
  return report.split('\n').slice(1).join('\n').trim();
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function walkUp(startDir, predicate) {
  let dir = path.resolve(startDir);
  for (;;) {
    try {
      if (predicate(dir)) return dir;
    } catch {
      // нечитаемый каталог — идём выше
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function nearestWith(file, names) {
  return walkUp(path.dirname(file), (dir) => names.some((name) => fs.existsSync(path.join(dir, name))));
}

function findLocalBin(startDir, relativePath) {
  const found = walkUp(startDir, (dir) =>
    fs.existsSync(path.join(dir, 'node_modules', relativePath)),
  );
  return found ? path.join(found, 'node_modules', relativePath) : null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function commandExists(command) {
  if (commandCache.has(command)) return commandCache.get(command);
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(finder, [command], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  const exists = !result.error && result.status === 0 && Boolean((result.stdout || '').trim());
  commandCache.set(command, exists);
  return exists;
}

function hasMypyConfig(startDir) {
  return Boolean(
    walkUp(startDir, (dir) => {
      if (fs.existsSync(path.join(dir, 'mypy.ini'))) return true;
      if (fs.existsSync(path.join(dir, '.mypy.ini'))) return true;
      const pyproject = readText(path.join(dir, 'pyproject.toml'));
      if (pyproject && pyproject.includes('[tool.mypy]')) return true;
      const setupCfg = readText(path.join(dir, 'setup.cfg'));
      return Boolean(setupCfg && /^\[mypy\]/m.test(setupCfg));
    }),
  );
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function dirHas(dir, suffixes) {
  try {
    return fs.readdirSync(dir).some((name) => suffixes.some((suffix) => name.endsWith(suffix)));
  } catch {
    return false;
  }
}

function commonDir(files) {
  const dirs = files.map((file) => path.dirname(file));
  let common = dirs[0];
  for (const dir of dirs.slice(1)) {
    while (dir !== common && !dir.startsWith(common + path.sep)) {
      const parent = path.dirname(common);
      if (parent === common) break;
      common = parent;
    }
  }
  return common;
}
