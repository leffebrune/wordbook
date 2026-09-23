import { describe, expect, it } from 'vitest';
import { parseSheet, SheetError } from './sheet';

describe('sheet parsing', () => {
  const data = (model: string, focus = '가방을 가져가는 장면') =>
    `word,focus,,model,${model}\ntake,"${focus}"\nget,\nTAKE,중복\n`;

  it('reads the first row as settings and skips duplicate words', async () => {
    const parsed = await parseSheet(data('openai/example'));
    expect(parsed.words.map(word => word.text)).toEqual(['take', 'get']);
    expect(parsed.words[0].focus).toBe('가방을 가져가는 장면');
    expect(parsed.model).toBe('openai/example');
  });

  it('keeps drafts valid across model changes, but detects focus changes', async () => {
    const initial = await parseSheet(data('openai/first'));
    const modelChanged = await parseSheet(data('openai/second'));
    const focusChanged = await parseSheet(data('openai/second', '버스를 타는 장면'));
    expect(initial.revision).toBe(modelChanged.revision);
    expect(initial.words[0].id).toBe(modelChanged.words[0].id);
    expect(initial.revision).not.toBe(focusChanged.revision);
  });

  it('rejects malformed header and invalid word', async () => {
    await expect(parseSheet('wrong,focus,,model,openai/example\ntake,')).rejects.toBeInstanceOf(SheetError);
    await expect(parseSheet('word,focus,,model,openai/example\n42cat,')).rejects.toBeInstanceOf(SheetError);
  });
});
