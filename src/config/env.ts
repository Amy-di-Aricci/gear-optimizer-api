import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

// How the code runs (Node convention): `production` for staging and
// production deployments, `test` under Vitest.
export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

// Which deployment this is (docs/environments.md). Independent of NODE_ENV,
// so staging runs exactly the production code paths.
export enum AppEnv {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
}

export class Env {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  // Deployments must set it explicitly; see validateEnv.
  @IsEnum(AppEnv)
  APP_ENV: AppEnv = AppEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  // Required for deployments only, so the app and unit tests boot without a
  // database. Prisma connects lazily on the first query.
  @ValidateIf(
    (env: Env) =>
      env.NODE_ENV === NodeEnv.Production || env.DATABASE_URL !== undefined,
  )
  @IsString()
  DATABASE_URL?: string;
}

export function validateEnv(config: Record<string, unknown>): Env {
  const env = plainToInstance(Env, config, {
    enableImplicitConversion: true,
  });
  const names = validateSync(env).map((error) => error.property);
  // A deployed build never runs as development.
  if (
    env.NODE_ENV === NodeEnv.Production &&
    env.APP_ENV === AppEnv.Development &&
    !names.includes('APP_ENV')
  ) {
    names.push('APP_ENV');
  }
  if (names.length > 0) {
    // Report property names only: values may contain secrets.
    throw new Error(`Invalid environment variables: ${names.join(', ')}`);
  }
  return env;
}

// Local env file for this process: `.env` for development, `.env.test` under
// Vitest. Deployments get their variables from the host (Render, GitHub
// Actions) and read no file.
export function envFileOptions(
  nodeEnv = process.env.NODE_ENV,
): { envFilePath: string } | { ignoreEnvFile: true } {
  switch (nodeEnv) {
    case NodeEnv.Production:
      return { ignoreEnvFile: true };
    case NodeEnv.Test:
      return { envFilePath: '.env.test' };
    default:
      return { envFilePath: '.env' };
  }
}
