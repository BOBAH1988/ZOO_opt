# ЗооКонтроль — клиенты, отчёты, KPI, автоматизация

MVP-приложение для управления почтовыми автоматизациями из репозитория [BOBAH1988/mail-automation](https://github.com/BOBAH1988/mail-automation). Приложение размещается на GitHub Pages, использует Firebase Authentication и Firestore, а запуск GitHub Actions workflows выполняется через защищённый серверный API-посредник.

## Статус и реализованные доработки

- **Клиенты:** чтение/запись только по `ownerUid` текущего пользователя (`where('ownerUid','==',uid)`), запись реального UID из Firebase Auth, валидация структуры документов, безопасное преобразование `Timestamp/Date/string` в ISO, понятные ошибки, пропуск некорректных записей с предупреждением. См. `src/pages/ClientsPage.tsx`.
- **Firestore Rules:** строгие правила владельца для `clients` и `runLogs`, запрет остального. Источник правил — `firestore.rules`; настройки Firebase CLI — `firebase.json`.
- **Запуск процессов:** клиент отправляет `Authorization: Bearer <Firebase ID token>`, параметры workflow редактируемы в UI, перед запуском подтверждение для сценариев с риском реальной рассылки, журнал запросов пишется в `runLogs`. См. `src/pages/RunProcessesPage.tsx`, `src/api.ts`.
- **Сервер запуска (пример):** добавлен `/server` — проверка Firebase ID token, белый список workflow/inputs, серверные ограничения и журналирование, вызов GitHub `workflow_dispatch` с секретным токеном. Требует развёртывания и `VITE_API_BASE_URL`. См. `server/README.md`, `server/index.js`.
- **Навигация:** внутренняя навигация через `Link`/роутер (HashRouter, base `/ZOO_opt/`), без обычных ссылок на внутренние маршруты вне роутера.
- **Регистрация/доступ:** вход, сброс пароля, опциональные ограничения регистрации (`VITE_DISABLE_SIGNUP`, `VITE_ALLOWED_EMAILS`, `VITE_ALLOWED_EMAIL_DOMAINS`, `VITE_REGISTRATION_INVITE_CODE`), попытка отправки письма подтверждения email после регистрации. Для внутренней системы рекомендуется отключить/ограничить регистрацию и управлять пользователями в Firebase.
- **Отчёты:** история запусков из `runLogs` (статус, сообщение, ошибка, ссылка на GitHub Actions, дата, параметры). Статус «принят» не означает завершение workflow.
- **PWA:** `public/sw.js` — чистый JS, кэш только статической оболочки, network-only для Firebase/API/авторизованных данных, `src/main.tsx` регистрирует SW.
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

## GitHub Secrets (deploy)

Для публикации через GitHub Actions создайте repository secret `ZOO` (Settings → Secrets and variables → Actions) со значениями веб-конфигурации Firebase из Firebase Console. Значение может быть строками `.env` (`ИМЯ=значение`, по одной на строку) или JSON-объектом с теми же ключами. Workflow записывает содержимое `ZOO` во временный `.env`, проверяет обязательные параметры входа (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`) и формат Firebase Web API key, затем собирает сайт.

Дополнительно (при необходимости) задайте секреты: `VITE_API_BASE_URL`, `VITE_DISABLE_SIGNUP`, `VITE_ALLOWED_EMAILS`, `VITE_ALLOWED_EMAIL_DOMAINS`, `VITE_REGISTRATION_INVITE_CODE`.

**Не храните реальные секреты/GitHub-токены в клиенте, `.env` в репозитории или README.**

## Firebase

- **Auth:** Email/Password. Включите провайдер в Firebase Console; настройте подтверждение email/сброс пароля и домены при необходимости.
- **Firestore:** коллекции `clients` (поля: `name`, `email`, `phone?`, `company?`, `notes?`, `createdAt`, `updatedAt`, `ownerUid`) и `runLogs`. Правила и индекс `runLogs` хранятся в репозитории.
- Правило вида `allow create: if request.auth != null` для клиентов **не используется** — доступ ограничен владельцем и валидацией.
- После входа в Firebase CLI (`firebase login`) опубликуйте конфигурацию Firestore из корня репозитория: `firebase deploy --only firestore:rules,firestore:indexes --project zoo-opt`. Индекс `runLogs` поддерживает запрос отчётов по `requestedBy` с сортировкой по `createdAt`.

## Запуск GitHub Actions (сервер)

Клиент: `POST ${VITE_API_BASE_URL}/run` с JSON `{ workflowId, inputs }` и Firebase ID token. Сервер обязан:
- проверять токен и права пользователя;
- разрешать только workflow/параметры из серверного белого списка;
- валидировать входные данные и усиливать ограничения для реальных рассылок (`test_mode`, allowlist/роль, журнал);
- хранить GitHub token/credentials только на сервере.

Пример реализации: `server/README.md`. Без настроенного API запуск не выполняется.

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

- Манифест/иконки в `public/`, SW кэширует только статическую оболочку, не кэширует Firebase/персональные/авторизованные данные и `/run`.
- Проверяйте установку и обновление после деплоя.

## Ограничения / дальнейшие шаги

- Развернуть и защитить сервер `/run`, перенести доверительную запись `runLogs` на сервер (Admin SDK) при необходимости.
- Добавить Firebase Emulator тесты для правил/сценариев, e2e/smoke проверки.
- Усилить контроль рассылок реальным адресатам (роли, подтверждения, аудит на сервере).
