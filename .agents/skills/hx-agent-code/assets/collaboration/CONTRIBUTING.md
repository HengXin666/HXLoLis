# Contributing

## Setup

Use the project's pinned Node, pnpm, Python and uv versions, install dependencies from committed lockfiles

## Local checks

Run the installed formatter and quality entrypoint after completing the change, record its Markdown and JSON reports

Use `pnpm test:affected` for the final local Diff, `pnpm test` for the full suite, `pnpm test` followed by a business module name for a focused run

Use `pnpm test:backend`, `pnpm test:frontend`, `pnpm test:contract` and `pnpm test:e2e` for individual layers

## Git and CI

The pre-commit hook checks staged content, the pre-push hook checks the commits being pushed, push CI selects affected tests and PR CI runs the full suite

Warnings require review, new errors block completion, push and CI, missing required environments are failures

## Decisions and exceptions

Keep nontrivial code changes paired with their Agent Note, request review for new dependencies and baseline or exemption changes, never refresh a baseline just to make a failing check pass
