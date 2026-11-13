#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

local_dir="$PWD/.local"
pg_dir="$local_dir/postgres"
pg_port=55432

case "${1:-}" in
  start)
    mkdir -p "$local_dir"
    if [[ ! -f "$pg_dir/PG_VERSION" ]]; then
      password_file="$(mktemp "$local_dir/password.XXXXXX")"
      trap 'rm -f "$password_file"' EXIT
      printf '%s\n' 'chat-local' > "$password_file"
      initdb -D "$pg_dir" --auth=scram-sha-256 --username=chat \
        --pwfile="$password_file" --encoding=UTF8 --no-locale
    fi
    if ! pg_ctl -D "$pg_dir" status >/dev/null; then
      pg_ctl -D "$pg_dir" -l "$local_dir/postgres.log" \
        -o "-h 127.0.0.1 -p $pg_port" -w start
    fi
    ;;
  stop)
    if [[ -f "$pg_dir/PG_VERSION" ]] && pg_ctl -D "$pg_dir" status >/dev/null; then
      pg_ctl -D "$pg_dir" -m fast -w stop
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop}" >&2
    exit 2
    ;;
esac
