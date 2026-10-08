# gear-optimizer-api

Backend API for **Where is my loot!?**, a community tool for World of Warcraft players that shows which items their character can get from the current season's dungeons and raids.

- Frontend: [gear-optimiser](https://github.com/Amy-di-Aricci/gear-optimiser) (React + Vite, deployed on Netlify)
- Running app: https://calm-kitten-ff2f2e.netlify.app/

Where is my loot!? is a **community fan project**. It is not affiliated with or endorsed by Blizzard Entertainment (see [Disclaimer](#disclaimer)).

## Status

Early development. The NestJS scaffold is in place; the plan is in [`docs/`](docs/overview.md), starting with [docs/overview.md](docs/overview.md).

Planned stack: NestJS, Prisma, PostgreSQL (Neon), hosted on Render.

## Running locally

```bash
npm install
npm run start:dev
```

```bash
npm run test       # unit tests
npm run test:e2e   # end-to-end tests
```

## License

Copyright (C) 2026 Sajgonka

The **source code** in this repository is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License, version 3** (AGPL-3.0-only), as published by the Free Software Foundation. See [LICENSE](LICENSE) for the full text.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

The license covers this project's own code only. It does **not** cover any Blizzard Entertainment content: game data, item names, icons, artwork or trademarks (see below).

## Disclaimer

Where is my loot!? is an unofficial, non-commercial community project. It is **not affiliated with, endorsed, sponsored, or approved by Blizzard Entertainment, Inc.**

World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries. All game content served by this API, including item names, game data and icon references, is the property of Blizzard Entertainment, Inc. and is used for informational, fan-community purposes only.
