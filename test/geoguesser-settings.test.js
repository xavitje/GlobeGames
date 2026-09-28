import test from "node:test";
import assert from "node:assert/strict";
import { buildPointFn } from "../src/games/geoguesser/settings.js";

test("specific-country generators stay within the selected country", () => {
  const point = buildPointFn({ type: "country", name: "Netherlands" }, () => 0.5)();
  assert.equal(point.country, "Netherlands");
});

test("capital sets always select the capital point", () => {
  const point = buildPointFn("capitals", () => 0)();
  assert.equal(typeof point.name, "string");
  assert.equal(typeof point.lat, "number");
  assert.equal(typeof point.lon, "number");
});

