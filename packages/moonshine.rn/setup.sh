#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

command -v git >/dev/null 2>&1 || {
  echo -e "${RED}Error: git is required.${NC}" >&2
  exit 1
}

mkdir -p third_party
mkdir -p prebuilt/android
mkdir -p prebuilt/ios
mkdir -p prebuilt/web

MOONSHINE_VERSION="$(node -p "require('./package.json').moonshineVersion")"
# Check out the commit, not the tag. They are different trees: the tag v0.0.59 is missing
# core/speaker-embedding-model-data.cpp, which core/CMakeLists.txt lists unconditionally,
# so a tag checkout cannot build no matter how LFS behaves (#442). moonshineVersion stays
# for display and metadata.
MOONSHINE_COMMIT="$(node -p "require('./package.json').moonshineCommit")"
MOONSHINE_JS_VERSION="$(node -p "require('./package.json').moonshineJsVersion")"
MOONSHINE_JS_GIT_HEAD="$(node -p "require('./package.json').moonshineJsGitHead")"
UPSTREAM_DIR="$SCRIPT_DIR/third_party/moonshine"
UPSTREAM_JS_DIR="$SCRIPT_DIR/third_party/moonshine-js"

echo -e "${BLUE}Setting up Moonshine upstream checkout (${MOONSHINE_VERSION} @ ${MOONSHINE_COMMIT})...${NC}"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone --no-checkout --filter=blob:none \
    https://github.com/moonshine-ai/moonshine "$UPSTREAM_DIR"
fi

cd "$UPSTREAM_DIR"
# Fetch the pinned commit by SHA. It is not reachable from any branch or tag upstream, so
# a plain clone/fetch does not have it and `git checkout` fails with "unable to read tree"
# while leaving HEAD on the default branch — a wrong tree that then fails opaquely at
# compile time. Verified against the real remote, which permits fetch-by-SHA.
if ! GIT_LFS_SKIP_SMUDGE=1 git fetch --depth 1 origin "$MOONSHINE_COMMIT"; then
  echo -e "${RED}Error: could not fetch pinned Moonshine commit $MOONSHINE_COMMIT.${NC}" >&2
  echo -e "${YELLOW}The remote may no longer serve it. Update moonshineCommit in package.json.${NC}" >&2
  exit 1
fi
git checkout --detach "$MOONSHINE_COMMIT"
git reset --hard "$MOONSHINE_COMMIT"
# Prove we landed where the gitlink points rather than trusting the commands above: a
# checkout that half-succeeds is exactly the failure this block exists to catch.
ACTUAL_HEAD="$(git rev-parse HEAD)"
if [ "$ACTUAL_HEAD" != "$MOONSHINE_COMMIT" ]; then
  echo -e "${RED}Error: upstream checkout is at $ACTUAL_HEAD, expected $MOONSHINE_COMMIT.${NC}" >&2
  exit 1
fi
# The clone runs with GIT_LFS_SKIP_SMUDGE=1, so LFS-tracked sources are still pointer
# files at this point. speaker-embedding-model-data.cpp is one of them, and compiling a
# pointer file is the opaque CMake failure this fix exists to prevent.
if command -v git-lfs >/dev/null 2>&1; then
  git lfs pull
else
  echo -e "${RED}Error: git-lfs is required to materialize upstream sources.${NC}" >&2
  echo -e "${YELLOW}Install it (brew install git-lfs) and re-run.${NC}" >&2
  exit 1
fi
cd "$SCRIPT_DIR"

./apply-upstream-patches.sh

echo -e "${BLUE}Setting up MoonshineJS upstream checkout (${MOONSHINE_JS_VERSION} @ ${MOONSHINE_JS_GIT_HEAD})...${NC}"

if [ ! -d "$UPSTREAM_JS_DIR/.git" ]; then
  git clone https://github.com/moonshine-ai/moonshine-js "$UPSTREAM_JS_DIR"
fi

cd "$UPSTREAM_JS_DIR"
git fetch origin
git checkout --detach "$MOONSHINE_JS_GIT_HEAD"
git reset --hard "$MOONSHINE_JS_GIT_HEAD"
cd "$SCRIPT_DIR"

echo -e "${GREEN}Moonshine upstream checkout is ready.${NC}"
echo -e "${YELLOW}Build Android source artifact with:${NC}"
echo -e "${YELLOW}  bash packages/moonshine.rn/build-moonshine-android.sh${NC}"
echo -e "${YELLOW}Build iOS source artifact with:${NC}"
echo -e "${YELLOW}  bash packages/moonshine.rn/build-moonshine-ios.sh${NC}"
echo -e "${YELLOW}Build web assets with:${NC}"
echo -e "${YELLOW}  bash packages/moonshine.rn/build-moonshine-web.sh${NC}"
