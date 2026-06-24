import { execSync, ExecSyncOptionsWithStringEncoding } from "node:child_process";

const CLI = "lobstercash";
const DEFAULT_TIMEOUT = 30_000;
const CARDS_REQUEST_TIMEOUT = 60_000;
const CRYPTO_SEND_TIMEOUT = 120_000;

export interface LobsterStatus {
  available: boolean;
  installed: boolean;
  walletConfigured: boolean;
  walletAddress?: string;
  balances?: { token: string; amount: string }[];
  cards?: { id: string; phase: string; mandates: unknown[] }[];
  hasBrowserAutomation: boolean;
  error?: string;
  nextStep?: string;
}

export interface CardRequestResult {
  approvalUrl: string;
  cardId?: string;
  message: string;
}

export interface CardRevealResult {
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvc: string;
}

export interface CryptoBalanceResult {
  balances: { token: string; amount: string }[];
}

export interface CryptoSendResult {
  txId: string;
  status: string;
}

export interface CryptoRequestResult {
  approvalUrl: string;
  message: string;
}

export interface X402FetchResult {
  body: string;
  status: number;
}

class LobsterError extends Error {
  constructor(
    message: string,
    public readonly code: "not_installed" | "wallet_not_configured" | "timeout" | "command_failed"
  ) {
    super(message);
    this.name = "LobsterError";
  }
}

function run(
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT
): { stdout: string; stderr: string } {
  if (!isInstalled()) {
    throw new LobsterError(
      `lobstercash CLI not found. Install: npm install -g @crossmint/lobster-cli`,
      "not_installed"
    );
  }

  const options: ExecSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  };

  try {
    // Escape arguments with spaces and special chars for shell
    const escaped = args.map((a) => a.includes(" ") || a.includes('"') ? `"${a.replace(/"/g, '\\"')}"` : a).join(" ");
    const stdout = execSync(`${CLI} ${escaped}`, options) as string;
    return { stdout: stdout.trim(), stderr: "" };
  } catch (error: unknown) {
    const err = error as { code?: string; stderr?: string; stdout?: string; status?: number };
    if (err.code === "ETIMEDOUT" || err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new LobsterError(`lobstercash timed out after ${timeoutMs}ms`, "timeout");
    }
    // Exit code 2 = wallet not configured
    if (err.status === 2) {
      throw new LobsterError(
        "Wallet not configured. Run lobstercash setup or use cards request which bundles setup.",
        "wallet_not_configured"
      );
    }
    const stderr = err.stderr || "";
    throw new LobsterError(stderr.trim() || `Command failed: lobstercash ${args[0]}`, "command_failed");
  }
}

function parseJson(stdout: string): unknown {
  try {
    const start = stdout.indexOf("{");
    const bracketStart = stdout.indexOf("[");
    if (start === -1 && bracketStart === -1) {
      return { raw: stdout };
    }
    const idx = start >= 0 && (bracketStart === -1 || start < bracketStart) ? start : bracketStart;
    return JSON.parse(stdout.slice(idx));
  } catch {
    return { raw: stdout };
  }
}

/** Extract the approval URL from human-readable CLI output like:
 *  "Open this URL to approve:\nhttps://www.lobster.cash/request/..." */
function extractApprovalUrl(stdout: string): string {
  const match = stdout.match(/https:\/\/www\.lobster\.cash\/request\/[a-f0-9-]+/i);
  return match ? match[0] : "";
}

export function isInstalled(): boolean {
  try {
    execSync(`command -v ${CLI}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function status(): LobsterStatus {
  try {
    const { stdout } = run(["status"]);
    const data = parseJson(stdout) as Record<string, unknown>;

    return {
      available: true,
      installed: true,
      walletConfigured: (data.walletConfigured as boolean) || false,
      walletAddress: data.walletAddress as string | undefined,
      balances: data.balances as LobsterStatus["balances"],
      cards: data.cards as LobsterStatus["cards"],
      hasBrowserAutomation: (data.hasBrowserAutomation as boolean) || false,
    };
  } catch (error) {
    if (error instanceof LobsterError) {
      return {
        available: false,
        installed: error.code !== "not_installed",
        walletConfigured: false,
        hasBrowserAutomation: false,
        error: error.message,
        nextStep:
          error.code === "not_installed"
            ? "npm install -g @crossmint/lobster-cli"
            : error.code === "wallet_not_configured"
              ? "Run lobstercash setup or use cards request which bundles setup"
              : undefined,
      };
    }
    return {
      available: false,
      installed: isInstalled(),
      walletConfigured: false,
      hasBrowserAutomation: false,
      error: String(error),
    };
  }
}

export function cardsRequest(amount: number, description: string): CardRequestResult {
  const rounded = Math.ceil(amount / 5) * 5;
  const { stdout } = run(
    ["cards", "request", "--amount", String(rounded), "--description", description],
    CARDS_REQUEST_TIMEOUT
  );
  const approvalUrl = extractApprovalUrl(stdout);

  return {
    approvalUrl,
    cardId: undefined, // cardId comes from cards list after approval
    message: approvalUrl
      ? `Card request for $${rounded} submitted. Open ${approvalUrl} to approve.`
      : `Card request for $${rounded} submitted. ${stdout.split("\n").slice(-3).join(" ")}`,
  };
}

export function cardsList(): { cards: unknown[] } {
  const { stdout } = run(["cards", "list"]);
  const data = parseJson(stdout) as Record<string, unknown>;
  return { cards: (data.cards as unknown[]) || (data as unknown as unknown[]) || [] };
}

export function cardsReveal(
  cardId: string,
  merchantName: string,
  merchantUrl: string,
  merchantCountry: string
): CardRevealResult {
  const { stdout } = run([
    "cards",
    "reveal",
    "--card-id", cardId,
    "--merchant-name", merchantName,
    "--merchant-url", merchantUrl,
    "--merchant-country", merchantCountry,
  ]);
  const data = parseJson(stdout) as Record<string, unknown>;

  return {
    cardNumber: (data.cardNumber as string) || (data.number as string) || "",
    expiryMonth: (data.expiryMonth as number) || (data.expiry_month as number) || 0,
    expiryYear: (data.expiryYear as number) || (data.expiry_year as number) || 0,
    cvc: (data.cvc as string) || (data.cvv as string) || "",
  };
}

export function cryptoBalance(): CryptoBalanceResult {
  const { stdout } = run(["crypto", "balance"]);
  const data = parseJson(stdout) as Record<string, unknown>;
  return {
    balances: (data.balances as CryptoBalanceResult["balances"]) || [],
  };
}

export function cryptoSend(
  to: string,
  amount: number,
  token?: string
): CryptoSendResult {
  const args = ["crypto", "send", "--to", to, "--amount", String(amount)];
  if (token) args.push("--token", token);
  const { stdout } = run(args, CRYPTO_SEND_TIMEOUT);
  const data = parseJson(stdout) as Record<string, unknown>;

  return {
    txId: (data.txId as string) || (data.tx_hash as string) || "",
    status: (data.status as string) || "submitted",
  };
}

export function cryptoRequest(amount: number, description: string): CryptoRequestResult {
  const { stdout } = run([
    "crypto",
    "request",
    "--amount", String(amount),
    "--description", description,
  ]);
  const approvalUrl = extractApprovalUrl(stdout);

  return {
    approvalUrl,
    message: approvalUrl
      ? `Crypto request for $${amount} submitted. Open ${approvalUrl} to approve.`
      : `Crypto request for $${amount} submitted. ${stdout.split("\n").slice(-3).join(" ")}`,
  };
}

export function x402Fetch(
  url: string,
  options?: { method?: string; body?: string; headers?: string[] }
): X402FetchResult {
  const args = ["x402", "fetch", "--url", url];
  if (options?.method) args.push("--method", options.method);
  if (options?.body) args.push("--body", options.body);
  if (options?.headers) {
    for (const h of options.headers) {
      args.push("--header", h);
    }
  }
  const { stdout } = run(args);
  const data = parseJson(stdout) as Record<string, unknown>;

  return {
    body: (data.body as string) || (data.response as string) || stdout,
    status: (data.status as number) || 0,
  };
}
