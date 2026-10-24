# Finance Dashboard — Project Progress

Срез состояния: **24 октября 2026 года, финальная QA-проверка Phase 5**.

Основание: код и документация репозитория, выполненные проверки и доступная история текущей сессии. Ветка — `feat/fullstack`; базовый Git HEAD до финализации Phase 5 — `946ed96`. Локальная финализация Phase 5 в Git отдельно разрешена пользователем; точные SHA и состав commits отражаются в Git log. Commit транзакции миграции в PostgreSQL и Git commit — разные операции.

В этой закрывающей проверке выполнены только offline/backend и frontend проверки. Обращения к PostgreSQL и Docker, миграции, restore и браузерные сценарии повторно не выполнялись. Исторические результаты отдельно отмечены ниже. Подробные отдельные отчёты о каждой ранней фазе доступны не полностью; их статус подтверждается реализацией, Git и историей сессии.

## 1. Project Overview

Finance Dashboard — приложение для локального управления персональными финансами: доходы и расходы, подписки, независимый бюджет 50/30/20, сводные показатели и распределение расходов. React-интерфейс подключён к FastAPI и PostgreSQL.

Регистрация создаёт новое изолированное пространство финансовых данных; вход открывает существующее пространство этого пользователя. Проект остаётся приложением для локальной разработки. Публичный deployment не согласован; production startup намеренно заблокирован.

## 2. Tech Stack

| Область | Используемые технологии |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS 3, React Router 7, Recharts 3, Lucide React |
| State / HTTP | React Context, собственные hooks, Fetch API, AbortController, access token в памяти |
| Backend | Python 3.13 в проверенном окружении; проект требует Python ≥3.12, FastAPI, Uvicorn, Pydantic 2, pydantic-settings |
| Database | PostgreSQL 17, SQLAlchemy 2.0, psycopg 3, Alembic, Docker Compose |
| Authentication | Argon2id через argon2-cffi, JWT через PyJWT, серверные сессии и хеши refresh tokens |
| Проверки | pytest/httpx, Node.js test runner, ESLint, TypeScript, Vite build; ранее выполненные реальные Chrome-сценарии |

## 3. Architecture

```text
finance-dashboard/
├── src/
│   ├── api/                     # Typed HTTP client, auth session / refresh coordination
│   ├── state/                   # AuthProvider, authStore, FinanceProvider
│   ├── components/              # AuthenticatedApp, UserMenu, layout и формы
│   ├── pages/                   # AuthPage и финансовые страницы
│   ├── hooks/                   # Ресурсы, mutations, настройки, бюджет
│   ├── features/                # Dashboard, бюджет, подписки, транзакции
│   ├── utils/                   # Точная денежная арифметика и даты
│   ├── App.tsx
│   └── main.tsx
├── backend/
│   ├── app/
│   │   ├── main.py              # App factory, CORS, health, безопасные ошибки
│   │   ├── config.py            # Environment configuration
│   │   ├── db.py                # SQLAlchemy engine / request sessions
│   │   ├── auth.py              # JWT, authenticated ownership, auth guards
│   │   ├── api/                 # auth.py, finance.py
│   │   ├── services/            # auth.py, finance.py
│   │   ├── models/              # Financial и authentication ORM models
│   │   ├── schemas.py
│   │   └── auth_schemas.py
│   ├── alembic/versions/        # 0001_infrastructure → 0002_models → 0003_auth
│   ├── verification/            # Guarded local database / backup verification
│   ├── tests/
│   ├── compose.yaml
│   └── pyproject.toml
├── tests/                       # Frontend tests и изолированные test helpers
├── .env.example                 # Публичная настройка локального API
└── PROJECT_PROGRESS.md
```

Frontend использует общий финансовый контекст и resource hooks; успешные mutations обновляют связанные страницы. Списки используют серверные фильтры, сортировку и pagination. Dashboard получает агрегаты полного набора, а recent transactions — отдельную ограниченную выборку.

AuthProvider восстанавливает сессию через refresh cookie. Access token хранится только в памяти. Refresh сериализуется внутри вкладки; epoch guards и смена ключа финансового subtree защищают от устаревших ответов и переноса состояния между аккаунтами.

Backend использует тонкие routes и сервисы без отдельного repository-слоя. Routes завершают транзакции записи; request sessions закрываются после запроса. Владелец определяется из проверенного JWT и активной серверной сессии. Клиентский `owner_id` не принимается; финансовые чтения, изменения и агрегаты ограничены текущим владельцем. `SINGLE_OWNER_ID` больше не используется для авторизации.

| Таблицы | Назначение |
| --- | --- |
| `owners` | UUID namespace финансовых данных; может существовать без аккаунта |
| `transactions`, `subscriptions` | Много записей на владельца |
| `budget_profiles`, `preferences` | Не более одной записи каждого типа на владельца |
| `users` | Нормализованный уникальный email, Argon2id hash, уникальная ссылка на Owner |
| `auth_sessions` | Семейство сессии пользователя, абсолютный срок, отзыв |
| `auth_refresh_tokens` | SHA-256 hash refresh token, сессия, срок и отметка использования |
| `alembic_version` | Текущая revision |

Используются UUID, FK с `ON DELETE RESTRICT`, уникальные ограничения и проверки. Деньги — `NUMERIC(20,8)`, финансовые даты — `DATE`, audit timestamps — timezone-aware, ответы UTC.

Разрешённая локальная инфраструктура: Compose project `backend`, контейнер `backend-postgres-1`, PostgreSQL `127.0.0.1:5434`. Digital Platform не относится к проекту и не затрагивается.

## 4. Completed Phases

| Фаза | Подтверждённый результат |
| --- | --- |
| 1 — Backend Infrastructure | FastAPI, environment configuration, SQLAlchemy sessions, Compose PostgreSQL, health/readiness, OpenAPI, Alembic baseline |
| 2 — Database Models & Relationships | Пять финансовых моделей, отношения, ограничения, `0002_models` |
| 3 — REST API & CRUD | Transactions/subscriptions CRUD, budget, preferences, dashboard, scoped ownership |
| 4 — React + FastAPI Integration | Typed client, финансовое состояние и persistence через API, aggregates, точные записываемые суммы, loading/error states |
| 5 — Authentication & Authorization | Registration/login/logout, JWT, refresh rotation/revocation, CSRF, authenticated ownership, protected React routes; изолированные API/browser проверки и development migration `0003_auth` выполнены |

Фазы 1–4 подтверждены кодом и предыдущими проверками. Phase 5 подтверждена реализацией, прежними PostgreSQL/Chrome/security проверками, успешной guarded development migration и текущим offline QA. Это завершение локальной authentication-фазы, а не подтверждение production readiness или полной браузерной регрессии всех финансовых экранов.

## 5. Current Status

Миграция **`0002_models → 0003_auth` применена и закоммичена в PostgreSQL** в предыдущем отдельно разрешённом шаге. Независимая read-only post-migration проверка и Reviewer дали **PASS**. Добавлены только `users`, `auth_sessions`, `auth_refresh_tokens`, их индексы/ограничения и обновлена Alembic revision.

Существующие финансовые таблицы и legacy Owner не изменены. Counts и fingerprints до/после совпали: owners — 1, transactions — 1, budget_profiles — 1, preferences — 1, subscriptions — 0. На момент post-migration проверки все три auth-таблицы были пустыми. В этой закрывающей проверке БД повторно не опрашивалась.

Проверенный custom-format PostgreSQL backup хранится вне Git в приватном локальном каталоге. SHA-256: `5bd5cd54974cec02004e64add78c28716063bd70fb5fe79014b42587ddd754c1`. Restore в `finance_dashboard_restore_2d7aad8af290` сертифицирован на `0002_models`: финансовые counts/fingerprints совпали, схема семантически эквивалентна. Различия deparser-текста трёх enum CHECK нормализованы только для точно проверенных форм. История manifest сохраняет исходный `failed_unknown` event и preimage; точное ранее подавленное exception-сообщение не восстановлено. Оба raw schema hashes сохранены в verification evidence, а creation/restoration claims остаются отдельными неизменёнными файлами. Backup, manifest и восстановленная БД этой проверкой не изменялись.

### Свежие проверки закрытия Phase 5

| Проверка | Реально выполненный результат |
| --- | --- |
| Backend offline suite | **462 passed, 45 skipped, 0 failed**, 2.58 s; database tests отключены |
| Frontend Node/source tests | **14 passed, 0 failed, 0 skipped**; без browser rerun |
| ESLint | PASS |
| TypeScript | PASS |
| Production build | PASS; advisory о bundle 640.53 KB / 189.55 KB gzip |
| Git branch / whitespace | `feat/fullstack`; `git diff --check` — PASS |
| Закрывающее независимое ревью | **Reviewer: PASS**, блокирующих замечаний для локального закрытия нет |

### Ранее выполненные проверки Phase 5

- 197 backend tests и отдельные 68 security tests — PASS на предыдущих стадиях; это исторические результаты, не дополнительные текущие запуски.
- 12 PostgreSQL authentication integration tests — PASS на изолированной disposable БД.
- 14/14 реальных Chrome authentication-сценариев — PASS: регистрация, вход, transaction persistence после reload, logout/protected routes, второй аккаунт и изоляция, неправильный пароль, validation, истечение JWT и session refresh.
- В browser expiry-сценарии наблюдались успешное продолжение сессии и серверная ротация; отдельная последовательность сетевых 401/refresh/retry и browser cookie metadata напрямую не зафиксированы. Cookie attributes и guards проверены API-тестами и кодом.
- Независимое security review, restoration certification и development migration review — PASS.

Браузер и PostgreSQL integration tests в текущем закрывающем запуске не повторялись. Проверка текущего worktree/index не выявила tracked secrets/backup/test artifacts или высокоуверенных secret-pattern совпадений; это не полный аудит истории Git. Добавлены общие ignore-правила для приватных env, Python caches и backup archives; существующие артефакты сохранены.

## 6. Implemented Features

- Transactions CRUD: income/expense, свободный текст категории, дата, поиск, фильтры, сортировка, limit/offset.
- Subscriptions CRUD: active/paused, ручная next payment date, active summaries. Автоматическое создание транзакций отсутствует.
- Независимый бюджет: monthly income, needs spent, wants spent, savings; правило 50/30/20. Бюджет не вычисляется из транзакций.
- Display currency USD/KZT/EUR/RUB сохраняется через API; тема и кэш курсов остаются browser-local.
- Dashboard: income, expenses, balance, transaction count, расходы по категориям и recent transactions. Smart Insights используют локальные бюджетные правила.
- Registration/login/logout, восстановление сессии после refresh, защищённые маршруты, ошибки и validation feedback, меню пользователя, очистка финансового состояния при смене аккаунта.
- Серверная изоляция владельца, generic auth errors, bounded process-local rate limiting, CSRF Origin/header checks, exact local CORS allowlist.

| API, префикс `/api/v1` | Методы |
| --- | --- |
| `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | POST |
| `/auth/me` | GET |
| `/transactions`, `/transactions/{id}` | POST/GET; GET/PATCH/DELETE |
| `/subscriptions`, `/subscriptions/{id}`, `/subscriptions/summary` | POST/GET; GET/PATCH/DELETE; GET |
| `/budget`, `/preferences` | GET/PATCH |
| `/dashboard`, `/health`, `/health/ready` | GET |

### Authentication и финансовые границы

Пароли хешируются Argon2id. HS256 access JWT живёт 5 минут; проверяются алгоритм, signature, issuer/audience, claims и активная серверная сессия. Refresh token — случайный opaque token, в БД хранится только hash; ротация с блокировкой строк, reuse отзывает семейство. Refresh срок до 7 дней внутри абсолютных 30 дней. Logout отзывает семейство.

Refresh cookie: host-only, HttpOnly, SameSite=Lax, path `/api/v1/auth`; Secure=false только для локального HTTP. Все auth POST требуют разрешённый Origin и `X-CSRF-Protection: 1`. Production cookie helper использует Secure=true, но production startup заблокирован. Долгоживущие токены и пароли не сохраняются в localStorage.

Каноническая валюта — USD; backend использует Decimal/NUMERIC, JSON money — decimal strings с восемью знаками. API отклоняет числа JSON, NaN/Infinity, запрещённые отрицательные суммы и превышение точности. Persisted input не округляется. Frontend использует точную BigInt-арифметику; непредставимая в восьми USD-знаках конверсия отклоняется. Изменение только title/category сохраняет исходную сумму. Number используется для визуализации, а не как источник сохраняемых денег.

## 7. Pending Tasks

- Получить отдельное согласование следующей фазы; Phase 6 и deployment не начаты.
- Отдельно спроектировать перенос legacy Owner/финансовых записей, если он нужен. Новая регистрация всегда создаёт нового Owner; прежние записи автоматически не присваиваются.
- Перед production: shared rate limiter и утверждённая proxy/client-IP схема; TLS/cookie/origin configuration и дополнительная security-приёмка.
- При отдельном согласовании: recovery/password reset, email verification, MFA, breached-password checks и межвкладочная refresh-координация.
- Расширить браузерную регрессию всех CRUD, budget/preferences, фильтров/страниц, ошибок и mobile UX; 14 auth-сценариев не покрывают весь интерфейс.
- Рассмотреть bundle splitting и исправление pagination offset после удаления последней строки последней страницы.
- Backup/import/export/reset как продуктовые функции и перенос старого localStorage не реализованы; выполненный технический backup не заменяет эти функции.
- Локальные Phase 5 commits разрешены в задаче Git-финализации. Push, merge и deployment требуют отдельного разрешения и не выполнялись.

## 8. Known Issues

1. Production startup намеренно запрещён: limiter локален одному процессу, proxy/deployment contract не утверждён. Публичное размещение не разрешено.
2. Refresh сериализуется внутри вкладки, но не между вкладками. Одновременная ротация может вызвать reuse detection и повторный вход.
3. Password recovery, email verification и MFA отсутствуют. Автоматическая очистка истёкших sessions/refresh token rows не реализована. Legacy Owner остаётся unclaimed и недоступен новым аккаунтам без отдельного переноса.
4. После удаления последней строки последней страницы возможен пустой список до перехода `Previous`.
5. При потере ответа на mutation исход может быть неизвестен; серверной идемпотентности нет. Перед повторной отправкой следует проверить сохранённые записи.
6. Некоторые суммы display currency не конвертируются точно в восемь USD-знаков; такие значения отклоняются. Для точного ввода можно выбрать USD.
7. Build предупреждает о bundle >500 KB; pytest — о deprecated Starlette TestClient/httpx integration. Проверки проходят.
8. Старые финансовые localStorage-ключи не импортируются, не удаляются и не перезаписываются. Browser-local theme/rate cache сохраняется; legacy backup/import/reset controls отключены.
9. Model/finance/auth integration tests используют общий guarded Phase 5 fixture: отдельную явно разрешённую disposable БД, private manifest и схему `0003_auth`. Их нельзя направлять на development БД; текущий QA запускает только offline tests.
10. Общие маркетинговые формулировки README не подтверждают отдельный time-series chart, месячную историю бюджетов или самостоятельные financial goals — эти функции не реализованы.

## 9. Next Phase

Phase 5 закрыта для локальной разработки: финальные offline QA и независимое Reviewer review — PASS. Следующая фаза определяется отдельным решением пользователя. Автоматический запуск Phase 6, перенос legacy данных и deployment не разрешены.

## 10. How to Run

Команды выполняются из корня репозитория при уже установленном окружении. В текущей задаче зависимости и сервисы не устанавливались и не запускались. Полная конфигурация описана в [README.md](README.md) и [backend/README.md](backend/README.md).

Нужен существующий приватный `backend/.env`: `DATABASE_URL`, PostgreSQL variables, случайный `AUTH_JWT_SECRET` минимум 32 UTF-8 bytes, `APP_ENV=development`. Не заменяйте существующие credentials или signing key. `SINGLE_OWNER_ID` не нужен для доступа. Образец без реальных секретов — [backend/.env.example](backend/.env.example).

Если PostgreSQL уже здоров, повторный запуск не нужен. Для обычного отдельно разрешённого локального запуска инфраструктуры:

```sh
docker compose -p backend --env-file backend/.env -f backend/compose.yaml up -d --wait postgres
```

Ожидаются `backend-postgres-1`, `127.0.0.1:5434/finance_dashboard`, revision `0003_auth`. Миграции при старте не выполняются. Не применяйте миграции повторно и не меняйте схему без отдельного разрешения.

FastAPI в отдельном терминале:

```sh
backend/.venv/bin/uvicorn --app-dir backend app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-proxy-headers
```

Swagger: `http://127.0.0.1:8000/docs`; OpenAPI: `/openapi.json`; health: `/api/v1/health`, readiness: `/api/v1/health/ready`. Для auth POST в Swagger нужен CSRF header, описанный в backend README.

React в отдельном терминале:

```sh
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

UI: `http://127.0.0.1:5173`. Используйте одинаковый hostname frontend/API для SameSite cookies. CORS разрешает явно настроенные loopback origins; секреты в Vite variables не допускаются.

Offline проверки без БД:

```sh
RUN_DATABASE_TESTS=0 PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python -B -m pytest backend/tests -q -p no:cacheprovider
node --test tests/phase5-auth.test.mjs tests/phase4.test.mjs
npm run lint
./node_modules/.bin/tsc -b
npm run build
git diff --check
```

Не включайте `RUN_DATABASE_TESTS=1` для development БД. Live tests, регистрация и финансовые mutations меняют данные и требуют соответствующей изолированной цели и отдельного разрешения.
