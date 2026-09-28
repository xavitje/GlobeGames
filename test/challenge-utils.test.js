import test from "node:test";
import assert from "node:assert/strict";
import { getDailyKey, hashStringToSeed, mulberry32, scoreForDistance } from "../src/games/geoguesser/challenge-utils.js";

test("daily keys use UTC across timezone boundaries", () => {
  assert.equal(getDailyKey(new Date("2026-09-28T23:30:00-02:00")), "2026-09-29");
  assert.equal(getDailyKey(new Date("2026-09-29T01:30:00Z")), "2026-09-29");
});

test("seeded random sequences are deterministic", () => {
  const seed = hashStringToSeed("2026-09-29");
  const first = mulberry32(seed);
  const second = mulberry32(seed);
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
});

test("distance scoring stays within its bounds", () => {
  assert.equal(scoreForDistance(0), 5000);
  assert.equal(scoreForDistance(20015), 0);
  assert.ok(scoreForDistance(1000) < 5000);
});

