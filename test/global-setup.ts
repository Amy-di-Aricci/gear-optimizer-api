import { execFileSync } from 'node:child_process';

// Brings the test database up to date before the e2e tests run. Tests may
// write to and wipe this database, so refuse anything that doesn't look like
// a dedicated test database.
export default function setup(): void {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  const database = new URL(url).pathname.replace(/^\//, '');
  if (!/(^|_)test$/.test(database)) {
    throw new Error(
      `Refusing to run tests against database "${database}": its name must be "test" or end in "_test".`,
    );
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}
