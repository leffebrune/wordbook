import { useEffect, useState } from 'react';
import { hasModelKey, hasSheetConfig } from './config';
import { grade, GradingError, type GradeResult } from './grading';
import { loadSheet, modelIsValid, SheetError, type WordSheet } from './sheet';

const DRAFTS_KEY = 'wordbook.drafts.v1';
const SHEET_KEY = 'wordbook.last-sheet.v1';
type Drafts = Record<string, string>;

const labels = {
  correct: '잘 알았어',
  close: '거의 맞았어',
  incorrect: '다시 생각해 보자',
  uncertain: '확인해 보자'
} as const;

function loadDrafts(): Drafts {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, answer]) =>
      /^[a-f0-9]{64}$/.test(id) && typeof answer === 'string' && answer.length <= 100
    ));
  } catch {
    return {};
  }
}

function cachedSheet(): WordSheet | null {
  try {
    const value = JSON.parse(localStorage.getItem(SHEET_KEY) ?? 'null') as Partial<WordSheet> | null;
    if (!value || !Array.isArray(value.words) || typeof value.revision !== 'string') return null;
    if (value.words.length > 30 || !value.words.every(word =>
      typeof word?.id === 'string' && typeof word.text === 'string' && typeof word.focus === 'string'
    )) return null;
    return { words: value.words, revision: value.revision, model: '', truncated: Boolean(value.truncated) };
  } catch {
    return null;
  }
}

function pruneDrafts(old: Drafts, sheet: WordSheet): Drafts {
  const ids = new Set(sheet.words.map(word => word.id));
  return Object.fromEntries(Object.entries(old).filter(([id]) => ids.has(id)));
}

export function App() {
  const [sheet, setSheet] = useState<WordSheet | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(loadDrafts);
  const [results, setResults] = useState<Record<string, GradeResult>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    if (!hasSheetConfig()) {
      setMessage('시트 ID와 gid를 config.local.ts에 입력해 주세요.');
      setLoading(false);
      return;
    }
    loadSheet().then(next => {
      if (!active) return;
      setSheet(next);
      setOffline(false);
      localStorage.setItem(SHEET_KEY, JSON.stringify(next));
      setDrafts(previous => {
        const pruned = pruneDrafts(previous, next);
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(pruned));
        return pruned;
      });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof SheetError && error.kind === 'format') {
        setMessage(error.message);
      } else {
        const previous = cachedSheet();
        if (previous) {
          setSheet(previous);
          setOffline(true);
          setMessage('오프라인이에요. 연결되면 채점할 수 있어요.');
        } else {
          setMessage('단어를 불러오려면 인터넷이 필요해요.');
        }
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function changeAnswer(id: string, answer: string) {
    const next = { ...drafts, [id]: answer.slice(0, 100) };
    setDrafts(next);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(next));
    setResults(previous => {
      const updated = { ...previous };
      delete updated[id];
      return updated;
    });
    setMessage('');
  }

  async function submit() {
    if (!sheet || busy || offline) return;
    const answers = sheet.words.map(word => ({ word, answer: (drafts[word.id] ?? '').trim() }))
      .filter(item => item.answer);
    if (!answers.length) {
      setMessage('뜻을 하나 이상 적어 봐!');
      return;
    }
    if (!hasModelKey()) {
      setMessage('OpenRouter 키를 config.local.ts에 입력해 주세요.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const current = await loadSheet();
      if (current.revision !== sheet.revision) {
        setMessage('단어 목록이 바뀌었어요. 새로고침 후 다시 채점해 주세요.');
        return;
      }
      if (!modelIsValid(current.model)) {
        setMessage('시트의 E1 모델 설정을 확인해 주세요.');
        return;
      }
      const grades = await grade(answers, current.model);
      setResults(Object.fromEntries(grades.map(result => [result.id, result])));
    } catch (error) {
      if (error instanceof GradingError) {
        setMessage(error.kind === 'model'
          ? '채점 모델을 사용할 수 없어요. 부모에게 알려 주세요.'
          : '채점이 잘 안 됐어요. 다시 눌러 주세요.');
      } else {
        setMessage('단어를 확인하지 못했어요. 연결을 확인하고 다시 눌러 주세요.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="heading">
        <div className="mark" aria-hidden="true">a<span>·</span>z</div>
        <div>
          <p className="eyebrow">나만의 작은 단어장</p>
          <h1>오늘의 영어 단어</h1>
          <p className="intro">생각나는 뜻을 적어 봐. 틀려도 괜찮아!</p>
        </div>
      </header>

      {loading && <p className="notice" role="status">단어를 불러오는 중…</p>}
      {!loading && !sheet && <p className="notice" role="alert">{message}</p>}
      {sheet && (
        <>
          {sheet.words.length === 0 && <p className="notice">아직 단어가 없어요.</p>}
          {sheet.truncated && <p className="notice">단어는 한 번에 30개까지만 보여 줘요.</p>}
          <div className="word-list">
            {sheet.words.map((word, index) => {
              const result = results[word.id];
              return (
                <section className="word-card" key={word.id} aria-label={`${index + 1}번 ${word.text}`}>
                  <div className="word-line">
                    <label htmlFor={`answer-${word.id}`} className="word-label">
                      <span className="number">{String(index + 1).padStart(2, '0')}</span>
                      <span>{word.text}</span>
                    </label>
                    <input
                      id={`answer-${word.id}`}
                      aria-label={`${word.text}의 뜻`}
                      type="text"
                      lang="ko"
                      maxLength={100}
                      placeholder="뜻을 적어 봐"
                      autoComplete="off"
                      value={drafts[word.id] ?? ''}
                      disabled={busy || offline}
                      onChange={event => changeAnswer(word.id, event.target.value)}
                    />
                  </div>
                  {result && (
                    <div className={`feedback feedback-${result.verdict}`}>
                      <strong>{labels[result.verdict]}</strong>
                      <p>{result.comment}</p>
                      <div className="example"><span>예문</span><p>{result.exampleEn}<br /><small>{result.exampleKo}</small></p></div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
          {sheet.words.length > 0 && !offline && (
            <div className="action">
              <button type="button" disabled={busy} onClick={submit}>
                {busy ? '채점 중…' : '채점하기'}
              </button>
            </div>
          )}
        </>
      )}
      <footer>천천히, 네 말로 적어 봐.</footer>
    </main>
  );
}
