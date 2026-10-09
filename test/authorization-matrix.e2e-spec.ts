import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_POLICY_KEY } from '../src/auth/access-policy.decorator';
import { createApp, GLOBAL_PREFIX } from '../src/app.setup';

// Expected status per route and actor (docs/testing.md). Every route the app
// exposes must appear here, and must declare an access policy. More actors
// (user A, user B, editor, admin) join when auth lands in phase 3.
type Actor = 'anonymous';
const matrix: Record<string, Record<Actor, number>> = {
  'GET /api/health': { anonymous: 200 },
};

interface Route {
  key: string;
  method: string;
  path: string;
  hasPolicy: boolean;
}

function discoverRoutes(app: INestApplication): Route[] {
  const routes: Route[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new () => object) | null;
      if (!controller) continue;

      const prototype = controller.prototype as object;
      const controllerPath = String(
        Reflect.getMetadata(PATH_METADATA, controller) ?? '',
      );
      const classPolicy: unknown = Reflect.getMetadata(
        ACCESS_POLICY_KEY,
        controller,
      );

      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler: unknown = Object.getOwnPropertyDescriptor(
          prototype,
          name,
        )?.value;
        if (name === 'constructor' || typeof handler !== 'function') continue;

        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (methodPath === undefined) continue;

        const method =
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
          ];
        const path = `/${[GLOBAL_PREFIX, controllerPath, methodPath]
          .map((part) => part.replace(/^\/+|\/+$/g, ''))
          .filter(Boolean)
          .join('/')}`;
        routes.push({
          key: `${method} ${path}`,
          method,
          path,
          hasPolicy:
            Reflect.getMetadata(ACCESS_POLICY_KEY, handler) !== undefined ||
            classPolicy !== undefined,
        });
      }
    }
  }
  return routes;
}

describe('authorization matrix', () => {
  let app: INestApplication<App>;
  let routes: Route[];

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    routes = discoverRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds the app routes', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every route declares an access policy', () => {
    const undeclared = routes.filter((r) => !r.hasPolicy).map((r) => r.key);
    expect(undeclared).toEqual([]);
  });

  it('every route has an entry in the matrix, and vice versa', () => {
    expect(routes.map((r) => r.key).sort()).toEqual(Object.keys(matrix).sort());
  });

  it('every route returns the expected status for each actor', async () => {
    for (const route of routes) {
      const expected = matrix[route.key];
      const response = await request(app.getHttpServer())[
        route.method.toLowerCase() as 'get'
      ](route.path);
      expect({
        route: route.key,
        actor: 'anonymous',
        status: response.status,
      }).toEqual({
        route: route.key,
        actor: 'anonymous',
        status: expected.anonymous,
      });
    }
  });
});
