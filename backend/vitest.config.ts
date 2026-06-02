import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
})
