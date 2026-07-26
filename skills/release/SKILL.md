---
name: release
description: Commit, tag, and publish a new @hub/job-parser version. Use for /release, publish, or bump.
---

# release

1. Abort if unrelated dirty files exist. Run `pnpm test && pnpm typecheck` in `packages/job-parser` — fail → stop.
2. Bump `packages/job-parser/package.json` version (default patch; use user-specified or minor/major when asked).
3. Commit, tag, push:

```bash
git add packages/job-parser/
git commit -m "$(cat <<'EOF'
chore: bump job-parser version to X.Y.Z

EOF
)"
git tag "job-parser-vX.Y.Z"
git push origin HEAD "job-parser-vX.Y.Z"
```

Tag must match package version. CI creates the GitHub Release — do not create it manually. Report version, tag, and https://github.com/apertso/hub/actions/workflows/job-parser-release.yml
