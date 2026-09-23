export interface AppConfig {
  sheetId: string;
  sheetGid: string;
  openRouterApiKey: string;
}

// 파일이 아직 없어도 빌드·화면 확인이 가능하다. 실제 값은 Git에서 제외한 파일에 둔다.
const modules = import.meta.glob<{ default: AppConfig }>('./config.local.ts', { eager: true });
export const config: AppConfig = modules['./config.local.ts']?.default ?? {
  sheetId: '',
  sheetGid: '',
  openRouterApiKey: ''
};

export function hasSheetConfig(): boolean {
  return Boolean(config.sheetId && config.sheetGid !== '');
}

export function hasModelKey(): boolean {
  return Boolean(config.openRouterApiKey);
}
