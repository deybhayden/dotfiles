#!/usr/bin/env bash

# Ensure there's a place for source code
REPO_DIR="$HOME/Repos"
[ ! -d $REPO_DIR ] && mkdir $REPO_DIR

if [[ ! $(zsh --version) ]]; then
  sudo apt update

  echo "Installing latest zsh & z'goodies..."
  sudo apt install zsh zsh-autosuggestions zsh-syntax-highlighting
  chsh -s /usr/bin/zsh

  echo "Installing sudo apt packages"

  # Languages
  # nvm
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.2/install.sh | bash
  # pyenv
  curl -L https://github.com/pyenv/pyenv-installer/raw/master/bin/pyenv-installer | bash
  # python build deps
  sudo apt install make build-essential libssl-dev zlib1g-dev \
    libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
    libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev
  # terraform
  wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
  sudo apt update && sudo apt install terraform

  # Tools
  sudo apt install direnv dnsutils eza fd-find gh git-crypt hugo jq nmap ntpdate ripgrep stow unzip wslu xdg-utils zip

  # AWS CLI v2
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip awscliv2.zip
  sudo ./aws/install
  rm -rf ./aws awscli2.zip

  # AWS Session Manager
  curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
  sudo dpkg -i session-manager-plugin.deb
  rm session-manager-plugin.deb

  # aws-sso-cli
  curl "https://github.com/synfinatic/aws-sso-cli/releases/download/v1.9.10/aws-sso-cli_1.9.10-1_amd64.deb" -o "aws-sso-cli.deb"
  sudo dpkg -i aws-sso-cli.deb
  rm aws-sso-cli.deb

  # Kubernetes
  curl -LO https://dl.k8s.io/release/v1.25.0/bin/linux/amd64/kubectl
  chmod +x ./kubectl
  sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
  rm kubectl

  # Krew
  (
    set -x
    cd "$(mktemp -d)" &&
      OS="$(uname | tr '[:upper:]' '[:lower:]')" &&
      ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/\(arm\)\(64\)\?.*/\1\2/' -e 's/aarch64$/arm64/')" &&
      KREW="krew-${OS}_${ARCH}" &&
      curl -fsSLO "https://github.com/kubernetes-sigs/krew/releases/latest/download/${KREW}.tar.gz" &&
      tar zxvf "${KREW}.tar.gz" &&
      ./"${KREW}" install krew &&
      ./"${KREW}" install ctx ns stern
  )

  # Helm
  curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
  chmod 700 get_helm.sh
  ./get_helm.sh
  rm -rf get_helm.sh

  # Kubeseal
  wget https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.18.0/kubeseal-0.18.0-linux-amd64.tar.gz
  mkdir kubeseal-temp
  tar xfz kubeseal-0.18.0-linux-amd64.tar.gz -C kubeseal-temp
  sudo install -m 755 kubeseal-temp/kubeseal /usr/local/bin/kubeseal
  rm -rf kubeseal*

  # Kustomize
  curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash
  sudo install -m 755 kustomize /usr/local/bin/kustomize
  rm -rf kustomize*

  # Argo CD
  curl -sSL -o argocd-linux-amd64 https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
  sudo install -m 555 argocd-linux-amd64 /usr/local/bin/argocd
  rm argocd-linux-amd64

  # Argo Rollouts
  curl -LO https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-linux-amd64
  sudo install -m 555 kubectl-argo-rollouts-linux-amd64 /usr/local/bin/kubectl-argo-rollouts
  rm kubectl-argo-rollouts-linux-amd64

  # Vegeta
  VEGETA_VERSION=$(curl -s "https://api.github.com/repos/tsenart/vegeta/releases/latest" | grep -Po '"tag_name": "v\K[0-9.]+')
  curl -Lo vegeta.tar.gz "https://github.com/tsenart/vegeta/releases/latest/download/vegeta_${VEGETA_VERSION}_linux_amd64.tar.gz"
  mkdir vegeta-temp
  tar xf vegeta.tar.gz -C vegeta-temp
  sudo install -m 755 vegeta-temp/vegeta /usr/local/bin/vegeta
  rm -rf vegeta*

  # yq
  wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64.tar.gz
  mkdir yq-temp
  tar xf yq_linux_amd64.tar.gz -C yq-temp
  sudo install -m 755 yq-temp/yq_linux_amd64 /usr/local/bin/yq
  rm -rf yq*

  echo "Stowing files"
  mkdir ~/.local ~/.config
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
  pip install black flake8 poetry

  # Node
  echo "Installing global npms"
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install lts/jod
  nvm alias default lts/jod
  nvm use default
  
  # AI tools
  npm install -g @openai/codex
  npm install -g @anthropic-ai/claude-code

  # Deno
  curl -fsSL https://deno.land/install.sh | sh
  export DENO_INSTALL="/home/$(whoami)/.deno"

  # Otpgen
  echo "Installing otpgen"
  mkdir -p $REPO_DIR/tools
  git clone https://github.com/deybhayden/otpgen.git $REPO_DIR/tools/otpgen
  pushd $REPO_DIR/tools/otpgen
  pipenv install
  popd

  echo "GitHub CLI login"
  gh auth login
else
  sudo apt update
  sudo apt upgrade
fi
