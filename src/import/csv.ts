export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const CANDIDATES = [';', ',', '\t', '|'];

/** Picks the delimiter that splits the header line (outside quotes) into the most fields. */
export function detectDelimiter(text: string): string {
  let line = '';
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if ((ch === '\n' || ch === '\r') && !inQuotes) break;
    if (!inQuotes) line += ch;
  }
  let best = ',';
  let bestCount = 0;
  for (const d of CANDIDATES) {
    const n = line.split(d).length - 1;
    if (n > bestCount) [best, bestCount] = [d, n];
  }
  return best;
}

/** RFC 4180 records: quoted fields may hold delimiters, newlines and "" escapes; CRLF, LF or CR line ends. */
export function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endRecord = () => {
    record.push(field);
    records.push(record);
    record = [];
    field = '';
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else field += ch;
    i++;
  }
  if (field !== '' || record.length) endRecord();
  return records;
}

export function parseCsv(input: string, delimiter?: string): CsvTable {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const records = parseRecords(text, d).filter((r) => r.some((c) => c.trim() !== ''));
  const [head = [], ...body] = records;
  const headers = head.map((h, i) => h.trim() || `Column ${i + 1}`);
  const width = headers.length;
  const rows = body.map((r) => {
    const cells = r.map((c) => c.trim());
    while (cells.length < width) cells.push('');
    return cells.slice(0, width);
  });
  return { headers, rows, delimiter: d };
}

/** UTF-8 when valid, else Windows-1252 (Excel's "CSV (semicolon)" export on Norwegian Windows). */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

const quote = (v: string, d: string) => (/["\r\n]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: string[][], delimiter = ';'): string {
  return rows.map((r) => r.map((c) => quote(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}
