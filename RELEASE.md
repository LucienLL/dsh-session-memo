# Release checklist (dsh-session-memo)

1. **Write** — plugin code (dsh.bundle + cordis.patch.yml + lib/{index,memo,client}.js).
2. **Verify** — `node --check` all lib files; `node test\memo.test.mjs`; `node test\probe.test.mjs`; `node test\client-shape.test.mjs`; `npm pack --dry-run` (check `files` contents).
3. **Composition** — `dsh --profile web --patch <repo>\cordis.patch.yml --dump-config` shows the insert row.
4. **Live smoke** (needs a DSH web restart) — install into the profile, restart `dsh web`, curl `GET http://127.0.0.1:3180/dsh-session-memo/probe?sessionId=<id>` for JSON; open the memo panel in the GUI and exercise override/tags/status linkage.
5. **Publish npm** — `pwsh -File scripts\publish-interactive.ps1` (WebAuthn device flow; token from NPM_PUBLISH_TOKEN / ~/.dsh/secrets/npm-token.txt). Name availability: `GET https://registry.npmjs.org/dsh-session-memo` should be 404.
6. **GitHub** — repo `LucienLL/dsh-session-memo`, push code, add topics `dsh-plugin`, `deepseek-harness`, `cordis`.
7. **awesome-dsh-plugin PR** (optional, per user: skipped) — data/plugins/<owner>__<repo>.yml; needs repo >= 1 day and >= 10 commits.
