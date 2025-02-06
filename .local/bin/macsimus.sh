#!/usr/bin/env bash

# Ensure there's a place for source code
REPO_DIR="$HOME/Repos"
[ ! -d $REPO_DIR ] && mkdir $REPO_DIR

if [[ ! $(brew --version) ]]; then
  echo "Install core utils from Xcode"
  xcode-select --install

  echo "Installing homebrew..."
  ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

  if [[ $(uname -m) == 'arm64' ]]; then
    # Apple M1
    eval "$(/opt/homebrew/bin/brew shellenv)"
  else
    # Intel Mac
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  echo "Installing latest zsh & z'goodies..."
  brew install zsh zsh-autosuggestions zsh-syntax-highlighting
  ZSH_PATH="$HOMEBREW_PREFIX/bin/zsh"
  echo $ZSH_PATH | sudo tee -a /etc/shells
  chsh -s $ZSH_PATH

  echo "Installing brews"

  # Languages
  brew install nvm pyenv terraform
  brew install dotnet@6
  brew link dotnet@6 --force

  # Tools
  brew install awscli clamav direnv eza fd fzf gh git git-crypt gpgme hugo jq netcat nmap ripgrep stow telnet vegeta yq

  # Kubernetes
  brew install argo argocd helm kubeseal kustomize
  brew install argoproj/tap/kubectl-argo-rollouts
  (
    set -x
    cd "$(mktemp -d)" &&
      OS="$(uname | tr '[:upper:]' '[:lower:]')" &&
      ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/\(arm\)\(64\)\?.*/\1\2/' -e 's/aarch64$/arm64/')" &&
      KREW="krew-${OS}_${ARCH}" &&
      curl -fsSLO "https://github.com/kubernetes-sigs/krew/releases/latest/download/${KREW}.tar.gz" &&
      tar zxvf "${KREW}.tar.gz" &&
      ./"${KREW}" install krew
  )

  echo "Tap some casks"
  brew tap homebrew/cask
  brew tap homebrew/cask-drivers
  brew tap homebrew/cask-fonts

  echo "Installing casks"
  brew install --cask \
    beekeeper-studio confluent-cli docker figma flycut font-cascadia-code gimp google-chrome \
    google-drive keepingyouawake keybase logitech-options microsoft-edge mongodb-compass \
    postman onedrive session-manager-plugin slack visual-studio-code zoom

  echo "Installing global python tools"
  pyenv install 3.12
  pyenv global 3.12
  export PYENV_ROOT="$HOME/.pyenv"
  eval "$(pyenv init --path)"
  pip install --upgrade pip
  pip install black flake8 pipenv

  echo "Installing global npms"
  export NVM_DIR="$HOME/.nvm"
  [ -s "$HOMEBREW_PREFIX/opt/nvm/nvm.sh" ] && \. "$HOMEBREW_PREFIX/opt/nvm/nvm.sh"
  nvm install lts/iron
  nvm alias default lts/iron
  nvm use default
  npm install -g @aws-amplify/cli aws-cdk aws-sso-creds-helper corepack eslint firebase-tools pnpm npm-check-updates prettier serverless

  echo "Stowing files"
  mkdir -p .local .config
  stow -t ~ .
  cp clamav/freshclam.conf "$HOMEBREW_PREFIX/etc/clamav"

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
  brew update
  brew upgrade
  brew cleanup -s
  brew doctor
  brew cleanup
fi
