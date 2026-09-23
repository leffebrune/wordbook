const API_KEY_STORAGE_KEY = 'wordbook.openrouter-api-key.v1';

export function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

// 실패를 호출자에게 전달한다. 저장하지 못한 키로 성공 안내를 표시하지 않는다.
export function saveApiKey(value: string): void {
  const key = value.trim();
  if (key) localStorage.setItem(API_KEY_STORAGE_KEY, key);
  else localStorage.removeItem(API_KEY_STORAGE_KEY);
}
