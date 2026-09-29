import { useEffect, useRef, useState } from 'react';
import { generateExercises } from './exercises';
import { LESSON_KEY, restoreLesson, type Lesson } from './lesson';
import { GradingError, gradingErrorMessage } from './openRouter';
import { loadApiKey } from './settings';
import { loadSheet, modelIsValid, SheetError, type WordSheet } from './sheet';

const SHEET_KEY = 'wordbook.last-sheet.v1';
type Phase = 'loading' | 'generating' | 'ready' | 'needs-key' | 'error' | 'offline';

function cachedSheet(): WordSheet | null {
  try {
    const value = JSON.parse(localStorage.getItem(SHEET_KEY) ?? 'null') as Partial<WordSheet> | null;
    if (!value || !Array.isArray(value.words) || typeof value.revision !== 'string') return null;
    if (value.words.length > 30 || !value.words.every(word =>
      typeof word?.id === 'string' && typeof word.text === 'string' && typeof word.focus === 'string'
    )) return null;
    return { words: value.words, revision: value.revision, model: '', ttsModel: '', ttsVoice: '', truncated: Boolean(value.truncated) };
  } catch { return null; }
}

export function useLesson() {
  const [sheet, setSheet] = useState<WordSheet | null>(null);
  const [lesson, setLesson] = useState<Lesson>({ revision: '', entries: {} });
  const currentLesson = useRef(lesson);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [generationStarted, setGenerationStarted] = useState(0);

  function persist(next: Lesson) {
    currentLesson.current = next;
    setLesson(next);
    try {
      localStorage.setItem(LESSON_KEY, JSON.stringify(next));
      setStorageWarning('');
    } catch {
      setStorageWarning('이 기기에 문장과 답을 저장하지 못했어요. 새로고침하면 사라질 수 있어요.');
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    setPhase('loading');
    setError('');
    async function prepare() {
      let next: WordSheet;
      let offline = false;
      try {
        next = await loadSheet();
      } catch (cause) {
        if (!active()) return;
        const cached = cause instanceof SheetError && cause.kind === 'format' ? null : cachedSheet();
        if (!cached) {
          setError(cause instanceof SheetError && cause.kind === 'format' ? cause.message : '단어를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
          setPhase('error');
          return;
        }
        next = cached;
        offline = true;
      }
      if (!active()) return;
      setSheet(next);
      try { if (!offline) localStorage.setItem(SHEET_KEY, JSON.stringify(next)); } catch { /* Lesson storage shows its own warning. */ }
      let restored: Lesson;
      if (currentLesson.current.revision === next.revision) restored = currentLesson.current;
      else {
        let raw: string | null = null;
        try { raw = localStorage.getItem(LESSON_KEY); } catch { /* Storage can be disabled. */ }
        restored = restoreLesson(raw, next);
      }
      persist(restored);
      if (offline) {
        setError('연결을 확인하지 못했어요. 저장된 문장과 답을 보여 드려요. 연결 후 다시 시도해 주세요.');
        setPhase('offline');
        return;
      }
      const missing = next.words.filter(word => !restored.entries[word.id]);
      if (!missing.length) { setPhase('ready'); return; }
      const key = loadApiKey();
      if (!key) { setPhase('needs-key'); return; }
      if (!modelIsValid(next.model)) {
        setError('시트의 E1 모델 설정을 확인해 주세요.');
        setPhase('error');
        return;
      }
      setPhase('generating');
      try {
        setGenerationStarted(Date.now());
        const exercises = await generateExercises(missing, next.model, key, controller.signal);
        if (!active()) return;
        const entries = { ...currentLesson.current.entries };
        for (const exercise of exercises) entries[exercise.id] = { exercise, answer: '' };
        persist({ revision: next.revision, entries });
        setPhase('ready');
      } catch (cause) {
        if (!active()) return;
        setError(cause instanceof GradingError ? gradingErrorMessage(cause, 'generation') : '문장을 준비하지 못했어요. 다시 시도해 주세요.');
        setPhase('error');
      }
    }
    void prepare();
    return () => controller.abort();
  }, [attempt]);

  return {
    sheet, lesson, phase, error, storageWarning, generationStarted,
    retry: () => setAttempt(previous => previous + 1),
    changeAnswer: (id: string, answer: string) => {
      const current = currentLesson.current;
      const entry = current.entries[id];
      if (entry) persist({ ...current, entries: { ...current.entries, [id]: { ...entry, answer: answer.slice(0, 100) } } });
    }
  };
}
