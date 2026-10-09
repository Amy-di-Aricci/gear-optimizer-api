import { describe, expect, it } from 'vitest';
import { AppEnv, envFileOptions, NodeEnv, validateEnv } from './env';

const deployed = {
  NODE_ENV: NodeEnv.Production,
  APP_ENV: AppEnv.Staging,
  DATABASE_URL: 'postgresql://example',
};

describe('validateEnv', () => {
  it('applies defaults outside production', () => {
    const env = validateEnv({ NODE_ENV: 'development' });
    expect(env.APP_ENV).toBe(AppEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('converts PORT to a number', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each([AppEnv.Staging, AppEnv.Production])(
    'accepts a %s deployment',
    (appEnv) => {
      expect(validateEnv({ ...deployed, APP_ENV: appEnv }).APP_ENV).toBe(
        appEnv,
      );
    },
  );

  it('requires DATABASE_URL in deployments', () => {
    expect(() => validateEnv({ ...deployed, DATABASE_URL: undefined })).toThrow(
      'Invalid environment variables: DATABASE_URL',
    );
  });

  it('requires deployments to name their stage', () => {
    expect(() => validateEnv({ ...deployed, APP_ENV: undefined })).toThrow(
      'Invalid environment variables: APP_ENV',
    );
  });

  it('rejects unknown stages', () => {
    expect(() => validateEnv({ APP_ENV: 'test' })).toThrow(
      'Invalid environment variables: APP_ENV',
    );
  });

  it('never includes values in the error message', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'staging', DATABASE_URL: 'postgres://secret' }),
    ).toThrow(/^Invalid environment variables: NODE_ENV$/);
  });
});

describe('envFileOptions', () => {
  it.each([
    ['development', { envFilePath: '.env' }],
    ['test', { envFilePath: '.env.test' }],
    ['production', { ignoreEnvFile: true }],
  ])('NODE_ENV=%s -> %o', (nodeEnv, expected) => {
    expect(envFileOptions(nodeEnv)).toEqual(expected);
  });
});
