import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../src/lib/html.js";

test("escapeHtml neutralizes text and attribute delimiters", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">&`),
    "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
  );
});

