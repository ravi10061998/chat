import type { IncomingMessage, ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import { ApiError } from "./errors";
import type { FirestoreMessages } from "./firestore";
import type { PostgresChats } from "./postgres";

export interface ApiDependencies {
  chats: Pick<PostgresChats, "create" | "get" | "list">;
  messages: Pick<FirestoreMessages, "send" | "list" | "markRead" | "updateLastSeen">;
}

interface ApiResult {
  status: number;
  body: object;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxBodyBytes = 32_768;

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ApiError(400, `${field} must be a UUID`);
  }
  return value.toLowerCase();
}

function messageText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > 4_000) {
    throw new ApiError(400, "text must contain 1 to 4000 characters and cannot be blank");
  }
  return value;
}

function messageLimit(url: URL): number {
  const values = url.searchParams.getAll("limit");
  if (values.length === 0) return 50;
  const value = values[0];
  if (values.length !== 1 || value === undefined || !/^[1-9][0-9]{0,2}$/.test(value) ||
      Number(value) > 100) {
    throw new ApiError(400, "limit must be an integer from 1 to 100");
  }
  return Number(value);
}

export async function parseJsonBody(
  chunks: AsyncIterable<Buffer>,
  contentType: string | undefined,
): Promise<Record<string, unknown>> {
  if (contentType?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "Content-Type must be application/json");
  }

  const buffers: Buffer[] = [];
  let length = 0;
  for await (const chunk of chunks) {
    length += chunk.length;
    if (length > maxBodyBytes) throw new ApiError(413, "Request body is too large");
    buffers.push(chunk);
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(buffers)));
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function createApi({ chats, messages }: ApiDependencies) {
  async function requireMember(chatId: string, userId: string): Promise<void> {
    const chat = await chats.get(chatId);
    if (!chat.memberIds.includes(userId)) throw new ApiError(403, "User is not a chat member");
  }

  return async function dispatch(
    method: string,
    target: string,
    readBody: () => Promise<Record<string, unknown>>,
  ): Promise<ApiResult> {
    try {
      if (!target.startsWith("/") || target.startsWith("//")) {
        throw new ApiError(400, "Invalid request path");
      }
      const url = new URL(target, "http://localhost");
      const path = url.pathname;

      if (method === "POST" && path === "/chat/create") {
        const body = await readBody();
        const chatId = await chats.create(uuid(body.userAId, "userAId"), uuid(body.userBId, "userBId"));
        return { status: 200, body: { chatId } };
      }

      const send = /^\/chat\/([^/]+)\/message\/send$/.exec(path);
      if (method === "POST" && send) {
        const chatId = uuid(send[1], "chatId");
        const body = await readBody();
        const senderId = uuid(body.senderId, "senderId");
        const text = messageText(body.text);
        await requireMember(chatId, senderId);
        const messageId = await messages.send(chatId, senderId, text);
        return { status: 201, body: { messageId } };
      }

      const history = /^\/chat\/([^/]+)\/messages$/.exec(path);
      if (method === "GET" && history) {
        const chatId = uuid(history[1], "chatId");
        const limit = messageLimit(url);
        await chats.get(chatId);
        return { status: 200, body: { messages: await messages.list(chatId, limit) } };
      }

      const read = /^\/chat\/([^/]+)\/message\/([^/]+)\/read$/.exec(path);
      if (method === "POST" && read) {
        const chatId = uuid(read[1], "chatId");
        const messageId = uuid(read[2], "messageId");
        const body = await readBody();
        const userId = uuid(body.userId, "userId");
        await requireMember(chatId, userId);
        await messages.markRead(chatId, messageId, userId);
        return { status: 200, body: { messageId, userId } };
      }

      const seen = /^\/chat\/([^/]+)\/lastseen$/.exec(path);
      if (method === "POST" && seen) {
        const chatId = uuid(seen[1], "chatId");
        const body = await readBody();
        const userId = uuid(body.userId, "userId");
        const messageId = uuid(body.messageId, "messageId");
        await requireMember(chatId, userId);
        const latestId = await messages.updateLastSeen(chatId, messageId, userId);
        return { status: 200, body: { userId, messageId: latestId } };
      }

      const userChats = /^\/user\/([^/]+)\/chats$/.exec(path);
      if (method === "GET" && userChats) {
        const userId = uuid(userChats[1], "userId");
        return { status: 200, body: { chats: await chats.list(userId) } };
      }

      throw new ApiError(404, "Route not found");
    } catch (error) {
      if (error instanceof ApiError) {
        return { status: error.status, body: { error: error.message } };
      }
      console.error("Request failed", error);
      return { status: 500, body: { error: "Internal server error" } };
    }
  };
}

export function createHttpHandler(dependencies: ApiDependencies) {
  const dispatch = createApi(dependencies);

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const result = await dispatch(request.method ?? "", request.url ?? "", () =>
      parseJsonBody(request.iterator({ destroyOnReturn: false }), request.headers["content-type"]),
    );
    // Drain unread bytes or close early for an oversized request.
    if (result.status === 413) {
      response.setHeader("Connection", "close");
    } else {
      request.resume();
    }
    response.writeHead(result.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(result.body));
  };
}
