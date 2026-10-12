import {
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { Public } from './access-policy.decorator';
import { AccessGuard } from './access.guard';

@Controller()
class FixtureController {
  @Get('open')
  @Public()
  open(this: void) {}

  @Get('undeclared')
  undeclared(this: void) {}
}

@Public()
@Controller()
class PublicFixtureController {
  @Get()
  inherited(this: void) {}
}

function contextFor(
  controller: new () => object,
  handler: () => void,
): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

describe('AccessGuard', () => {
  const guard = new AccessGuard(new Reflector());

  beforeAll(() => Logger.overrideLogger(false));

  it('allows a route declared @Public()', () => {
    expect(
      guard.canActivate(
        contextFor(FixtureController, FixtureController.prototype.open),
      ),
    ).toBe(true);
  });

  it('allows a route on a controller declared @Public()', () => {
    expect(
      guard.canActivate(
        contextFor(
          PublicFixtureController,
          PublicFixtureController.prototype.inherited,
        ),
      ),
    ).toBe(true);
  });

  it('denies a route without an access policy', () => {
    expect(() =>
      guard.canActivate(
        contextFor(FixtureController, FixtureController.prototype.undeclared),
      ),
    ).toThrow(ForbiddenException);
  });
});
