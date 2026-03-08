import type Database from 'better-sqlite3';

export type SqliteDatabase = InstanceType<typeof Database>;

export interface Migration {
  readonly id: string;
  up(db: SqliteDatabase): void;
}
