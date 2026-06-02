#!/usr/bin/env node
/**
 * 数据库迁移脚本
 * 扫描 src/db/migrations/*.sql，按文件名顺序执行未跑过的迁移
 * 记录在 _migrations 表
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const DB_PATH = process.env.DB_PATH || path.resolve(projectRoot, 'data/qingqiu_drama.db')
const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations')

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 30000')

// 确保 _migrations 表存在
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )
`)

const appliedRows = db.prepare('SELECT name FROM _migrations').all()
const applied = new Set(appliedRows.map(r => r.name))

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

let appliedCount = 0
for (const f of files) {
  if (applied.has(f)) {
    console.log(`✓ skip ${f}`)
    continue
  }
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
  console.log(`→ applying ${f} (${sql.length} chars)...`)
  try {
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString())
    })()
    console.log(`✓ applied ${f}`)
    appliedCount++
  } catch (err) {
    console.error(`✗ failed ${f}:`, err.message)
    process.exit(1)
  }
}

console.log(`\nMigrations complete: ${appliedCount} new, ${applied.size + appliedCount} total`)
db.close()
