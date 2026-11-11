# Analytics

# ЗОО Opt — PWA для ручного управления проектами автоматизации почты

MVP-приложение для управления почтовыми автоматизациями из репозитория [BOBAH1988/mail-automation](https://github.com/BOBAH1988/mail-automation) (приватный).

## Страницы (MVP)

| Раздел | Путь | Описание |
|--------|------|----------|
| Отчёты | `/#/reports` | Главная страница с пустым состоянием «Отчётов пока нет». |
| Запуск процессов | `/#/run` | Кнопки ручного запуска существующих GitHub Actions workflows. |
| База клиентов | `/#/clients` | Список, поиск, карточка клиента, создание/редактирование/удаление. |

Все разделы доступны только после авторизации через Firebase Authentication.

## Архитектура

- **Frontend:** статическая PWA на React + TypeScript + Vite, размещается на GitHub Pages.
- **Вход:** Firebase Authentication (email + пароль).
- **База клиентов:** Firebase Firestore (коллекция `clients`, чтение/запись только от имени авторизованного пользователя).
- **Запуск процессов:** защищённый серверный API (Firebase Cloud Functions или Cloudflare Worker) вызывает `workflow_dispatch` в GitHub Actions. GitHub-токены не хранятся в frontend.
- **PWA:** веб-манифест, Service Worker (кэширует только статическую оболочку), иконки для установки.

## Список поддерживаемых запусков

Сценарии берутся из реальных workflows репозитория `mail-automation`:

1. **Тесты (стенд)** — `tests.yml` — без реальных писем, тестовый режим по умолчанию.
2. **KPI Продажи** — `kpi_sales.yml` — личный отчёт, письмо только владельцу.
3. **Почта пятница** — `weekly_fri.yml` — параметры: `test_mode`, `only`, `ignore_window`.
4. **Почта пн-вт** — `weekly_mon_tue.yml` — параметры: `test_mode`, `only`, `ignore_window`.
5. **Почта среда** — `weekly_wed.yml` — параметры: `test_mode`, `only`, `ignore_window`.
6. **Рекомендации к заказу (пн)** — `weekly_residues.yml` — параметр: `test_mode`.
7. **Прайсы понедельника (сети + ИП Мамедов)** — `weekly_sety_price.yml` — параметры: `test_mode`, `skip_if_sent`.

Перед запуском сценариев, которые могут отправлять реальные письма клиентам, показывается диалог подтверждения с предупреждением. Тестовый режим выбран по умолчанию.

## Настройка для публикации

### 1. GitHub Pages (репозиторий ZOO_opt)

1. Включите GitHub Pages в настройках репозитория (Source: GitHub Actions).
2. При пуше в `main` workflow `.github/workflows/deploy.yml` соберёт и деплоит приложение.
3. Сайт будет доступен по адресу `https://BOBAH1988.github.io/ZOO_opt/`.

### 2. Firebase (Authentication + Firestore)

Создайте веб-приложение в консоли Firebase и задайте переменные окружения (или `.env`):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Настройте правила безопасности Firestore (пример):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /clients/{documentId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.ownerUid;
      allow create: if request.auth != null;
    }
  }
}
```

### 3. Серверный API для запуска workflows

Приложение ожидает API по адресу `VITE_API_BASE_URL`. Endpoint `POST /run` принимает:

```json
{
  "workflowId": "weekly_fri",
  "inputs": { "test_mode": true }
}
```

Возвращает:

```json
{
  "accepted": true,
  "message": "Запуск принят",
  "runUrl": "https://github.com/.../actions/runs/...",
  "runId": "12345678"
}
```

Если API не настроен, страница «Запуск процессов» показывает сообщение «Запуск процессов не настроен: отсутствует серверный API» и не имитирует запуск.

Реализация серверной стороны (Firebase Cloud Functions / Cloudflare Worker / свой API) должна:
- хранить GitHub-токен только в серверных секретах;
- проверять `workflowId` по белому списку разрешённых workflows;
- валидировать параметры inputs по схеме workflow;
- вызывать GitHub API `workflow_dispatch`.

## Безопасность

- GitHub-токены и секреты НЕ находятся в клиентском коде, переменных сборки или Firebase-конфиге.
- Персональные данные клиентов не кэшируются для офлайн-доступа.
- Пароли, токены и содержимое писем не пишутся в логи.
- Доступ к разделам и данным только после авторизации.

## Разработка

```bash
npm install          # установка зависимостей
npm run dev          # локальный сервер (http://localhost:5173/ZOO_opt/)
npm run build        # сборка для продакшена (dist/)
npm run lint         # проверка типов TypeScript
```

## Не входит в MVP

Обработка входящих писем, новые автоматизации, импорт/экспорт клиентов, уведомления, сложные роли, аналитика. Бизнес-логика Python-скриптов не изменяется.
