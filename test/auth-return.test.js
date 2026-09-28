import test from "node:test";
import assert from "node:assert/strict";
import { accountSignInPath, sanitizeReturnTo } from "../src/lib/auth-return.js";

test("authentication returns only to approved in-app routes", () => {
  assert.equal(sanitizeReturnTo("/geoguesser/multiplayer/host"), "/geoguesser/multiplayer/host");
  assert.equal(sanitizeReturnTo("/geoguesser/multiplayer/AB2C?invite=1"), "/geoguesser/multiplayer/AB2C?invite=1");
  assert.equal(sanitizeReturnTo("https://example.com"), "");
  assert.equal(sanitizeReturnTo("//example.com/path"), "");
  assert.equal(sanitizeReturnTo("/unknown"), "");
});

test("account sign-in paths preserve the intended destination", () => {
  assert.equal(accountSignInPath("/geoguesser/multiplayer/join"), "/account?returnTo=%2Fgeoguesser%2Fmultiplayer%2Fjoin");
  assert.equal(accountSignInPath("https://example.com"), "/account");
});
