export const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://chat:chat-local@127.0.0.1:55432/postgres";

export const firestoreProject = "demo-local-chat";

export function localEmulatorHost(): string {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const match = /^(?:127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/.exec(host);
  if (!match || Number(match[1]) > 65535) {
    throw new Error("FIRESTORE_EMULATOR_HOST must be a loopback address and valid port");
  }
  return host;
}

export function httpPort(): number {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}
