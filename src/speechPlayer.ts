import { speechCacheKey, speechErrorMessage, SpeechError, validateSpeechSettings, type SpeechSettings } from './tts';

export interface SpeechState {
  id: string | null;
  phase: 'idle' | 'loading' | 'playing' | 'ready' | 'error';
  message: string;
}
interface AudioPlayer {
  src: string;
  onended: ((event: Event) => void) | null;
  onerror: OnErrorEventHandler;
  play(): Promise<void>;
  pause(): void;
  load(): void;
}
interface Dependencies {
  settings(): Promise<SpeechSettings>;
  generate(text: string, settings: SpeechSettings, key: string, signal: AbortSignal): Promise<Blob>;
  audio(): AudioPlayer;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
}
interface CacheEntry { promise: Promise<Blob>; blob?: Blob }
export const idleSpeech: SpeechState = { id: null, phase: 'idle', message: '' };

export class SpeechPlayer {
  private state = idleSpeech;
  private version = 0;
  private disposed = false;
  private settings?: SpeechSettings;
  private settingsPromise?: Promise<SpeechSettings>;
  private cache = new Map<string, CacheEntry>();
  private audio?: AudioPlayer;
  private url?: string;
  private abort = new AbortController();

  constructor(private deps: Dependencies, private changed: (state: SpeechState) => void) {}

  private update(state: SpeechState) {
    this.state = state;
    if (!this.disposed) this.changed(state);
  }

  stop() {
    this.version++;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = '';
      this.audio.load();
    }
    if (this.url) { this.deps.revokeUrl(this.url); this.url = undefined; }
    this.update(idleSpeech);
  }

  stopIf(id: string) { if (this.state.id === id) this.stop(); }

  read(id: string, text: string, apiKey: string) {
    if (this.disposed) return;
    if (this.state.id === id && this.state.phase === 'loading') return;
    if (this.state.id === id && this.state.phase === 'playing') { this.stop(); return; }
    this.stop();
    const version = this.version;
    const current = () => !this.disposed && version === this.version;
    this.update({ id, phase: 'loading', message: '' });
    const fail = (error: unknown) => {
      if (!current()) return;
      if (error instanceof SpeechError && ['settings', 'request'].includes(error.kind)) {
        this.settings = undefined;
        this.settingsPromise = undefined;
      }
      this.update({ id, phase: 'error', message: speechErrorMessage(error) });
    };
    const withSettings = (settings: SpeechSettings) => {
      if (!current()) return;
      try {
        const cacheKey = speechCacheKey(text, settings);
        let entry = this.cache.get(cacheKey);
        if (entry?.blob) { this.play(id, entry.blob, version); return; }
        if (!entry) {
          if (!apiKey.trim()) throw new SpeechError('auth');
          const promise = this.deps.generate(text, settings, apiKey, this.abort.signal);
          entry = { promise };
          this.cache.set(cacheKey, entry);
          const saved = entry;
          void promise.then(blob => {
            saved.blob = blob;
            // Retain at most 30 completed examples; pending calls remain deduplicated.
            const completed = [...this.cache].filter(([, item]) => item.blob);
            for (const [key] of completed.slice(0, Math.max(0, completed.length - 30))) this.cache.delete(key);
          }, () => { if (this.cache.get(cacheKey) === saved) this.cache.delete(cacheKey); });
        }
        void entry.promise.then(blob => { if (current()) this.play(id, blob, version); }, fail);
      } catch (error) { fail(error); }
    };
    // Cached playback runs inside the click handler, allowing mobile autoplay recovery.
    if (this.settings) { withSettings(this.settings); return; }
    if (!this.settingsPromise) {
      this.settingsPromise = this.deps.settings().then(validateSpeechSettings).then(settings => {
        this.settings = settings;
        return settings;
      }).catch(error => { this.settingsPromise = undefined; throw error; });
    }
    void this.settingsPromise.then(withSettings, fail);
  }

  private play(id: string, blob: Blob, version: number) {
    const current = () => !this.disposed && version === this.version;
    try {
      const audio = this.audio ??= this.deps.audio();
      this.url = this.deps.createUrl(blob);
      audio.src = this.url;
      audio.onended = () => { if (current()) this.stop(); };
      audio.onerror = () => {
        if (current()) this.update({ id, phase: 'error', message: '음성을 재생하지 못했어요. 다시 눌러 주세요.' });
      };
      void audio.play().then(() => {
        if (current()) this.update({ id, phase: 'playing', message: '' });
      }, error => {
        if (!current()) return;
        this.update({ id, phase: 'ready', message: error instanceof Error && error.name === 'NotAllowedError'
          ? '음성이 준비됐어요. 읽기를 한 번 더 눌러 주세요.'
          : '재생을 시작하지 못했어요. 읽기를 다시 눌러 주세요.' });
      });
    } catch {
      if (current()) this.update({ id, phase: 'error', message: '이 브라우저에서 음성을 재생하지 못했어요.' });
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.abort.abort();
    this.cache.clear();
  }
}
