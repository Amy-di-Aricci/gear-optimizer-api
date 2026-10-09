import { defineConfig } from 'prisma/config';

// Locally, the CLI targets the development database from `.env`
// (`.env.test` when NODE_ENV=test). Variables already set in the environment
// win, which is how CI and the test setup point it at other databases.
try {
  process.loadEnvFile(process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
} catch {
  // no env file
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
