/**
 * THIRD_PARTY_NOTICES.txt for each build: the licence (and NOTICE) files of every package whose
 * code ends up in a bundle, plus packages whose files are copied in as they are (ONNX Runtime's
 * WebAssembly). Used from wxt.config.ts.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** The package directory a bundled module comes from, or null for the project's own code. */
export function packageDir(moduleId: string): string | null {
  const id = moduleId.replace(/^\0/, '').split('?')[0]!.replace(/\\/g, '/');
  const at = id.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const rest = id.slice(at + '/node_modules/'.length).split('/');
  const name = rest[0]!.startsWith('@') ? rest.slice(0, 2).join('/') : rest[0]!;
  return resolve(id.slice(0, at), 'node_modules', name);
}

/** A Vite plugin that records the packages of every module in the output. */
export function collectPackages(found: Set<string>): Plugin {
  return {
    name: 'arxiv-triage:collect-packages',
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        const ids = (out as { moduleIds?: string[] }).moduleIds ?? Object.keys(out.modules ?? {});
        for (const id of ids) {
          const dir = packageDir(id);
          if (dir && existsSync(join(dir, 'package.json'))) found.add(dir);
        }
      }
    },
  };
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

function section(dir: string): string {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
  const files = readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort();
  const texts = files.map((f) => readFileSync(join(dir, f), 'utf8').trim());
  const body = texts.length ? texts.join('\n\n') : `(The package ships no licence file; its package.json says ${pkg.license ?? 'nothing'}.)`;
  const rule = '='.repeat(78);
  return `${rule}\n${pkg.name} ${pkg.version} (${pkg.license ?? 'licence not stated'})\n${rule}\n\n${body}\n`;
}

export function writeNotices(outDir: string, dirs: Iterable<string>): void {
  const sorted = [...new Set(dirs)].sort((a, b) => a.localeCompare(b));
  const intro =
    'arXiv Triage includes the following third-party software. Each part is distributed under its\n' +
    'own licence, reproduced below. arXiv Triage itself is licensed under the GNU General Public\n' +
    'License, version 3 or later (see LICENSE in its source repository).\n\n';
  writeFileSync(join(outDir, 'THIRD_PARTY_NOTICES.txt'), intro + sorted.map(section).join('\n'));
}
