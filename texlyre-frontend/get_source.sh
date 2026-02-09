#!/bin/bash
set -e

echo "Fetching TeXlyre source code..."

# Remove old src directory if it exists
if [ -d "src" ]; then
    echo "Removing old src directory..."
    rm -rf src
fi

# Clone the repository
echo "Cloning TeXlyre repository..."
git clone https://github.com/TeXlyre/texlyre.git src

echo "Source code fetched successfully!"
echo "You can now build with: docker-compose build"