#!/usr/bin/env bash
# Double-click this file in Finder to launch 此刻 + the mini player.
# This copy can live inside the repo or on the Desktop.

set -euo pipefail

APP_DIR="/Users/zhuanz/music-agent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$APP_DIR/package.json" ]; then
  if [ -f "$SCRIPT_DIR/package.json" ]; then
    APP_DIR="$SCRIPT_DIR"
  elif [ -f "$SCRIPT_DIR/../package.json" ]; then
    APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  else
    echo "找不到此刻项目目录：$APP_DIR"
    echo "请确认 /Users/zhuanz/music-agent 还在。"
    exit 1
  fi
fi

cd "$APP_DIR"
unset ELECTRON_RUN_AS_NODE
exec npm run desktop:dev
