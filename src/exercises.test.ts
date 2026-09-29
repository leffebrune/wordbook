import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateExercises, validateExercises } from './exercises';
import { GradingError, gradingErrorMessage } from './openRouter';
import { restoreLesson } from './lesson';
import type { WordSheet } from './sheet';

const word = { id: 'get', text: 'get', focus: '날씨가 추워지는 장면' };
const exercise = { id: word.id, exampleEn: 'It is getting cold.', target: 'getting', meaning: '~해지다', exampleKo: '날씨가 추워지고 있어.' };
const sheet: WordSheet = { words: [word], revision: 'r1', model: 'openai/example', ttsModel: '', ttsVoice: '', truncated: false };
afterEach(() => vi.unstubAllGlobals());

describe('exercise generation', () => {
  it('generates all 30 words in one request with easy-language instructions and no answers', async () => {
    const words = Array.from({ length: 30 }, (_, index) => ({ ...word, id: String(index) }));
    const exercises = words.map(item => ({ ...exercise, id: item.id }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ exercises }) } }] })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await generateExercises(words, sheet.model, 'test-key', new AbortController().signal)).toEqual(exercises);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(request.messages[1].content)).toHaveLength(30);
    expect(request.messages[0].content).toContain('가장 쉬운 생활 어휘와 문장 구조');
    expect(request.messages[0].content).toContain('관계절, 수동태');
    expect(request).not.toHaveProperty('temperature');
    expect(request.messages[1].content).not.toContain('answer');
  });
  it('preserves a valid inflection and a whole multiword expression', () => {
    expect(validateExercises({ exercises: [exercise] }, [word])).toEqual([exercise]);
    expect(validateExercises({ exercises: [{ ...exercise, exampleEn: 'Come out and play!', target: 'Come out' }] }, [word])[0].target).toBe('Come out');
  });
  it.each([
    { target: 'get' }, { target: 'getting cold today' }, { exampleEn: 'It is getting 추워.' },
    { exampleEn: '<b>getting</b>' }, { exampleEn: 'a'.repeat(121) }, { meaning: '' }, { id: 'other' }
  ])('rejects invalid or revealing exercise data: %j', patch => {
    expect(() => validateExercises({ exercises: [{ ...exercise, ...patch }] }, [word])).toThrow(GradingError);
  });
  it('rejects missing and duplicate questions', () => {
    expect(() => validateExercises({ exercises: [] }, [word])).toThrow();
    expect(() => validateExercises({ exercises: [exercise, exercise] }, [word, { ...word, id: 'other' }])).toThrow();
  });
  it('reports generation timeout distinctly and never retries automatically', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);
    const error = await generateExercises([word], sheet.model, 'test-key', new AbortController().signal).catch(error => error);
    expect(error).toMatchObject({ kind: 'timeout' });
    expect(gradingErrorMessage(error, 'generation')).toContain('문장 생성 응답 시간이 초과');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('keeps explicit cancellation separate from failures', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
    await expect(generateExercises([word], sheet.model, 'test-key', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('exercise and answer persistence', () => {
  const saved = JSON.stringify({ revision: sheet.revision, entries: { get: { exercise, answer: '추워지다' } } });
  it('restores the exact question and answer together across model-only changes', () => {
    expect(restoreLesson(saved, { ...sheet, model: 'another/model' }).entries.get).toEqual({ exercise, answer: '추워지다' });
  });
  it('does not apply old answers when words or focus changed', () => {
    expect(restoreLesson(saved, { ...sheet, revision: 'r2' }).entries).toEqual({});
    expect(restoreLesson('{"get":"얻다"}', sheet).entries).toEqual({});
  });
  it('discards corrupt cached questions without keeping their orphan answers', () => {
    const bad = JSON.stringify({ revision: sheet.revision, entries: { get: { exercise: { ...exercise, target: 'missing' }, answer: '답' } } });
    expect(restoreLesson(bad, sheet).entries).toEqual({});
    expect(restoreLesson('broken json', sheet).entries).toEqual({});
  });
});
