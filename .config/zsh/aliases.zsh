#!/usr/bin/env zsh

# cd
alias .r="cd $REPO_DIR"
alias .f="cd $REPO_DIR/dotfiles"
alias .o="cd $REPO_DIR/tools/otpgen"
if [ -n "$VSCODE_WORKSPACE_FOLDER" ]; then
  alias .v="cd $VSCODE_WORKSPACE_FOLDER"
fi

# misc
alias cO="curl -O"
alias htop="sudo htop"
alias src='source "$HOME/.zshrc"'

# ls
alias ls="eza"
alias sl="eza"
alias ll="eza --long --all"
alias lt="eza --long --tree --level=3 --color=always | less -R"

# docker
alias dex="docker exec -it"

# python
alias venv!="source .venv/bin/activate"

# node
alias nr="npm run"

# terraform
alias tf="terraform"

# aws
alias aws-sso="aws sso login --sso-session"
