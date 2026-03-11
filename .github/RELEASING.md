# Releasing Log Sight

GitHub Actions workflow:

- `.github/workflows/publish.yml`

Behavior:

- Pull requests and pushes to `main` compile the extension and upload a `.vsix` artifact.
- Pushing a tag like `v0.0.3` packages the extension and publishes it to the Visual Studio Marketplace.
- The workflow can also be run manually with `publish=true`.

Required repository secret:

- `VSCE_PAT`: a Visual Studio Marketplace personal access token with publish rights for publisher `JashwanthNeela`.

Release flow:

```bash
npm version patch
git push origin main --follow-tags
```

Notes:

- The workflow checks that the git tag version matches `package.json`.
- The packaged `.vsix` is written to `artifacts/` to avoid publishing stale files.