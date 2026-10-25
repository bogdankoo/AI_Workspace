#!/usr/bin/env node
/**
 * Project Claude Code hook: требует минимум 3 уточняющих вопроса перед правкой файлов.
 *
 * UserPromptSubmit  — сбрасывает состояние хода, взводит гейт (кроме продолжений,
 *                     слэш-команд и маркера [без вопросов]); для change-запросов
 *                     добавляет в контекст инструкцию, какие вопросы задать.
 * PostToolUse       — AskUserQuestion: считает заданные вопросы.
 * PreToolUse        — Edit/Write/MultiEdit/NotebookEdit: пока вопросов < 3,
 *                     запрещает правку и возвращает причину с требуемой структурой.
 *
 * Отладка: CLARIFY_DEBUG=1 → %TEMP%/claude-clarify/debug.log
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REQUIRED_QUESTIONS = 3;
const STATE_DIR = path.join(os.tmpdir(), 'claude-clarify');
const DEBUG = process.env.CLARIFY_DEBUG === '1';
const MAX_CONTINUATION_LENGTH = 80;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const BYPASS_MARKERS = [
  /\[\s*без\s*вопросов\s*\]/i,
  /\[\s*no[\s-]?questions\s*\]/i,
  /\[\s*skip[\s-]?questions\s*\]/i,
  /#no[\s-]?questions\b/i,
  /#безвопросов\b/i,
];

const SLASH_COMMAND = /^\s*(?:<command-name>|<local-command-|\/[a-zа-я0-9_-]+)/i;

const CHANGE_INTENT =
  /(созда|добав|измен|исправ|удал|перепиш|реализу|напиш|обнов|передел|внедр|подключ|настро|почини|замени|вставь|сделай|собери|build|create|add|implement|change|update|remove|delete|write|fix|refactor|rename|move|replace|install)/i;

// \b в JS не считает кириллицу словом, поэтому граница задана явно.
const CONTINUATION_PREFIX =
  /^(продолжай|продолжи|продолжаем|делай|приступай|поехали|погнали|дальше|continue|go on|keep going)(?=\s|$|[,.!?;:…—-])/i;
const SHORT_ACK = /^(ок|окей|да|yes|yep|go|next)[\s!.,…]*$/i;
const ACK_THEN =
  /^(да|ок|окей)[,!.\s]+(делай|давай|продолжай|поехали|погнали|дальше)(?=\s|$|[,.!?;:…—-])/i;

const PROMPT_CONTEXT = [
  'Это запрос на изменение файлов. Хук проекта требует: до первой правки',
  '(Edit/Write/MultiEdit/NotebookEdit) задай минимум 3 содержательных уточняющих',
  'вопроса через AskUserQuestion — по возможности одним вызовом.',
  '',
  'Вопросы должны покрывать три оси:',
  '1) ЧТО: что именно создать/изменить, в каких файлах или на каких экранах, что не трогать.',
  '2) КАК: подход, формат, стиль, ограничения, крайние случаи.',
  '3) ЗАЧЕМ: цель и критерий готовности — как поймём, что результат совпал с ожиданием.',
  '',
  'Каждый ответ должен влиять на реализацию. Формальные вопросы («продолжать?»,',
  '«всё верно?») не подходят. Если часть деталей уже есть в запросе — спрашивай про',
  'пробелы, но всё равно не меньше 3 вопросов за ход. Пока счётчик меньше 3,',
  'инструменты правки заблокированы.',
].join('\n');

main();

function main() {
  const input = readInput();
  switch (input?.hook_event_name) {
    case 'UserPromptSubmit':
      onUserPromptSubmit(input);
      break;
    case 'PostToolUse':
      onPostToolUse(input);
      break;
    case 'PreToolUse':
      onPreToolUse(input);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// События

function onUserPromptSubmit(input) {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const stateFile = statePath(input.session_id);
  const trimmed = prompt.trim();

  if (!trimmed || SLASH_COMMAND.test(trimmed)) {
    startTurn(stateFile, false);
    debug('prompt: slash/empty — gate off');
    return;
  }

  if (BYPASS_MARKERS.some((pattern) => pattern.test(prompt))) {
    startTurn(stateFile, false);
    debug('prompt: bypass marker — gate off');
    return;
  }

  if (isContinuation(trimmed)) {
    startTurn(stateFile, false);
    debug('prompt: continuation — gate off');
    return;
  }

  startTurn(stateFile, true);
  debug('prompt: gate armed');

  if (CHANGE_INTENT.test(trimmed)) {
    writeJson({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: PROMPT_CONTEXT,
      },
    });
  }
}

function onPostToolUse(input) {
  if (input.tool_name !== 'AskUserQuestion') return;

  const stateFile = statePath(input.session_id);
  const turn = readTurn(stateFile);
  if (!turn.armed) return;

  const questions = Array.isArray(input.tool_input?.questions) ? input.tool_input.questions : [];
  if (questions.length === 0) return;

  appendQuestions(stateFile, questions.length);
  debug(`asked += ${questions.length} → ${turn.asked + questions.length}`);
}

function onPreToolUse(input) {
  if (!EDIT_TOOLS.has(input.tool_name)) return;

  // Субагент не может показать вопросы человеку — гейт на него не распространяем.
  if (input.agent_id) {
    debug(`subagent edit (${input.agent_id}): allow`);
    return;
  }

  const stateFile = statePath(input.session_id);
  const { armed, asked } = readTurn(stateFile);
  if (!armed) {
    debug('edit: gate off — allow');
    return;
  }
  if (asked >= REQUIRED_QUESTIONS) {
    debug(`edit: asked=${asked} — allow`);
    return;
  }

  debug(`edit: asked=${asked} — DENY`);
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denyReason(asked),
    },
  });
}

// ---------------------------------------------------------------------------
// Тексты

function denyReason(asked) {
  const remaining = REQUIRED_QUESTIONS - asked;
  return [
    `Правка файлов заблокирована хуком проекта: за этот ход задано ${asked} из ${REQUIRED_QUESTIONS} обязательных уточняющих вопросов (осталось ${remaining}).`,
    '',
    'Вызови AskUserQuestion и задай вопросы (можно 3–4 за один вызов), затем дождись ответов и повтори правку.',
    'Покрой три оси:',
    '1) ЧТО — что именно создать/изменить, в каких файлах/экранах, что не трогать.',
    '2) КАК — подход, формат, стиль, ограничения, крайние случаи.',
    '3) ЗАЧЕМ — цель и критерий готовности: как проверим, что результат совпал с ожиданием.',
    '',
    'Вопросы должны менять реализацию, а не быть формальностью. Ответы пользователя уже в контексте — не переспрашивай то, что он только что сказал.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Состояние

function statePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(STATE_DIR, `turn-${safe}.jsonl`);
}

// Append-only: UserPromptSubmit открывает ход одной строкой, PostToolUse дописывает
// счётчики. Read-modify-write дал бы гонку, потому что хуки — отдельные процессы.
function startTurn(file, armed) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ type: 'prompt', armed, at: new Date().toISOString() }) + '\n',
      'utf8',
    );
  } catch (error) {
    debug(`state write failed: ${error?.message || error}`);
  }
}

function appendQuestions(file, count) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ type: 'questions', count }) + '\n', 'utf8');
  } catch (error) {
    debug(`state append failed: ${error?.message || error}`);
  }
}

function readTurn(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { armed: false, asked: 0 };
  }

  let armed = false;
  let asked = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'prompt') {
      armed = entry.armed === true;
      asked = 0;
    } else if (entry.type === 'questions' && armed) {
      asked += Number(entry.count) || 0;
    }
  }
  return { armed, asked };
}

// ---------------------------------------------------------------------------
// Утилиты

function isContinuation(prompt) {
  if (prompt.length > MAX_CONTINUATION_LENGTH) return false;
  if (SHORT_ACK.test(prompt)) return true;

  const match = ACK_THEN.exec(prompt) || CONTINUATION_PREFIX.exec(prompt);
  if (!match) return false;

  // «Продолжай и добавь X» — это уже новый запрос на изменение, гейт нужен.
  const rest = prompt.slice(match[0].length).trim();
  if (rest && CHANGE_INTENT.test(rest)) return false;
  return true;
}

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return null;
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
