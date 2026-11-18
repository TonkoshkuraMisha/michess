// --- FILE: frontend/src/migrateStorage.ts ---
// Импортируется первым в src/main.tsx: модули настроек (язык, доска, звук) читают хранилище уже при импорте, поэтому
// перенос ключей michess_… → regence_… (services/storageMigration.ts) должен случиться раньше их загрузки.

import {migrateLegacyStorage} from './services/storageMigration';

migrateLegacyStorage();
