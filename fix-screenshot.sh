#!/bin/bash

echo "Fixing screenshot permissions on Linux..."

# Install required screenshot dependencies
if command -v apt-get >/dev/null; then
    echo "Installing imagemagick and scrot..."
    sudo apt-get update
    sudo apt-get install -y imagemagick scrot
elif command -v yum >/dev/null; then
    echo "Installing imagemagick and scrot..."
    sudo yum install -y ImageMagick scrot
elif command -v pacman >/dev/null; then
    echo "Installing imagemagick and scrot..."
    sudo pacman -S imagemagick scrot
fi

echo "Screenshot dependencies installed."
echo "You may need to restart the application."