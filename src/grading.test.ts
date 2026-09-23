import { afterEach, describe, expect, it, vi } from 'vitest';
import { grade, GradingError, validateResults, type GradeItem } from './grading';

vi.mock('./config', () => ({ config: { openRouterApiKey: 'test-only-key' } }));
afterEach(() => vi.unstubAllGlobals());

const items: GradeItem[] = [{
  word: { id: 'id1', text: 'take', focus: '가방을 가져가는 장면' },
  answer: '가저가다'
}];
const result = {
  id: 'id1', verdict: 'correct', comment: '뜻을 잘 알았어.',
  exampleEn: 'I take a bag.', exampleKo: '나는 가방을 가져가.'
};

describe('grading response validation', () => {
  it('accepts one valid result for each submitted id', () => {
    expect(validateResults({ results: [result] }, items)).toEqual([result]);
  });

  it('rejects missing, extra, and unsafe output', () => {
    expect(() => validateResults({ results: [] }, items)).toThrow(GradingError);
    expect(() => validateResults({ results: [{ ...result, id: 'unknown' }] }, items)).toThrow(GradingError);
    expect(() => validateResults({ results: [{ ...result, comment: '<script>bad</script>' }] }, items)).toThrow(GradingError);
  });

  it('sends the sheet model and answer directly to OpenRouter in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ results: [result] }) } }] })
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await grade(items, 'openai/example')).toEqual([result]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const request = JSON.parse(options.body);
    expect(request.model).toBe('openai/example');
    expect(request.messages[1].content).toContain('가저가다');
    expect(request.provider.require_parameters).toBe(true);
  });
});
