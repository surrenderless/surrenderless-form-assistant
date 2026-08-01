import { execSync } from "node:child_process";

execSync("npm run build", {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED: "true",
    // TEMPORARY: enables next.config.mjs's productionBrowserSourceMaps only for this E2E
    // build, so a CDP-attached Playwright test can map minified breakpoint offsets back to
    // source. Remove alongside the other temporary E2E diagnostics.
    E2E_DIAGNOSTIC_SOURCE_MAPS_ENABLED: "1",
  },
});
