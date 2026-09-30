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

test("landmarks use their actual country as the answer", () => {
  const point = buildPointFn("landmarks", () => 0.16)();
  assert.equal(point.name, "Vrijheidsbeeld (VS)");
  assert.equal(point.country, "United States of America");
});

test("standard world rounds never expose the landmark category as a country", () => {
  const point = buildPointFn("world", () => 0.999)();
  assert.notEqual(point.country, "Beroemde Bezienswaardigheden");
});

