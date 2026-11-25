# Contributing to ts-agent-kit

Thanks for your interest in improving ts-agent-kit! Bug reports, ideas and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/umarjavedse/ts-agent-kit.git
cd ts-agent-kit
npm install
npm test
```

Node.js 22 or newer is required.

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Create a branch from `main` (for example `fix/short-description`).
3. Keep the library dependency-free: new runtime dependencies need a strong reason.
4. Add or update tests for every behaviour change. `npm test` must pass.
5. Update the README when you change the public API.
6. Open a pull request and fill in the template.

## Code style

- TypeScript in `strict` mode; avoid `any` in public types.
- Small, focused functions with clear names.
- Comments explain *why*, not *what*.

## Reporting bugs

Use the bug report template and include a minimal reproduction: the input, what you expected, and what happened.

## Security issues

Please do not open public issues for security problems. See [SECURITY.md](SECURITY.md).
