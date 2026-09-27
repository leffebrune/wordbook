import { modelIsValid } from './sheet';

export interface SpeechSettings { model: string; voice: string }
export const speechInstructions = 'Speak in natural American English with a warm, friendly tone for a nine-year-old English learner. Use a comfortable, slightly slower pace with natural sentence stress, connected speech, and question intonation. Do not exaggerate or separate every word. Read only the supplied text, exactly as written.';

type SpeechErrorKind = 'settings' | 'auth' | 'credits' | 'forbidden' | 'request' | 'rate-limit' | 'service' | 'timeout' | 'network' | 'format';
export class SpeechError extends Error {
  constructor(readonly kind: SpeechErrorKind, readonly status?: number) { super(kind); }
}

export function validateSpeechSettings(settings: SpeechSettings): SpeechSettings {
  if (!modelIsValid(settings.model) || settings.model.length > 200 ||
      !settings.voice.trim() || settings.voice.length > 120 || /[\u0000-\u001f]/.test(settings.voice)) {
    throw new SpeechError('settings');
  }
  return settings;
}

export function speechRequest(text: string, settings: SpeechSettings) {
  validateSpeechSettings(settings);
  if (!text.trim() || text.length > 120) throw new SpeechError('format');
  return {
    model: settings.model, input: text, voice: settings.voice, response_format: 'mp3',
    // Other providers receive only the portable speech parameters.
    ...(settings.model.startsWith('openai/gpt-4o-mini-tts') ? {
      provider: { options: { openai: { instructions: speechInstructions } } }
    } : {})
  };
}

export function speechCacheKey(text: string, settings: SpeechSettings): string {
  return JSON.stringify(speechRequest(text, settings));
}

function apiError(status: number): SpeechError {
  const kinds: Record<number, SpeechErrorKind> = {
    400: 'request', 401: 'auth', 402: 'credits', 403: 'forbidden', 404: 'request',
    408: 'timeout', 422: 'request', 429: 'rate-limit', 504: 'timeout'
  };
  return new SpeechError(kinds[status] ?? 'service', status);
}

export async function synthesizeSpeech(text: string, settings: SpeechSettings, apiKey: string, signal: AbortSignal): Promise<Blob> {
  if (!apiKey.trim()) throw new SpeechError('auth');
  const body = speechRequest(text, settings);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body), signal: controller.signal
    });
    if (!response.ok) throw apiError(response.status);
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^audio\/(mpeg|mp3)(?:;|$)/i.test(contentType)) {
      if (contentType.includes('json')) {
        const data = await response.json() as { error?: { code?: unknown } };
        const status = Number(data?.error?.code);
        if (Number.isInteger(status) && status >= 400 && status <= 599) throw apiError(status);
      }
      throw new SpeechError('format');
    }
    const audio = await response.blob();
    if (!audio.size) throw new SpeechError('format');
    return audio;
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timedOut) throw new SpeechError('timeout');
    if (error instanceof SpeechError) throw error;
    throw new SpeechError('network');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

export function speechErrorMessage(error: unknown): string {
  const messages: Record<SpeechErrorKind, string> = {
    settings: '시트 D2/E2의 tts_model과 D3/E3의 tts_voice를 확인해 주세요.',
    auth: '오른쪽 위 설정에서 OpenRouter API 키를 확인해 주세요.',
    credits: 'OpenRouter 잔액과 API 키의 사용 한도를 확인해 주세요.',
    forbidden: '음성 요청이 차단됐어요. API 키 권한과 정책 설정을 확인해 주세요.',
    request: '시트 E2의 TTS 모델과 E3의 목소리가 호환되는지 확인해 주세요.',
    'rate-limit': '음성 요청이 많아요. 잠시 후 다시 눌러 주세요.',
    service: '음성 서비스가 응답하지 못했어요. 잠시 후 다시 눌러 주세요.',
    timeout: '음성 준비 시간이 초과됐어요. 다시 눌러 주세요.',
    network: '음성을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.',
    format: '재생할 음성을 받지 못했어요. 모델의 MP3 지원을 확인해 주세요.'
  };
  return error instanceof SpeechError
    ? messages[error.kind] + (error.status ? ` (오류 ${error.status})` : '')
    : '음성 설정을 불러오지 못했어요. 연결을 확인하고 다시 눌러 주세요.';
}
