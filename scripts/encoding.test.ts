import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// UTF-8 bytes decoded as Windows-1252 ("GjÃ¸vik", "Â«", "â€”") or replacement characters.
const MOJIBAKE = /Ã[\u0080-¿Œ-™]|Â[\u0080-¿]|â€|�/;

function strings(x: unknown, path: string, out: [string, string][]): [string, string][] {
  if (typeof x === 'string') out.push([path, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) strings(v, `${path}.${k}`, out);
  return out;
}

describe('text encoding', () => {
  it('detects typical mojibake', () => {
    for (const bad of ['GjÃ¸vik', 'LÃ¸nn', 'Â«Nordlyset»', 'MÃ¥nedstall', 'a â€” b', 'Ã˜stfold']) expect(bad).toMatch(MOJIBAKE);
    for (const ok of ['Gjøvik', 'Lønn', '«Nordlyset»', 'Månedstall', 'a — b', 'Østfold', 'Æøå ÆØÅ', 'Hogia Lön']) expect(ok).not.toMatch(MOJIBAKE);
  });

  for (const file of ['data/portfolio.json', 'data/rationale.json', 'data/assumptions.json']) {
    it.skipIf(!existsSync(resolve(root, file)))(`${file} has no mojibake`, () => {
      const bad = strings(JSON.parse(readFileSync(resolve(root, file), 'utf8')), '$', []).filter(([, s]) => MOJIBAKE.test(s));
      expect(bad).toEqual([]);
    });
  }

  it.skipIf(!existsSync(resolve(root, 'public/sample-inventory.csv')))('sample CSV has no mojibake', () => {
    expect(readFileSync(resolve(root, 'public/sample-inventory.csv'), 'utf8')).not.toMatch(MOJIBAKE);
  });
});
