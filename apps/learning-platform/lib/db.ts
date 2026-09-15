import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { INITIAL_SCHEMA } from '@/db/schema'

const databaseSymbol = Symbol.for('learning-platform.database')

interface DatabaseGlobal {
  [databaseSymbol]?: DatabaseSync
}

function dataDirectory(): string {
  return process.env.LEARNING_DATA_DIR
    ? path.resolve(process.env.LEARNING_DATA_DIR)
    : path.resolve(process.cwd(), '.data')
}

function createDatabase(): DatabaseSync {
  const directory = dataDirectory()
  mkdirSync(directory, { recursive: true })
  const database = new DatabaseSync(path.join(directory, 'learning-platform.sqlite'))
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  database.exec(INITIAL_SCHEMA)
  database.prepare('INSERT OR IGNORE INTO app_migrations(version, applied_at) VALUES (?, ?)')
    .run(1, new Date().toISOString())
  database.exec('PRAGMA optimize;')
  return database
}

export function getDatabase(): DatabaseSync {
  const globalDatabase = globalThis as typeof globalThis & DatabaseGlobal
  globalDatabase[databaseSymbol] ??= createDatabase()
  return globalDatabase[databaseSymbol]
}
