#!/usr/bin/env node
// ===========================================================================
// Foundit — the control-byte sweep.
//
//   node scripts/scan-control-bytes.mjs
//
// Every tracked text file this repository writes, checked for a control byte
// that should never be in one: C0 except tab, newline and carriage return,
// plus DEL, plus U+2028 and U+2029.
//
// WHY THIS EXISTS, and it is not theoretical. On the development machine a
// bash heredoc and printf both turn a written backspace or form-feed ESCAPE
// into the byte itself — so a file that was meant to contain the four
// characters backslash-b ends up containing one 0x08. In a migration that is a
// CHECK constraint whose pattern silently lost a range. In a test it is an
// assertion that passes because the string it compares against is also wrong.
// In a document it is a line a reader cannot see.
//
// The sweep was a scratch file for four phases and is in the repository now
// because Phase 7 writes a schema whose whole job is refusing these bytes, and
// a guard that lives outside the repository is a guard that gets forgotten.
//
// It is written with no escape sequence of its own, for the same reason: every
// byte it cares about is named by its number.
//
// Exit codes: 0 clean, 1 something was found, 2 could not run.
// ===========================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TAB = 9;
const LF = 10;
const CR = 13;
const DEL = 127;
const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;

/** The extensions swept. Source, schema, prose, data and shell. */
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.sql', '.md', '.json', '.sh'];

const banned = new Set();
for (let code = 0; code <= 31; code += 1) banned.add(code);
banned.delete(TAB);
banned.delete(LF);
banned.delete(CR);
banned.add(DEL);
// The C1 block is deliberately NOT banned here: in a UTF-8 file those bytes
// only appear as part of a multi-byte character, and this sweep reads code
// points. The two Unicode separators are the ones that matter, because they
// are legal characters that break a line where nothing looks broken.
banned.add(LINE_SEPARATOR);
banned.add(PARAGRAPH_SEPARATOR);

function name(code) {
  if (code === DEL) return 'DEL';
  if (code === LINE_SEPARATOR) return 'U+2028 LINE SEPARATOR';
  if (code === PARAGRAPH_SEPARATOR) return 'U+2029 PARAGRAPH SEPARATOR';
  return 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
}

let files;
try {
  files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(String.fromCharCode(LF))
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => EXTENSIONS.some((ext) => line.endsWith(ext)));
} catch (error) {
  process.stderr.write('could not list tracked files: ' + error.message + String.fromCharCode(LF));
  process.exit(2);
}

const findings = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // A tracked path that is not readable as text is not this sweep's problem.
    continue;
  }

  let line = 1;
  let column = 1;
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === LF) {
      line += 1;
      column = 1;
      continue;
    }
    if (banned.has(code)) {
      findings.push({ file, line, column, code });
    }
    column += 1;
  }
}

const newline = String.fromCharCode(LF);

if (findings.length > 0) {
  process.stdout.write(
    findings.length + ' control byte(s) in tracked text:' + newline + newline,
  );
  for (const found of findings.slice(0, 100)) {
    process.stdout.write(
      '  ' + found.file + ':' + found.line + ':' + found.column + '  ' + name(found.code) + newline,
    );
  }
  if (findings.length > 100) {
    process.stdout.write('  ... and ' + (findings.length - 100) + ' more' + newline);
  }
  process.stdout.write(
    newline +
      'Write the file again with the Write tool or from node. A bash heredoc or' +
      newline +
      'printf is what put the byte there.' +
      newline,
  );
  process.exit(1);
}

process.stdout.write(
  files.length + ' tracked file(s) swept across ' + EXTENSIONS.join(' ') + ': no control bytes.' + newline,
);
