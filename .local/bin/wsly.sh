#!/usr/bin/env bash
set -euo pipefail

# Ensure there's a place for source code
REPO_DIR="$HOME/Repos"
[ ! -d $REPO_DIR ] && mkdir $REPO_DIR

if ! command -v zsh >/dev/null 2>&1; then
  sudo apt update

  echo "Installing latest zsh & z'goodies..."
  sudo apt install zsh zsh-autosuggestions zsh-syntax-highlighting
  chsh -s /usr/bin/zsh

  echo "Set up nvm & pyenv"

  # Languages
  # nvm
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # pyenv
  curl -L https://github.com/pyenv/pyenv-installer/raw/master/bin/pyenv-installer | bash

  echo "Installing packages via apt"
  # python build deps
  sudo apt install make build-essential libssl-dev zlib1g-dev \
    libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
    libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev
  # terraform
  wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
  sudo apt update && sudo apt install terraform
  # golang
  sudo apt install golang-go

  # Tools
  sudo apt install direnv dnsutils eza fd-find jq nmap ntpdate ripgrep stow unzip wslu xdg-utils zip

  # Github cli
  (type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
	&& sudo mkdir -p -m 755 /etc/apt/keyrings \
	&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
	&& cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
	&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& sudo mkdir -p -m 755 /etc/apt/sources.list.d \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
	&& sudo apt update \
	&& sudo apt install gh -y

  # AWS CLI v2
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip awscliv2.zip
  sudo ./aws/install
  rm -rf ./aws awscli2.zip

  # AWS Session Manager
  curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
  sudo dpkg -i session-manager-plugin.deb
  rm session-manager-plugin.deb

  echo "Stowing files"
  mkdir ~/.local ~/.config ~/.codex
  stow -t ~ .

  source ~/.zshrc

  # Python
  echo "Installing global python tools"
  pyenv install 3.12
  pyenv global 3.12
  export PYENV_ROOT="$HOME/.pyenv"
  command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init -)"
  pip install --upgrade pip
  curl -LsSf https://astral.sh/uv/install.sh | sh

  # Node
  echo "Installing global npms"
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install lts/jod
  nvm alias default lts/jod
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
  sudo apt update
  sudo apt upgrade
fi
