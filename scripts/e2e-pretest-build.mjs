import { execSync } from "node:child_process";

execSync("npm run build", {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED: "true",
  },
});
