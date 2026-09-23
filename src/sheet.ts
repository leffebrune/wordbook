import Papa from 'papaparse';
import { config } from './config';

export interface Word {
  id: string;
  text: string;
  focus: string;
}

export interface WordSheet {
  words: Word[];
  revision: string;
  model: string;
  truncated: boolean;
}

export class SheetError extends Error {
  constructor(message: string, readonly kind: 'network' | 'format' = 'format') {
    super(message);
  }
}

const wordPattern = /^[A-Za-z][A-Za-z' -]*$/;
const encoder = new TextEncoder();

export function normalizeWord(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function parseSheet(csv: string): Promise<WordSheet> {
  if (encoder.encode(csv).length > 100_000) throw new SheetError('시트가 너무 큽니다.');
  const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ''), { skipEmptyLines: false });
  if (parsed.errors.length) throw new SheetError('CSV 형식이 올바르지 않습니다.');
  const rows = parsed.data;
  if (rows[0]?.[0]?.trim() !== 'word' || rows[0]?.[1]?.trim() !== 'focus' || rows[0]?.[3]?.trim() !== 'model') {
    throw new SheetError('A1=word, B1=focus, D1=model인지 확인해 주세요.');
  }

  const model = rows[0]?.[4]?.trim() ?? '';
  const seen = new Set<string>();
  const entries: Array<{ text: string; focus: string }> = [];
  for (let index = 1; index < rows.length; index++) {
    const text = normalizeWord(rows[index][0] ?? '');
    if (!text) continue;
    const focus = (rows[index][1] ?? '').trim();
    if (text.length > 50 || !wordPattern.test(text)) throw new SheetError(`${index + 1}행 단어를 확인해 주세요.`);
    if (focus.length > 120) throw new SheetError(`${index + 1}행 설명이 너무 깁니다.`);
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ text, focus });
  }

  const words = await Promise.all(entries.slice(0, 30).map(async entry => ({
    ...entry,
    id: await digest(entry.text.toLowerCase())
  })));
  // 모델만 바뀌었을 때 작성 중인 답안이 무효화되지 않도록 E1은 제외한다.
  const revision = await digest(JSON.stringify(entries.map(entry => [entry.text.toLowerCase(), entry.focus])));
  return { words, revision, model, truncated: entries.length > 30 };
}

export function sheetUrl(): string {
  const { sheetId, sheetGid } = config;
  if (!/^[\w-]+$/.test(sheetId) || !/^\d+$/.test(sheetGid)) {
    throw new SheetError('시트 ID와 gid를 config.local.ts에 입력해 주세요.');
  }
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?gid=${sheetGid}&tqx=out:csv&headers=0`;
}

export async function loadSheet(): Promise<WordSheet> {
  const url = sheetUrl();
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new SheetError(`시트 응답: ${response.status}`, 'network');
    return await parseSheet(await response.text());
  } catch (error) {
    if (error instanceof SheetError) throw error;
    throw new SheetError('시트에 연결하지 못했습니다.', 'network');
  }
}

export function modelIsValid(model: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/+-]+$/.test(model);
}
