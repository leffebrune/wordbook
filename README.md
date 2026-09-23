# Wordbook

9세 아이가 영어 단어 옆에 한국어 뜻을 쓰고 한 번에 채점받는 개인용 PWA. 부모는 구글 시트에서 단어와 모델을 관리한다. **GitHub Pages에서 배포**하며, 휴대폰은 구글 시트와 OpenRouter를 직접 호출한다. 설치·실행·업데이트에 개발 PC를 켜 둘 필요가 없다.

## 1. 구글 시트

`src/config.ts`에 다음 공개 설정이 포함되어 있다. 별도 로컬 설정 파일은 필요 없다.

```ts
sheetId: '17PQOTPHT-rSYyGKFyyibfdkRXl9zAbkmagAi5-nSesQ'
sheetGid: '0'
```

[사용 중인 시트](https://docs.google.com/spreadsheets/d/17PQOTPHT-rSYyGKFyyibfdkRXl9zAbkmagAi5-nSesQ/edit#gid=0)의 첫 번째 탭을 다음 형식으로 관리한다.

| 셀 | 값 |
| --- | --- |
| A1 | `word` |
| B1 | `focus` |
| D1 | `model` |
| E1 | 구조화 출력을 지원하는 OpenRouter 모델 ID, 예: `openai/…` |
| A2 이후 | `take`, `get` 등 단어 |
| B2 이후 | 선택 설명: `가방을 학교에 가져가는 장면` |

시트 공유 설정은 **링크가 있는 모든 사용자: 뷰어**로 한다. 공개 시트에는 단어와 학습용 메모만 넣으며 API 키나 아이 답안을 넣지 않는다. E1 모델 변경은 앱 재빌드 없이 다음 채점 시 다시 읽힌다. 다른 시트를 사용하려면 `src/config.ts`를 수정하고 재배포한다.

## 2. GitHub Pages 배포

1. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택한다.
2. 변경 사항을 `main`에 반영하면 `.github/workflows/pages.yml`이 의존성 설치 → 테스트 → 빌드 → Pages 배포를 수행한다. 수동 실행은 **Actions → Deploy Wordbook to GitHub Pages → Run workflow**를 사용한다.
3. 배포 성공 후 [Wordbook](https://leffebrune.github.io/wordbook/)을 연다. 실제 배포 주소와 성공 여부는 Actions의 `github-pages` 환경에서도 확인한다.

PR에서는 테스트·빌드만 수행한다. 배포는 `main`에 한정한다. `package-lock.json`을 버전 관리하고 CI에서는 `npm ci`를 사용한다. **OpenRouter 키를 GitHub Secrets나 빌드 환경변수에 등록하지 않는다.** 빌드에는 시트 ID와 gid만 포함된다.

현재 저장소는 비공개다. 비공개 저장소의 Pages 사용 가능 여부는 GitHub 요금제에 따라 다르므로 Pages 설정에서 확인한다. 저장소 공개 범위를 자동으로 변경하지 않는다. 배포된 사이트의 접근 범위는 저장소의 공개 범위와 별도로 확인한다.

Vite의 `base`, PWA의 ID·시작 주소·scope·아이콘·오프라인 fallback은 `/wordbook/`에 맞춰져 있다. 저장소명이나 도메인 경로를 바꾸면 `vite.config.ts`의 `base`를 함께 수정한다. 참고: [Vite의 GitHub Pages 배포 안내](https://vite.dev/guide/static-deploy.html#github-pages).

## 3. 기기별 API 키 설정

1. 앱 **오른쪽 위 ⚙ 설정**을 누른다.
2. OpenRouter API 키를 입력하고 **저장**한다. 입력값은 화면에서 가려진다.
3. 이후 같은 기기의 같은 브라우저에서 다시 열면 저장된 키로 채점한다. 키가 없는 상태로 채점을 누르면 설정 창이 열린다.

키는 브라우저 `localStorage`의 `wordbook.openrouter-api-key.v1`에 저장한다. 키 변경은 다음 채점부터 적용되며, **저장된 키 삭제** 또는 입력란을 비우고 저장하면 삭제된다. 취소·Esc는 변경 사항을 저장하지 않는다. 키 삭제는 단어 답안을 삭제하지 않는다. 저장소 접근이 거부되면 저장 실패를 표시한다.

키는 GitHub, 구글 시트, 앱 소스나 배포 산출물에 저장하지 않고, 채점 요청의 Authorization 헤더로 OpenRouter에만 보낸다. localStorage는 암호화 금고가 아니므로 해당 브라우저/동일 출처의 스크립트가 접근할 수 있다. 앱 전용 키와 사용액 한도를 사용하는 것이 좋다. 다른 기기·브라우저·출처에서는 별도로 입력해야 하며 사이트 데이터를 지우면 키와 답안도 사라진다.

## 4. 휴대폰 설치와 업데이트

휴대폰에서 Pages HTTPS 주소를 열고 Chrome 또는 Samsung Internet의 **앱 설치 / 홈 화면에 추가**를 사용한다. 별도 LAN IP, PC 서버, 인증서 발급·설치가 필요 없다. 브라우저 탭에서도 설치 없이 사용할 수 있다.

첫 로딩 후 서비스 워커가 활성화되어 앱 파일이 캐시되면 오프라인에서도 화면을 열 수 있다. 시트 로드와 AI 채점에는 인터넷이 필요하다. 오프라인에서는 마지막 단어 목록을 읽기 전용으로 표시한다. 앱 업데이트는 Pages에 배포한 뒤 브라우저의 서비스 워커 업데이트 확인으로 반영된다. 캐시가 지워져도 인터넷에 연결해 Pages 주소에서 다시 열거나 설치할 수 있다.

이전 LAN 주소로 설치한 앱과 Pages 앱은 다른 출처이므로 답안·API 키가 자동 이전되지 않는다. Pages 주소에서 새로 설치하고 키를 입력한다. 예전에 키를 넣어 빌드한 파일은 이번 변경으로 정리되지 않으므로, 과거 파일을 공개한 적이 있다면 해당 키를 교체한다.

## 5. PC에서 개발·확인

Node.js 24를 사용한다.

```bash
npm ci
npm run dev
```

PC 브라우저에서 `http://localhost:5173/wordbook/`을 열어 설치 없이 확인한다. 개발 PC에서도 API 키는 앱의 설정 창에서 입력한다. 배포 빌드 확인:

```bash
npm test
npm run build
npm run preview
```

`http://localhost:4173/wordbook/`에서 배포 빌드와 서비스 워커를 확인한다. 휴대폰 PWA 설치 확인은 Pages HTTPS 주소에서 진행한다. `src/config.local.ts`는 더 이상 읽지 않는다. 남아 있는 이전 파일은 삭제해도 되며 Git 제외 규칙은 실수로 커밋하지 않도록 유지한다.

## 오류 확인

- `A1=word…`: 시트 첫 행과 gid 확인.
- `단어를 불러오려면 인터넷이 필요해요`: 시트 공유 범위, 인터넷 연결, 브라우저 CORS 확인.
- `모델 설정`: E1에 정확한 OpenRouter 모델 ID 확인.
- `API 키를 확인해 주세요`: 설정 창에서 키 변경.
- `크레딧이 부족… (오류 402)`: OpenRouter 잔액과 API 키 사용 한도 확인.
- `호출 한도… (오류 429)`: 잠시 후 재시도.
- `요청이 차단… (오류 403)`: 키 권한·콘텐츠 정책 설정 확인.
- `요청 옵션… (오류 400/422)`: 모델의 구조화 출력 지원·요청 옵션 확인.
- `모델 경로가 없어요 (오류 404)`: E1 모델 ID와 OpenRouter 공급자 설정 확인.
- `채점 서비스… (오류 500/502/503)`: 서비스 상태 확인 후 재시도.
- `응답 시간이 초과…`: 입력을 보존하므로 다시 시도. 서버가 요청을 처리했을 가능성이 있어 자동 재시도하지 않는다.
- Pages 배포 실패: Pages의 Source, 요금제 지원, Actions 로그 확인.

실제 휴대폰에서 시트 CSV GET과 OpenRouter POST가 서버 프록시 없이 동작하는지 확인한다. 두 서비스의 CORS 정책이 바뀌면 앱 코드만으로 우회할 수 없다.

채점 오류에는 오류 코드와 요청한 모델 ID를 표시한다. 서버의 원문 오류·API 키·답안은 로그로 출력하지 않는다. HTTP 200 응답 안의 `error`도 오류로 처리한다.

모델 호환성을 위해 `temperature`는 지정하지 않는다. 예를 들어 `openai/gpt-6-luna`는 구조화 출력은 지원하지만 현재 공급자의 지원 옵션 목록에 temperature가 없다. `provider.require_parameters: true`와 함께 temperature를 보내면 모든 공급자가 제외될 수 있다. 구조화 출력 조건은 유지한다. 참고: [OpenRouter 공급자 라우팅](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-support-all-parameters), [모델 공급자 지원 옵션](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints).
