#!/bin/sh
# Downloads the four open-source C code bases used as real compiler workloads (pinned release tags).
set -e
mkdir -p corpora && cd corpora
get() { curl -sL -o "$1.tgz" "https://codeload.github.com/$2/tar.gz/refs/tags/$3"; mkdir -p "$1"; tar -xzf "$1.tgz" -C "$1" --strip-components=1 --wildcards '*.c' '*.h'; }
get lua lua/lua v5.4.7
get zlib madler/zlib v1.3.1
get redis redis/redis 7.2.5
get sqlite sqlite/sqlite version-3.46.0
sha256sum *.tgz > SHA256SUMS.txt
