#!/usr/bin/env bash
set -euo pipefail

# archie.sh - Arch Linux dotfiles bootstrap
# Must be run as a normal user (not root). sudo is called where needed.

if [ "$(id -u)" -eq 0 ]; then
  echo "ERROR: Do not run this script as root. Run as your normal user."
  exit 1
fi

# Ensure there's a place for source code
REPO_DIR="$HOME/Repos"
[ ! -d "$REPO_DIR" ] && mkdir "$REPO_DIR"

if ! command -v zsh >/dev/null 2>&1; then
  sudo pacman -Syu --noconfirm

  echo "Installing latest zsh & z'goodies..."
  sudo pacman -S --needed --noconfirm zsh zsh-autosuggestions zsh-syntax-highlighting
  chsh -s /usr/bin/zsh

  echo "Installing packages via pacman"

  # Build deps (Ubuntu: build-essential ca-certificates git gnupg make)
  sudo pacman -S --needed --noconfirm base-devel ca-certificates git gnupg make

  # Tools
  # Package mapping:
  #   dnsutils   → bind-tools
  #   fd-find    → fd
  #   ntpdate    → ntp
  sudo pacman -S --needed --noconfirm \
    curl direnv bind-tools eza fd ffmpeg imagemagick jq keyd less nmap ntp \
    ripgrep screen stow unzip vim wget wl-clipboard xdg-utils zip

  # keyd
  sudo systemctl enable keyd --now
  sudo cp etc/keyd/default.conf /etc/keyd/default.conf
  sudo keyd reload

  # Database client tools
  # Package mapping:
  #   mysql-client             → mariadb-clients
  #   postgresql-client*       → postgresql
  #   redis-tools              → redis
  #   mongodb-*                → AUR (below)
  sudo pacman -S --needed --noconfirm mariadb-clients postgresql redis

  # Install yay (AUR helper) if not present
  if ! command -v yay &>/dev/null; then
    echo "Installing yay (AUR helper)..."
    YAYDIR="$(mktemp -d)"
    git clone https://aur.archlinux.org/yay-bin.git "$YAYDIR"
    pushd "$YAYDIR"
    makepkg -si --noconfirm
    popd
    rm -rf "$YAYDIR"
  fi

  echo "Installing AUR packages..."
  # Package mapping:
  #   amazon-ecr-credential-helper → amazon-ecr-credential-helper-bin
  #   mongodb-database-tools       → mongodb-tools-bin
  #   mongodb-mongosh              → mongosh-bin
  #   mongodb-atlas{,-cli}         → mongodb-atlas-cli-bin
  #   session-manager-plugin.deb   → aws-session-manager-plugin
  yay -S --needed --noconfirm \
    agent-browser \
    amazon-ecr-credential-helper-bin \
    aws-session-manager-plugin \
    mongodb-tools-bin \
    mongosh-bin \
    mongodb-atlas-cli-bin \
    ttf-delugia-code

  echo "Stowing files"
  mkdir -p ~/.local ~/.config ~/.pi/agent
  stow -t ~ .

  # asdf
  wget https://github.com/asdf-vm/asdf/releases/download/v0.18.0/asdf-v0.18.0-linux-amd64.tar.gz
  tar xzf asdf-v0.18.0-linux-amd64.tar.gz
  mv asdf ~/.local/bin
  rm asdf-v0.18.0-linux-amd64.tar.gz
  export ASDF_DATA_DIR="$HOME/.asdf"
  mkdir -p "$ASDF_DATA_DIR/completions"
  ~/.local/bin/asdf completion zsh > "$ASDF_DATA_DIR/completions/_asdf"

  # source to get updated PATH
  source ~/.zshrc

  echo "Setting up asdf"
  asdf plugin add awscli
  asdf install awscli 2.33.21
  asdf set -u awscli 2.33.21
  asdf plugin add github-cli
  asdf install github-cli 2.86.0
  asdf set -u github-cli 2.86.0
  asdf plugin add golang
  asdf install golang 1.26.0
  asdf set -u golang 1.26.0
  asdf plugin add nodejs
  asdf install nodejs 22.22.0
  asdf set -u nodejs 22.22.0
  asdf plugin add terraform
  asdf install terraform 1.14.5
  asdf set -u terraform 1.14.5
  asdf plugin add uv
  asdf install uv 0.10.2
  asdf set -u uv 0.10.2

  # Python
  echo "Installing uv tools"
  uv tool install ruff
  uv tool install pre-commit

  # Node
  echo "Installing node tools"
  npm install -g @mariozechner/pi-coding-agent agent-browser
  agent-browser install --with-deps

  # Otpgen
  echo "Installing otpgen"
  mkdir -p "$REPO_DIR/tools"
  git clone https://github.com/deybhayden/otpgen.git "$REPO_DIR/tools/otpgen"
  pushd "$REPO_DIR/tools/otpgen"
  uv sync
  popd

  # AWS ECS exec checker
  curl "https://raw.githubusercontent.com/aws-containers/amazon-ecs-exec-checker/refs/heads/main/check-ecs-exec.sh" -o "check-ecs-exec.sh"
  chmod +x check-ecs-exec.sh
  mv check-ecs-exec.sh ~/.local/bin

  # Github
  gh extension install https://github.com/nektos/gh-act
  echo "GitHub CLI login"
  gh auth login
else
  sudo pacman -Syu --noconfirm
fi
