# Contributing

GiviLoop is an independent MIT-licensed project for repeatable external code review. Useful contributions include reproducible browser failures, focused context packaging, provider adapters with documented access methods, and comparisons showing whether a second review catches real defects.

## Local checks

Use Node 20 or newer, Git, and `zip`. Install dependencies with `npm ci`.

```sh
npm test
npm run test:browser
npm run test:package -- --browser
```

Local provider tests start temporary HTTP servers bound to loopback; they do not require downloaded models. Live inference checks are separate and must identify model, runtime, budgets, completed output, and independently assessed review quality.

The browser suite requires Chrome, or `GIVILOOP_CHROME_PATH` pointing to a compatible Chromium executable. It intercepts the provider website with local fixtures and uses temporary profiles. No account or website request is needed. The default suite skips cases that intentionally display Chrome. Opt in with `npm run test:browser -- --foreground` or `npm run test:package -- --browser --foreground` to cover manual recovery and visible-window lifecycle. CI includes them explicitly; on Linux without a desktop use `xvfb-run -a npm run test:browser -- --foreground`. Chrome's sandbox must work in the test environment; do not disable it in the product to accommodate a runner. The package check installs the actual tarball into a clean temporary consumer and reruns checks against that installation.

Keep regressions focused on observable behavior: association of request and response, one send per attempt, no partial answers reported as completed, and clear failures when provider assumptions stop holding. Do not add credentials, real browser profiles, or captured private conversations to fixtures.

## Issues and changes

For bugs, include the version, redacted command, OS/Node version, error code, and expected versus actual behavior. See [troubleshooting](docs/troubleshooting.md). A small synthetic source file or fixture is preferable to a private repository dump.

For a pull request, explain the concrete failure or use case, the resulting behavior, and checks you ran. Record separately what was tested on local pages and what was tested against a live provider. Automated UI success does not certify provider permission or access to a particular model.

Never send account credentials to CI. Never include `.giviloop/` run artifacts, source archives, clipboard data, or the dedicated Chrome profile in a pull request. The normal test suite is deliberately independent of an authenticated account.
