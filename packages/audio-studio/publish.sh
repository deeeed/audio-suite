#!/bin/bash
set -e

# Define color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get absolute path of script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Script directory: $SCRIPT_DIR"
cd "$SCRIPT_DIR"
echo -e "${BLUE}Changed to script directory: $(pwd)${NC}"

# Cleanup and rebuild first
echo -e "${YELLOW}Cleaning and rebuilding...${NC}"
yarn lint --fix
yarn clean
yarn build
yarn build:plugin

echo -e "${YELLOW}Starting publication process...${NC}"

# Check for git changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}Warning: There are uncommitted changes in the repository.${NC}"
    read -p "$(echo -e ${YELLOW}Do you want to proceed with --no-git-check? [y/N]: ${NC})" skip_git_check
    if [[ $skip_git_check =~ ^[Yy]$ ]]; then
        publisher release --no-git-check
    else
        echo -e "${BLUE}Please commit or stash your changes before proceeding.${NC}"
        exit 1
    fi
else
    publisher --debug release
fi

# Get new version after bump
version=$(node -p "require('./package.json').version")
echo -e "${GREEN}New version: $version${NC}"

# Print CDN URL for manual verification (jsDelivr syncs from npm within ~5 min)
WASM_CDN_URL="https://cdn.jsdelivr.net/npm/@siteed/audio-studio@${version}/prebuilt/wasm/mel-spectrogram.js"
echo -e "${BLUE}WASM CDN URL (verify once propagated): $WASM_CDN_URL${NC}"
echo -e "${BLUE}GitHub release fallback (attach mel-spectrogram.js as asset):${NC}"
echo -e "  https://github.com/deeeed/audiolab/releases/download/@siteed/audio-studio@${version}/mel-spectrogram.js"

# Ask about publishing the compatibility shim
read -p "$(echo -e ${YELLOW}Do you need to publish the deprecated @siteed/expo-audio-studio shim? [y/N]: ${NC})" publish_shim
if [[ $publish_shim =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Publishing compatibility shim @siteed/expo-audio-studio...${NC}"
    cd "$SCRIPT_DIR/../../packages/expo-audio-studio"
    # Sync shim version to match audio-studio
    node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); p.version='$version'; fs.writeFileSync('package.json', JSON.stringify(p, null, 4));"
    npm publish --access public
    npm deprecate "@siteed/expo-audio-studio@$version" "Deprecated: use @siteed/audio-studio instead. This compatibility shim only re-exports @siteed/audio-studio."
    cd "$SCRIPT_DIR"
    echo -e "${GREEN}Shim published successfully!${NC}"
fi

# Ask about generating documentation (default Yes)
read -p "$(echo -e ${YELLOW}Do you want to generate updated documentation? [Y/n]: ${NC})" generate_docs
if [[ $generate_docs =~ ^[Nn]$ ]]; then
    echo -e "${BLUE}Skipping documentation generation${NC}"
else
    echo -e "${YELLOW}Generating updated documentation...${NC}"
    yarn docgen

    # Store the root directory path
    ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
    
    cd "$ROOT_DIR/documentation_site"

    yarn build
    echo -e "${BLUE}Waiting while docs are generated...${NC}"
    sleep 2

    yarn deploy
    
    # Change to root directory before git operations
    cd "$ROOT_DIR"
    git add "docs" "documentation_site"
    git commit -m "docs: update api references for v$version"
    git push
    
    # Return to script directory
    cd "$SCRIPT_DIR"
fi

# Ask about deploying playground app
read -p "$(echo -e ${YELLOW}Do you want to deploy the playground app? [y/N]: ${NC})" deploy_playground
if [[ $deploy_playground =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Publishing playground app...${NC}"
    cd ../../apps/playground
    
    # Use our new interactive deployment script
    yarn publish
fi

# Ask about deploying minimal app
read -p "$(echo -e ${YELLOW}Do you want to deploy the minimal app? [y/N]: ${NC})" deploy_minimal
if [[ $deploy_minimal =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Publishing minimal app...${NC}"
    cd ../minimal
    
    # Use our new interactive deployment script
    yarn publish
fi

echo -e "${GREEN}Publication process completed successfully!${NC}"
