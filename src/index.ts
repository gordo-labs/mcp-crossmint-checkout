#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import {
  BasketStore,
  getBasketViewerUrl,
  resolveBasketStorePath,
  resolveBasketViewerPort,
  summarizeBasket,
} from "./basket/store.js";
import {
  BASKET_MODEL_FIELD_GUIDE,
  BasketContextInputSchema,
  CandidateStatusSchema,
  CartItemInputSchema,
  PlatformSessionSchema,
} from "./basket/schema.js";
import { SessionStore } from "./sessions/store.js";
import * as LobsterCash from "./lobster.js";

dotenv.config();

const isProduction = process.env.ENVIRONMENT === 'prod';
const CROSSMINT_API_BASE = isProduction 
  ? "https://www.crossmint.com/api"
  : "https://staging.crossmint.com/api";
const CHAIN = isProduction ? 'ethereum' : 'ethereum-sepolia';
const TOKEN = 'credit';
const USER_AGENT = "crossmint-checkout/1.0";
const basketStore = new BasketStore();
const sessionStore = new SessionStore();
const basketContextToolShape = BasketContextInputSchema.shape as Record<string, z.ZodTypeAny>;
const cartItemInputToolSchema = (CartItemInputSchema as z.ZodTypeAny)
  .describe("Universal cart product candidate with product, price, merchant, evidence, and checkout fields.");
const candidateStatusToolSchema = CandidateStatusSchema as z.ZodTypeAny;

// Create server instance
const server = new McpServer({
  name: "crossmint-checkout",
  version: "1.0.0",
});
const registerTool = server.tool.bind(server) as (...args: any[]) => void;

function textResponse(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function missingCheckoutConfig(): string[] {
  const missing = [];
  if (!process.env.CROSSMINT_API_KEY) {
    missing.push("CROSSMINT_API_KEY");
  }
  if (!process.env.AGENT_WALLET_ADDRESS) {
    missing.push("AGENT_WALLET_ADDRESS");
  }
  return missing;
}

// Helper function for making Crossmint API requests
async function makeCrossmintRequest(
  endpoint: string,
  method: string = "GET",
  body?: any
): Promise<any | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    "X-API-KEY": process.env.CROSSMINT_API_KEY || "",
  };

  try {
    const response = await fetch(`${CROSSMINT_API_BASE}/2022-06-09${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      try {
        const json = await response.json();
        throw new Error(`HTTP error! status: ${json.message}, message: ${json.message}`);
      } catch (error) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
}

// Helper function to sign and submit transaction via Crossmint API
async function createTransaction(serializedTx: string): Promise<string | null> {
  if (!process.env.CROSSMINT_API_KEY || !process.env.AGENT_WALLET_ADDRESS) {
    return null;
  }

  try {

    const response = await fetch(
      `${CROSSMINT_API_BASE}/2022-06-09/wallets/${process.env.AGENT_WALLET_ADDRESS}/transactions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': process.env.CROSSMINT_API_KEY,
        },
        body: JSON.stringify({
          params: {
            calls:[{
              transaction: serializedTx
            }],
            chain: CHAIN
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.status;
    
  } catch (error) {
    console.error("Error submitting transaction via Crossmint:", error);
    return null;
  }
}

registerTool(
  "basket-set-context",
  "Set shopping or research context for the neutral pre-checkout basket",
  basketContextToolShape,
  async (input: any) => {
    const basket = await basketStore.setContext(input);
    return textResponse({
      basket: summarizeBasket(basket),
      storePath: basketStore.path(),
      viewerUrl: getBasketViewerUrl(),
    });
  }
);

registerTool(
  "basket-upsert-product",
  "Add or update a product candidate in the neutral pre-checkout basket",
  {
    item: cartItemInputToolSchema,
  },
  async ({ item }: any) => {
    const result = await basketStore.upsertItem(item);
    return textResponse({
      created: result.created,
      item: result.item,
      basket: summarizeBasket(result.basket),
      viewerUrl: getBasketViewerUrl(),
    });
  }
);

registerTool(
  "basket-list-products",
  "List product candidates currently stored in the pre-checkout basket",
  {
    includeRaw: z.boolean().optional().describe("Return full raw basket data instead of compact UI summary."),
  },
  async ({ includeRaw }: any) => {
    const basket = await basketStore.load();
    return textResponse({
      basket: includeRaw ? basket : summarizeBasket(basket),
      storePath: basketStore.path(),
      viewerUrl: getBasketViewerUrl(),
      modelFields: includeRaw ? BASKET_MODEL_FIELD_GUIDE : undefined,
    });
  }
);

registerTool(
  "basket-update-status",
  "Update a product candidate status without changing the product snapshot",
  {
    id: z.string().describe("Basket item id."),
    status: candidateStatusToolSchema.describe("New candidate status."),
  },
  async ({ id, status }: any) => {
    const item = await basketStore.updateStatus(id, status);
    if (item == null) {
      return textResponse({ error: "Item not found", id });
    }
    return textResponse({
      item,
      basket: summarizeBasket(await basketStore.load()),
      viewerUrl: getBasketViewerUrl(),
    });
  }
);

registerTool(
  "basket-remove-product",
  "Remove a product candidate from the pre-checkout basket",
  {
    id: z.string().describe("Basket item id."),
  },
  async ({ id }: any) => {
    const removed = await basketStore.removeItem(id);
    return textResponse({
      removed,
      basket: summarizeBasket(await basketStore.load()),
      viewerUrl: getBasketViewerUrl(),
    });
  }
);

registerTool(
  "basket-clear",
  "Clear all product candidates from the pre-checkout basket",
  {
    confirm: z.boolean().describe("Must be true to clear the basket."),
  },
  async ({ confirm }: any) => {
    if (confirm !== true) {
      return textResponse({ error: "confirm must be true" });
    }
    return textResponse({
      basket: summarizeBasket(await basketStore.clear()),
      viewerUrl: getBasketViewerUrl(),
    });
  }
);

registerTool(
  "basket-get-viewer",
  "Return the local basket viewer URL, store path, and startup command",
  {},
  async () => {
    const port = resolveBasketViewerPort();
    return textResponse({
      viewerUrl: getBasketViewerUrl(port),
      storePath: resolveBasketStorePath(),
      command: "npm run basket-viewer",
      api: {
        basket: `${getBasketViewerUrl(port)}/api/basket`,
        rawBasket: `${getBasketViewerUrl(port)}/api/basket/raw`,
        addItem: `${getBasketViewerUrl(port)}/api/items`,
      },
    });
  }
);

registerTool(
  "basket-detect-checkout-requirements",
  "Analyze a basket item and determine its checkout provider, auth requirements, and platform metadata. Consults the session store for known sessions on the merchant domain.",
  {
    itemId: z.string().describe("Basket item id to analyze."),
  },
  async ({ itemId }: any) => {
    const basket = await basketStore.load();
    const item = basket.items.find((i: any) => i.id === itemId);
    if (!item) {
      return textResponse({ error: "Item not found", itemId });
    }

    const locator: string | undefined = item.checkout?.locator || item.product.identifiers?.crossmintLocator || item.product.identifiers?.productLocator;
    const sourceUrl: string | undefined = item.product.identifiers?.sourceUrl || item.product.urls?.product;
    const domain: string | undefined = (item.checkout?.sessionDomain as string | undefined) || (item.product.merchant as Record<string, unknown> | undefined)?.domain as string | undefined || (sourceUrl ? new URL(sourceUrl).hostname : undefined);

    // Detect provider from locator
    let provider: "crossmint" | "lobstercash_card" | "lobstercash_crypto" | "merchant" | "manual" | "unknown" = "unknown";
    if (locator) {
      if (locator.startsWith("amazon:") || locator.startsWith("shopify:")) {
        provider = "crossmint";
      }
    }

    // Detect from URL patterns
    if (provider === "unknown" && sourceUrl) {
      try {
        const parsed = new URL(sourceUrl);
        if (parsed.hostname.includes("amazon.com")) provider = "crossmint";
        else if (parsed.pathname.includes("/checkout") || parsed.pathname.includes("/cart")) provider = "lobstercash_card";
      } catch { /* keep unknown */ }
    }

    // Platform checkout info from product
    const platCheckout: any = item.product.platformCheckout;
    const authRequired: boolean = item.checkout?.requiresAuth === true || platCheckout?.authRequired === true;
    const guestCheckoutAvailable: boolean | null = item.checkout?.guestCheckoutAvailable ?? platCheckout?.guestCheckout ?? null;
    const authType: string = item.checkout?.authType || "unknown";

    // Check session store
    let knownSession: Record<string, unknown> | null = null;
    let sessionStatus: string = "none";
    if (domain) {
      knownSession = await sessionStore.getSession(domain) as Record<string, unknown> | null;
      sessionStatus = (knownSession?.status as string) || "none";
    }

    // Build recommendation
    let recommendation: string;
    if (provider === "crossmint") {
      recommendation = "Use create-order with product locator";
    } else if (authRequired && sessionStatus !== "logged_in") {
      recommendation = "Login required before checkout. Use basket-set-session once logged in.";
    } else if (guestCheckoutAvailable) {
      recommendation = "Guest checkout available. Use lobstercash_card for payment.";
    } else if (provider === "lobstercash_card") {
      recommendation = "Use lobstercash cards request";
    } else {
      recommendation = "Manual checkout required — no automated provider detected.";
    }

    // Update item checkout fields
    const readiness: "missing_locator" | "needs_session" | "ready" | "unknown" =
      authRequired && sessionStatus !== "logged_in" ? "needs_session"
      : provider !== "unknown" ? "ready"
      : "unknown";
    const updatedCheckout: Record<string, unknown> = {
      ...(item.checkout as Record<string, unknown> || {}),
      provider,
      requiresAuth: authRequired,
      authType,
      sessionDomain: domain,
      guestCheckoutAvailable: guestCheckoutAvailable ?? undefined,
      readiness,
    };
    await basketStore.upsertItem({ ...item, checkout: updatedCheckout });

    return textResponse({
      itemId,
      provider,
      checkoutRequirements: {
        provider,
        authRequired,
        authType,
        guestCheckoutAvailable,
        sessionStatus,
        knownSession,
        supportedPaymentMethods: platCheckout?.supportedPaymentMethods || [],
        recommendation,
      },
    });
  }
);

registerTool(
  "basket-set-session",
  "Record a platform session for a merchant domain. Used when the agent logs into or registers on a site so future checkouts know the session state.",
  {
    domain: z.string().describe("Merchant domain (e.g. namecheap.com)."),
    status: z.enum(["none", "needs_account", "needs_login", "logged_in"]).describe("Current session status."),
    method: z.enum(["username_password", "oauth_google", "oauth_github", "sso", "magic_link", "api_key", "none"]).optional().describe("Authentication method used."),
    email: z.string().email().optional().describe("Email associated with the session."),
    notes: z.string().optional(),
  },
  async ({ domain, status, method, email, notes }: any) => {
    const session = await sessionStore.setSession(domain, {
      domain,
      status,
      method: method || "none",
      email,
      notes,
      lastVerified: new Date().toISOString(),
    });

    // Update checkout readiness for items matching this domain
    const basket = await basketStore.load();
    const updatedItems = basket.items.map((item: any) => {
      const itemDomain = item.checkout?.sessionDomain || item.product.merchant?.domain;
      if (itemDomain === domain && item.checkout?.requiresAuth && status === "logged_in") {
        return {
          ...item,
          checkout: {
            ...(item.checkout as Record<string, unknown> || {}),
            readiness: "ready",
          },
        };
      }
      return item;
    });

    // Write back only if items changed
    const changed = basket.items.some((item: any, idx: number) => {
      const updated: any = updatedItems[idx];
      return item.checkout?.readiness !== updated.checkout?.readiness;
    });
    if (changed) {
      await basketStore.saveItems(updatedItems);
    }

    const allSessions = await sessionStore.listSessions();
    return textResponse({
      session,
      allSessions,
      itemsUpdated: changed,
    });
  }
);

registerTool(
  "basket-list-sessions",
  "List all known platform sessions across merchant domains. Useful for checking which sites the agent is already logged into.",
  {},
  async () => {
    const sessions = await sessionStore.listSessions();
    return textResponse({ sessions });
  }
);

// ─── Lobster Cash tools ───

registerTool(
  "lobstercash-status",
  "Check Lobster Cash availability, wallet configuration, balances, and installed cards. Use this first before attempting any Lobster Cash payment.",
  {},
  async () => {
    return textResponse(LobsterCash.status());
  }
);

registerTool(
  "lobstercash-cards-request",
  "Request a virtual card with a spending limit through Lobster Cash. The amount is rounded up to the nearest $5. Returns an approval URL for the human to authorize. The card can be revealed later with lobstercash-cards-reveal.",
  {
    amount: z.number().positive().describe("Maximum amount to load on the card (rounded up to nearest $5)."),
    description: z.string().describe("Purchase description (e.g. 'Domain name from Namecheap')."),
    itemId: z.string().optional().describe("Basket item id to link this card request to."),
  },
  async ({ amount, description, itemId }: any) => {
    try {
      const result = LobsterCash.cardsRequest(amount, description);
      if (itemId) {
        const item = (await basketStore.load()).items.find((i: any) => i.id === itemId);
        if (item) {
          await basketStore.upsertItem({
            ...item,
            checkout: {
              ...(item.checkout as Record<string, unknown> || {}),
              provider: "lobstercash_card",
              readiness: "needs_approval",
            },
          });
        }
      }
      return textResponse(result);
    } catch (error: any) {
      return textResponse({
        error: error.message || String(error),
        code: error.code || "unknown",
        available: LobsterCash.isInstalled(),
      });
    }
  }
);

registerTool(
  "lobstercash-cards-reveal",
  "Reveal virtual card details for use in a merchant checkout form. The credentials are single-use and merchant-locked. NEVER log the full card number or CVC — use them only to fill the payment form.",
  {
    cardId: z.string().describe("Card id from lobstercash-cards-request or lobstercash-status."),
    merchantName: z.string().describe("Merchant name (e.g. 'Namecheap')."),
    merchantUrl: z.string().url().describe("Merchant URL (e.g. 'https://www.namecheap.com')."),
    merchantCountry: z.string().length(2).describe("ISO 2-letter merchant country code (e.g. 'US')."),
  },
  async ({ cardId, merchantName, merchantUrl, merchantCountry }: any) => {
    try {
      const result = LobsterCash.cardsReveal(cardId, merchantName, merchantUrl, merchantCountry);
      return textResponse({
        cardNumber: `****${result.cardNumber.slice(-4)}`,
        expiryMonth: result.expiryMonth,
        expiryYear: result.expiryYear,
        cvc: "***",
        raw: result,
        warning: "Use raw.cardNumber and raw.cvc ONLY in the merchant payment form. Never log or display them.",
      });
    } catch (error: any) {
      return textResponse({
        error: error.message || String(error),
        code: error.code || "unknown",
      });
    }
  }
);

registerTool(
  "lobstercash-crypto-balance",
  "Get crypto wallet balances from Lobster Cash. Returns available tokens and amounts for x402 or crypto payments.",
  {},
  async () => {
    try {
      return textResponse(LobsterCash.cryptoBalance());
    } catch (error: any) {
      return textResponse({
        error: error.message || String(error),
        code: error.code || "unknown",
      });
    }
  }
);

registerTool(
  "lobstercash-crypto-send",
  "Send crypto from the Lobster Cash wallet to an address. Supports USDC and other tokens. Use for x402 payments or direct transfers.",
  {
    to: z.string().describe("Destination wallet address."),
    amount: z.number().positive().describe("Amount to send."),
    token: z.string().optional().describe("Token symbol (e.g. 'USDC'). Uses wallet default if omitted."),
  },
  async ({ to, amount, token }: any) => {
    try {
      const result = LobsterCash.cryptoSend(to, amount, token);
      return textResponse(result);
    } catch (error: any) {
      return textResponse({
        error: error.message || String(error),
        code: error.code || "unknown",
      });
    }
  }
);

registerTool(
  "basket-export-crossmint-line-items",
  "Export approved basket candidates as Crossmint create-order lineItems when locators are available",
  {
    itemIds: z.array(z.string()).optional().describe("Optional list of basket item ids. Defaults to approved or ready_for_checkout items."),
  },
  async ({ itemIds }: any) => {
    return textResponse(await basketStore.exportCrossmintLineItems(itemIds));
  }
);

// Register crossmint checkout tool to create orders
registerTool(
  "basket-checkout",
  "Orchestrate checkout for one or more basket items. Detects the provider per item and routes to Crossmint, Lobster Cash cards, or crypto. Processes items sequentially to avoid wallet race conditions.",
  {
    itemIds: z.array(z.string()).optional().describe("Basket item ids to checkout. Defaults to approved or ready_for_checkout items."),
    paymentMethod: z.enum(["crossmint", "lobstercash_card", "lobstercash_crypto", "auto"]).default("auto").describe("Force a specific payment method. 'auto' uses the detected provider."),
  },
  async ({ itemIds, paymentMethod }: any) => {
    const basket = await basketStore.load();
    const candidates = itemIds
      ? basket.items.filter((i: any) => itemIds.includes(i.id))
      : basket.items.filter((i: any) => i.status === "approved" || i.status === "ready_for_checkout");

    if (candidates.length === 0) {
      return textResponse({ error: "No items to checkout. Approve items first or provide itemIds." });
    }

    const results: any[] = [];
    for (const item of candidates) {
      const provider = paymentMethod === "auto"
        ? (item.checkout?.provider || "unknown")
        : paymentMethod;

      try {
        if (provider === "crossmint") {
          const locator = item.checkout?.locator || item.product.identifiers?.crossmintLocator || item.product.identifiers?.productLocator;
          if (!locator) {
            results.push({ itemId: item.id, provider, status: "failed", details: { error: "No checkout locator for this item." } });
            continue;
          }
          const missing = missingCheckoutConfig();
          if (missing.length > 0) {
            results.push({ itemId: item.id, provider, status: "failed", details: { error: "Crossmint not configured.", missingEnv: missing } });
            continue;
          }
          // Create order via Crossmint API
          const envRecipient = {
            email: process.env.RECIPIENT_EMAIL,
            physicalAddress: {
              name: process.env.RECIPIENT_NAME,
              line1: process.env.RECIPIENT_ADDRESS_LINE1,
              line2: process.env.RECIPIENT_ADDRESS_LINE2 || "",
              city: process.env.RECIPIENT_CITY,
              state: process.env.RECIPIENT_STATE,
              postalCode: process.env.RECIPIENT_POSTAL_CODE,
              country: process.env.RECIPIENT_COUNTRY,
            },
          };
          const resp = await makeCrossmintRequest("/orders", "POST", {
            recipient: envRecipient,
            payment: { method: CHAIN, currency: TOKEN, payerAddress: process.env.AGENT_WALLET_ADDRESS, receiptEmail: process.env.RECIPIENT_EMAIL },
            lineItems: [{ productLocator: locator }],
          });
          const txId = resp.order?.payment?.preparation?.serializedTransaction;
          if (txId) await createTransaction(txId);
          await basketStore.upsertItem({ ...item, checkout: { ...(item.checkout as Record<string, unknown> || {}), orderId: resp.order?.orderId, readiness: "ready" }, status: "ordered" });
          results.push({ itemId: item.id, provider, status: "ordered", details: { orderId: resp.order?.orderId } });

        } else if (provider === "lobstercash_card") {
          if (!LobsterCash.isInstalled()) {
            results.push({ itemId: item.id, provider, status: "failed", details: { error: "Lobster Cash CLI not installed. Run: npm install -g @crossmint/lobster-cli" } });
            continue;
          }
          const domain = item.checkout?.sessionDomain || item.product.merchant?.domain;
          if (item.checkout?.requiresAuth && domain) {
            const session = await sessionStore.getSession(domain as string);
            if (!session || session.status !== "logged_in") {
              await basketStore.upsertItem({ ...item, checkout: { ...(item.checkout as Record<string, unknown> || {}), readiness: "needs_session" } });
              results.push({ itemId: item.id, provider, status: "needs_session", details: { domain, message: "Login required. Use basket-set-session after logging in." } });
              continue;
            }
          }
          const price = (item.product.price as any)?.current?.amount || (item.product.price as any)?.amount || 0;
          const description = `Purchase: ${item.product.title}`;
          const card = LobsterCash.cardsRequest(price, description);
          await basketStore.upsertItem({ ...item, checkout: { ...(item.checkout as Record<string, unknown> || {}), readiness: "needs_approval" } });
          results.push({ itemId: item.id, provider, status: "needs_approval", details: { approvalUrl: card.approvalUrl, cardId: card.cardId, message: card.message, nextStep: "Human must approve the card, then use lobstercash-cards-reveal to get card details." } });

        } else if (provider === "lobstercash_crypto") {
          if (!LobsterCash.isInstalled()) {
            results.push({ itemId: item.id, provider, status: "failed", details: { error: "Lobster Cash CLI not installed." } });
            continue;
          }
          const bal = LobsterCash.cryptoBalance();
          const price = (item.product.price as any)?.current?.amount || (item.product.price as any)?.amount || 0;
          const hasFunds = (bal.balances || []).some((b: any) => parseFloat(b.amount || "0") >= price);
          if (!hasFunds) {
            results.push({ itemId: item.id, provider, status: "failed", details: { error: "Insufficient crypto funds.", balances: bal.balances, suggestion: "Use lobstercash crypto request to request more funds." } });
            continue;
          }
          results.push({ itemId: item.id, provider, status: "needs_approval", details: { balances: bal.balances, nextStep: "Use lobstercash-crypto-send with the merchant's wallet address or lobstercash x402-fetch for x402 payments." } });

        } else {
          results.push({ itemId: item.id, provider, status: "failed", details: { error: `No automated checkout available. Provider: ${provider}. Use manual checkout.` } });
        }
      } catch (error: any) {
        results.push({ itemId: item.id, provider, status: "failed", details: { error: error.message || String(error) } });
      }
    }

    return textResponse({
      results,
      summary: {
        total: results.length,
        ordered: results.filter((r: any) => r.status === "ordered").length,
        needsApproval: results.filter((r: any) => r.status === "needs_approval").length,
        needsSession: results.filter((r: any) => r.status === "needs_session").length,
        failed: results.filter((r: any) => r.status === "failed").length,
      },
      viewerUrl: getBasketViewerUrl(),
    });
  }
);

registerTool(
  "create-order",
  "Create a new order for a product",
  {
    lineItems: z.array(
      z.object({
        productLocator: z.string()
          .describe("The product locator. Ex: 'amazon:<amazon_product_url>', 'amazon:<asin>', 'shopify:<product-url>:<variant-id>'"),
      })
    ).length(1).describe("Item to purchase"),
    paymentMethod: z.enum(["crossmint", "lobstercash_card", "lobstercash_crypto"]).default("crossmint").optional().describe("Payment method. Default: crossmint."),
  },
  async ({
    lineItems
  }: any) => {

    try {
      const missing = missingCheckoutConfig();
      if (missing.length > 0) {
        return textResponse({
          error: "Crossmint checkout is not configured. Basket tools still work.",
          missingEnv: missing,
        });
      }

      const envRecipient = {
        email: process.env.RECIPIENT_EMAIL,
        physicalAddress: {
          name: process.env.RECIPIENT_NAME,
          line1: process.env.RECIPIENT_ADDRESS_LINE1,
          line2: process.env.RECIPIENT_ADDRESS_LINE2 || '',
          city: process.env.RECIPIENT_CITY,
          state: process.env.RECIPIENT_STATE,
          postalCode: process.env.RECIPIENT_POSTAL_CODE,
          country: process.env.RECIPIENT_COUNTRY,
        }
      };
  
      const orderData = {
        recipient: envRecipient,
        payment: {
          method: CHAIN,
          currency: TOKEN,
          payerAddress: process.env.AGENT_WALLET_ADDRESS,
          receiptEmail: process.env.RECIPIENT_EMAIL,
        },
        lineItems,
      };

      const response = await makeCrossmintRequest("/orders", "POST", orderData);

      const serializedTx = response.order.payment.preparation.serializedTransaction;

      const orderId = response.order.orderId;

      const status = await createTransaction(serializedTx);

      return {
        content: [
          { 
            type: "text",
            text: `Your request was successfully submitted! Order ID: ${orderId}. Order status: ${status}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to process order: ${JSON.stringify(error, null, 2)}`,
          },
        ],
      };
    }
  }
);


registerTool(
  "check-order",
  "Check the status of an existing order",
  {
    orderId: z.string().describe("The order ID to check"),
  },
  async ({ orderId }: any) => {
    try {
      if (!process.env.CROSSMINT_API_KEY) {
        return textResponse({
          error: "Crossmint checkout is not configured.",
          missingEnv: ["CROSSMINT_API_KEY"],
        });
      }

      const response = await makeCrossmintRequest(`/orders/${orderId}`);

      return {
        content: [
          { 
            type: "text",
            text: `Status: \n - Order is ${JSON.stringify(response.phase, null, 2)} \n - Payment is ${JSON.stringify(response.lineItems[0].delivery.status, null, 2)}`,
          },
        ],
      };

    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve order status",
          },
        ],
      };
    }
  }
);

// Get balance tool
registerTool(
  "get-usd-balance",
  "Get the USD balance of the wallet",
  {},
  async () => {
    try {
      const missing = missingCheckoutConfig();
      if (missing.length > 0) {
        return textResponse({
          error: "Crossmint checkout is not configured.",
          missingEnv: missing,
        });
      }

      const address = process.env.AGENT_WALLET_ADDRESS;

      const response = await fetch(
        `${CROSSMINT_API_BASE}/v1-alpha2/wallets/${address}/balances?tokens=${TOKEN}&chains=${CHAIN}`,
        {
          headers: {
            "X-API-KEY": process.env.CROSSMINT_API_KEY || "",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        content: [
          {
            type: "text",
            text: `USD Balance: ${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get USD balance: ${JSON.stringify(error, null, 2)}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
