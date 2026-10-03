# Contributing

- Keep the repository neutral: no customer data, no brand assets you do not own, no keys.
- Every script must run from any folder with `--project <dir>`; relative paths resolve from the project.
- Engine code is TypeScript (`cd engine && npm run typecheck`); audio code is Python ≥ 3.10 with numpy/scipy.
- Test with the example: `cd examples/hello && sms capture && sms build && sms stills --scenes --sheet`.
- Commit messages: imperative, one topic per commit.
