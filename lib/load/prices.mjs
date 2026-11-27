// LAYER 1: LOADING. The price file.
//
// Reads ~/.dclaude_costs.json (or ~/dclaude_costs.json) and decodes it into per-token rates.
// Names without the ".json" suffix are not read. Pricing calls with those rates is a transformation (lib/transform/costs.mjs).
//
// This layer never prints or exits: a malformed file is thrown as an Error whose `path` says
// which file, and bin/dclaude.mjs reports it. It imports nothing from the other layers.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COST_FILES = [".dclaude_costs.json", "dclaude_costs.json"].map((f) => join(homedir(), f));
const COST_KEYS = ["input", "output", "5mPromptCacheWrite", "60mPromptCacheWrite", "hitAndRefresh"];

/**
 * The price table from ~/.dclaude_costs.json (or ~/dclaude_costs.json), or null if neither exists:
 *   { "<model>": { "input": { "dollarCost": 5, "perTokens": 1000000 }, "output": {...},
 *                  "5mPromptCacheWrite": {...}, "60mPromptCacheWrite": {...}, "hitAndRefresh": {...},
 *                  "overPromptTokens": { "100000": { <the same five prices> } },
 *                  "multipliers": { "batch": 0.5, "fast": 2, "us-inference": 1.1 } } }
 * "overPromptTokens" is optional: prices for calls whose prompt (new-input + cache_write +
 * cache_read) is over the given size. "multipliers" is optional too: keyed by the names the
 * flags column uses, each scales every price of a call that has that flag. Numbers, and the
 * overPromptTokens keys, may use digit separators (1_000_000). Returns
 * { model: { base: rates, tiers: [{ over, rates }] (largest first), multipliers } },
 * where rates are { key: dollars per token }. Throws an Error with `path` set if the file
 * is malformed.
 */
function loadCosts(path = COST_FILES.find((p) => existsSync(p))) {
  if (!path) return null;
  try {
    return parseCosts(readFileSync(path, "utf8"));
  } catch (e) {
    throw Object.assign(new Error(e.message), { path });
  }
}

const fail = (why) => {
  throw new Error(why);
};
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

/** The price table's text -> rates (see loadCosts). Throws an Error saying what is wrong. */
function parseCosts(text) {
  // Drop "_" between digits outside strings, so 1_000_000 parses.
  const table = JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|(?<=\d)_(?=\d)/g, (m, s) => s ?? ""));
  if (!isObj(table)) fail("expected an object keyed by model name");
  const pricesOf = (entry, where) => {
    const r = {};
    for (const k of COST_KEYS) {
      const { dollarCost, perTokens } = entry?.[k] ?? {};
      if (typeof dollarCost !== "number" || typeof perTokens !== "number" || perTokens <= 0) {
        fail(`${where}.${k} needs numeric dollarCost and positive perTokens`);
      }
      r[k] = dollarCost / perTokens;
    }
    return r;
  };
  const rates = {};
  for (const [model, entry] of Object.entries(table)) {
    const over = entry?.overPromptTokens ?? {};
    if (!isObj(over)) fail(`${model}.overPromptTokens must be an object keyed by prompt size`);
    const tiers = Object.entries(over).map(([size, prices]) => {
      const n = Number(size.replaceAll("_", ""));
      if (!Number.isInteger(n) || n < 0)
        fail(`${model}.overPromptTokens: "${size}" is not a token count`);
      return { over: n, rates: pricesOf(prices, `${model}.overPromptTokens.${size}`) };
    });
    const multipliers = entry?.multipliers ?? {};
    if (!isObj(multipliers)) fail(`${model}.multipliers must be an object keyed by flag name`);
    for (const [flag, x] of Object.entries(multipliers)) {
      if (typeof x !== "number" || x < 0)
        fail(`${model}.multipliers.${flag} must be a non-negative number`);
    }
    rates[model] = {
      base: pricesOf(entry, model),
      tiers: tiers.toSorted((a, b) => b.over - a.over),
      multipliers,
    };
  }
  return rates;
}

export { loadCosts, parseCosts };
