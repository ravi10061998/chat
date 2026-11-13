import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createApi, parseJsonBody, type ApiDependencies } from "../src/api";
import { ApiError } from "../src/errors";

const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const charlie = "00000000-0000-4000-8000-000000000003";
const chatId = "aaaaaaaa-0000-4000-8000-000000000000";
const messageId = "bbbbbbbb-0000-4000-8000-000000000000";
const unknownId = "cccccccc-0000-4000-8000-000000000000";

function fixture() {
  const chat = { chatId, memberIds: [alice, bob] as [string, string] };
  const message = { messageId, senderId: alice, text: "hello", createdAt: "2026-11-13T00:00:00Z", readBy: {} };
  const calls: unknown[][] = [];
  const stores: ApiDependencies = {
    chats: {
      async create(...args) { calls.push(["create", ...args]); return chatId; },
      async get(id) {
        if (id !== chatId) throw new ApiError(404, "Chat not found");
        return chat;
      },
      async list(id) { calls.push(["chats", id]); return [chat]; },
    },
    messages: {
      async send(...args) { calls.push(["send", ...args]); return messageId; },
      async list(...args) { calls.push(["messages", ...args]); return [message]; },
      async markRead(...args) { calls.push(["read", ...args]); },
      async updateLastSeen(...args) { calls.push(["lastSeen", ...args]); return messageId; },
    },
  };
  const dispatch = createApi(stores);
  return {
    calls, chat, message,
    request(method: string, path: string, body: object = {}) {
      return dispatch(method, path, async () => ({ ...body }));
    },
  };
}

test("the root path reports that the API is running", async () => {
  const { request, calls } = fixture();
  assert.deepEqual(await request("GET", "/"), {
    status: 200, body: { service: "Local Chat API", status: "running" },
  });
  assert.deepEqual(calls, []);
});

test("all six routes map validated input to their stores", async () => {
  const { request, calls, chat, message } = fixture();
  const base = `/chat/${chatId}`;

  assert.deepEqual(await request("POST", "/chat/create", { userAId: alice, userBId: bob }), {
    status: 200, body: { chatId },
  });
  assert.deepEqual(await request("POST", `${base}/message/send`, { senderId: alice, text: "hello" }), {
    status: 201, body: { messageId },
  });
  assert.deepEqual(await request("GET", `${base.toUpperCase().replace("/CHAT/", "/chat/")}/messages`), {
    status: 200, body: { messages: [message] },
  });
  assert.deepEqual(await request("POST", `${base}/message/${messageId}/read`, { userId: bob }), {
    status: 200, body: { messageId, userId: bob },
  });
  assert.deepEqual(await request("POST", `${base}/lastseen`, { userId: bob, messageId }), {
    status: 200, body: { messageId, userId: bob },
  });
  assert.deepEqual(await request("GET", `/user/${alice}/chats`), {
    status: 200, body: { chats: [chat] },
  });
  assert.deepEqual(calls, [
    ["create", alice, bob], ["send", chatId, alice, "hello"], ["messages", chatId, 50],
    ["read", chatId, messageId, bob], ["lastSeen", chatId, messageId, bob], ["chats", alice],
  ]);
});

test("invalid limits, missing chats, and nonmember writes fail before reaching the message store", async () => {
  const { request, calls } = fixture();
  const base = `/chat/${chatId}`;

  for (const limit of ["0", "101", "2.5", "", "1&limit=2"]) {
    assert.equal((await request("GET", `${base}/messages?limit=${limit}`)).status, 400);
  }
  assert.equal((await request("GET", `/chat/${unknownId}/messages`)).status, 404);
  assert.equal((await request("POST", `${base}/message/send`, { senderId: charlie, text: "hello" })).status, 403);
  assert.equal((await request("POST", `${base}/message/${messageId}/read`, { userId: charlie })).status, 403);
  assert.equal((await request("POST", `${base}/lastseen`, { userId: charlie, messageId })).status, 403);
  assert.equal((await request("POST", `${base}/message/send`, { senderId: alice, text: "  " })).status, 400);
  assert.equal((await request("POST", `${base}/message/send`, { senderId: alice, text: "a".repeat(4001) })).status, 400);
  assert.deepEqual(calls, []);
});

test("JSON parser rejects invalid content and caps request size", async () => {
  const json = "application/json; charset=utf-8";
  const stream = (...chunks: string[]) => Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  assert.deepEqual(await parseJsonBody(stream('{"text":', '"hi"}'), json), { text: "hi" });

  for (const body of ["", "{", "[]", "null"]) {
    await assert.rejects(parseJsonBody(stream(body), json), { status: 400 });
  }
  await assert.rejects(parseJsonBody(stream("{}"), "text/plain"), { status: 415 });
  await assert.rejects(parseJsonBody(stream(" ".repeat(32769)), json), { status: 413 });
});
