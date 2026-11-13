# Local Chat Backend

A strict TypeScript HTTP API for one-to-one chats. PostgreSQL stores users and chat membership. The official Firestore emulator stores messages, read receipts, and each user's last-seen message. The API and both stores run on loopback using the Firebase demo project `demo-local-chat`.

## Start locally

### Prerequisites

Use Node.js 22 or newer, Bash, PostgreSQL 13 or newer, and JDK 21 or newer. The first setup needs internet access to download npm dependencies, the Firebase CLI, and the Firestore emulator.

On macOS with Homebrew, install any missing prerequisites. These commands use Node.js 24, PostgreSQL 16, and JDK 21.

```sh
brew install node@24 postgresql@16
brew install --cask temurin@21
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
```

Run the `export PATH` command in each new terminal that needs these Homebrew tools. If you already have the required versions, check them with `node --version`, `initdb --version`, `pg_ctl --version`, and `java -version`. On macOS, `/usr/libexec/java_home -V` lists installed JDKs. The startup script can find a supported macOS JDK even if `java` on `PATH` is older. On Linux, put `node`, `npm`, `initdb`, `pg_ctl`, and a supported `java` on `PATH`.

### Run the service

In a regular terminal, change into the project folder containing `package.json`. Run these commands as your normal user.

```sh
npm ci
npm run dev
```

The startup command builds the API, initializes a project-specific PostgreSQL cluster on port `55432`, seeds three demo users, and starts the Firestore emulator on port `8080`. The defaults require zero environment variables and zero Firebase credentials. Wait for `Chat API listening on http://127.0.0.1:3000`, then leave that terminal open and make requests from a second terminal.

Use Ctrl+C for a clean shutdown and let the Firestore export finish. Firestore saves to `.local/firestore-data` and imports it at the next startup. PostgreSQL keeps its data in `.local/postgres`. To stop it as well, run `npm run db:stop` from the project folder.

### Startup troubleshooting

- **`initdb` or `pg_ctl` missing** — Add PostgreSQL's `bin` directory to `PATH` using the command above.
- **Port already in use** — On macOS, use `lsof -nP -iTCP:8080 -sTCP:LISTEN` to identify what's using the Firestore port. The PostgreSQL and API ports are `55432` and `3000`. To move the API to port `3001`, run `PORT=3001 npm run dev` and use that port in the requests.
- **PostgreSQL shared memory or loopback permission errors** — Run the startup command in a regular local terminal with permission to open loopback sockets and create shared memory. If PostgreSQL initialization succeeds but the server fails to start, check `.local/postgres.log`.

## API

All IDs are UUIDs. Send JSON with `Content-Type: application/json` for POST requests. Error responses have the shape `{"error":"..."}`. The loopback API uses caller-supplied IDs as demo identities. It checks chat membership on message writes, read receipts, and last-seen updates. Both GET routes are unauthenticated.

| Method and path | JSON body or query | Successful response |
| --- | --- | --- |
| `POST /chat/create` | `userAId`, `userBId` | `200` with `{ chatId }`. Reversing the users returns the same chat. |
| `POST /chat/:chatId/message/send` | `senderId`, `text` | `201` with `{ messageId }`. Firestore assigns the timestamp. |
| `GET /chat/:chatId/messages` | `limit` defaults to `50` and accepts `1` through `100` | `200` with `{ messages }`. Returns the latest window in oldest-first order, with message ID breaking timestamp ties. Each message includes `messageId`, `senderId`, `text`, `createdAt`, and a `readBy` map of user IDs to timestamps. |
| `POST /chat/:chatId/message/:messageId/read` | `userId` | `200` with `{ messageId, userId }`. A repeated receipt preserves the original read timestamp. |
| `POST /chat/:chatId/lastseen` | `userId`, `messageId` | `200` with `{ userId, messageId }`. The response reports the current last-seen message. An older update cannot move it backward. |
| `GET /user/:userId/chats` | | `200` with `{ chats }`. Each chat includes `chatId` and `memberIds`. |

### Try all six endpoints

Run this in the second terminal after the API starts. The commands use `curl` and Node.js to capture IDs from the responses.

```sh
api=http://127.0.0.1:3000
alice=00000000-0000-4000-8000-000000000001
bob=00000000-0000-4000-8000-000000000002

post() {
  curl -fsS "$api$1" -H 'Content-Type: application/json' -d "$2"
}

json_id() {
  node -e 'const id = JSON.parse(require("node:fs").readFileSync(0, "utf8"))[process.argv[1]]; if (typeof id !== "string") process.exit(1); console.log(id)' "$1"
}

chat_id=$(post /chat/create "{\"userAId\":\"$alice\",\"userBId\":\"$bob\"}" | json_id chatId) &&
message_id=$(post "/chat/$chat_id/message/send" "{\"senderId\":\"$alice\",\"text\":\"Hello, Bob.\"}" | json_id messageId) &&
post "/chat/$chat_id/message/$message_id/read" "{\"userId\":\"$bob\"}" && printf '\n' &&
post "/chat/$chat_id/lastseen" "{\"userId\":\"$bob\",\"messageId\":\"$message_id\"}" && printf '\n' &&
curl -fsS "$api/chat/$chat_id/messages?limit=50" && printf '\n' &&
curl -fsS "$api/user/$alice/chats" && printf '\n'
```

The message history includes Bob's timestamp in `readBy`, and Alice's chat list includes both member IDs. The third demo user, Charlie, has ID `00000000-0000-4000-8000-000000000003`.

## Tests

```sh
npm test
npm run test:local
```

`npm test` compiles the project and checks the routes and request validation without starting either store. `npm run test:local` starts PostgreSQL and a fresh Firestore emulator, then exercises all six endpoints over HTTP. It checks concurrent chat creation, membership, message ordering, receipt idempotency, and last-seen tracking. Stop `npm run dev` first so port `8080` is available, or use `npm run test:integration` to run against the already-running local stores.

[Homebrew Node.js 24](https://formulae.brew.sh/formula/node@24) · [Homebrew PostgreSQL 16](https://formulae.brew.sh/formula/postgresql@16) · [Homebrew Temurin 21](https://formulae.brew.sh/cask/temurin@21) · [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure)
