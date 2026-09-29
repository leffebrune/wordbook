import { validateExercises, type Exercise } from './exercises';
import type { WordSheet } from './sheet';

export const LESSON_KEY = 'wordbook.lesson.v1';
export interface LessonEntry { exercise: Exercise; answer: string }
export interface Lesson { revision: string; entries: Record<string, LessonEntry> }

// Exercise and answer live in one record: a draft can never attach to a different sentence.
export function restoreLesson(raw: string | null, sheet: WordSheet): Lesson {
  const lesson: Lesson = { revision: sheet.revision, entries: {} };
  try {
    const saved = JSON.parse(raw ?? 'null');
    if (!saved || saved.revision !== sheet.revision || !saved.entries || typeof saved.entries !== 'object') return lesson;
    for (const word of sheet.words) {
      const entry = saved.entries[word.id];
      if (!entry) continue;
      try {
        const [exercise] = validateExercises({ exercises: [entry.exercise] }, [word]);
        if (typeof entry.answer === 'string' && entry.answer.length <= 100) lesson.entries[word.id] = { exercise, answer: entry.answer };
      } catch { /* A damaged entry must not invalidate the other completed exercises. */ }
    }
  } catch { /* Missing or corrupt storage starts a new lesson. */ }
  return lesson;
}
