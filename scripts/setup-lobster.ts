import { execSync } from "node:child_process";
import { isInstalled } from "../src/lobster.js";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function step(label: string) {
  console.log(`\n${BOLD}${label}${RESET}`);
}

function ok(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

async function main() {
  console.log(`${BOLD}🦞 Lobster Cash Setup${RESET}\n`);

  // Step 1: Check Node.js
  step("1. Node.js");
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major >= 20) {
    ok(`Node.js ${nodeVersion}`);
  } else {
    warn(`Node.js ${nodeVersion} — Node.js 20+ recommended`);
  }

  // Step 2: Check lobstercash CLI
  step("2. Lobster Cash CLI");
  if (isInstalled()) {
    ok("lobstercash is installed");
  } else {
    warn("lobstercash not found — installing...");
    try {
      execSync("npm install -g @crossmint/lobster-cli", {
        stdio: "inherit",
        timeout: 120_000,
      });
      ok("lobstercash installed successfully");
    } catch {
      console.log(`  ${RED}✗${RESET} Failed to install. Run manually:`);
      console.log("    npm install -g @crossmint/lobster-cli");
      process.exit(1);
    }
  }

  // Step 3: Register agent
  step("3. Register agent");
  try {
    execSync("lobstercash agents register --name 'MCP Checkout Agent'", {
      stdio: "inherit",
      timeout: 30_000,
    });
    ok("Agent registered");
  } catch {
    warn("Could not register agent — may already be registered");
  }

  // Step 4: Setup wallet
  step("4. Wallet setup");
  try {
    execSync("lobstercash setup", {
      stdio: "inherit",
      timeout: 60_000,
    });
    ok("Wallet setup complete");
  } catch {
    warn("Wallet setup needs manual completion — run 'lobstercash setup'");
  }

  // Step 5: Verify
  step("5. Verification");
  try {
    const out = execSync("lobstercash status", {
      encoding: "utf8",
      timeout: 15_000,
    });
    console.log(`  ${out.trim()}`);
    ok("Lobster Cash is ready");
  } catch {
    warn("Run 'lobstercash status' to verify");
  }

  console.log(`\n${BOLD}Next steps:${RESET}`);
  console.log("  1. Start the basket viewer: npm run basket-viewer");
  console.log("  2. Configure the MCP server with your agent host");
  console.log("  3. Test with: lobstercash-status");
}

main().catch((error) => {
  console.error(`${RED}Setup failed:${RESET}`, error.message);
  process.exit(1);
});
