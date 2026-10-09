import { SetMetadata } from '@nestjs/common';

export const ACCESS_POLICY_KEY = 'accessPolicy';

// Every route declares exactly one policy; AccessGuard denies routes without
// one. `@Authenticated()` and `@Roles(...)` arrive with auth in phase 3.
export type AccessPolicy = { kind: 'public' };

export const Public = () =>
  SetMetadata(ACCESS_POLICY_KEY, { kind: 'public' } satisfies AccessPolicy);
