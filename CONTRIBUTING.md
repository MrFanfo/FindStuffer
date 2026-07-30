# Contributing

Issues and pull requests are welcome. Before opening a pull request:

1. Create a focused branch from `main`.
2. Install the backend and frontend development dependencies described in the
   README.
3. Run `pytest`, Ruff, `npm test`, the TypeScript check, the production frontend
   build, and the Playwright end-to-end suite.
4. Add tests for behavior changes.
5. Do not commit `.env`, databases, inventory exports, photos, generated
   Graphify output, tokens, local paths, or private network details.

Report security problems privately according to [SECURITY.md](SECURITY.md).
By contributing, you agree that your contribution is licensed under the MIT
License.
