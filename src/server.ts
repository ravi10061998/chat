import { createServer } from "node:http";
import { createHttpHandler } from "./api";
import { httpPort } from "./config";
import { FirestoreMessages, openFirestore } from "./firestore";
import { openPool, PostgresChats } from "./postgres";

async function main(): Promise<void> {
  const port = httpPort();
  const firestore = openFirestore();
  const pool = openPool();
  const handler = createHttpHandler({
    chats: new PostgresChats(pool),
    messages: new FirestoreMessages(firestore),
  });
  const server = createServer((request, response) => {
    void handler(request, response).catch((error: unknown) => {
      console.error("HTTP response failed", error);
      response.destroy();
    });
  });

  const closeStores = async (): Promise<void> => {
    await Promise.all([pool.end(), firestore.terminate()]);
  };
  const shutdown = (): void => {
    server.close(() => {
      void closeStores().catch((error: unknown) => {
        console.error("Shutdown failed", error);
        process.exitCode = 1;
      });
    });
  };

  try {
    await pool.query("SELECT id FROM chats LIMIT 0");
    // Exercise the actual emulator connection before accepting requests.
    await firestore.collection("chats").limit(1).get();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await closeStores();
    throw error;
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(`Chat API listening on http://127.0.0.1:${port}`);
}

void main().catch((error: unknown) => {
  console.error("Chat API could not start", error);
  process.exitCode = 1;
});
