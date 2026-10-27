import {createHash} from 'node:crypto';
import {readFileSync, realpathSync} from 'node:fs';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

// Extracts explicitly marked Oreslang docs snippets; never compiles or runs
// guest programs. Unsupported illustrative source blocks remain unexecuted.
const ticks = String.fromCharCode(96).repeat(3);
const header = new RegExp('^' + ticks + '(?:oreslang|ores)(?:\\s+doctest:(compile|reject|run)\\s+id=([a-z][a-z0-9_]{0,79}))?\\s*$');
const fence = new RegExp('^' + ticks + '\\s*$');
const anyDoctest = new RegExp('^' + ticks + '.*\\bdoctest\\b');

export function extractDoctests(markdown, documentPath = 'example.md') {
  if (typeof markdown !== 'string') throw new TypeError('markdown must be UTF-8 text');
  if (Buffer.byteLength(markdown, 'utf8') > 1024 * 1024) throw new Error('Markdown file exceeds 1 MiB source scan budget');
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const seen = new Set(), items = [];
  let active = null, ignored = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (active !== null) {
      if (fence.test(line)) {
        const source = active.content.join('\n') + '\n';
        if (!source.trim()) throw new Error('empty doctest: ' + active.id);
        items.push({
          id: active.id,
          kind: active.kind,
          source_file: documentPath,
          source_line: active.line,
          source_sha256: createHash('sha256').update(source, 'utf8').digest('hex'),
          source
        });
        active = null;
      } else {
        active.content.push(line);
      }
    } else if (ignored) {
      if (fence.test(line)) ignored = false;
    } else {
      const match = header.exec(line);
      if (match) {
        if (match[1]) {
          const id = match[2];
          if (seen.has(id)) throw new Error('duplicate doctest id: ' + id);
          seen.add(id);
          active = {id, kind: match[1], line: i + 2, content: []};
        } else {
          ignored = true;
        }
      } else if (anyDoctest.test(line)) {
        throw new Error('malformed or non-Oreslang doctest directive at line ' + (i + 1));
      } else if (line.startsWith(ticks)) {
        ignored = true;
      }
    }
  }
  if (active || ignored) throw new Error('unclosed Markdown source fence');
  return {
    schema: 'oreslang.doctest-source-manifest.v1',
    status: 'EXTRACTED_NOT_COMPILED',
    binary_evidence: false,
    document: documentPath,
    entries: items
  };
}

export function manifestForFile(filepath, rootDir = process.cwd()) {
  const root = realpathSync(resolve(rootDir)), absolute = realpathSync(resolve(filepath));
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel) || rel === '') throw new Error('doctest file must be under designated repository root');
  if (!rel.endsWith('.md')) throw new Error('doctest scanner only accepts Markdown files');
  return extractDoctests(readFileSync(absolute, 'utf8'), rel);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.length !== 4) {
    process.stderr.write('Usage: node tools/doctest-manifest.mjs /absolute/repository/root path/to/file.md\n');
    process.exitCode = 2;
  } else {
    try {
      const rootDir = resolve(process.argv[2]);
      const candidate = resolve(rootDir, process.argv[3]);
      process.stdout.write(JSON.stringify(manifestForFile(candidate, rootDir), null, 2) + '\n');
    } catch (err) {
      process.stderr.write('DOCTEST_MANIFEST_REJECTED: ' + err.message + '\n');
      process.exitCode = 1;
    }
  }
}
