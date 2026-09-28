import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlayerName } from "../src/lib/multiplayer.js";

test("player names are trimmed, bounded and stripped of controls", () => {
  assert.equal(normalizePlayerName("  Rafi\n  "), "Rafi");
  assert.equal(normalizePlayerName("abcdefghijklmnopqrstuv"), "abcdefghijklmnopqr");
  assert.equal(normalizePlayerName("", "Speler"), "Speler");
});

