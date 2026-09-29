type GradingErrorKind = 'auth' | 'forbidden' | 'credits' | 'rate-limit' | 'request' | 'model' | 'unavailable' | 'timeout' | 'network' | 'format';

export class GradingError extends Error {
  constructor(readonly kind: GradingErrorKind, readonly status?: number, readonly model?: string) {
    super(kind);
  }
}

function apiError(status: number, model: string): GradingError {
  const kinds: Record<number, GradingErrorKind> = {
    400: 'request', 401: 'auth', 402: 'credits', 403: 'forbidden',
    404: 'model', 408: 'timeout', 422: 'request', 429: 'rate-limit',
    500: 'unavailable', 502: 'unavailable', 503: 'unavailable', 504: 'timeout'
  };
  return new GradingError(kinds[status] ?? 'unavailable', status, model);
}

export function gradingErrorMessage(error: GradingError, purpose: 'grading' | 'generation' = 'grading'): string {
  const messages: Record<GradingErrorKind, string> = {
    auth: 'API 키를 확인해 주세요. 오른쪽 위 설정에서 변경할 수 있어요.',
    forbidden: '요청이 차단됐어요. OpenRouter의 키 권한·콘텐츠 정책 설정을 확인해 주세요.',
    credits: 'OpenRouter 크레딧이 부족하거나 키의 사용 한도에 도달했어요. 잔액과 한도를 확인해 주세요.',
    'rate-limit': 'OpenRouter 호출 한도에 도달했어요. 잠시 후 다시 시도해 주세요.',
    request: '모델이 채점 요청 옵션을 받지 못했어요. 모델의 구조화 출력 지원과 요청 설정을 확인해 주세요.',
    model: '사용 가능한 모델 경로가 없어요. 시트 E1의 모델 ID, 구조화 출력 지원, OpenRouter 공급자 설정을 확인해 주세요.',
    unavailable: '채점 서비스가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    timeout: '채점 응답 시간이 초과됐어요. 입력은 남아 있으니 다시 시도해 주세요.',
    network: '채점 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
    format: '채점 결과 형식을 확인하지 못했어요. 다시 시도해 주세요.'
  };
  // 서버의 원문 오류나 요청 본문(키·답안)은 화면이나 로그로 내보내지 않는다.
  const context = [error.status ? `오류 ${error.status}` : '', error.model ?? ''].filter(Boolean);
  const message = purpose === 'generation' ? messages[error.kind].replaceAll('채점', '문장 생성').replace('입력은 남아 있으니', '준비된 문장과 입력은 남아 있으니') : messages[error.kind];
  return message + (context.length ? ` (${context.join(' · ')})` : '');
}

// Both generation and grading use the sheet's structured-output model.
export async function requestJson(body: object, model: string, apiKey: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const key = apiKey.trim();
  if (!key) throw new GradingError('auth');
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: requestSignal
    });
    if (!response.ok) throw apiError(response.status, model);
    const data: unknown = await response.json();
    // 생성 도중 발생한 오류는 HTTP 200의 error 객체로도 전달될 수 있다.
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      const code = typeof data.error === 'object' && 'code' in data.error ? Number(data.error.code) : NaN;
      throw apiError(Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502, model);
    }
    const content = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new GradingError('format');
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (error instanceof GradingError) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new GradingError('timeout', undefined, model);
    }
    if (error instanceof SyntaxError) throw new GradingError('format');
    throw new GradingError('network');
  }
}
