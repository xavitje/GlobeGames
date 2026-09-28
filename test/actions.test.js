import test from "node:test";
import assert from "node:assert/strict";
import { ActionController } from "../src/lib/actions.js";

test("ActionController delegates clicks and detaches cleanly", () => {
  const listeners = new Map();
  const root = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    contains: () => true,
  };
  let calls = 0;
  const control = { dataset: { action: "play" } };
  const controller = new ActionController(root, { play: () => calls++ });

  listeners.get("click")({ target: { closest: () => control } });
  assert.equal(calls, 1);
  controller.destroy();
  assert.equal(listeners.size, 0);
});

