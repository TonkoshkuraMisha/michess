PROJECT: michess
ROOT: C:\Users\tonko\PycharmProjects\michess
FILES INCLUDED: 149
PARTS: 15 (target <= 80 KiB per part)

UPLOAD ALL PARTS IN NUMERICAL ORDER (snapshot_001.txt .. snapshot_00N.txt).

TABLE OF CONTENTS BY PART:

--- snapshot_001.txt (71.1 KiB) ---
  - ToDo.md
  - requirements.txt
  - pytest.ini
  - alembic.ini
  - docker-compose.yml
  - .github/workflows/ci.yml
  - frontend/package.json
  - frontend/vite.config.ts
  - frontend/tsconfig.json
  - migrations/env.py
  - migrations/README
  - migrations/script.py.mako
  - migrations/versions/3605cc4e4cfc_add_time_controls_to_game.py
  - migrations/versions/4101ce4b6d90_authoritative_game_state_and_move_.py
  - migrations/versions/af5330e8cef6_init_tables.py
  - migrations/versions/c8a91e2f4b10_add_analysis_json_to_game.py
  - migrations/versions/d9f4a1b2c3e4_add_metadata_columns_to_games.py
  - migrations/versions/e5b7c9d1a2f3_add_username_key_to_users.py
  - migrations/versions/f6c8d0e2b3a4_add_token_version_to_users.py
  - src/__init__.py
  - src/api/analysis.py
  - src/api/auth.py

--- snapshot_002.txt (73.5 KiB) ---
  - src/api/bots.py
  - src/api/deps.py
  - src/api/profile.py
  - src/api/rate_limit.py
  - src/api/websockets.py

--- snapshot_003.txt (67.4 KiB) ---
  - src/core/config.py
  - src/core/instance.py
  - src/core/security.py
  - src/db/redis.py
  - src/db/seed.py
  - src/db/session.py
  - src/main.py
  - src/models/__init__.py
  - src/models/base.py
  - src/models/game.py
  - src/models/move.py
  - src/models/user.py
  - src/schemas/analysis.py
  - src/schemas/user.py
  - src/services/__init__.py
  - src/services/analysis_service.py
  - src/services/anticheat.py
  - src/services/bots/__init__.py
  - src/services/bots/anderssen.py

--- snapshot_004.txt (77.8 KiB) ---
  - src/services/bots/base.py
  - src/services/bots/books/anderssen.json
  - src/services/bots/books/labourdonnais.json
  - src/services/bots/books/morphy.json
  - src/services/bots/books/paulsen.json
  - src/services/bots/books/philidor.json
  - src/services/bots/books/staunton.json
  - src/services/bots/books/zukertort.json
  - src/services/bots/labourdonnais.py
  - src/services/bots/morphy.py
  - src/services/bots/paulsen.py
  - src/services/bots/philidor.py
  - src/services/bots/staunton.py
  - src/services/bots/zukertort.py
  - src/services/connection_manager.py
  - src/services/engine_pool.py

--- snapshot_005.txt (63.5 KiB) ---
  - src/services/game_engine.py
  - src/services/game_state.py

--- snapshot_006.txt (70.1 KiB) ---
  - src/services/matchmaker.py
  - src/services/rating.py
  - src/services/task_dispatch.py
  - src/worker/celery_app.py
  - src/worker/tasks.py
  - tests/conftest.py
  - tests/integration/test_real_backends.py
  - tests/test_analysis_service.py
  - tests/test_anderssen_bot.py
  - tests/test_anticheat.py
  - tests/test_audit_fixes.py

--- snapshot_007.txt (74.8 KiB) ---
  - tests/test_audit_followups_rules.py
  - tests/test_auth_hardening.py
  - tests/test_deploy_config.py
  - tests/test_disconnect_clock.py
  - tests/test_engine_endpoints.py
  - tests/test_game_end_atomicity.py
  - tests/test_game_end_reconciliation.py
  - tests/test_game_engine.py
  - tests/test_game_state.py
  - tests/test_labourdonnais_bot.py
  - tests/test_matchmaking_rules.py
  - tests/test_morphy_bot.py

--- snapshot_008.txt (76.4 KiB) ---
  - tests/test_multiworker.py
  - tests/test_paulsen_bot.py
  - tests/test_philidor_bot.py
  - tests/test_staunton_bot.py
  - tests/test_stockfish_engine.py
  - tests/test_task_dispatch.py
  - tests/test_timeouts_loop.py
  - tests/test_token_lifecycle.py
  - tests/test_websockets_flow.py
  - tests/test_worker_tasks.py
  - tests/test_ws_db_sessions.py
  - tests/test_ws_rate_limit.py
  - tests/test_zukertort_bot.py
  - scripts/build_opening_books.py
  - scripts/chessgames_downloader.py

--- snapshot_009.txt (66.9 KiB) ---
  - scripts/download_champions.py
  - scripts/setup_piece_sets.py
  - scripts/setup_stockfish.py
  - frontend/.dockerignore
  - frontend/.gitignore
  - frontend/.oxlintrc.json
  - frontend/Dockerfile
  - frontend/index.html
  - frontend/postcss.config.js
  - frontend/README.md
  - frontend/src/App.tsx
  - frontend/src/components/AuthModal.tsx
  - frontend/src/components/ChampionGames.tsx

--- snapshot_010.txt (77.3 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 1)

--- snapshot_011.txt (77.3 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 2)

--- snapshot_012.txt (25.4 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 3)
  - frontend/src/components/chessboard/__tests__/boardUtils.test.ts
  - frontend/src/components/chessboard/boardUtils.ts
  - frontend/src/components/chessboard/types.ts

--- snapshot_013.txt (69.6 KiB) ---
  - frontend/src/components/GameViewer.tsx
  - frontend/src/components/Leaderboard.tsx

--- snapshot_014.txt (76.9 KiB) ---
  - frontend/src/components/Profile.tsx
  - frontend/src/config/api.ts
  - frontend/src/config/boardAppearance.ts
  - frontend/src/config/champions.ts
  - frontend/src/config/timeControls.ts
  - frontend/src/index.css
  - frontend/src/main.tsx
  - frontend/src/services/__tests__/apiErrors.test.ts
  - frontend/src/services/__tests__/gameSocket.test.ts
  - frontend/src/services/__tests__/gameSocketTicket.test.ts
  - frontend/src/services/apiErrors.ts
  - frontend/src/services/gameSocket.ts
  - frontend/src/services/soundEngine.ts
  - frontend/tailwind.config.js
  - frontend/tsconfig.app.json
  - frontend/tsconfig.node.json
  - .dockerignore
  - .gitignore
  - DEPLOY.md

--- snapshot_015.txt (44.0 KiB) ---
  - docker-compose.prod.yml
  - Dockerfile
  - make_snapshot.py
  - pyproject.toml
  - QUICKSTART.md
  - README.md
  - requirements-dev.txt
  - start_dev.ps1
  - WORKFLOW.md
