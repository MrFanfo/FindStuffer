#!/usr/bin/env node
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_BUDGETS = {
  initial_render: 2500,
  search: 1200,
  rapid_search_final: 1400,
  open_detail: 1400,
  add_item: 1800,
  quantity_feedback: 250,
  quantity_backend_sync: 1500,
  repeated_quantity_taps_latency: 3000,
};

function parseArgs(argv) {
  const args = {
    baseUrl: "http://127.0.0.1:8010",
    chromium: process.env.CHROMIUM_BIN || "chromium",
    headless: true,
    iterations: 4,
    seedCount: 160,
    budgetScale: 1,
    port: 9225,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url") { args.baseUrl = next; index += 1; }
    else if (arg === "--chromium") { args.chromium = next; index += 1; }
    else if (arg === "--iterations") { args.iterations = Number(next); index += 1; }
    else if (arg === "--seed-count") { args.seedCount = Number(next); index += 1; }
    else if (arg === "--budget-scale") { args.budgetScale = Number(next); index += 1; }
    else if (arg === "--port") { args.port = Number(next); index += 1; }
    else if (arg === "--headed") args.headless = false;
    else if (arg === "--help") {
      console.log("Usage: node scripts/frontend-perf-check.mjs [--base-url URL] [--iterations N] [--seed-count N] [--budget-scale N] [--chromium PATH] [--headed]");
      process.exit(0);
    }
  }
  return args;
}

async function apiRequest(baseUrl, method, apiPath, body) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${apiPath}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${method} ${apiPath} failed: ${response.status} ${text}`);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

async function waitForHttp(url, timeoutMs = 12000) {
  const started = performance.now();
  let lastError;
  while (performance.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.round((ordered.length - 1) * fraction)));
  return ordered[index];
}

function stats(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

async function seedData(baseUrl, count) {
  await apiRequest(baseUrl, "GET", "/api/v1/health");
  const suffix = String(Date.now());
  const home = await apiRequest(baseUrl, "POST", "/api/v1/locations", {
    name: `Frontend Perf Home ${suffix}`,
    kind: "home",
    parent_public_id: null,
  });
  const shelf = await apiRequest(baseUrl, "POST", "/api/v1/locations", {
    name: "Frontend Perf Shelf",
    kind: "shelf",
    parent_public_id: home.public_id,
  });
  const items = [];
  for (let index = 0; index < Math.max(1, count); index += 1) {
    const padded = String(index).padStart(3, "0");
    const item = await apiRequest(baseUrl, "POST", "/api/v1/items", {
      name: `Frontend Perf Item ${suffix}-${padded}`,
      description: `Seeded by scripts/frontend-perf-check.mjs group ${index % 9}`,
      quantity: String((index % 7) + 1),
      unit: "pcs",
      location_public_id: shelf.public_id,
      expiration_date: "2026-12-31",
      low_stock_threshold: index % 11 === 0 ? "2" : null,
      brand: `PerfBrand ${index % 5}`,
      model: `PerfModel ${index % 13}`,
    });
    items.push(item);
  }
  for (const item of items.slice(0, 12)) {
    await apiRequest(baseUrl, "POST", `/api/v1/items/${item.public_id}/maintenance`, {
      title: "Frontend perf maintenance",
      notes: "Loaded by the detail perf path",
      interval_days: 30,
      last_completed_at: null,
      next_due_at: "2026-12-31",
    });
  }
  return { suffix, home, shelf, items };
}

class DevToolsSocket {
  constructor(url) {
    this.url = new URL(url);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      const host = this.url.hostname;
      const port = Number(this.url.port || 80);
      const requestPath = `${this.url.pathname}${this.url.search}`;
      let handshake = Buffer.alloc(0);
      const socket = net.createConnection({ host, port });
      this.socket = socket;
      socket.once("error", reject);
      socket.on("connect", () => {
        socket.write([
          `GET ${requestPath} HTTP/1.1`,
          `Host: ${host}:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n"));
      });
      socket.on("data", (chunk) => {
        if (!this.connected) {
          handshake = Buffer.concat([handshake, chunk]);
          const marker = handshake.indexOf("\r\n\r\n");
          if (marker === -1) return;
          const header = handshake.subarray(0, marker).toString("utf8");
          if (!header.startsWith("HTTP/1.1 101")) {
            reject(new Error(`Chrome DevTools upgrade failed: ${header.split("\r\n")[0]}`));
            return;
          }
          this.connected = true;
          socket.off("error", reject);
          const rest = handshake.subarray(marker + 4);
          if (rest.length) this.readFrames(rest);
          resolve();
          return;
        }
        this.readFrames(chunk);
      });
      socket.on("close", () => {
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error("DevTools socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  readFrames(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        length = high * 2 ** 32 + low;
        offset += 8;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x1) this.handleMessage(payload.toString("utf8"));
      else if (opcode === 0x8) this.close();
      else if (opcode === 0x9) this.sendFrame(payload, 0xA);
    }
  }

  handleMessage(text) {
    const message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method) this.events.push(message);
  }

  send(method, params = {}, timeoutMs = 10000) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    this.sendFrame(Buffer.from(payload, "utf8"), 0x1);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method });
    });
  }

  sendFrame(payload, opcode) {
    if (!this.socket) throw new Error("DevTools socket is not connected");
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | payload.length;
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(payload.length, 6);
    }
    header[0] = 0x80 | opcode;
    const maskedPayload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    this.socket.write(Buffer.concat([header, mask, maskedPayload]));
  }

  close() {
    if (this.socket && !this.socket.destroyed) this.socket.end();
  }
}

async function launchChromium(options) {
  const userDataDir = path.join(tmpdir(), `findstuff-frontend-perf-${process.pid}`);
  const args = [
    options.headless ? "--headless=new" : "",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ].filter(Boolean);
  const chrome = spawn(options.chromium, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 6000) stderr = stderr.slice(-6000);
  });
  chrome.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`Chromium exited with ${code}\n${stderr}`);
  });
  await waitForHttp(`http://127.0.0.1:${options.port}/json/version`, 10000);
  const target = await fetch(`http://127.0.0.1:${options.port}/json/new?${encodeURIComponent(options.baseUrl)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = new DevToolsSocket(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  return {
    cdp,
    async close() {
      try { await cdp.send("Browser.close", {}, 1000); } catch { chrome.kill("SIGTERM"); }
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

async function evalPage(cdp, source, args = [], timeoutMs = 10000) {
  const expression = `(${source})(...${JSON.stringify(args)})`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime evaluation failed";
    throw new Error(detail);
  }
  return result.result?.value;
}

async function installHelpers(cdp) {
  await evalPage(cdp, () => {
    window.__findstuffPerf = {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      visible: (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
      },
      text: () => document.body.textContent || "",
      async waitFor(predicate, timeoutMs = 5000) {
        const started = performance.now();
        while (performance.now() - started < timeoutMs) {
          if (predicate()) return true;
          await this.sleep(35);
        }
        throw new Error("Timed out waiting for UI state");
      },
      clickSelector(selector) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing selector ${selector}`);
        element.click();
      },
      clickButtonText(text, rootSelector = "body") {
        const root = document.querySelector(rootSelector) || document;
        const element = Array.from(root.querySelectorAll("button, a")).find((entry) =>
          (entry.textContent || "").replace(/\s+/g, " ").trim().includes(text)
        );
        if (!element) throw new Error(`Missing button/link text ${text}`);
        element.click();
      },
      setValue(selector, value) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing input ${selector}`);
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
        if (descriptor?.set) descriptor.set.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      },
      setLabelValue(labelText, value) {
        const label = Array.from(document.querySelectorAll("label")).find((entry) =>
          (entry.textContent || "").replace(/\s+/g, " ").trim().includes(labelText)
        );
        if (!label) throw new Error(`Missing label ${labelText}`);
        const element = label.querySelector("input, textarea, select");
        if (!element) throw new Error(`Missing control for ${labelText}`);
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
        if (descriptor?.set) descriptor.set.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      },
      firstQuantity() {
        const value = document.querySelector(".item-card .quantity strong")?.textContent || "";
        return Number(value.replace(",", "."));
      },
    };
  });
}

function perfUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set("perf", "1");
  return url.toString();
}

async function navigate(cdp, baseUrl) {
  await cdp.send("Page.navigate", { url: perfUrl(baseUrl) });
  await evalPage(cdp, async () => {
    await new Promise((resolve) => {
      if (document.readyState === "complete") resolve();
      else window.addEventListener("load", resolve, { once: true });
    });
  }, [], 15000);
  await installHelpers(cdp);
}

async function waitForApp(cdp) {
  await evalPage(cdp, async () => {
    await window.__findstuffPerf.waitFor(() =>
      Boolean(document.querySelector(".bottom-nav")) &&
      document.body.textContent.includes("Findstuff") &&
      !document.querySelector(".splash"),
    8000);
  }, [], 9000);
}

async function measure(samples, name, action) {
  const started = performance.now();
  await action();
  samples[name].push(performance.now() - started);
}

async function runDelayedFetchLoop(cdp, eventStartIndex, delayMs, shouldRun) {
  const seen = new Set();
  while (shouldRun()) {
    const events = cdp.events.slice(eventStartIndex);
    for (const event of events) {
      if (event.method !== "Fetch.requestPaused") continue;
      const requestId = event.params?.requestId;
      if (!requestId || seen.has(requestId)) continue;
      seen.add(requestId);
      await sleep(delayMs);
      await cdp.send("Fetch.continueRequest", { requestId }, 5000).catch(() => undefined);
    }
    await sleep(20);
  }
}

async function runChecks(options, seed) {
  const browser = await launchChromium(options);
  const samples = Object.fromEntries(Object.keys(DEFAULT_BUDGETS).map((key) => [key, []]));
  try {
    await measure(samples, "initial_render", async () => {
      await navigate(browser.cdp, options.baseUrl);
      await waitForApp(browser.cdp);
    });

    for (let index = 0; index < Math.max(1, options.iterations); index += 1) {
      const item = seed.items[index % seed.items.length];
      const exactTerm = item.name;
      await measure(samples, "search", async () => {
        await evalPage(browser.cdp, async (term) => {
          window.__findstuffPerf.clickButtonText("Inventory", ".bottom-nav");
          await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".inventory-page input[type='search']")));
          window.__findstuffPerf.setValue(".search-large input[type='search']", term);
          window.__findstuffPerf.clickSelector(".search-submit");
          await window.__findstuffPerf.waitFor(() =>
            document.querySelectorAll(".item-card").length > 0 &&
            window.__findstuffPerf.text().includes(term),
          6000);
        }, [exactTerm], 7000);
      });

      await measure(samples, "open_detail", async () => {
        await evalPage(browser.cdp, async () => {
          await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".item-card .item-main")), 6000);
          window.__findstuffPerf.clickSelector(".item-card .item-main");
          await window.__findstuffPerf.waitFor(() =>
            Boolean(document.querySelector(".detail-sheet")) &&
            window.__findstuffPerf.text().includes("Frontend perf maintenance"),
          6000);
          window.__findstuffPerf.clickSelector(".detail-header .icon-button");
          await window.__findstuffPerf.waitFor(() => !document.querySelector(".detail-sheet"));
        }, [], 7000);
      });
    }

    await measure(samples, "rapid_search_final", async () => {
      const terms = seed.items.slice(0, 5).map((item) => item.name);
      const finalTerm = terms[terms.length - 1];
      await evalPage(browser.cdp, async (searchTerms, lastTerm) => {
        window.__findstuffPerf.clickButtonText("Inventory", ".bottom-nav");
        await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".inventory-page input[type='search']")));
        for (const term of searchTerms) {
          window.__findstuffPerf.setValue(".search-large input[type='search']", term);
          window.__findstuffPerf.clickSelector(".search-submit");
        }
        await window.__findstuffPerf.waitFor(() =>
          document.querySelectorAll(".item-card").length === 1 &&
          window.__findstuffPerf.text().includes(lastTerm),
        7000);
        const visibleText = window.__findstuffPerf.text();
        for (const term of searchTerms.slice(0, -1)) {
          if (visibleText.includes(term)) {
            throw new Error(`Stale search result is visible for ${term}`);
          }
        }
      }, [terms, finalTerm], 8000);
    });

    await evalPage(browser.cdp, async () => {
      window.__findstuffPerf.clickButtonText("Inventory", ".bottom-nav");
      await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".inventory-page input[type='search']")));
      window.__findstuffPerf.setValue(".search-large input[type='search']", "Frontend Perf");
      window.__findstuffPerf.clickSelector(".search-submit");
      await window.__findstuffPerf.sleep(100);
      await window.__findstuffPerf.waitFor(() =>
        document.querySelectorAll(".item-card").length > 0 &&
        !document.querySelector(".activity-banner"),
      6000);
    }, [], 7000);

    for (let index = 0; index < Math.max(1, options.iterations); index += 1) {
      const itemName = `Frontend Perf Added ${seed.suffix}-${index}`;
      await measure(samples, "add_item", async () => {
        await evalPage(browser.cdp, async () => {
          window.__findstuffPerf.clickButtonText("Capture", ".bottom-nav");
          await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".scan-page")));
          window.__findstuffPerf.clickButtonText("Quick add", ".capture-modes");
          await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".scan-entry")));
          document.querySelector(".scan-entry input[placeholder='Item name']").focus();
        });
        await browser.cdp.send("Input.insertText", { text: itemName });
        await evalPage(browser.cdp, async (name) => {
          try {
            await window.__findstuffPerf.waitFor(() => {
              const button = Array.from(document.querySelectorAll(".scan-entry button")).find((entry) => (entry.textContent || "").includes("Save item"));
              return button && !button.disabled;
            });
          } catch {
            const field = document.querySelector(".scan-entry input[placeholder='Item name']");
            const save = Array.from(document.querySelectorAll(".scan-entry button")).find((entry) => (entry.textContent || "").includes("Save item"));
            throw new Error(`Quick capture did not become saveable (name=${field?.value || "missing"}, disabled=${save?.disabled ?? "missing"}, activity=${document.querySelector(".activity-banner")?.textContent || "none"})`);
          }
          window.__findstuffPerf.clickButtonText("Save item", ".scan-entry");
          await window.__findstuffPerf.waitFor(() => !document.querySelector(".scan-entry"), 7000);
          window.__findstuffPerf.clickButtonText("Inventory", ".bottom-nav");
          await window.__findstuffPerf.waitFor(() =>
            Boolean(document.querySelector(".inventory-page")) &&
            window.__findstuffPerf.text().includes(name),
          7000);
        }, [itemName], 8000);
      });
    }

    const quantityItem = seed.items[0];
    const before = await apiRequest(options.baseUrl, "GET", `/api/v1/items/${quantityItem.public_id}`);
    const expected = Number(before.quantity) + 1;
    await evalPage(browser.cdp, async (term) => {
      window.__findstuffPerf.clickButtonText("Inventory", ".bottom-nav");
      await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".inventory-page input[type='search']")));
      window.__findstuffPerf.setValue(".search-large input[type='search']", term);
      window.__findstuffPerf.clickSelector(".search-submit");
      await window.__findstuffPerf.waitFor(() =>
        document.querySelectorAll(".item-card").length === 1 &&
        window.__findstuffPerf.text().includes(term),
      6000);
    }, [quantityItem.name], 7000);

    await measure(samples, "quantity_feedback", async () => {
      await evalPage(browser.cdp, async (nextQuantity) => {
        await window.__findstuffPerf.waitFor(() => Array.from(document.querySelectorAll(".item-card .quick-actions button")).some((entry) =>
          (entry.getAttribute("aria-label") || "").startsWith("Add one")
        ), 1000);
        const button = Array.from(document.querySelectorAll(".item-card .quick-actions button")).find((entry) =>
          (entry.getAttribute("aria-label") || "").startsWith("Add one")
        );
        if (!button) throw new Error("Missing quick add button");
        button.click();
        await window.__findstuffPerf.waitFor(() => window.__findstuffPerf.firstQuantity() === nextQuantity, 1000);
      }, [expected], 1200);
    });

    await measure(samples, "quantity_backend_sync", async () => {
      const started = performance.now();
      while (performance.now() - started < 2500) {
        const current = await apiRequest(options.baseUrl, "GET", `/api/v1/items/${quantityItem.public_id}`);
        if (Number(current.quantity) === expected) return;
        await sleep(60);
      }
      throw new Error(`Backend quantity did not reach ${expected}`);
    });

    const repeatedItem = seed.items[1] || seed.items[0];
    const repeatedBefore = await apiRequest(options.baseUrl, "GET", `/api/v1/items/${repeatedItem.public_id}`);
    const repeatedExpected = Number(repeatedBefore.quantity) + 5;
    await evalPage(browser.cdp, async (term) => {
      window.__findstuffPerf.clickButtonText("Inventory", ".bottom-nav");
      await window.__findstuffPerf.waitFor(() => Boolean(document.querySelector(".inventory-page input[type='search']")));
      window.__findstuffPerf.setValue(".search-large input[type='search']", term);
      window.__findstuffPerf.clickSelector(".search-submit");
      await window.__findstuffPerf.waitFor(() =>
        document.querySelectorAll(".item-card").length === 1 &&
        window.__findstuffPerf.text().includes(term),
      6000);
    }, [repeatedItem.name], 7000);

    const eventStartIndex = browser.cdp.events.length;
    let delayingAdjustments = true;
    await browser.cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*adjust-quantity*", requestStage: "Request" }],
    });
    const delayLoop = runDelayedFetchLoop(browser.cdp, eventStartIndex, 350, () => delayingAdjustments);
    try {
      await measure(samples, "repeated_quantity_taps_latency", async () => {
        await evalPage(browser.cdp, async (nextQuantity) => {
          await window.__findstuffPerf.waitFor(() => Array.from(document.querySelectorAll(".item-card .quick-actions button")).some((entry) =>
            (entry.getAttribute("aria-label") || "").startsWith("Add one")
          ), 1000);
          for (let index = 0; index < 5; index += 1) {
            const button = Array.from(document.querySelectorAll(".item-card .quick-actions button")).find((entry) =>
              (entry.getAttribute("aria-label") || "").startsWith("Add one")
            );
            if (!button) throw new Error("Missing quick add button");
            button.click();
            await window.__findstuffPerf.sleep(25);
          }
          await window.__findstuffPerf.waitFor(() => window.__findstuffPerf.firstQuantity() === nextQuantity, 1200);
        }, [repeatedExpected], 1500);

        const started = performance.now();
        while (performance.now() - started < 5000) {
          const current = await apiRequest(options.baseUrl, "GET", `/api/v1/items/${repeatedItem.public_id}`);
          if (Number(current.quantity) === repeatedExpected) return;
          await sleep(80);
        }
        throw new Error(`Backend quantity did not reach ${repeatedExpected} after repeated taps`);
      });
    } finally {
      delayingAdjustments = false;
      await delayLoop;
      await browser.cdp.send("Fetch.disable").catch(() => undefined);
    }

    const resources = await evalPage(browser.cdp, () =>
      performance.getEntriesByType("resource")
        .map((entry) => ({
          name: entry.name.replace(location.origin, ""),
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize || 0,
        }))
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 8)
    );
    const text = await evalPage(browser.cdp, () => document.body.textContent || "");
    const browserIssues = browser.cdp.events.filter((event) => {
      if (event.method === "Runtime.exceptionThrown") return true;
      if (event.method === "Log.entryAdded") return ["error", "warning"].includes(event.params.entry.level);
      if (event.method === "Runtime.consoleAPICalled") return event.params.type === "error";
      return false;
    });
    const networkFailures = browser.cdp.events.filter((event) => (
      event.method === "Network.loadingFailed" &&
      event.params.type === "Fetch" &&
      !event.params.canceled
    ));
    if (/aborted|timed out|failed/i.test(text)) {
      throw new Error("The UI displayed a failed/aborted request message during the perf run");
    }
    return { samples, resources, browserIssues, networkFailures };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const budgets = Object.fromEntries(
    Object.entries(DEFAULT_BUDGETS).map(([key, value]) => [key, value * options.budgetScale]),
  );
  console.log(`Frontend performance check against ${options.baseUrl}`);
  console.log(`seed_count=${options.seedCount} iterations=${options.iterations} chromium=${options.chromium}`);
  const seed = await seedData(options.baseUrl, options.seedCount);
  const { samples, resources, browserIssues, networkFailures } = await runChecks(options, seed);
  const failures = [];
  for (const [name, values] of Object.entries(samples)) {
    if (values.length === 0) continue;
    const summary = stats(values);
    const budget = budgets[name];
    const verdict = summary.p95 <= budget ? "OK" : "SLOW";
    console.log(`${name.padEnd(23)} p50=${summary.p50.toFixed(1).padStart(7)}ms p95=${summary.p95.toFixed(1).padStart(7)}ms max=${summary.max.toFixed(1).padStart(7)}ms budget=${budget.toFixed(0).padStart(5)}ms ${verdict}`);
    if (summary.p95 > budget) failures.push(name);
  }
  if (resources.length) {
    console.log("slow_resources");
    for (const resource of resources) {
      console.log(`  ${String(resource.duration).padStart(5)}ms ${String(resource.transferSize).padStart(8)}b ${resource.name}`);
    }
  }
  if (browserIssues.length) {
    console.log("browser_issues");
    for (const issue of browserIssues.slice(0, 8)) {
      console.log(`  ${issue.method}: ${JSON.stringify(issue.params).slice(0, 400)}`);
    }
    failures.push("browser_issues");
  }
  if (networkFailures.length) {
    console.log("network_failures");
    for (const issue of networkFailures.slice(0, 8)) {
      console.log(`  ${issue.params.errorText || "network failure"} ${issue.params.blockedReason || ""}`);
    }
    failures.push("network_failures");
  }
  if (failures.length) {
    console.log(`Slow or failed frontend checks: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
