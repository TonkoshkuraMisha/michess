PROJECT: michess
ROOT: C:\Users\User_Fayna\PycharmProjects\michess
FILES INCLUDED: 127
PARTS: 14 (target <= 80 KiB per part)

UPLOAD ALL PARTS IN NUMERICAL ORDER (snapshot_001.txt .. snapshot_00N.txt).

TABLE OF CONTENTS BY PART:

--- snapshot_001.txt (66.3 KiB) ---
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
  - src/__init__.py
  - src/api/analysis.py
  - src/api/auth.py
  - src/api/bots.py
  - src/api/deps.py

--- snapshot_002.txt (72.7 KiB) ---
  - src/api/profile.py
  - src/api/rate_limit.py
  - src/api/websockets.py
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

--- snapshot_003.txt (75.5 KiB) ---
  - src/services/analysis_service.py
  - src/services/anticheat.py
  - src/services/bots/__init__.py
  - src/services/bots/anderssen.py
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

--- snapshot_004.txt (75.8 KiB) ---
  - src/services/bots/zukertort.py
  - src/services/connection_manager.py
  - src/services/engine_pool.py
  - src/services/game_engine.py
  - src/services/game_state.py

--- snapshot_005.txt (74.2 KiB) ---
  - src/services/matchmaker.py
  - src/services/rating.py
  - src/worker/celery_app.py
  - src/worker/tasks.py
  - tests/conftest.py
  - tests/integration/test_real_backends.py
  - tests/test_analysis_service.py
  - tests/test_anderssen_bot.py
  - tests/test_anticheat.py
  - tests/test_audit_fixes.py
  - tests/test_audit_followups_rules.py

--- snapshot_006.txt (74.5 KiB) ---
  - tests/test_disconnect_clock.py
  - tests/test_engine_endpoints.py
  - tests/test_game_end_atomicity.py
  - tests/test_game_engine.py
  - tests/test_game_state.py
  - tests/test_labourdonnais_bot.py
  - tests/test_matchmaking_rules.py
  - tests/test_morphy_bot.py
  - tests/test_multiworker.py
  - tests/test_paulsen_bot.py
  - tests/test_philidor_bot.py
  - tests/test_staunton_bot.py
  - tests/test_stockfish_engine.py
  - tests/test_websockets_flow.py
  - tests/test_worker_tasks.py
  - tests/test_zukertort_bot.py

--- snapshot_007.txt (63.3 KiB) ---
  - scripts/build_opening_books.py
  - scripts/chessgames_downloader.py
  - scripts/download_champions.py
  - scripts/setup_piece_sets.py
  - scripts/setup_stockfish.py
  - frontend/.gitignore
  - frontend/.oxlintrc.json
  - frontend/index.html
  - frontend/postcss.config.js
  - frontend/README.md
  - frontend/src/App.tsx
  - frontend/src/components/AuthModal.tsx

--- snapshot_008.txt (18.1 KiB) ---
  - frontend/src/components/ChampionGames.tsx

--- snapshot_009.txt (77.3 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 1)

--- snapshot_010.txt (77.3 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 2)

--- snapshot_011.txt (24.2 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 3)
  - frontend/src/components/chessboard/__tests__/boardUtils.test.ts
  - frontend/src/components/chessboard/boardUtils.ts
  - frontend/src/components/chessboard/types.ts

--- snapshot_012.txt (68.8 KiB) ---
  - frontend/src/components/GameViewer.tsx
  - frontend/src/components/Leaderboard.tsx

--- snapshot_013.txt (67.5 KiB) ---
  - frontend/src/components/Profile.tsx
  - frontend/src/config/api.ts
  - frontend/src/config/boardAppearance.ts
  - frontend/src/config/champions.ts
  - frontend/src/config/timeControls.ts
  - frontend/src/index.css
  - frontend/src/main.tsx
  - frontend/src/services/__tests__/gameSocket.test.ts
  - frontend/src/services/gameSocket.ts
  - frontend/src/services/soundEngine.ts
  - frontend/tailwind.config.js
  - frontend/tsconfig.app.json
  - frontend/tsconfig.node.json
  - .gitignore

--- snapshot_014.txt (33.9 KiB) ---
  - make_snapshot.py
  - QUICKSTART.md
  - README.md
  - start_dev.ps1
  - WORKFLOW.md
