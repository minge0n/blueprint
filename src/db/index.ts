import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { getMigrations } from './migrations/index.js';
import type { Migration, SqliteDatabase } from './migrations/types.js';

const BLUEPRINT_HOME_DIR = '.blueprint';
const DB_FILENAME = 'db.sqlite';
const BLUEPRINT_HOME_ENV_KEY = 'BLUEPRINT_HOME';

let dbInstance: SqliteDatabase | null = null;

interface MigrationIdRow {
  readonly id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isMigrationIdRow(value: unknown): value is MigrationIdRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  return true;
}

export function getBlueprintDirectory(): string {
  const configuredDirectory = process.env[BLUEPRINT_HOME_ENV_KEY];
  const directoryPath =
    configuredDirectory === undefined || configuredDirectory.length === 0
      ? path.join(os.homedir(), BLUEPRINT_HOME_DIR)
      : configuredDirectory;

  fs.mkdirSync(directoryPath, { recursive: true });

  return directoryPath;
}

function getDatabasePath(): string {
  const blueprintDirectory = getBlueprintDirectory();

  return path.join(blueprintDirectory, DB_FILENAME);
}

function ensureMigrationTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

function getAppliedMigrationIds(db: SqliteDatabase): Set<string> {
  const statement = db.prepare('SELECT id FROM schema_migrations ORDER BY id ASC');
  const rows = statement.all();
  const migrationIds = new Set<string>();

  for (const row of rows) {
    if (isMigrationIdRow(row)) {
      migrationIds.add(row.id);
    }
  }

  return migrationIds;
}

function applyMigration(db: SqliteDatabase, migration: Migration): void {
  const runMigration = db.transaction((currentMigration: Migration) => {
    currentMigration.up(db);

    db.prepare(
      'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)'
    ).run(currentMigration.id, new Date().toISOString());
  });

  runMigration(migration);
}

function runPendingMigrations(db: SqliteDatabase): void {
  const migrations = getMigrations();
  const appliedMigrationIds = getAppliedMigrationIds(db);

  for (const migration of migrations) {
    if (!appliedMigrationIds.has(migration.id)) {
      applyMigration(db, migration);
    }
  }
}

function createDatabase(): SqliteDatabase {
  const databasePath = getDatabasePath();
  const db = new Database(databasePath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  ensureMigrationTable(db);
  runPendingMigrations(db);

  return db;
}

export function getDb(): SqliteDatabase {
  if (dbInstance === null) {
    dbInstance = createDatabase();
  }

  return dbInstance;
}

export function resetDbForTests(): void {
  if (dbInstance !== null) {
    dbInstance.close();
    dbInstance = null;
  }
}
