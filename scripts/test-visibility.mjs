// Visible recovery and observer calibration belong on CI desktops, not the
// developer's working desktop. Reject before starting any test or browser.
export function requireCiForVisibleTests(env = process.env) {
  if (env.CI !== 'true') {
    throw new Error('Visible browser tests run only in CI. Local checks must stay windowless; use npm run test:browser without --foreground.');
  }
}

export function browserTestEnvironment(foreground, env = process.env) {
  if (foreground) requireCiForVisibleTests(env);
  return { ...env, GIVILOOP_TEST_FOREGROUND: foreground ? '1' : '0' };
}
