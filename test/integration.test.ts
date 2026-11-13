import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { createHttpHandler } from "../src/api";
import { FirestoreMessages, openFirestore, type Message } from "../src/firestore";
import { openPool, PostgresChats, type Chat } from "../src/postgres";

test("HTTP API persists chat, messages, receipts, and last-seen state in the local stores", async (t) => {
  const pool = openPool();
  const firestore = openFirestore();
  const server = createServer(createHttpHandler({
    chats: new PostgresChats(pool),
    messages: new FirestoreMessages(firestore),
  }));
  const alice = randomUUID();
  const bob = randomUUID();
  const charlie = randomUUID();
  const users = [alice, bob, charlie];
  let chatId: string | undefined;
  let usersInserted = false;

  t.after(async () => {
    try {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
      if (usersInserted) {
        try {
          if (chatId) await firestore.recursiveDelete(firestore.collection("chats").doc(chatId));
        } finally {
          await pool.query("DELETE FROM chats WHERE member_a_id = ANY($1::uuid[]) OR member_b_id = ANY($1::uuid[])", [users]);
          await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
        }
      }
    } finally {
      await Promise.all([pool.end(), firestore.terminate()]);
    }
  });

  await pool.query(
    "INSERT INTO users (id, display_name) VALUES ($1, 'Test Alice'), ($2, 'Test Bob'), ($3, 'Test Charlie')",
    users,
  );
  usersInserted = true;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  async function request<Result>(path: string, status: number, body?: object): Promise<Result> {
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, body ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {});
    const payload: unknown = await response.json();
    assert.equal(response.status, status, JSON.stringify(payload));
    return payload as Result;
  }

  await request("/chat/create", 400, { userAId: alice, userBId: alice });
  await request("/chat/create", 404, { userAId: alice, userBId: randomUUID() });
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    request<{ chatId: string }>("/chat/create", 200, index % 2 === 0
      ? { userAId: alice, userBId: bob }
      : { userAId: bob, userBId: alice }),
  ));
  chatId = results[0]?.chatId;
  assert.ok(chatId);
  assert.deepEqual(new Set(results.map((result) => result.chatId)), new Set([chatId]));
  const expectedChat = { chatId, memberIds: [alice, bob].sort() };
  for (const userId of [alice, bob]) {
    assert.deepEqual((await request<{ chats: Chat[] }>(`/user/${userId}/chats`, 200)).chats, [expectedChat]);
  }
  assert.deepEqual(await request(`/user/${charlie}/chats`, 200), { chats: [] });

  const base = `/chat/${chatId}`;
  assert.deepEqual(await request(`${base}/messages`, 200), { messages: [] });
  await request(`${base}/message/send`, 403, { senderId: charlie, text: "Blocked" });
  const first = await request<{ messageId: string }>(`${base}/message/send`, 201, { senderId: alice, text: "Hello" });
  const second = await request<{ messageId: string }>(`${base}/message/send`, 201, { senderId: bob, text: "Hi" });

  await request(`${base}/message/${randomUUID()}/read`, 404, { userId: bob });
  const readPath = `${base}/message/${first.messageId}/read`;
  await request(readPath, 200, { userId: bob });
  const { messages } = await request<{ messages: Message[] }>(`${base}/messages`, 200);
  assert.deepEqual(messages.map((message) => [message.messageId, message.text]), [
    [first.messageId, "Hello"], [second.messageId, "Hi"],
  ]);
  const readAt = messages[0]?.readBy[bob];
  assert.ok(readAt && !Number.isNaN(Date.parse(readAt)));
  await request(readPath, 200, { userId: bob });
  const history = await request<{ messages: Message[] }>(`${base}/messages`, 200);
  assert.equal(history.messages[0]?.readBy[bob], readAt);
  const latest = await request<{ messages: Message[] }>(`${base}/messages?limit=1`, 200);
  assert.deepEqual(latest.messages.map((message) => message.messageId), [second.messageId]);

  await request(`${base}/lastseen`, 404, { userId: bob, messageId: randomUUID() });
  await request(`${base}/lastseen`, 200, { userId: bob, messageId: first.messageId });
  await request(`${base}/lastseen`, 200, { userId: bob, messageId: second.messageId });
  assert.deepEqual(await request(`${base}/lastseen`, 200, { userId: bob, messageId: first.messageId }), {
    userId: bob, messageId: second.messageId,
  });
  const saved = await firestore.collection("chats").doc(chatId).collection("lastSeen").doc(bob).get();
  assert.equal(saved.get("messageId"), second.messageId);
});
