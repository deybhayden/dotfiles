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

  echo "Installing packages via apt"
  # build deps (incl. Python/asdf compile deps)
  sudo apt install \
    build-essential ca-certificates git gnupg make pkg-config \
    llvm xz-utils \
    libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev \
    libffi-dev liblzma-dev libncurses-dev tk-dev \
    libgdbm-dev libgdbm-compat-dev libnss3-dev uuid-dev libdb-dev

  # Tools
  sudo apt install amazon-ecr-credential-helper curl direnv dnsutils eza fd-find ffmpeg imagemagick jq nmap ntpdate ripgrep stow unzip vim wget wl-clipboard wslu xdg-utils zip

  echo "Configuring MongoDB apt source"
  if [ ! -f /usr/share/keyrings/mongodb-server-8.0.gpg ]; then
    curl -fsSL https://pgp.mongodb.com/server-8.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
  fi

  if [ ! -f /etc/apt/sources.list.d/mongodb-org-8.0.list ] || ! grep -q 'jammy/mongodb-org/8.0' /etc/apt/sources.list.d/mongodb-org-8.0.list; then
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list > /dev/null
  fi

  sudo apt update

  echo "Installing database client tools via apt"
  sudo apt install mongodb-atlas mongodb-atlas-cli mongodb-database-tools mongodb-mongosh mysql-client postgresql-client postgresql-client-common redis-tools

  echo "Stowing files"
  mkdir ~/.local ~/.config ~/.pi/agent
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
  asdf plugin add python
  asdf install python 3.12.8
  asdf set -u python 3.12.8

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
  mkdir -p $REPO_DIR/tools
  git clone https://github.com/deybhayden/otpgen.git $REPO_DIR/tools/otpgen
  pushd $REPO_DIR/tools/otpgen
  uv sync
  popd
  
  # AWS Session Manager
  curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
  sudo dpkg -i session-manager-plugin.deb
  rm session-manager-plugin.deb

  # AWS ECS exec checker
  curl "https://raw.githubusercontent.com/aws-containers/amazon-ecs-exec-checker/refs/heads/main/check-ecs-exec.sh" -o "check-ecs-exec.sh"
  chmod +x check-ecs-exec.sh
  mv check-ecs-exec.sh ~/.local/bin

  # Github
  gh extension install https://github.com/nektos/gh-act
  echo "GitHub CLI login"
  gh auth login
else
  sudo apt update
  sudo apt upgrade
fi
