#!/usr/bin/env bash
set -euo pipefail

# Ensure there's a place for source code
REPO_DIR="$HOME/Repos"
mkdir -p "$REPO_DIR"

if ! command -v zsh >/dev/null 2>&1; then
  sudo dnf -y update

  echo "Installing latest zsh & z'goodies..."
  sudo dnf -y install zsh zsh-autosuggestions zsh-syntax-highlighting
  chsh -s /usr/bin/zsh

  echo "Set up nvm & pyenv"

  # Languages
  # nvm
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # pyenv
  curl -L https://github.com/pyenv/pyenv-installer/raw/master/bin/pyenv-installer | bash

  echo "Installing packages via dnf"

  # Python build deps
  sudo dnf -y install \
    make gcc gcc-c++ openssl-devel zlib-devel bzip2-devel readline-devel sqlite-devel \
    wget curl llvm ncurses-devel xz xz-devel tk-devel libxml2-devel xmlsec1-devel libffi-devel

  # HashiCorp repo + Terraform
  sudo dnf -y install dnf-plugins-core
  sudo dnf config-manager addrepo --from-repofile="https://rpm.releases.hashicorp.com/fedora/hashicorp.repo"
  sudo dnf -y makecache --refresh
  sudo dnf -y install terraform

  # Go
  sudo dnf -y install golang

  # Tools
  sudo dnf -y install awscli2 direnv eza fd-find jq nmap ripgrep stow unzip wireguard-tools zip
  # eza rpm if not available https://kojipkgs.fedoraproject.org//packages/rust-eza/0.19.3/1.fc41/x86_64/eza-0.19.3-1.fc41.x86_64.rpm

  # Github cli
  sudo dnf config-manager addrepo --from-repofile=https://cli.github.com/packages/rpm/gh-cli.repo
  sudo dnf install gh --repo gh-cli

  # Docker
  sudo dnf-3 config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
  sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo groupadd docker
  sudo usermod -aG docker $USER

  # VS Code
  sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
  echo -e "[code]\nname=Visual Studio Code\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\nenabled=1\nautorefresh=1\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://packages.microsoft.com/keys/microsoft.asc" | sudo tee /etc/yum.repos.d/vscode.repo > /dev/null
  sudo dnf -y install code

  # Slack
  sudo dnf -y install "https://downloads.slack-edge.com/desktop-releases/linux/x64/4.46.101/slack-4.46.101-0.1.el8.x86_64.rpm"

  # AWS Session Manager
  sudo dnf -y install https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm

  echo "Stowing files"
  mkdir -p ~/.local ~/.config
  stow -t ~ .

  # Reload shell config if present
  [ -f ~/.zshrc ] && source ~/.zshrc

  # Python (ensure pyenv is on PATH before using it)
  echo "Installing global python tools"
  export PYENV_ROOT="$HOME/.pyenv"
  export PATH="$PYENV_ROOT/bin:$PATH"
  if command -v pyenv >/dev/null 2>&1; then
    eval "$(pyenv init -)"
    pyenv install -s 3.12
    pyenv global 3.12
  fi
  pip install --upgrade pip
  curl -LsSf https://astral.sh/uv/install.sh | sh

  # Node
  echo "Installing global npms"
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default 'lts/*'
  nvm use default
  npm install -g @openai/codex @anthropic-ai/claude-code

  # Otpgen
  echo "Installing otpgen"
  mkdir -p $REPO_DIR/tools
  git clone https://github.com/deybhayden/otpgen.git $REPO_DIR/tools/otpgen
  pushd $REPO_DIR/tools/otpgen
  uv sync
  popd

  echo "GitHub CLI login"
  gh auth login
else
  sudo dnf -y update
fi
