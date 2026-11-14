# Run API (пример серверного посредника)

Минимальный пример защищённого API для `POST /run`. В продакшене разверните как отдельный сервис (Cloud Functions / Cloud Run / Cloudflare Worker / Node.js API) и задайте `VITE_API_BASE_URL` в клиенте.

## Требования безопасности
- Хранить GitHub token только в серверных секретах (`GITHUB_TOKEN` / GitHub App credentials).
- Проверять Firebase ID token из `Authorization: Bearer <token>` (Firebase Admin SDK).
- Разрешать запуск **только** workflow из белого списка.
- Валидировать `inputs` по схеме каждого workflow; отклонять неизвестные ключи и произвольные имена.
- Для рассылок реальным адресатам: принудительно учитывать `test_mode`, проверять роль/allowlist пользователя, логировать запросы/ответы.
- **Fail-closed по умолчанию:** пустой `ALLOWED_UIDS` запрещает запуск всем (403), пустой `REAL_SEND_UIDS` запрещает реальную рассылку всем (403).
- Не принимать произвольные команды или скрипты от клиента.

## Переменные окружения
- `PORT` (по умолчанию 8787)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (PEM, `\n`)
- `ALLOWED_UIDS` (через запятую; пусто = никто не имеет прав на запуск)
- `REAL_SEND_UIDS` (через запятую; пусто = реальная рассылка запрещена всем)
- `APP_ORIGIN` (разрешённый origin для CORS; обязателен для работы из браузера)
- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN` (`actions:write` на целевой репозиторий)

## Запуск
```bash
cd server
npm install
npm start
```

Сервер пишет JSON-журнал в stdout. В продакшене рекомендуется сохранять `runLogs` в Firestore через Admin SDK (доверенная запись).

## Коды ошибок

Ответы об ошибках содержат машинный код причины в поле `code`, чтобы клиент не показывал внутренний текст GitHub (перевод в русские тексты — `ERROR_CODE_MAP` в `src/api.ts`):

| `code` | HTTP | Значение |
|--------|------|----------|
| `missing_token` | 401 | Нет заголовка `Authorization: Bearer` |
| `invalid_token` | 401 | ID token истёк или повреждён — нужен перелогин |
| `unverified_email` | 403 | Email не подтверждён |
| `uid_not_allowed` | 403 | UID нет в `ALLOWED_UIDS` |
| `github_auth_failed` | 502 | GitHub отклонил `GITHUB_TOKEN` |
| `github_forbidden` | 502 | GitHub: недостаточно прав |
| `github_not_found` | 502 | GitHub: файл workflow не найден |
| `github_timeout` | 504 | GitHub не ответил за 15 секунд |

Ошибки валидации запроса (`Workflow is not allowed`, `Unknown input`, `test_mode must be boolean` и т.п.) возвращаются с HTTP 400 без поля `code`.
