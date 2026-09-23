import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadApiKey, saveApiKey } from './settings';

interface Props {
  onClose: () => void;
  onSaved: (removed: boolean) => void;
}

export function SettingsDialog({ onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState(loadApiKey);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function save(value: string) {
    try {
      saveApiKey(value);
      onSaved(!value.trim());
    } catch {
      setError('이 브라우저에 키를 저장하지 못했어요. 사이트 저장소 허용 설정을 확인해 주세요.');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save(key);
  }

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose}>
      <form onSubmit={submit}>
        <h2 id="settings-title">설정</h2>
        <label htmlFor="api-key">OpenRouter API 키</label>
        <input id="api-key" type="password" value={key} autoFocus autoComplete="off"
          autoCapitalize="none" spellCheck={false} aria-describedby="key-help"
          onChange={event => { setKey(event.target.value); setError(''); }} />
        <p id="key-help">키는 이 기기의 브라우저에만 저장해요. 채점할 때 OpenRouter로 전송하며, 다른 기기에서는 다시 입력해야 해요.</p>
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="settings-actions">
          <button type="button" className="secondary" onClick={onClose}>취소</button>
          <button type="submit">저장</button>
        </div>
        <button type="button" className="delete-key" onClick={() => save('')}>저장된 키 삭제</button>
      </form>
    </dialog>
  );
}
