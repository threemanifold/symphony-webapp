import assert from "node:assert/strict";
import test from "node:test";

import { formatResponse, postChatMessage } from "./chat.mjs";

test("formatResponse trims returned text", () => {
  assert.equal(formatResponse("  hello from symphony  "), "hello from symphony");
});

test("formatResponse falls back for empty or missing text", () => {
  assert.equal(formatResponse("   "), "No response returned.");
  assert.equal(formatResponse(undefined), "No response returned.");
});

test("postChatMessage sends the expected POST /chat request", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { response: "  received  " };
      },
    };
  };

  const result = await postChatMessage("hello", fetchImpl);

  assert.equal(result, "received");
  assert.deepEqual(calls, [
    {
      url: "/chat",
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "hello" }),
      },
    },
  ]);
});

test("postChatMessage rejects unsuccessful responses", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
  });

  await assert.rejects(
    () => postChatMessage("hello", fetchImpl),
    /Chat request failed with 500/,
  );
});
