#!/bin/bash

# Check if a version number is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    exit 1
fi

VERSION=$1
TARBALL_NAME="juice-it-v${VERSION}.tar.gz"

# Automatically determine the project directory based on the script's location
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Change to the project directory
cd "$PROJECT_DIR" || { echo "Project directory not found"; exit 1; }

# Create a releases directory if it doesn't exist
mkdir -p releases

# Create the tarball, excluding the .git and releases directories
tar -czvf "releases/$TARBALL_NAME" --exclude='.git' --exclude='releases' --exclude='bin' ./*

echo "Tarball created: releases/$TARBALL_NAME"