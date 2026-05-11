#!/usr/bin/env bash
# Double-click this file in Finder to launch Claudio + the mini player.
# It finds its own project root so it works no matter where you move it.

set -e
cd "$(dirname "$0")/.."
exec npm run desktop:dev
