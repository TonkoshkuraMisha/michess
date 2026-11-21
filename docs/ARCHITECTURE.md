<!-- --- FILE: docs/ARCHITECTURE.md --- -->

# Как устроен regence: что работает, как и откуда берётся

Путеводитель для владельца проекта и для разработчика: по каждому разделу сайта — что он делает, в каких файлах это
написано, откуда берутся данные и каким тестом это проверяется. Подробные правила каждого раздела записаны в начале
его модуля (докстринг); этот документ — карта, которая к ним ведёт. Состояние на 17.11.2026 (спринт 33).

Связанные документы: запуск — `QUICKSTART.md`, развёртывание — `DEPLOY.md`, работа с ветками — `WORKFLOW.md`, план и
история задач — `ToDo.md`, лицензии и источники — `ATTRIBUTION.md`, краткие правила для ИИ-помощника — `CLAUDE.md`.

## 1. Из чего состоит система

| Часть | Что это | Где код |
|---|---|---|
| Клиент | Одностраничное приложение: React 19, TypeScript, Vite, Tailwind | `frontend/src/` |
| API | FastAPI: HTTP-эндпоинты и один WebSocket для партий, лобби и уведомлений | `src/api/`, `src/main.py` |
| Сервисы | Правила и расчёты, не зависящие от HTTP | `src/services/` |
| База | PostgreSQL 16 через SQLAlchemy 2.0 (асинхронно), миграции Alembic | `src/models/`, `migrations/versions/` |
| Redis | Состояние идущих партий, лобби, присутствие, лимиты, кэш оценок, брокер Celery | ключи — в §3 |
| Фоновые задачи | Celery: очередь `analysis` (разбор партий, индекс позиций, напоминания) и `simulation` (партии ботов) | `src/worker/` |
| Движок | Stockfish, только через пул процессов | `src/services/engine_pool.py` |

В продакшене это девять сервисов `docker-compose.prod.yml`: `web` (nginx со статикой клиента и прокси к API), `api`,
`worker`, `worker-simulation`, `beat` (расписание Celery), `migrate`, `db`, `redis` и `backup`. Подробно —
`DEPLOY.md`.

## 2. Как проходит запрос

1. Клиент вызывает эндпоинт (`frontend/src/services/*.ts` — по файлу на раздел) или шлёт действие в WebSocket
   (`frontend/src/services/gameSocket.ts`). Компоненты в сеть сами не ходят: все сервисы зовут общий
   `services/http.ts` — `apiRequest` (ответ JSON) или `apiFetch` (ответ целиком: текст PGN, заголовки), `apiUrl` —
   адрес для ссылок. Он добавляет токен входа и Content-Type, а отказ превращает в `UiError` с текстом по коду
   сервера (`services/apiErrors.ts`); сеть недоступна — «нет связи».
2. Маршрут в `src/api/<раздел>.py` проверяет вход (`src/api/deps.py`), лимит запросов (`src/api/rate_limit.py`) и,
   если эндпоинт выдаёт оценку или ход движка, — правило честной игры (`src/api/fair_play.py`).
3. Маршрут вызывает сервис из `src/services/`; сервис читает и пишет базу через модели `src/models/`.
4. Ответ — данные и **коды**, не тексты. Отказ — код из реестра `src/core/errors.py` с параметрами; клиент собирает
   текст на языке игрока из каталогов `frontend/src/i18n/messages/{en,uk,ru}.ts`.

Список всех маршрутов собирает `src/main.py` (`create_app`); в разработке их видно на `/docs`.

**WebSocket** (`src/api/websockets.py`, адрес `/api/v1/ws/matchmaking`). Вход — по одноразовому тикету
(`POST /auth/ws-ticket`), не по токену в адресе. Каждое сообщение клиента — действие (`join_queue`, `make_move`,
`resign`, `offer_draw`, `berserk`, `chat_message` и другие): у каждого своя функция-обработчик в `ACTION_HANDLERS`,
лимит частоты по группам (`WS_RATE_LIMITS`) и короткая сессия базы на одно действие — соединение с базой
освобождается до отправки ответа в сеть (`ActionContext.release_db`).

## 3. Где лежат данные

### PostgreSQL (источник правды для всего, что должно сохраниться)

| Область | Таблицы | Модели |
|---|---|---|
| Игроки | `users`, `email_tokens`, `user_achievements`, `product_events` | `user.py`, `email_token.py`, `achievement.py`, `product_event.py` |
| Партии | `games`, `moves`, `imported_games` | `game.py`, `move.py`, `imported_game.py` |
| Дебюты и позиции | `position_stats`, `position_games`, `repertoires`, `repertoire_moves`, `repertoire_cards` | `position.py`, `repertoire.py` |
| Задачи и тренировки | `puzzles`, `puzzle_themes`, `puzzle_attempts`, `theme_progress`, `personal_puzzles`, `defense_drills`, `drill_records`, `guess_positions`, `lesson_progress`, `trainer_results`, `exam_results` | `puzzle.py`, `guess.py`, `lesson.py`, `trainer.py` |
| Боты | `bot_personalities`, `bot_opening_stats`, `bot_ratings`, `bot_rivals`, `bot_rival_stats`, `bot_tunings`, `bot_tuning_log`, `ladder_beaten` | `personality.py`, `bot_memory.py`, `ladder.py` |
| Турниры с ботами | `tournaments`, `tournament_players`, `tournament_games` | `tournament.py` |
| Арены между людьми | `arenas`, `arena_players`, `arena_games`, `arena_reminders`, `arena_awards` | `arena.py` |
| Команды | `teams`, `team_members` | `team.py` |
| Библиотека и архив | `library_collections`, `library_games`, `library_game_collections`, `library_annotations`, `collection_entries` | `library.py`, `collection.py` |
| Общение | `follows`, `notifications`, `direct_messages`, `blocks`, `hidden_conversations`, `posts`, `post_comments`, `post_likes`, `reports`, `study_materials` | `social.py`, `moderation.py`, `study.py` |
| Бета | `invites`, `feedback` | `beta.py` |

Схему меняют только миграции (`migrations/versions/`); CI применяет их на пустой базе и командой `alembic check`
сверяет с моделями. Отчёт о состоянии схемы и открытые решения по ней — `docs/db-audit-2026-11-17.md`.

### Redis (то, что живёт недолго или должно быть общим для нескольких процессов API)

| Что | Ключи | Кто пишет |
|---|---|---|
| Состояние идущей партии: позиция, часы, версия, предложение ничьей, берсерк, расход квоты лага | `game:{id}:state`, `game:{id}:commands`, `game:{id}:moves` | `game_state.py` |
| Какие партии идут и когда у каждой ближайший срок (флаг, неявка, брошенная партия) | `active_games`, `game_deadlines`, `games:pending_finish`, `user:{id}:current_game` | `game_state.py` |
| Лобби и приватные вызовы | `queue:prefs:{id}` и ключи очереди | `matchmaker.py` |
| Присутствие и зрители | `presence:user:{id}`, `game:{id}:spectators`, каналы `user:{id}` | `connection_manager.py` |
| Ожидание пары в арене | `arena:{id}:waiting` | `arena.py` |
| Долгий вход | `refresh:<хэш>` | `auth_sessions.py` |
| Сессии честной партии (лестница, турнир) и запросы движка во время партии | ключи `fairplay:*`, сессии лестницы | `fair_play.py`, `ladder.py` |
| Кэш оценок позиций, ответы эндшпильных таблиц, активная задача игрока, комнаты разбора | — | `move_check.py`, `tablebase.py`, `puzzles.py`, `study_room.py` |
| Лимиты запросов | — | `rate_limit.py` |

Партия пишется в базу по ходу игры (`sync_authoritative_state_to_db`) и окончательно — при завершении; если состояние
в Redis пропало, оно восстанавливается из базы (`_recover_state_from_db`). Долгие сессии входа снимком базы не
покрываются: сброс Redis выводит всех из них.

### Файлы в репозитории

| Файл | Что в нём | Чем собран |
|---|---|---|
| `data/puzzles/lichess_subset.csv.gz`, `lichess_themes_extra.csv.gz` | Выборка задач открытой базы lichess (CC0) | `scripts/dev/build_puzzle_subset.py`, `build_theme_extra.py` |
| `data/puzzles/defense_drills.csv.gz` | Защитные упражнения | `scripts/dev/build_defense_drills.py` |
| `data/drills/seeds.json` | Проверенные позиции упражнений-генераторов | `scripts/dev/build_drill_seeds.py` |
| `src/services/data/openings.tsv` | Таблица дебютов (CC0) | `scripts/build_openings.py` |
| `src/services/data/level_exams.json` | Экзамены уровней Большого курса | `scripts/build_level_exams.py` |
| `src/services/bots/books/*.json` (22) | Дебютные книги ботов из партий мастеров | `scripts/build_opening_books.py`, `build_master_books.py` |
| `src/services/bots/calibration.json` | Измеренная сила ботов | `scripts/calibrate_bots.py` |
| `src/services/civility_lexicon.txt` | Словарь фильтра оскорблений | вручную |
| `frontend/src/content/endgames.json` | Упражнения эндшпильного тренажёра, сверенные с таблицами | `scripts/build_endgames.py` |
| `frontend/src/content/lessons/*.json` | Уроки школы на трёх языках | вручную; проверка — `validate.ts` и `scripts/verify_lessons.py` |
| `frontend/src/i18n/messages/{en,uk,ru}.ts` | Все тексты интерфейса на трёх языках | вручную; ключи сверяет тест |

Задачи загружает в базу сервис `migrate` при каждом развёртывании (`scripts/import_puzzles.py`). Партии библиотеки
владельца и архив мастеров в репозиторий не входят — их загружают скрипты (`DEPLOY.md`, раздел 9).

### Внешние сервисы

Сервер обращается наружу только в четырёх случаях: эндшпильные таблицы (`TABLEBASE_URL`, уходит только позиция),
импорт партий игрока с lichess и chess.com (уходит ник, который игрок ввёл сам), почта по SMTP, Sentry (если задан
`SENTRY_DSN`). Что именно и кому — `ATTRIBUTION.md`, раздел «Внешние сервисы».

## 4. Разделы сайта

У каждого раздела: что делает → файлы → откуда данные → чем проверяется. Имена тестов — файлы `tests/test_<имя>.py`.

### 4.1. Вход и учётная запись

- **Что.** Регистрация по имени и паролю, вход, долгая сессия, смена пароля, необязательный e-mail со сбросом
  пароля, выгрузка своих данных, удаление аккаунта (анонимизация: партии остаются у соперников без имени).
- **Файлы.** `src/api/auth.py`, `src/api/account.py`, `src/core/security.py` (хэш пароля, JWT),
  `src/services/auth_sessions.py`, `email_links.py`, `mailer.py`, `account.py`, `onboarding.py`, `legal.py` (согласие с условиями при регистрации, `/privacy`); клиент —
  `services/authToken.ts`, `services/account.ts` (вход, регистрация, почта, пароль, выгрузка, удаление),
  `components/AuthModal.tsx`, `components/Settings.tsx`, `components/EmailLinkPages.tsx`.
- **Как.** Короткий access-токен (15 минут) живёт только в памяти страницы; долгий вход держит refresh-токен в cookie
  HttpOnly, в Redis хранится только его хэш. Смена пароля и «выйти везде» увеличивают `users.token_version` — все
  прежние токены перестают действовать.
- **Тесты.** `auth_sessions`, `auth_hardening`, `token_lifecycle`, `account`, `email_links`, `onboarding`.

### 4.2. Партия между людьми

- **Что.** Лобби с вызовами, автоподбор, приглашение по ссылке, рейтинговые и товарищеские партии, часы с добавкой,
  предходы, ничья, сдача, реванш, зрители, чат, фора, шахматы Фишера.
- **Файлы.** `src/api/websockets.py` (действия), `src/services/matchmaker.py` (лобби и старт партии),
  `game_state.py` (позиция, часы, завершение), `game_engine.py` (правила: легальность, итог, флаг), `rating.py`,
  `connection_manager.py`, `odds.py`, `chess960.py`; клиент — `components/Chessboard.tsx` и хуки в
  `components/chessboard/hooks/` (`useGameSocket.ts`, `useClock.ts`, `usePremoves.ts`).
- **Как идёт ход.** `make_move` → `GameStateManager.process_atomic_move`: в одной транзакции Redis (WATCH/MULTI)
  проверяются очередь хода, версия состояния и легальность, списывается время, записывается новая позиция. Один и тот
  же ход, присланный дважды, применяется один раз (`command_id`). Затем ход рассылается обоим игрокам и зрителям.
- **Часы.** Время идёт только у стороны, которая ходит, и считается сервером от момента предыдущего хода; разрыв
  связи часы не останавливает. **Квота лага:** клиент сообщает, сколько думал над ходом; разницу с временем сервера
  (задержку сети) сервер возвращает игроку — не больше 300 мс за ход и 2 с за партию (`LAG_PER_MOVE_MS`,
  `LAG_PER_GAME_MS`), и флаг падает с отсрочкой на остаток квоты.
- **Конец партии.** Мат, пат и ничьи по правилам определяет `game_engine.py`; флаг, неявку на первый ход (30 с) и
  брошенную партию (игрок отключён 3 минуты) — цикл `check_timeouts_loop`, который ведёт один процесс-лидер. Завершить
  партию может только один из претендентов (`claim_game_end`). Итог пишет `finish_game`: рейтинг, архив, телеметрия
  античита, очки арены, индекс позиций и разбор — в фоне.
- **Рейтинг.** Отдельный для пули, блица, рапида и классики; категория — по оценке длительности «база + 40 × добавка»
  (границы 3, 8 и 25 минут). Формула Эло, K = 40 первые 30 партий в категории, затем 20, от 2400 — 10.
- **Тесты.** `game_state`, `game_moves_server`, `game_end_atomicity`, `game_end_reconciliation`, `disconnect_clock`,
  `timeouts_loop`, `multiworker`, `matchmaking_rules`, `rating_categories`, `casual_games`, `odds_pvp`,
  `chess960_pvp`, `ws_rate_limit`, `ws_db_sessions`, `arena_berserk_lag` (квота лага); браузер — `e2e/pvp-game.e2e.ts`.

### 4.3. Честная игра и античит

- **Правило.** Во время своей рейтинговой партии игрок не получает от сервера оценок и ходов движка: все такие
  эндпоинты закрыты зависимостью `forbid_engine_help_during_game` (`src/api/fair_play.py`). Список эндпоинтов —
  `CLAUDE.md`, правило 2. Запрос без токена с адреса, с которого сейчас кто-то играет, тоже получает отказ.
- **Античит** (`src/services/anticheat.py`). После партии по телеметрии ходов считается штраф к фактору доверия
  игрока (`users.trust_factor`, начинается со 100): ровный «машинный» ритм ходов по часам сервера — основной сигнал,
  потеря фокуса окна только усиливает его. Ниже 30 — флаг `is_cheater` и заявка модератору на проверку; решает
  человек (`src/services/moderation.py`), игрок может подать апелляцию.
- **Телеметрия ходов** (таблица `moves`) — только буфер для античита: сводка по сторонам сразу пишется в
  `games.telemetry_summary`, а сырые строки удаляет плановая задача `archive_move_telemetry` через 90 дней после
  партии (срок апелляции, `src/services/telemetry_retention.py`).
- **Тесты.** `fair_play`, `anticheat`, `engine_endpoints`, `moderation`, `telemetry_retention`.

### 4.4. Движок Stockfish

- **Правило.** Движок вызывается только через `get_engine_pool(path).acquire()` (`src/services/engine_pool.py`): не
  больше `ENGINE_POOL_SIZE` процессов, запрос сверх предела ждёт и получает отказ «пул занят», а не новый процесс.
- **Кто им пользуется.** Ход бота, разбор партии, наставник, «найти мат», симуляция турниров, проверка задач.
  Время работы по видам — метрика `regence_engine_seconds_total{kind}`.
- **В тестах и CI движка нет:** расчёты проверяются на подменах или на статическом анализаторе с фиксированным seed.
- **Тесты.** `stockfish_engine`, `engine_budget`, `engine_info`.

### 4.5. Разбор партии и наставник

- **Что.** Разбор всей партии (точность, ошибки, график оценки), объяснение хода словами, подсказка по ступеням,
  игра с наставником (проверка каждого своего хода), итог партии, «не согласен» с оценкой.
- **Файлы.** `src/api/analysis.py`, `src/services/analysis_service.py` (оценка каждого хода движком),
  `mentor_service.py` (детектор мотивов по правилам, без движка), `positional.py` (позиционные признаки), `coach.py`
  (сборка объяснения), `move_check.py` (проверка хода и кэш оценок), `game_summary.py`; клиент —
  `components/GameViewer.tsx`, `chessboard/CoachPanel.tsx`, хук `useCoachMode.ts`.
- **Откуда текст.** Сервер отдаёт факты: код мотива, поля, фигуры, ключ шаблона. Предложение собирает клиент из
  каталога `coach.*`. Главный принцип детектора — ложное объяснение хуже молчания.
- **«Клубный тренер» после партии.** В итоге партии (`chessboard/GameSummaryPanel.tsx` → `CoachCards.tsx`) до трёх
  карточек: задача из самой дорогой своей ошибки (решается прямо в панели), отклонение от репертуара (тренировать
  или добавить ответ), урок Большого курса по теме ошибки. Сервер собирает готовое без движка
  (`src/services/coach_cards.py`, `GET /learn/after-game/{id}`: таблица `personal_puzzles`, репертуары игрока);
  модуль курса по теме выбирает клиент (`services/coachCards.ts`, данные `content/supercourse.ts`).
- **Тесты.** `analysis_service`, `mentor_motifs`, `mentor_pins`, `positional`, `coach`, `coach_mode`, `game_summary`,
  `coach_cards`; клиент — `CoachCards.test.tsx`.

### 4.6. Боты

- **Кто есть.** Семь исторических ботов первой волны (Филидор … Цукерторт, `src/services/bots/<имя>.py`), мастера
  второй волны (`masters.py`; всего ботов с дебютной книгой — 22), мастера прошлого для «Машины времени»
  (`guests.py`, 230 человек), вымышленные архетипы мастерской (`archetypes.py`, 22) и соперники, собранные игроком
  из ползунков (`personality.py`, таблица `bot_personalities`). Числа — на 17.11.2026.
- **Как бот выбирает ход** (`bots/base.py`, `style.py`). Оценку позиции даёт только Stockfish (до 8 лучших линий).
  Стиль не меняет оценку: он начисляет бонусы кандидатам внутри окна от лучшего хода и так выбирает «по вкусу».
  В дебюте бот играет по книге из партий своего прототипа. Сила ограничивается через `UCI_Elo`, ниже 1320 —
  управляемыми ошибками. Время «раздумья» имитируется.
- **Сила** — измеренная: `scripts/calibrate_bots.py` играет матчи с эталонами Stockfish и пишет
  `calibration.json`. **Память** (`memory.py`): итоги своих дебютов и рейтинг по партиям с людьми. **Самоигра**
  (`selfplay.py`, задача beat раз в 6 часов): архетипы подстраивают разброс под заявленную силу, каждый шаг — в
  открытом журнале `bot_tuning_log`.
- **Тесты.** `<имя>_bot` для каждого исторического бота, `style_presets`, `personality_bot`, `bot_strength`,
  `bot_memory`, `bot_selfplay`, `masters`, `masters_catalog`, `beginner_opponents`.

### 4.7. Лестница, турниры с ботами, «Машина времени»

- **Лестница** (`src/services/ladder.py`): все исторические боты и все архетипы, включая соперников для новичков,
  по возрастанию измеренной силы, и отдельный рейтинг. Прогресс — пройденные ступени по ключу соперника (таблица
  `ladder_beaten`), текущая — первая непройденная выше самой сильной пройденной; новый соперник ничей прогресс не
  сдвигает (ниже пройденного он «пропущен»). Честность партии проверяет сервер: запрос подсказки, возврат хода или
  подмена соперника — партия не засчитывается.
- **Турниры** (`tournaments.py`, правила — `tournament_rules.py`): круговые (таблицы Бергера) и на выбывание.
  Партии ботов между собой играет отдельный воркер (`tournament_simulation.py`, очередь `simulation`). Результат
  партии игрока приходит только из сохранения сыгранной партии — прислать его самому нельзя.
- **Карьера** (`tournament_career.py`) — лестница готовых турниров нарастающей силы. **«Машина времени»**
  (`time_machine.py`, 50 турниров) — знаменитые турниры прошлого в полном историческом составе плюс игрок; составы
  и настоящие итоги сверены с открытыми источниками скриптами `scripts/dev/time_machine/` (порядок добавления
  турнира — `scripts/dev/time_machine/README.md`).
- **Тесты.** `ladder`, `tournaments`, `tournament_rules`, `tournament_play`, `tournament_simulation`,
  `tournament_career`, `tournament_big`, `time_machine`, `time_machine_play`; браузер — `e2e/time-machine.e2e.ts`.

### 4.8. Арены между людьми и конференции

- **Что.** Турниры по времени: игрок играет партию за партией с теми, кто тоже ждёт. Победа — 2 очка, ничья — 1;
  после двух побед подряд очки удваиваются («огонь»). Есть швейцарки по турам.
- **Файлы.** `src/services/arena.py` (правила), `arena_schedule.py` (расписание), `conferences.py` (конференции),
  `src/api/arenas.py`, `src/api/conferences.py`; клиент — `components/arena/`.
- **Честный конец.** Новые пары создаются только до «последнего старта» (конец минус длительность партии), итоги —
  когда доиграна последняя партия. Неявка на первый ход — поражение; ничья по соглашению до 10-го хода — 0 очков.
- **Вход открыт всем.** В любую арену входит любой зарегистрированный игрок: порога сыгранных партий и арен
  «только до такого-то рейтинга» нет (решение владельца 17.11.2026) — новичок может встретиться с сильнейшим.
  Закрыт вход только игроку с флагом нечестной игры. При 500 участниках открывается следующее деление — это
  вместимость таблицы, а не отбор.
- **Награды** (`arena_awards.py`, таблица `arena_awards`): когда итоги окончательные, тройка таблицы (сыгравшие хотя
  бы одну партию) получает места — уведомление, кубки в профиле, достижения «призёр арены» и «победитель арены».
  Раздаёт плановая задача `arena_awards` каждые 5 минут. Страница арены отдаёт призёру его место
  (`me.podium_place`, `arena_awards.place_of`), а любому игроку — `me.username`; клиент один раз показывает экран итогов
  (`TournamentCelebration`: кубок призёру, значок места остальным, таблица участников со своей строкой, скачивание CSV).
- **Лига месяца** (`arena_league.py`, `GET /arenas/league`, блок под списком на `/arenas`): сумма очков арен сезона
  (календарный месяц UTC) в категории контроля; швейцарки не входят, категории — те, где расписание ставит арены
  (пуля, блиц). Порядок: очки, лучшая арена, меньше арен. Считается при запросе, на рейтинг не влияет.
- **Берсерк.** До своего первого хода — половина времени без добавки; победа приносит лишнее очко.
- **Расписание.** У каждой из пяти конференций — своя зона времени, план задан в её местном времени: вечером блиц
  3+2 каждый час, пуля 2+1 и вечерняя 5+3, в остальное время — блиц раз в три часа, плюс швейцарки. Арены создаются
  при запросе списка на 6 часов вперёд. Напоминание о начале — задача beat раз в минуту.
- **Конференции.** Страну игрок указывает сам (`users.country`); страна определяет конференцию (250 кодов в
  `conferences.COUNTRIES`). Конференция запоминается при входе в арену; в зачёт арены идут 10 лучших игроков
  конференции; Кубок конференций — сумма зачётов арен месяца. Смена конференции — раз в сезон.
- **Матчи конференций** (`conference_match_rules.py` — чистые правила, формат арены `match` в `arena.py`): каждую
  субботу две конференции по кругу (10 пар, хозяин чередуется по кругам), общий вечер или 19:00 хозяина. Записаться —
  только игрокам двух конференций, до часа перед стартом; на старте составы по рейтингу (`arena_players.board`), два
  тура 5+3 (на доске белыми и чёрными), счёт — победа 1, ничья ½ (`match_view`). Матчи создаются на 8 дней вперёд
  (`ensure_schedule`), список — на `/conferences`, страница матча — `/arenas/{id}`. Кубков за матч нет.
- **Тесты.** `arena`, `arena_swiss`, `arena_fair_end`, `arena_groups`, `arena_berserk_lag`, `arena_schedule`,
  `conferences`, `arena_league`, `conference_matches`. Замысел и решения владельца — `docs/research/arenas.md`.

### 4.9. Задачи и тренажёры

- **Задачи** (`src/services/puzzles.py`, `src/api/puzzles.py`). Решение клиенту не отправляется: сервер хранит, на
  каком ходу решающий, проверяет каждый ход и отвечает ходом соперника. Рейтинг решателя — Эло против рейтинга
  задачи. Источник — открытая база lichess (CC0), темы размечены по реестру `themes.py` (125 тем в 12 разделах,
  описание — `docs/training/tactical-themes.md`).
- **Свои ошибки** (`personal_puzzles.py`): из разбора своих партий, с повторением через 1, 3, 7 и 21 день.
- **Защита** (`defense_drills.py`), **упражнения-генераторы** (`drill_generator.py`, `generated_drills.py` —
  позиции строятся по seed и проверяются перебором), **матовые конструкции** (`mate_course.py`, `mate_patterns.py`),
  **«Угадай ход мастера»** (`guess.py`, отбор позиций — `guess_selection.py`), **миниатюры** и **«Узнай структуру»**.
- **Тренажёры зрения, памяти и счёта** считаются на клиенте (`frontend/src/trainers/`), сервер хранит результаты
  (`src/api/trainers.py`, таблица `trainer_results`); учебные мини-игры — `mini_games.py`; с
  другом по ссылке — комнаты `mini_game_rooms.py` (Redis, опрос раз в секунду, `/train/games/room/{code}`).
- **Тесты.** `puzzles_api`, `puzzles_data`, `themes`, `theme_training`, `theme_detectors`, `personal_puzzles`,
  `defense_drills`, `generated_drills`, `mate_course`, `mate_patterns`, `guess_api`, `guess_selection`, `trainers`,
  `mini_games`, `mini_game_rooms`, `miniatures`, `structure_quiz`; браузер — `e2e/puzzles.e2e.ts`, `puzzle-moves.e2e.ts`.

### 4.10. Школа, Большой курс, план тренировок

- **Уроки** — файлы данных клиента: `frontend/src/content/lessons/*.json` (формат — `format.ts`, проверка —
  `validate.ts`, список курсов — `courses.json`), компоненты — `components/learn/`. Сервер хранит только прогресс
  (`lesson_progress`). Легальность ходов уроков проверяет тест клиента, ответы сверяет с движком
  `scripts/verify_lessons.py`.
- **Большой курс** (`content/supercourse.ts`, замысел — `docs/research/supercourse.md`): уровни 0–5 по разрядам и
  ветви; шаг курса ведёт в уже готовый раздел. Экзамены уровней — `level_exam.py`, диагностика — `exam.py`.
  **Автозачёт:** `GET /learn/course-progress` (`src/services/course_progress.py`) собирает выполненное по нормативам
  (записи `lesson_progress`, ступени тем `theme_progress`, попытки `trainer_results`, оценки `exam_results`); клиент
  (`services/courseProgress.ts`) сопоставляет его с шагами модуля и закрывает модуль сам. Вручную отмечаются только
  модули без проверяемых шагов.
- **Личный тренер:** карта навыков (`skills.py`), ежедневная разминка (`workout.py`, напоминание — задача beat в
  16:00 UTC), программы тренировок (`content/programs.ts`). Новых таблиц нет: всё считается по уже собранным данным.
- **Тесты.** `learn_progress`, `course_progress`, `exam`, `level_exams`, `skills`, `workout`; клиент —
  `courseProgress.test.ts`, `SupercoursePage.test.tsx`; браузер — `e2e/course-library.e2e.ts`.

### 4.11. Дебюты

- **Таблица дебютов** (`openings.py`, данные `openings.tsv`): дебют определяется по позиции, поэтому перестановки
  ходов распознаются. **Индекс позиций** (`position_index.py`): первые 30 полуходов каждой законченной партии —
  в `position_stats` и `position_games`; партии библиотеки — только в `position_library_games` (примеры, без
  статистики). **Справочник** (`opening_explorer.py`) — ходы из позиции со статистикой и партии мастеров: архив и
  публичные коллекции библиотеки; повтор (те же фамилии и год) показывается один раз — партией библиотеки.
- **Репертуар** (`repertoire.py`, `repertoire_drill.py`, `repertoire_deviations.py`, `repertoire_starters.py`): свои
  линии как граф позиций, повторение по расписанию SM-2, игра против репертуара, разбор отклонений в сыгранной партии.
- **Тесты.** `opening_explorer`, `explorer_library`, `position_index`, `repertoire`, `repertoire_drill`, `repertoire_deviations`,
  `repertoire_advanced`.

### 4.12. Архив, библиотека, просмотр, импорт

- **Архив чемпионов** — исторические партии из PGN (`src/db/seed.py`); их игроки хранятся в `users` с признаком
  `is_bot` и без `username_key`. **«Просмотр»** (`src/api/watch.py`): идущие партии, архив с фильтрами, «Партия дня»,
  «забавные подборки» (`collections.py`, таблицу заполняет `scripts/build_collections.py`).
- **Библиотека партий** (`library.py`): дерево коллекций, видимость (публичная, владельца, служебная). При импорте
  берутся только заголовки и главная линия — комментарии и варианты из изданий не берутся. Разметка пешечных
  структур — `pawn_structures.py`. Правила работы с материалами — `docs/research/books-library-review.md`,
  аннотации — `docs/research/library-annotations.md`.
- **Импорт своих партий** с lichess и chess.com (`game_import.py`): по нику через открытые API или вставкой PGN.
- **Тесты.** `library`, `library_text`, `library_annotations`, `pawn_structures`, `cbh_reader`, `watch`,
  `game_import`, `pgn_normalization`.

### 4.13. Общение

- **Игроки и уведомления** (`src/api/social.py`, `notifications.py`): поиск, подписки, вызов на партию, центр
  уведомлений (запись в базе и доставка в открытые вкладки по WebSocket).
- **Личные сообщения** (`direct_messages.py`), **лента** (`feed.py`), **карточки-вложения** (`attachments.py` —
  сервер проверяет ссылку и сохраняет снимок данных на момент отправки).
- **Уважительное общение** (`civility.py`): фильтр по словарю до отправки, придержание, квоты новичкам и
  нарушителям. Автоматика только помечает — решает модератор (`moderation.py`, страница `/moderation`).
- **Совместный разбор** (`study_room.py`): комната в Redis, ведущий управляет доской. **Команды и лига**
  (`league.py`): сезон — календарный месяц, очки — за партии между игроками разных команд.
- **Достижения** (`achievements.py`) — только за реальные результаты, считаются по уже имеющимся данным.
- **Тесты.** `social`, `direct_messages`, `feed`, `civility`, `moderation`, `study_room`, `league`, `achievements`.

### 4.14. Языки, оформление, приложение на телефоне

- **Три языка** (en, uk, ru). Ни одной строки для игрока в коде сервера и в разметке компонентов: сервер отдаёт
  коды, клиент — тексты из каталогов. Проверяют тесты `no_russian_in_api`, `error_codes`, `bot_content_keys` и тесты
  каталогов на клиенте (одинаковые ключи и параметры во всех трёх языках).
- **Оформление:** доски, наборы фигур, темы-комплекты, фоны, звуки (`frontend/src/config/boardAppearance.ts`,
  `themePresets.ts`, `services/soundEngine.ts`). Каждый ассет — со свободной лицензией и записью в `ATTRIBUTION.md`
  (тест `assets_licensing`).
- **Установка на телефон:** сервис-воркер и манифест (`services/pwa.ts`, `public/sw.js`).

### 4.15. Наблюдение за системой и бета

- **Журналы** (`src/core/logging_setup.py`, `src/api/client_errors.py`, `scripts/trace_logs.py`; клиент —
  `services/breadcrumbs.ts`, `services/clientErrors.ts`): json-строки с контекстом `request_id` / `user_id` / `game_id`,
  сквозной номер запроса клиент ↔ API ↔ воркер, отчёты страницы об ошибках и перезагрузках со следом событий.
- **Ошибки и метрики** (`src/core/observability.py`): Sentry при заданном `SENTRY_DSN`, метрики Prometheus на
  `/metrics` (наружу не публикуются). **Продуктовые метрики** без сторонних трекеров (`product_metrics.py`, отчёт —
  `scripts/product_metrics.py`). **Прозрачность:** журналы калибровки ботов и открытый API (`src/api/public.py`).
- **Бета** (`beta.py`): коды-приглашения, «Сообщить о проблеме», еженедельная сводка.
- **Тесты.** `observability`, `product_metrics`, `public_api`, `beta`, `deploy_config`.

## 5. Фоновые и плановые задачи

Задачи — `src/worker/tasks.py`, очереди и расписание — `src/worker/celery_app.py`.

| Задача | Очередь | Когда |
|---|---|---|
| `analyze_game`, `analyze_imported_game` | `analysis` | после завершения партии или импорта |
| индекс позиций партии | `analysis` | после завершения партии |
| `simulate_tournament_game` | `simulation` | партии ботов в турнире |
| `workout_reminders` | `analysis` | beat, раз в день в 16:00 UTC |
| `bot_selfplay` | `simulation` | beat, каждые 6 часов |
| `arena_reminders` | `analysis` | beat, каждую минуту |

Постановка задачи из API не ждёт брокер (`src/services/task_dispatch.py`): итог партии рассылается сразу, а при
недоступном брокере разбор можно посчитать позже кнопкой на странице партии.

## 6. Клиент

- `frontend/src/App.tsx` — шапка, меню и все маршруты (их около 60).
- `components/Chessboard.tsx` — главная доска: партия с человеком, с ботом и свободный анализ; логика вынесена в
  хуки `components/chessboard/hooks/`. Слева — кнопка «Новая партия» (окно по шагам `chessboard/NewGameDialog.tsx`:
  соперник, время, старт), идущая партия, соперник-бот, турниры и лобби; справа — вкладки «Ходы / Чат / Наставник /
  Рентген». Доступность (26.3): клетки — кнопки с подписью, ход с клавиатуры (Tab на доску, стрелки, Enter/пробел),
  ходы объявляются словами в живой области и есть «Позиция словами» (`chessboard/BoardSpeech.tsx`); слова —
  `services/a11y/speech.ts` (ключи `a11y.*`). В игре вслепую скрытые фигуры не называются.
- `components/ui/` — общие компоненты дизайна (страница, карточки, кнопки, метки, вкладки, окно); правила —
  `docs/design-system.md`, витрина — `/design`.
- `components/<раздел>/` — страницы разделов; `services/<раздел>.ts` — обращения к API этого раздела, все — через
  `services/http.ts` (профиль — `profile.ts`, учётная запись — `account.ts`, просмотр и разбор партии —
  `analysis.ts`, лестница — `ladder.ts`, шахматы Фишера — `chess960.ts`, экзамены — `exam.ts`);
  общие правила без сети тоже лежат здесь: дата партии `gameDates.ts`, нумерация ходов `moveNumbers.ts`;
  клавиатура доски — `chessboard/hooks/useBoardKeyboard.ts` (главная доска и доски задач), чат партии —
  `chessboard/gameChat.ts` (главная доска и партия 960); лимиты текстов — `config/textLimits.ts`;
  `config/` — данные оформления и ботов; `content/` — учебное содержание; `trainers/` — логика тренажёров.
- `i18n/` — три каталога сообщений и функции перевода; `test/` — общие заготовки тестов.

## 7. Правила, которые нельзя нарушать, и чем они проверяются

| Правило | Проверка |
|---|---|
| Ни одной строки для игрока на сервере и в разметке компонентов | `tests/test_no_russian_in_api.py`, тесты каталогов клиента |
| Коды ошибок сервера и каталоги клиента совпадают | `tests/test_error_codes.py` |
| Эндпоинты с движком закрыты во время партии | `tests/test_fair_play.py`, `test_engine_endpoints.py` |
| Движок — только через пул, с пределом процессов | `tests/test_engine_endpoints.py`, `test_engine_budget.py` |
| Модели и миграции совпадают | `alembic check` в CI |
| Ассеты — со свободной лицензией и записью в `ATTRIBUTION.md` | `tests/test_assets_licensing.py` |
| Вёрстка не ломается на телефоне и на трёх языках | `frontend/e2e/layout.e2e.ts` |
| Вход в арену открыт любому зарегистрированному игроку (никакого отбора по силе) | `tests/test_arena_groups.py` |

## 8. Как убедиться самому

    uv run python project_status.py                 # сводка: git, план, миграции, калибровка ботов
    uv run ruff check . --quiet                     # линтер
    uv run mypy                                     # проверка типов
    uv run python -m pytest -q --tb=short           # все тесты сервера (движок и сеть не нужны)
    uv run pytest tests/test_arena.py -q            # один раздел: имя теста — из §4
    cd frontend && npm run lint && npx vitest run --reporter=dot && npm run build

Чтобы проследить раздел от кнопки до базы: открыть его страницу в `frontend/src/components/`, найти вызов в
`frontend/src/services/`, по адресу — маршрут в `src/api/`, по маршруту — сервис в `src/services/`. В начале каждого
сервиса написано, по каким правилам он работает и откуда берёт данные.
