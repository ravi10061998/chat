import { FieldPath, FieldValue, Firestore, Timestamp } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { firestoreProject, localEmulatorHost } from "./config";
import { ApiError } from "./errors";

interface StoredMessage {
  senderId: string;
  text: string;
  createdAt: Timestamp;
  readBy: Record<string, Timestamp>;
}

interface StoredLastSeen {
  messageId: string;
  messageCreatedAt: Timestamp;
}

export interface Message {
  messageId: string;
  senderId: string;
  text: string;
  createdAt: string;
  readBy: Record<string, string>;
}

export function openFirestore(): Firestore {
  const host = localEmulatorHost();
  // The SDK uses the emulator environment variable to select an insecure local channel.
  process.env.FIRESTORE_EMULATOR_HOST = host;
  return new Firestore({ projectId: firestoreProject });
}

function toISOString(timestamp: Timestamp): string {
  const wholeSecond = new Date(timestamp.seconds * 1000).toISOString();
  return wholeSecond.replace(/\.000Z$/, `.${String(timestamp.nanoseconds).padStart(9, "0")}Z`);
}

export class FirestoreMessages {
  constructor(private readonly firestore: Firestore) {}

  private chat(chatId: string) {
    return this.firestore.collection("chats").doc(chatId);
  }

  private messages(chatId: string) {
    return this.chat(chatId).collection("messages");
  }

  async send(chatId: string, senderId: string, text: string): Promise<string> {
    const message = this.messages(chatId).doc(randomUUID());
    await message.create({ senderId, text, createdAt: FieldValue.serverTimestamp(), readBy: {} });
    return message.id;
  }

  async list(chatId: string, limit: number): Promise<Message[]> {
    const result = await this.messages(chatId)
      .orderBy("createdAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(limit)
      .get();

    return result.docs.reverse().map((doc) => {
      const data = doc.data() as StoredMessage;
      return {
        messageId: doc.id,
        senderId: data.senderId,
        text: data.text,
        createdAt: toISOString(data.createdAt),
        readBy: Object.fromEntries(
          Object.entries(data.readBy).map(([userId, timestamp]) => [userId, toISOString(timestamp)]),
        ),
      };
    });
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<void> {
    const ref = this.messages(chatId).doc(messageId);
    await this.firestore.runTransaction(async (transaction) => {
      const data = (await transaction.get(ref)).data() as StoredMessage | undefined;
      if (!data) throw new ApiError(404, "Message not found in this chat");
      if (data.readBy[userId]) return;
      transaction.update(ref, new FieldPath("readBy", userId), FieldValue.serverTimestamp());
    });
  }

  async updateLastSeen(chatId: string, messageId: string, userId: string): Promise<string> {
    const message = this.messages(chatId).doc(messageId);
    const lastSeen = this.chat(chatId).collection("lastSeen").doc(userId);

    return this.firestore.runTransaction(async (transaction) => {
      const [messageDoc, lastSeenDoc] = await transaction.getAll(message, lastSeen);
      const data = messageDoc?.data() as StoredMessage | undefined;
      if (!data) throw new ApiError(404, "Message not found in this chat");

      const previous = lastSeenDoc?.data() as StoredLastSeen | undefined;
      if (previous) {
        const currentTime = data.createdAt.valueOf();
        const previousTime = previous.messageCreatedAt.valueOf();
        if (currentTime < previousTime ||
            (currentTime === previousTime && messageId <= previous.messageId)) {
          return previous.messageId;
        }
      }

      transaction.set(lastSeen, {
        messageId,
        messageCreatedAt: data.createdAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return messageId;
    });
  }
}
