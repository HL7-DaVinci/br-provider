// Boots the full stack from the repo root docker-compose.yml, runs the
// Playwright suite against the built SPA on port 8080, then tears the stack
// down. Extra arguments are passed through to `playwright test`.
//
// The payer comes from the published Docker Hub image. To test local payer
// changes, build it first:
//   docker build -t hlseven/davinci-br-payer:latest ../br-payer
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(frontendDir, "..", "docker-compose.yml");

// The e2e profile adds fhir-candle, which a plain `docker compose up` omits.
function compose(args, options = {}) {
  return spawnSync(
    "docker",
    ["compose", "-f", composeFile, "--profile", "e2e", ...args],
    {
      cwd: frontendDir,
      stdio: "inherit",
      ...options,
    },
  );
}

let alreadyTornDown = false;
function teardown() {
  if (alreadyTornDown) return;
  alreadyTornDown = true;
  compose(["down"]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    teardown();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

// Runs the locally installed Playwright under whichever runtime started this
// script. Keeps the harness independent of bun, npm, and yarn.
const playwrightCli = createRequire(import.meta.url).resolve(
  "@playwright/test/cli",
);

function playwright(args, options = {}) {
  return spawnSync(process.execPath, [playwrightCli, ...args], {
    cwd: frontendDir,
    stdio: "inherit",
    ...options,
  });
}

// Installing dependencies does not download browsers. Check before the much
// slower Docker build so a missing browser fails in seconds. The command only
// downloads what is absent, so it costs a fraction of a second once present.
// A system browser channel needs no download at all.
if (
  !process.env.E2E_BROWSER_CHANNEL &&
  playwright(["install", "chromium"]).status !== 0
) {
  console.error(
    "Failed to install the Playwright chromium browser. Set E2E_BROWSER_CHANNEL=msedge or chrome to use an installed browser instead.",
  );
  process.exit(1);
}

let exitCode = 0;
try {
  const up = compose(["up", "-d", "--wait", "--build"]);

  if (up.error?.code === "ENOENT") {
    console.error(
      "docker was not found on PATH. Install Docker Desktop first.",
    );
    exitCode = 1;
  } else if (up.status !== 0) {
    console.error("Stack failed to start. Recent logs:");
    compose(["logs", "--tail", "50"]);
    exitCode = 1;
  } else {
    const test = playwright(["test", ...process.argv.slice(2)], {
      env: {
        ...process.env,
        BASE_URL: "http://localhost:8080",
        E2E_WAIT_TIMEOUT: "300",
        E2E_REQUIRE_CANDLE: "1",
        E2E_STUB_HOST: "host.docker.internal",
      },
    });

    if (test.status !== 0) {
      const logs = compose(["logs"], { stdio: ["ignore", "pipe", "pipe"] });
      const resultsDir = join(frontendDir, "test-results");
      mkdirSync(resultsDir, { recursive: true });
      writeFileSync(
        join(resultsDir, "stack-logs.txt"),
        `${logs.stdout ?? ""}${logs.stderr ?? ""}`,
      );
      console.error(
        "Tests failed. Stack logs saved to test-results/stack-logs.txt",
      );
      exitCode = test.status ?? 1;
    }
  }
} finally {
  teardown();
}

process.exit(exitCode);
