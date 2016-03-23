#!/bin/bash

if [[ ! $(brew --version) ]]; then
  echo "Installing homebrew..."
  ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

  echo "Installing brew packages"
  brews=(coreutils tmux the_silver_searcher hub htop-osx stow zsh python node jq siege ruby mysql gnu-sed gnu-tar ncdu)

  for $b in $brews;
    do brew install $b;
  done

  brew install vim --override-system-vi --with-lua
  brew linkapps

  echo "Installing casks"
  brew tap caskroom/fonts
  casks=(flux google-chrome google-drive firefox slack karabiner font-sauce-code-powerline iterm2 shiftit flycut sequel-pro screenhero packer cyberduck dockertoolbox sling tunnelblick)

  for c in $casks;
    do brew cask install $c;
  done

  echo "Installing pips"
  pips=(awsebcli awscli ipython pudb sh flake8 virtualenv pandas matplotlib)

  for p in $pips;
    do pip install $p;
  done

  echo "Installing npms"
  npms=(eslint eslint-plugin-react babel-eslint webpack karma concurrently)

  for n in $npms;
    do npm install -g $n;
  done

  echo "Installing gems"
  gems=(bropages slackcat bundler)

  for g in $gems;
    do gem install $g;
  done

  echo "Installing tmux plugin manager"
  mkdir -p ~/.tmux/plugins
  git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm

  echo "Installing oh-my-zsh"
  sh -c "$(curl -fsSL https://raw.github.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"
  rm ~/.zshrc

  echo "Stowing files"
  stow -t ~ .
else
  brew update
  brew upgrade
  brew cask update
  brew prune
  brew cleanup
  brew doctor
fi
