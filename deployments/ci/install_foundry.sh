#!/bin/sh

# Install Foundry and anvil
echo "Installing Foundry and anvil"
curl -L https://foundry.paradigm.xyz | bash

echo "Reloading the shell configuration to update PATH"
if [ -f "$HOME/.bashrc" ]; then
    . "$HOME/.bashrc"
elif [ -f "$HOME/.profile" ]; then
    . "$HOME/.profile"
elif [ -f "$HOME/.zshrc" ]; then
    . "$HOME/.zshrc"
fi

echo "Verifying Foundry installation"
if command -v foundryup >/dev/null 2>&1; then
    echo "Foundry installed successfully!"
    source /home/runner/.bashrc
    foundryup --version
    foundryup
else
    echo "Foundry installation failed. foundryup command not found."
    exit 1
fi
