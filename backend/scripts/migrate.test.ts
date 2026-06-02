import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('migrate.mjs', () => {
  let testDb: string

  beforeEach(() => {
    testDb = path.join(tmpdir(), `migrate_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
  })

  afterEach(() => {
    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(testDb + ext) } catch {}
    }
  })

  it('applies migrations on fresh DB', () => {
    execFileSync('node', [path.join(__dirname, 'migrate.mjs')], {
      env: { ...process.env, DB_PATH: testDb },
    })

    const out = execFileSync('sqlite3', [testDb, '.tables'], { encoding: 'utf8' })
    expect(out).toContain('dramas')
    expect(out).toContain('episodes')
    expect(out).toContain('bgm_library')
    expect(out).toContain('cover_templates')
    expect(out).toContain('prompt_templates')
    expect(out).toContain('tasks')
  })

  it('is idempotent (running twice is safe)', () => {
    execFileSync('node', [path.join(__dirname, 'migrate.mjs')], {
      env: { ...process.env, DB_PATH: testDb },
    })
    const out = execFileSync('node', [path.join(__dirname, 'migrate.mjs')], {
      env: { ...process.env, DB_PATH: testDb },
    }).toString()
    expect(out).toContain('0 new, 3 total')
  })

  it('records applied migrations in _migrations', () => {
    execFileSync('node', [path.join(__dirname, 'migrate.mjs')], {
      env: { ...process.env, DB_PATH: testDb },
    })
    const out = execFileSync('sqlite3', [testDb, 'SELECT name FROM _migrations'], { encoding: 'utf8' })
    expect(out).toContain('0001_phase11_916_bgm_cover.sql')
    expect(out).toContain('0002_phase11_index.sql')
  })
})
