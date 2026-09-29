import { useEffect, useRef, useState } from 'react';
import { useSpeech } from './useSpeech';
import { useLesson } from './useLesson';
import { loadApiKey } from './settings';
import { SettingsDialog } from './SettingsDialog';
import { grade, GradingError, gradingErrorMessage, type GradeResult } from './grading';
import { loadSheet, modelIsValid } from './sheet';

const labels = {
  correct: '잘 알았어', close: '거의 맞았어', incorrect: '다시 생각해 보자', uncertain: '확인해 보자'
} as const;

function Preparation({ total, started }: { total: number; started: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [started]);
  return (
    <section className="preparation" aria-labelledby="preparation-title" aria-busy="true">
      <div className="preparation-heading"><span className="spinner" aria-hidden="true" /><h2 id="preparation-title">쉬운 문장을 만들고 있어요</h2></div>
      <p>단어 {total}개의 쉬운 문장을 한 번에 준비해요.<br />완성되면 문제를 모두 보여 드릴게요.</p>
      <div className="preparation-count"><strong>전체 문장 생성 중</strong><span>기다린 시간 {seconds}초</span></div>
      <p className="preparation-detail" role="status">{seconds >= 15
        ? '아직 문장을 만들고 있어요. 이 화면에서 조금만 더 기다려 주세요.'
        : '문장 준비에는 시간이 걸릴 수 있어요. 화면을 닫지 않고 기다려 주세요.'}</p>
    </section>
  );
}

export function App() {
  const speech = useSpeech();
  const study = useLesson();
  const { sheet, lesson, phase } = study;
  const [results, setResults] = useState<Record<string, GradeResult>>({});
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const preparing = phase === 'loading' || phase === 'generating';
  const completed = Object.keys(lesson.entries).length;

  useEffect(() => { setResults({}); setMessage(''); }, [lesson.revision]);

  function openSettings() { speech.stop(); setSettingsNotice(''); setSettingsOpen(true); }

  function changeAnswer(id: string, answer: string) {
    speech.stopIf(id);
    study.changeAnswer(id, answer);
    setResults(previous => {
      const updated = { ...previous };
      delete updated[id];
      return updated;
    });
    setMessage('');
  }

  async function submit() {
    if (!sheet || submitting.current || preparing || phase === 'offline') return;
    const answers = sheet.words.flatMap(word => {
      const entry = lesson.entries[word.id];
      return entry?.answer.trim() ? [{ word, exercise: entry.exercise, answer: entry.answer.trim() }] : [];
    });
    if (!answers.length) { setMessage('뜻을 하나 이상 적어 봐!'); return; }
    const apiKey = loadApiKey();
    if (!apiKey) { setMessage('설정에서 OpenRouter API 키를 입력해 주세요.'); openSettings(); return; }
    speech.stop();
    submitting.current = true;
    setBusy(true);
    setMessage('');
    try {
      const current = await loadSheet();
      if (current.revision !== sheet.revision) {
        setMessage('단어 목록이 바뀌었어요. 새로고침 후 새 문장으로 풀어 주세요.');
        return;
      }
      if (!modelIsValid(current.model)) { setMessage('시트의 E1 모델 설정을 확인해 주세요.'); return; }
      const grades = await grade(answers, current.model, apiKey);
      setResults(Object.fromEntries(grades.map(result => [result.id, result])));
    } catch (error) {
      setMessage(error instanceof GradingError ? gradingErrorMessage(error) : '단어를 확인하지 못했어요. 연결을 확인하고 다시 눌러 주세요.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <div className="settings-bar">
        <button type="button" className="settings-button" aria-label="설정" aria-haspopup="dialog" disabled={busy || preparing} onClick={openSettings}>
          <span aria-hidden="true">⚙</span> 설정
        </button>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onSaved={removed => {
        setSettingsOpen(false);
        setSettingsNotice(removed ? '이 기기에 저장된 API 키를 삭제했어요.' : '이 기기에 API 키를 저장했어요.');
        setMessage('');
        if (!removed && phase !== 'ready') study.retry();
      }} />}
      {settingsNotice && <p className="notice" role="status">{settingsNotice}</p>}
      <header className="heading">
        <div className="mark" aria-hidden="true">a<span>·</span>z</div>
        <div>
          <p className="eyebrow">나만의 작은 단어장</p>
          <h1>오늘의 영어 단어</h1>
          <p className="intro">문장을 읽고, 굵은 말의 뜻을 적어 봐!</p>
        </div>
      </header>

      {phase === 'loading' && <div className="preparation" role="status"><div className="preparation-heading"><span className="spinner" aria-hidden="true" /><strong>단어와 저장된 문장을 확인하고 있어요…</strong></div><p>잠시만 기다려 주세요.</p></div>}
      {phase === 'generating' && sheet && <Preparation total={sheet.words.length} started={study.generationStarted} />}
      {phase === 'needs-key' && <section className="notice" aria-label="문장 준비 안내">
        <strong>문장을 준비하려면 설정이 필요해요.</strong>
        <p>부모님과 함께 API 키를 입력하면 쉬운 문장을 만들어 드릴게요.</p>
        <button type="button" className="inline-action" onClick={openSettings}>설정 열기</button>
      </section>}
      {(phase === 'error' || phase === 'offline') && <section className="notice" aria-label="문장 준비 오류">
        <div role="alert"><strong>{phase === 'offline' ? '저장된 학습을 보여 드려요' : '문장 준비를 완료하지 못했어요'}</strong><p>{study.error}</p></div>
        {completed > 0 && <p>준비된 문장 {completed}개와 작성한 답은 남아 있어요.</p>}
        <button type="button" className="inline-action" disabled={busy} onClick={() => { speech.stop(); study.retry(); }}>다시 시도</button>
      </section>}
      {study.storageWarning && <p className="notice" role="status">{study.storageWarning}</p>}
      {sheet && <>
        {sheet.words.length === 0 && <p className="notice">아직 단어가 없어요.</p>}
        {sheet.truncated && <p className="notice">단어는 한 번에 30개까지만 보여 줘요.</p>}
        {phase === 'ready' && sheet.words.length > 0 && <p className="ready-notice" role="status">문장이 준비됐어요. 천천히 읽고 뜻을 적어 봐.</p>}
        <div className="word-list">
          {sheet.words.map((word, index) => {
            const entry = lesson.entries[word.id];
            const exercise = entry?.exercise;
            const result = results[word.id];
            const targetIndex = exercise?.exampleEn.indexOf(exercise.target) ?? 0;
            const speechActive = speech.state.id === word.id;
            return (
              <section className="word-card" key={word.id} aria-label={`${index + 1}번 ${word.text}`}>
                <div className="word-line">
                  <div className="word-label"><span className="number">{String(index + 1).padStart(2, '0')}</span><span lang="en">{word.text}</span></div>
                  {exercise ? <>
                    <div className="question-example">
                      <p lang="en" id={`example-${word.id}`}>
                        {exercise.exampleEn.slice(0, targetIndex)}<strong>{exercise.target}</strong>{exercise.exampleEn.slice(targetIndex + exercise.target.length)}
                      </p>
                      <button type="button" className="speech-button"
                        disabled={busy || phase === 'offline' || phase === 'loading' || (speechActive && speech.state.phase === 'loading')}
                        aria-label={`${word.text} 문장 ${speechActive && speech.state.phase === 'playing' ? '멈추기' : '듣기'}`}
                        aria-busy={speechActive && speech.state.phase === 'loading'}
                        onClick={() => speech.read(word.id, exercise.exampleEn)}>
                        {speechActive && speech.state.phase === 'loading' ? '음성 준비 중…' : speechActive && speech.state.phase === 'playing' ? '■ 멈추기' : '🔊 문장 듣기'}
                      </button>
                      <small className="speech-disclosure">AI 음성</small>
                      {speechActive && speech.state.message && <p className="speech-message" role="status">{speech.state.message}</p>}
                    </div>
                    <label className="answer-label" htmlFor={`answer-${word.id}`}>이 문장에서 굵은 말은 무슨 뜻일까?</label>
                    <input id={`answer-${word.id}`} aria-label={`${word.text}의 뜻`} aria-describedby={`example-${word.id}`}
                      type="text" lang="ko" maxLength={100} placeholder="뜻을 적어 봐" autoComplete="off"
                      value={entry.answer} disabled={busy || phase === 'offline' || phase === 'loading'}
                      onChange={event => changeAnswer(word.id, event.target.value)} />
                  </> : <div className={`question-placeholder ${preparing ? 'is-preparing' : ''}`}>
                    <div className="skeleton-line" aria-hidden="true" /><div className="skeleton-line short" aria-hidden="true" />
                    <p>{preparing ? '문장을 준비하고 있어요…' : '문장이 준비되면 여기에 보여 드릴게요.'}</p>
                  </div>}
                </div>
                {result && exercise && <div className={`feedback feedback-${result.verdict}`}>
                  <strong>{labels[result.verdict]}</strong><p>{result.comment}</p>
                  <p className="translation"><span>문장 해석</span>{exercise.exampleKo}</p>
                </div>}
              </section>
            );
          })}
        </div>
        {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
        {sheet.words.length > 0 && phase !== 'offline' && <div className="action">
          <button type="button" disabled={busy || preparing || completed === 0} onClick={submit}>
            {busy ? '채점 중…' : preparing ? '문장 준비 중…' : '채점하기'}
          </button>
        </div>}
      </>}
      <footer>천천히, 네 말로 적어 봐.</footer>
    </main>
  );
}
