import ts from 'typescript';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Nest's DI needs emitted decorator metadata, which Vite's default transform
// doesn't produce. Transpile TypeScript with tsc instead (no type checking;
// `npm run typecheck` does that).
function typescriptDecorators(): Plugin {
  return {
    name: 'typescript-decorators',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || id.includes('node_modules')) return null;
      const output = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          sourceMap: true,
          inlineSources: true,
        },
      });
      return { code: output.outputText, map: output.sourceMapText };
    },
  };
}

// The local test database (.env.test). Variables already set, as in CI, win.
try {
  process.loadEnvFile('.env.test');
} catch {
  // no .env.test: tests that need Postgres are skipped
}

export default defineConfig({
  plugins: [typescriptDecorators()],
  oxc: false,
  test: {
    env: { NODE_ENV: 'test' },
    setupFiles: ['reflect-metadata'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts'],
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          globalSetup: ['test/global-setup.ts'],
        },
      },
    ],
  },
});
