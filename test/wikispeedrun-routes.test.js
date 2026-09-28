import test from "node:test";
import assert from "node:assert/strict";
import { parseWikiRoute, wikiArticlePath, wikiLobbyPath } from "../src/games/wikispeedrun/routes.js";

test("WikiSpeedrun uses distinct lobby and article routes", () => {
  assert.equal(wikiLobbyPath("ab2c"), "/wikispeedrun/multiplayer/AB2C");
  assert.equal(wikiArticlePath("New York City"), "/wikispeedrun/play/New_York_City");
});

test("WikiSpeedrun parses current and legacy lobby links", () => {
  assert.deepEqual(parseWikiRoute(["multiplayer", "ab2c"]), { type: "lobby", code: "AB2C" });
  assert.deepEqual(parseWikiRoute(["AB2C"]), { type: "lobby", code: "AB2C" });
  assert.deepEqual(parseWikiRoute(["play", "New_York_City"]), { type: "article", title: "New York City" });
});
