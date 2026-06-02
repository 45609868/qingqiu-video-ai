import { describe, it, expect } from 'vitest'
import { toSnakeCase, toSnakeCaseArray } from './transform.js'

describe('toSnakeCase', () => {
  it('converts camelCase to snake_case', () => {
    expect(toSnakeCase({ imageUrl: 'a', createdAt: 'b' })).toEqual({ image_url: 'a', created_at: 'b' })
  })

  it('preserves snake_case keys', () => {
    expect(toSnakeCase({ image_url: 'a' })).toEqual({ image_url: 'a' })
  })

  it('handles nested objects', () => {
    expect(toSnakeCase({ userId: 1, profileData: { firstName: 'a' } })).toEqual({
      user_id: 1,
      profile_data: { first_name: 'a' },
    })
  })

  it('handles arrays via toSnakeCaseArray', () => {
    const arr = [{ imageUrl: 'a' }, { imageUrl: 'b' }]
    expect(toSnakeCaseArray(arr)).toEqual([{ image_url: 'a' }, { image_url: 'b' }])
  })

  it('handles null/undefined', () => {
    expect(toSnakeCase(null)).toBeNull()
    expect(toSnakeCase(undefined)).toBeUndefined()
  })

  it('preserves 9:16 default value', () => {
    expect(toSnakeCase({ aspectRatio: '9:16' })).toEqual({ aspect_ratio: '9:16' })
  })
})
