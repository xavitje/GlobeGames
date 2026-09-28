import test from "node:test";
import assert from "node:assert/strict";
import { bonusLabel, randomSabotage } from "../src/games/geoguesser/bonuses.js";

test("the third sabotage disorients instead of removing a compass", () => {
  assert.equal(randomSabotage(() => 0.99), "spin");
  assert.equal(bonusLabel("spin", "en"), "Disorient");
  assert.equal(bonusLabel("spin", "nl"), "Desoriënteer");
});

