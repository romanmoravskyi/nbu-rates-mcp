# Contributing to nbu-rates-mcp

Thanks for helping. This is a small project, so the process is light.

## Setup

1. Install Node 22 or newer.
2. Fork and clone the repo, then `npm ci`.
3. `npm run dev` starts the server from source at http://localhost:8787 (MCP endpoint `/mcp`) and
   reloads on save. `npm start` builds to `dist/` and runs the compiled server instead.
4. `npm run check` runs the typecheck, Biome and the test suite. It must pass.

No accounts or API keys are needed to develop, test or host your own copy.

## Branches and pull requests

We use GitHub Flow: `main` is the only long-lived branch and is always releasable. It is
protected, so every change (maintainers' included) lands through a pull request.

1. Open an issue first for anything beyond a small fix, so we can agree on the shape.
2. Branch from `main`: `feat/short-name`, `fix/short-name`, `docs/short-name`, `chore/short-name`.
3. Keep PRs focused. Fill in the PR template, including how you verified the change.
4. Give the PR a Conventional Commits title (see below): it becomes the commit message on `main`.
5. CI (`Typecheck, lint, test, build`) must be green, the branch up to date with `main`, and review
   threads resolved. A maintainer then squash-merges; the branch is deleted automatically.

Direct pushes, force pushes and deleting `main` are blocked, and squash is the only merge method.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
feat: add optional `precision` to convert
fix: treat empty NBU answer for tomorrow as "not published yet"
docs: explain the in-memory cache
```

Use `feat!:` or a `BREAKING CHANGE:` footer for anything that breaks the tool contract.

## Tests

- Every behaviour change needs a test in `test/`. Tests run on plain Vitest in Node.
- Never call the real NBU API from tests. Use `fakeFetch` from `test/fixtures.ts` injected into
  `NbuClient`, or `vi.stubGlobal("fetch", ...)` for tests that go through the HTTP server's `/mcp`
  endpoint (see `test/server.test.ts`).
- Before opening a PR for tool changes, also run the MCP Inspector checks described in
  [AGENTS.md](AGENTS.md#verify-a-change-end-to-end).

## Compatibility

Tool names and their input/output fields are a public API: people have connectors saved against
their own hosted URL or a local `npm start`. Prefer adding optional fields. Breaking changes need a
major version bump.

## Releasing (maintainers)

1. Branch from an up-to-date `main`: `git switch -c chore/release-vX.Y.Z origin/main`.
2. Move the `Unreleased` entries in `CHANGELOG.md` under a new version heading with today's date,
   and update the compare links at the bottom.
3. Bump `version` in `package.json` (`npm version <major|minor|patch> --no-git-tag-version`).
   The version is shown on `GET /` and in the MCP server info.
4. Commit, push the branch and open a PR titled `chore(release): vX.Y.Z`. Squash-merge it once CI
   is green.
5. Tag the merge commit on `main` and push the tag (tags are not affected by branch protection):
   `git switch main && git pull --ff-only && git tag vX.Y.Z && git push origin vX.Y.Z`.
6. Create a GitHub release from the tag with the CHANGELOG section as notes. If you host an
   instance, rebuild and redeploy the Docker image or `dist/` build.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
