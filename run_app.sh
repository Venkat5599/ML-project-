#!/usr/bin/env bash
# ChainSleuth AML - local run helper for macOS / Linux (run_app.bat is the Windows twin).
# Starts the FastAPI backend (port 8000) and the Next.js frontend (port 3001).
# Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
[ -x .venv/bin/python ] && PY=.venv/bin/python

if [ ! -f data/processed/test_scores.parquet ]; then
  echo "data/processed/test_scores.parquet is missing - run the pipeline first (see README)." >&2
  exit 1
fi

"$PY" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT INT TERM

(cd frontend && { [ -d node_modules ] || bun install; } && bun dev --port 3001)
