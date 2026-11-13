#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-}"
case "$mode" in
  serve|test) ;;
  *)
    echo "Usage: $0 {serve|test}" >&2
    exit 2
    ;;
esac

for tool in initdb pg_ctl; do
  if ! command -v "$tool" >/dev/null; then
    echo "Required command missing from PATH: $tool" >&2
    exit 1
  fi
done

has_supported_java() {
  local version
  version="$("$1" -version 2>&1)" || return 1
  [[ "$version" =~ version\ \"([0-9]+) ]] && (( BASH_REMATCH[1] >= 21 ))
}

if ! has_supported_java java && [[ -x /usr/libexec/java_home ]]; then
  discovered_jdk="$(/usr/libexec/java_home 2>/dev/null || true)"
  if [[ -n "$discovered_jdk" ]] && has_supported_java "$discovered_jdk/bin/java"; then
    export JAVA_HOME="$discovered_jdk"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
fi
if ! has_supported_java java; then
  echo "Put JDK 21 or newer on PATH to run the Firestore emulator." >&2
  exit 1
fi

npm run build
npm run db:start
npm run db:setup

firebase=(npx --yes firebase-tools@15.35.0 emulators:exec --only firestore --project demo-local-chat)

if [[ "$mode" == test ]]; then
  exec "${firebase[@]}" 'node --test dist/test/integration.test.js'
fi

data_dir=.local/firestore-data
data_args=("--export-on-exit=$data_dir")
if [[ -f "$data_dir/firebase-export-metadata.json" ]]; then
  data_args+=("--import=$data_dir")
fi
exec "${firebase[@]}" "${data_args[@]}" 'npm start'
