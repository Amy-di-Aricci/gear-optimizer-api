## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## Abuse check

<!-- New endpoint or data flow? Who could abuse it, and what stops them? (docs/security.md, A06) Write "n/a" otherwise. -->

## Checklist

- [ ] Tests added or updated
- [ ] Docs updated (`docs/`, README)
- [ ] New routes declare an access policy and are listed in the authorization matrix test
- [ ] `openapi.json` regenerated (`npm run openapi:export`) if the API changed
- [ ] No secrets, hook URLs, `.env` files, database dumps or real user data
- [ ] Decisions log in `docs/overview.md` updated if a cross-repo decision changed
