import { afterEach, describe, expect, it, vi } from 'vitest';
import { grade, GradingError, gradingErrorMessage, validateResults, type GradeItem } from './grading';

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
    expect(await grade(items, 'openai/gpt-6-luna', 'test-only-key')).toEqual([result]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-only-key');
    expect(options.body).not.toContain('test-only-key');
    const request = JSON.parse(options.body);
    expect(request.model).toBe('openai/gpt-6-luna');
    // GPT-6 Luna 공급자가 지원하지 않는 옵션 때문에 라우팅에서 제외되지 않아야 한다.
    expect(request).not.toHaveProperty('temperature');
    expect(request.response_format.type).toBe('json_schema');
    expect(request.messages[1].content).toContain('가저가다');
    expect(request.provider.require_parameters).toBe(true);
  });

  it('does not make a request without a device key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(grade(items, 'openai/example', ' ')).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'request'], [401, 'auth'], [402, 'credits'], [403, 'forbidden'],
    [404, 'model'], [408, 'timeout'], [422, 'request'], [429, 'rate-limit'],
    [500, 'unavailable'], [502, 'unavailable'], [503, 'unavailable'], [504, 'timeout']
  ] as const)('distinguishes HTTP %s as %s even without a JSON body', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(grade(items, 'openai/example', 'test-only-key')).rejects.toMatchObject({ kind, status, model: 'openai/example' });
  });

  it('handles API errors delivered with HTTP 200 without exposing raw messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ error: { code: 429, message: 'private response: test-only-key' } })
    }));
    const error = await grade(items, 'openai/example', 'test-only-key').catch(error => error);
    expect(error).toMatchObject({ kind: 'rate-limit', status: 429 });
    expect(gradingErrorMessage(error)).toContain('호출 한도');
    expect(gradingErrorMessage(error)).toContain('429');
    expect(gradingErrorMessage(error)).toContain('openai/example');
    expect(gradingErrorMessage(error)).not.toContain('test-only-key');
  });

  it('distinguishes a local timeout from network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    await expect(grade(items, 'openai/example', 'test-only-key')).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('does not report insufficient credit as an invalid model', () => {
    expect(gradingErrorMessage(new GradingError('credits', 402, 'openai/example'))).toContain('크레딧');
  });
});
