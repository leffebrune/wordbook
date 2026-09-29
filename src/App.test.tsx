// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { LESSON_KEY } from './lesson';
import { GradingError } from './openRouter';
import type { Exercise } from './exercises';

const mocks = vi.hoisted(() => ({ loadSheet: vi.fn(), generate: vi.fn(), grade: vi.fn(), read: vi.fn() }));
vi.mock('./sheet', async importOriginal => ({ ...await importOriginal<typeof import('./sheet')>(), loadSheet: mocks.loadSheet }));
vi.mock('./exercises', async importOriginal => ({ ...await importOriginal<typeof import('./exercises')>(), generateExercises: mocks.generate }));
vi.mock('./grading', async importOriginal => ({ ...await importOriginal<typeof import('./grading')>(), grade: mocks.grade }));
vi.mock('./useSpeech', () => ({ useSpeech: () => ({ state: { phase: 'idle' }, read: mocks.read, stop: () => {}, stopIf: () => {} }) }));

const words = Array.from({ length: 8 }, (_, index) => ({ id: `word${index}`, text: index === 0 ? 'get' : `word ${index}`, focus: '' }));
const sheet = { words, revision: 'r1', model: 'openai/example', ttsModel: '', ttsVoice: '', truncated: false };
const exercises: Exercise[] = words.map(word => ({ id: word.id, exampleEn: 'It is getting cold.', target: 'getting', meaning: '~해지다', exampleKo: '날씨가 추워지고 있어.' }));
let host: HTMLDivElement;
let root: Root;
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text))!;
async function mount() { await act(async () => { root.render(<StrictMode><App /></StrictMode>); }); }
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function answer(value: string) {
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('wordbook.openrouter-api-key.v1', 'test-key');
  mocks.loadSheet.mockResolvedValue(sheet);
  mocks.generate.mockResolvedValue(exercises);
  mocks.grade.mockResolvedValue([{ id: 'word0', verdict: 'correct', comment: '잘 알았어.' }]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('context-first learning flow', () => {
  it('shows immediate loading, elapsed time and a longer-wait message, then all questions at once', async () => {
    const request = pending<Exercise[]>();
    mocks.generate.mockReturnValue(request.promise);
    await mount();
    expect(host.textContent).toContain('쉬운 문장을 만들고 있어요');
    expect(host.textContent).toContain('단어 8개의 쉬운 문장을 한 번에');
    expect(host.querySelectorAll('input')).toHaveLength(0);
    expect(host.querySelector('.spinner')).not.toBeNull();
    expect(button('문장 준비 중').disabled).toBe(true);
    expect(mocks.generate).toHaveBeenCalledTimes(1); // StrictMode must not double-charge.
    expect(mocks.generate.mock.calls[0][0]).toHaveLength(8);
    await act(async () => request.resolve(exercises));
    expect(host.textContent).not.toContain('쉬운 문장을 만들고 있어요');
    expect(host.querySelectorAll('input')).toHaveLength(8);
    expect(host.querySelector('.question-example strong')?.textContent).toBe('getting');
    expect(host.textContent).not.toContain('날씨가 추워지고 있어.');
    await click(button('문장 듣기'));
    expect(mocks.read).toHaveBeenCalledWith('word0', 'It is getting cold.');
  });

  it('updates actual elapsed time without a fabricated percentage', async () => {
    vi.useFakeTimers();
    mocks.generate.mockReturnValue(new Promise(() => {}));
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(host.textContent).toContain('기다린 시간 16초');
    expect(host.textContent).toContain('아직 문장을 만들고 있어요');
    expect(host.querySelector('progress')).toBeNull();
  });

  it('replaces the spinner with a retryable error and recovers in a single request', async () => {
    mocks.generate.mockRejectedValueOnce(new GradingError('timeout'));
    await mount();
    expect(host.textContent).toContain('문장 생성 응답 시간이 초과');
    expect(host.querySelector('.spinner')).toBeNull();
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await click(button('다시 시도'));
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('input')).toHaveLength(8);
  });

  it('grades the visible context, reveals only its translation, and preserves the sentence after edits and reload', async () => {
    await mount();
    await answer('추워지다');
    await click(button('채점하기'));
    expect(mocks.grade.mock.calls[0][0][0]).toMatchObject({ answer: '추워지다', exercise: exercises[0] });
    expect(host.querySelector('.translation')?.textContent).toContain('날씨가 추워지고 있어.');
    await answer('추워진다');
    expect(host.querySelector('.translation')).toBeNull();
    expect(host.querySelector('.question-example')?.textContent).toContain('It is getting cold.');
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount();
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('input')?.value).toBe('추워진다');
  });

  it('shows a clear settings action when there is no key, without sending generation requests', async () => {
    localStorage.clear();
    await mount();
    expect(host.textContent).toContain('문장을 준비하려면 설정이 필요해요');
    expect(button('설정 열기').disabled).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(host.querySelector('.spinner')).toBeNull();
  });

  it('invalidates questions and answers together for a changed focus revision', async () => {
    localStorage.setItem(LESSON_KEY, JSON.stringify({ revision: 'old', entries: { word0: { exercise: exercises[0], answer: '옛 답' } } }));
    await mount();
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('input')?.value).toBe('');
  });

  it('keeps the app usable if writing the lesson cache fails', async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === LESSON_KEY) throw new Error('quota');
      original.call(this, key, value);
    });
    await mount();
    expect(host.textContent).toContain('문장과 답을 저장하지 못했어요');
    await answer('추워지다');
    expect(host.querySelector('input')?.value).toBe('추워지다');
    await click(button('채점하기'));
    expect(mocks.grade).toHaveBeenCalledTimes(1);
  });

  it('ignores a late generation response after unmount', async () => {
    const request = pending<Exercise[]>();
    mocks.generate.mockReturnValue(request.promise);
    await mount();
    const signal = mocks.generate.mock.calls[0][3] as AbortSignal;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    await act(async () => request.resolve(exercises));
    expect(JSON.parse(localStorage.getItem(LESSON_KEY)!).entries).toEqual({});
    root = createRoot(host);
  });
});
