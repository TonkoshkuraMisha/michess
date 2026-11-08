PROJECT: michess
ROOT: C:\Users\misha\PycharmProjects\michess
FILES INCLUDED: 110
PARTS: 11 (target <= 80 KiB per part)

UPLOAD ALL PARTS IN NUMERICAL ORDER (snapshot_001.txt .. snapshot_00N.txt).

TABLE OF CONTENTS BY PART:

--- snapshot_001.txt (73.9 KiB) ---
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

--- snapshot_002.txt (70.6 KiB) ---
  - src/api/profile.py
  - src/api/websockets.py
  - src/core/config.py
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

--- snapshot_003.txt (75.7 KiB) ---
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
  - src/services/bots/zukertort.py

--- snapshot_004.txt (73.6 KiB) ---
  - src/services/connection_manager.py
  - src/services/game_engine.py
  - src/services/game_state.py
  - src/services/matchmaker.py
  - src/services/rating.py
  - src/worker/celery_app.py
  - src/worker/tasks.py
  - tests/conftest.py
  - tests/test_analysis_service.py
  - tests/test_anderssen_bot.py
  - tests/test_anticheat.py
  - tests/test_game_engine.py

--- snapshot_005.txt (67.1 KiB) ---
  - tests/test_game_state.py
  - tests/test_labourdonnais_bot.py
  - tests/test_morphy_bot.py
  - tests/test_paulsen_bot.py
  - tests/test_philidor_bot.py
  - tests/test_staunton_bot.py
  - tests/test_stockfish_engine.py
  - tests/test_websockets_flow.py
  - tests/test_zukertort_bot.py
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

--- snapshot_006.txt (44.1 KiB) ---
  - frontend/src/App.tsx
  - frontend/src/components/AuthModal.tsx
  - frontend/src/components/ChampionGames.tsx

--- snapshot_007.txt (77.3 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 1)

--- snapshot_008.txt (77.2 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 2)

--- snapshot_009.txt (25.7 KiB) ---
  - frontend/src/components/Chessboard.tsx (chunk 3)

--- snapshot_010.txt (65.5 KiB) ---
  - frontend/src/components/GameViewer.tsx
  - frontend/src/components/Leaderboard.tsx

--- snapshot_011.txt (77.5 KiB) ---
  - frontend/src/components/Profile.tsx
  - frontend/src/config/api.ts
  - frontend/src/config/boardAppearance.ts
  - frontend/src/config/champions.ts
  - frontend/src/index.css
  - frontend/src/main.tsx
  - frontend/src/services/__tests__/gameSocket.test.ts
  - frontend/src/services/gameSocket.ts
  - frontend/tailwind.config.js
  - frontend/tsconfig.app.json
  - frontend/tsconfig.node.json
  - .gitignore
  - make_snapshot.py
  - QUICKSTART.md
  - README.md
  - start_dev.ps1
  - WORKFLOW.md
