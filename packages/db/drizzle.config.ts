import { defineConfig } from 'drizzle-kit'

const url = process.env['DATABASE_URL']
if (!url) {
  throw new Error('Falta DATABASE_URL. Copie .env.example a .env y ajústelo.')
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
