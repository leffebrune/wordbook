import { afterEach, describe, expect, it, vi } from 'vitest';
import { grade, GradingError, validateResults, type GradeItem } from './grading';

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
    expect(await grade(items, 'openai/example', 'test-only-key')).toEqual([result]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-only-key');
    expect(options.body).not.toContain('test-only-key');
    const request = JSON.parse(options.body);
    expect(request.model).toBe('openai/example');
    expect(request.messages[1].content).toContain('가저가다');
    expect(request.provider.require_parameters).toBe(true);
  });

  it('does not make a request without a device key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(grade(items, 'openai/example', ' ')).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])('identifies an invalid key for HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(grade(items, 'openai/example', 'invalid-test-key')).rejects.toMatchObject({ kind: 'auth' });
  });
});
