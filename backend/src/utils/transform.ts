/**
 * 将 Drizzle 返回的 camelCase 对象转换为 snake_case
 * 保持前端 API 兼容（和旧 Go 后端一致）
 * 递归处理嵌套对象和数组
 */
export function toSnakeCase(obj: any): any {
  if (obj == null) return obj
  if (Array.isArray(obj)) return obj.map(toSnakeCase)
  if (typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    result[snakeKey] = toSnakeCase(value)
  }
  return result
}

export function toSnakeCaseArray(arr: Record<string, any>[] | null | undefined): Record<string, any>[] | null | undefined {
  if (arr == null) return arr
  return arr.map(toSnakeCase as (x: any) => Record<string, any>)
}
