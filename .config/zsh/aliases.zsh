#!/usr/bin/env zsh

# cd
alias .r="cd $REPO_DIR"
alias .f="cd $REPO_DIR/dotfiles"
alias .v="cd $VSCODE_WORKSPACE_FOLDER"
alias .o="cd $REPO_DIR/tools/otpgen"

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

# kubernetes
alias kc="kubectl"
alias kctx="kubectl-ctx"
alias kubectx="kubectl-ctx"
alias kns="kubectl-ns"
alias kubens="kubectl-ns"
alias kargo="kubectl -n argocd"
alias kxu="kubectl config use-context"
alias kxs="kubectl config set-context"
alias kmon="kubectl -n monitoring"
alias krew="kubectl-krew"
alias kroll="kubectl-argo-rollouts"
alias stern="kubectl-stern"

# node
alias nr="npm run"

# terraform
alias tf="terraform"
alias tf-gitlab-init="terraform init -backend-config=config.http.tfbackend -backend-config=\"username=deybhayden\" -backend-config=\"password=$GITLAB_TOKEN\""

# vscode
alias vc="code"
alias v-="code -"
alias vd="code -d"
alias vdiff="code -d"
