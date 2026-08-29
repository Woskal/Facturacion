import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Los tests de este paquete hablan con una base real. Se carga `.env` a mano
// porque Vite solo expone variables con prefijo `VITE_`, y `DATABASE_URL` no
// debe llevar ese prefijo: no es una variable de cliente.
const envPath = resolve(__dirname, '../../packages/db/.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
    }
  }
}

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Los tests comparten una base: correrlos en paralelo los haría pisarse.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
