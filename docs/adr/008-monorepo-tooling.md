# ADR-008: Monorepo tooling (npm workspaces, source packages, bundled apps)

- Status: accepted
- Date: 2026-10-01

## Context

Seven TypeScript projects share types and logic. Options: separate repositories, npm or
pnpm workspaces with per-package builds, or Nx/Turborepo.

## Decision

- **npm workspaces** (nothing extra to install), scoped `@eoi/*`.
- Internal packages ship **TypeScript source** (`exports: ./src/index.ts`), with no
  per-package build step.
- **Extensionless relative imports** with `moduleResolution: "Bundler"`. Every consumer
  is a bundler-style resolver: tsup (API, indexer), tsx (dev and scripts), Vitest, and
  Next.js. Turbopack does not map `.js` specifiers to `.ts` sources in transpiled
  packages, which the first web build revealed.
- API and indexer are bundled by **tsup** into self-contained ESM files (dependencies
  included), so their Docker runtime images need no `node_modules`.
- Next.js consumes `@eoi/shared` through `transpilePackages`.

## Consequences

- One `npm install`, one ESLint config, one Vitest workspace, and a shared
  `tsconfig.base.json` with `strict` and `noUncheckedIndexedAccess`.
- No stale `dist/` folders between packages; a change in a package is visible everywhere
  immediately.
- Packages are not publishable to npm as-is (not a goal).
- Turborepo or Nx caching was not needed at this size and can be added later without
  restructuring.
