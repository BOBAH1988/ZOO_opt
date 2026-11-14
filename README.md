# ЗооКонтроль — клиенты, отчёты, KPI, автоматизация

MVP-приложение для управления почтовыми автоматизациями из репозитория [BOBAH1988/mail-automation](https://github.com/BOBAH1988/mail-automation). Приложение размещается на GitHub Pages, использует Firebase Authentication и Firestore, а запуск GitHub Actions workflows выполняется через защищённый серверный API-посредник.

## Статус и реализованные доработки

- **Клиенты:** чтение/запись только по `ownerUid` текущего пользователя (`where('ownerUid','==',uid)`), запись реального UID из Firebase Auth, валидация структуры документов, безопасное преобразование `Timestamp/Date/string` в ISO, понятные ошибки, пропуск некорректных записей с предупреждением. См. `src/pages/ClientsPage.tsx`.
- **Firestore Rules:** строгие правила владельца для `clients` и `runLogs`, запрет остального. Источник правил — `firestore.rules`; настройки Firebase CLI — `firebase.json`.
- **Запуск процессов:** клиент отправляет `Authorization: Bearer <Firebase ID token>`, параметры workflow редактируемы в UI (запоминаются в `localStorage`), перед запуском подтверждение для сценариев с риском реальной рассылки, журнал запросов пишется в `runLogs`. После запуска вместо кнопки показывается статус «Ок»/«Сбой». Кнопка `❓` рядом с заголовком открывает список всех сценариев запуска и всех скриптов с описаниями и кодами (из `mail-automation/README.md`). См. `src/pages/RunProcessesPage.tsx`, `src/api.ts`.
- **Сервер запуска:** `/server` содержит пример Express API, а `server/cloudflare` — Cloudflare Worker для бесплатного размещения с проверкой Firebase ID token, allowlist пользователя, валидацией workflow/inputs и серверным GitHub token. Требует развёртывания и настройки `VITE_API_BASE_URL`. См. `server/README.md` и `server/cloudflare/README.md`. **Безопасность по умолчанию — fail-closed:** пустой `ALLOWED_UIDS` запрещает запуск всем, пустой `REAL_SEND_UIDS` запрещает реальную рассылку всем.
- **Навигация:** внутренняя навигация через `Link`/роутер (HashRouter, base `/ZOO_opt/`), без обычных ссылок на внутренние маршруты вне роутера.
- **Регистрация/доступ:** вход, сброс пароля, опциональные ограничения регистрации (`VITE_DISABLE_SIGNUP`, `VITE_ALLOWED_EMAILS`, `VITE_ALLOWED_EMAIL_DOMAINS`, `VITE_REGISTRATION_INVITE_CODE`), попытка отправки письма подтверждения email после регистрации. Для внутренней системы рекомендуется отключить/ограничить регистрацию и управлять пользователями в Firebase.
- **Отчёты:** история запусков из `runLogs` (дата в две строки — дата и время, процесс, статус «Ок»/«Сбой»). Столбцы «Результат» и «Сообщение» скрыты; текст сообщения показывается во всплывающей подсказке при клике на статус. Статус «Ок» не означает завершение workflow.
- **PWA:** `public/sw.js` — чистый JS, кэш только статической оболочки, network-only для Firebase/API/авторизованных данных, `src/main.tsx` регистрирует SW. Адаптация под устройства: `env(safe-area-inset-*)` для вырезов/домашнего индикатора iPhone, `touch-action: manipulation`, брейкпоинты до 480px, поля ввода 16px против зума iOS при фокусе.
- **CI/проверки:** `npm run lint` и `npm run test` = `tsc --noEmit`, `npm run build` = `tsc -b && vite build`; deploy workflow выполняет lint, загружает/валидирует Firebase-конфиг из секрета `ZOO` и собирает проект. Правила и индексы Firestore публикуются отдельно через Firebase CLI.

## Конфигурация (`.env`, не коммитить)

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Защищённый серверный API для POST /run
VITE_API_BASE_URL=

# Ограничения регистрации (для внутренней системы)
VITE_DISABLE_SIGNUP=false
VITE_ALLOWED_EMAILS=
VITE_ALLOWED_EMAIL_DOMAINS=
VITE_REGISTRATION_INVITE_CODE=
```

## Настройка Firestore в консоли Firebase (обязательно)

Даже если все `VITE_FIREBASE_*` заданы верно, ошибка `400 (Bad Request)` на потоке `google.firestore.v1.Firestore/Listen` означает, что **база данных Firestore не создана** в проекте Firebase или не настроены правила доступа.

### Шаги настройки:

1. Откройте [Firebase Console](https://console.firebase.google.com/), выберите проект `zoo-opt`.
2. В боковом меню перейдите **Firestore Database** → **Create database**.
3. Выберите режим **Native mode** (рекомендуется), затем расположение БД (ближайшее к вам).
4. Нажмите **Enable** — создание может занять до 1 минуты.
5. В разделе **Firestore Database → Rules** замените правила на содержимое `firestore.rules` из этого репозитория и нажмите **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       ... (см. firestore.rules)
     }
   }
   ```
6. В разделе **Firestore Database → Indexes** убедитесь, что индексы из `firestore.indexes.json` созданы (либо нажмите «Create index» при первом открытии страницы, которая требует составной индекс).
7. Скопируйте веб-конфигурацию: **Настройки проекта → Общие → Ваши приложения → Веб-приложение (</>)** → `firebaseConfig` и впишите значения в `.env` (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` и т.д.).

### Почему возникает `400 Bad Request` на `Listen`

SDK Firebase пытается открыть веб-канал (WebChannel) для подписки на изменения в Firestore. Если база данных не создана, проект не имеет прав на Firestore или API-ключ не валиден, Google отвечает `400 (Bad Request)` и соединение рвётся. Это не ошибка кода приложения — необходимо завершить настройку в консоли Firebase.

## GitHub Secrets (deploy)

Для публикации через GitHub Actions создайте repository secret `ZOO` (Settings → Secrets and variables → Actions) со значениями веб-конфигурации Firebase из Firebase Console. Значение может быть строками `.env` (`ИМЯ=значение`, по одной на строку) или JSON-объектом с теми же ключами. Workflow записывает содержимое `ZOO` во временный `.env`, проверяет обязательные параметры входа (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`) и формат Firebase Web API key, затем собирает сайт.

Дополнительно (при необходимости) задайте секреты: `VITE_API_BASE_URL`, `VITE_DISABLE_SIGNUP`, `VITE_ALLOWED_EMAILS`, `VITE_ALLOWED_EMAIL_DOMAINS`, `VITE_REGISTRATION_INVITE_CODE`.

**Не храните реальные секреты/GitHub-токены в клиенте, `.env` в репозитории или README.**

## Firebase

- **Auth:** Email/Password. Включите провайдер в Firebase Console; настройте подтверждение email/сброс пароля и домены при необходимости.
- **Firestore:** коллекции `clients` (поля: `name`, `email`, `phone?`, `company?`, `address?`, `day?`, `mode?`, `manager?`, `notes?`, `active?`, `title?`, `grade?` (Gold/Silver/Bronze), `createdAt`, `updatedAt`, `ownerUid`) и `runLogs`. Правила и индекс `runLogs` хранятся в репозитории.
- Правило вида `allow create: if request.auth != null` для клиентов **не используется** — доступ ограничен владельцем и валидацией.
- После входа в Firebase CLI (`firebase login`) опубликуйте конфигурацию Firestore из корня репозитория: `firebase deploy --only firestore:rules,firestore:indexes --project zoo-opt`. Индекс `runLogs` поддерживает запрос отчётов по `requestedBy` с сортировкой по `createdAt`.

## Запуск GitHub Actions (сервер)

Клиент: `POST ${VITE_API_BASE_URL}/run` с JSON `{ workflowId, inputs }` и Firebase ID token. Сервер обязан:
- проверять токен и права пользователя;
- разрешать только workflow/параметры из серверного белого списка;
- валидировать входные данные и усиливать ограничения для реальных рассылок (`test_mode`, allowlist/роль, журнал);
- хранить GitHub token/credentials только на сервере.

Ответы об ошибках содержат машинный код причины в поле `code`, чтобы клиент не показывал внутренний текст GitHub: `github_timeout` (504), `github_auth_failed`, `github_forbidden`, `github_not_found` (502), а также `missing_token` (401), `invalid_token` (401), `unverified_email` (403), `uid_not_allowed` (403). Клиент переводит их в русские тексты через `ERROR_CODE_MAP` в `src/api.ts`.

Пример реализации: `server/README.md`. Без настроенного API запуск не выполняется.
Бесплатный вариант размещения — Cloudflare Workers; пошаговая настройка находится в `server/cloudflare/README.md`. Для работы нужны GitHub token в секрете Worker и URL Worker в GitHub Secret `VITE_API_BASE_URL`.

## Разработка и публикация

```bash
npm install
npm run dev      # http://localhost:5173/ZOO_opt/
npm run lint     # tsc --noEmit
npm run test     # tsc --noEmit (базовая автоматическая проверка)
npm run build
```

GitHub Pages: base `/ZOO_opt/`, HashRouter, workflow `.github/workflows/deploy.yml`. Включите Pages (GitHub Actions) и задайте секреты.

## PWA

- Манифест/иконки в `public/`, SW кэширует только статическую оболочку, network-only для Firebase/API/авторизованных данных и `/run`.
- iOS PWA: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `viewport-fit=cover`, безопасные зоны `env(safe-area-inset-*)` в CSS.
- `manifest.json` — `display: standalone`, `shortcuts` («Клиенты», «Запуск»), иконки 192/512 + maskable.
- На iPhone (где нет `beforeinstallprompt`) показывается баннер с инструкцией «Поделиться» → «На экран «Домой»» (`src/components/PWAInstallPrompt.tsx`).
- Проверяйте установку и обновление после деплоя.

## Ограничения / дальнейшие шаги

- Развернуть сервер `/run` (например, Cloudflare Workers) и перенести доверительную запись `runLogs` на сервер (Admin SDK) при необходимости.
- Добавить Firebase Emulator тесты для правил/сценариев, e2e/smoke проверки.
- Усилить контроль рассылок реальным адресатам (роли, подтверждения, аудит на сервере).

## Решение проблем (troubleshooting)

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `Запуск не настроен: отсутствует серверный API (VITE_API_BASE_URL)` | `VITE_API_BASE_URL` не задан в клиенте | Локально: `VITE_API_BASE_URL=http://localhost:8787` в `.env` и запущен `server/index.js`. Онлайн: задайте repository secret `VITE_API_BASE_URL` = URL Cloudflare Worker (например `https://zoo-opt-run-api.zoo-opt.workers.dev`) в GitHub Settings → Secrets → Actions и пересоберите сайт (пуш в `main`). |
| `net::ERR_CONNECTION_REFUSED` на `localhost:8787` | Локальный Express-сервер не запущен | `cd server && npm install && npm start`. Сервер должен слушать порт 8787. |
| WebSocket HMR падает с `400` в dev (`ws://localhost:5173/ZOO_opt/...`) | Vite dev сервер не знает базовый путь `/ZOO_opt/` | В `vite.config.ts` добавьте `server.origin: 'http://localhost:5173'` (или `server.hmr.path: '/__vite_hmr'`). |
| `502 Bad Gateway` / `Failed to dispatch GitHub Actions workflow` | `GITHUB_TOKEN` не задан в секретах Cloudflare Worker | `cd server/cloudflare && npx wrangler secret put GITHUB_TOKEN` → введите Fine-grained PAT с правом `Actions: Read and write` на `BOBAH1988/mail-automation` → `npx wrangler deploy --name zoo-opt-run-api`. |
| `github_auth_failed` (502) | GitHub отклонил токен сервера (`GITHUB_TOKEN`) как недействительный | Обновите секрет `GITHUB_TOKEN` (Fine-grained PAT с правом `Actions: Read and write` на `BOBAH1988/mail-automation`), затем `npx wrangler secret put GITHUB_TOKEN` / обновите `server/.env`. |
| `github_forbidden` (502) | Токену не хватает прав или отсутствует заголовок `User-Agent` | 1) В токене GitHub (Fine-grained) выберите репозиторий `BOBAH1988/mail-automation` и право `Repository permissions → Actions: Read and write`. 2) Заголовок `User-Agent: zoo-opt-run-api` уже отправляется в `server/cloudflare/src/index.js` и `server/index.js`. |
| `github_not_found` (502) | Файл workflow не найден в репозитории | Проверьте `ALLOWED_WORKFLOWS` (`server/cloudflare/src/index.js` / `server/index.js`): файл должен существовать в `mail-automation` и содержать триггер `workflow_dispatch`. |
| `github_timeout` (504) | GitHub не ответил за 15 секунд | Повторите запуск позже; проверьте доступность `api.github.com` и статус GitHub Actions. |
| `Request forbidden by administrative rules... User-Agent header` | GitHub требует `User-Agent` на все запросы к REST API | Добавьте `'User-Agent': 'zoo-opt-run-api'` в заголовки `fetch` к `api.github.com` (уже исправлено в `server/cloudflare/src/index.js` и `server/index.js`). |
| `Workflow is not allowed` | Указанный `workflowId` нет в серверном белом списке | Проверьте `ALLOWED_WORKFLOWS` в `server/cloudflare/src/index.js` / `server/index.js` — должен содержать запускаемый `workflowId` и соответствующий файл в репозитории `mail-automation` с триггером `workflow_dispatch`. |
| `Real email sending is not enabled for this account` | `test_mode=false` для workflow с `realSendGuard`, но UID не в `REAL_SEND_UIDS` | Добавьте свой Firebase UID в secret `REAL_SEND_UIDS` сервера (воркера или Express), либо оставьте `test_mode=true`. |
| `Требуется токен авторизации Firebase` (401) | Запрос пришёл без `Authorization: Bearer <token>` | Войдите в приложение через Firebase Auth перед запуском. |
| `Сессия истекла. Войдите заново.` (401, код `invalid_token`) | ID token истёк или повреждён | Перезайдите в приложение — токен обновится автоматически. |
| `Email не подтверждён. Подтвердите почту в Firebase Auth.` (403, код `unverified_email`) | Аккаунт создан, но письмо подтверждения не открыто; правила Firestore и сервер запуска требуют `email_verified` | Откройте письмо подтверждения (кнопка «Отправить письмо ещё раз» на экране «Подтвердите email»), затем нажмите «Я подтвердил(а) — проверить». |
| `400 (Bad Request)` на `google.firestore.v1.Firestore/Listen` (WebChannelConnection) | База данных Firestore не создана в консоли Firebase или API-ключ не валиден | Создайте базу Firestore (Firebase Console → Firestore Database → Create database, Native mode), опубликуйте правила из `firestore.rules`, проверьте `VITE_FIREBASE_*` в `.env` и пересоберите проект. См. раздел «Настройка Firestore в консоли Firebase». |

