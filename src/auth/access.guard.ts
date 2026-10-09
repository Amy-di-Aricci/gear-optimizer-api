import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_POLICY_KEY, AccessPolicy } from './access-policy.decorator';

// Global deny-by-default guard (docs/security.md, A01). Fails closed: a route
// without a policy, or with one this guard doesn't know, is forbidden.
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(
      ACCESS_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (policy?.kind === 'public') {
      return true;
    }

    if (!policy) {
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} has no access policy`,
      );
    }
    throw new ForbiddenException();
  }
}
