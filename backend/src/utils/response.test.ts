import { describe, it, expect } from 'vitest'
import { success, badRequest, notFound, now } from './response.js'

describe('response helpers', () => {
  it('success returns { code: 200, message: success, data }', () => {
    const c: any = { json: (body: any, status?: number) => ({ body, status }) }
    const result = (success as any)(c, { foo: 'bar' })
    expect(result.body.code).toBe(200)
    expect(result.body.message).toBe('success')
    expect(result.body.data).toEqual({ foo: 'bar' })
  })

  it('badRequest returns code 400 with default message', () => {
    const c: any = { json: (body: any, status?: number) => ({ body, status }) }
    const result = (badRequest as any)(c)
    expect(result.body.code).toBe(400)
    expect(result.status).toBe(400)
  })

  it('badRequest with custom message', () => {
    const c: any = { json: (body: any) => ({ body }) }
    const result = (badRequest as any)(c, 'invalid input')
    expect(result.body.message).toBe('invalid input')
  })

  it('notFound returns code 404', () => {
    const c: any = { json: (body: any) => ({ body }) }
    const result = (notFound as any)(c)
    expect(result.body.code).toBe(404)
  })

  it('now returns ISO string', () => {
    const ts = now()
    expect(typeof ts).toBe('string')
    expect(new Date(ts).toISOString()).toBe(ts)
  })
})
