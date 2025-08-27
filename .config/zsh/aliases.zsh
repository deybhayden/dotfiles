#!/usr/bin/env zsh

# cd
alias .r="cd $REPO_DIR"
alias .f="cd $REPO_DIR/dotfiles"
alias .o="cd $REPO_DIR/tools/otpgen"
alias .v="cd $VSCODE_WORKSPACE_FOLDER"

# misc
alias cO="curl -O"
alias ct="curl -o /dev/null -s -w 'Time to connect: %{time_connect}s\nTime to start transfer: %{time_starttransfer}s\nTotal time: %{time_total}s\n'"
alias htop="sudo htop"
alias src='source "$HOME/.zshrc"'
alias vc="code"

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

# aws
alias aws-sso="aws sso login --sso-session"

# ai tools
alias codex-yolo="codex --full-auto -m gpt-5 -c model_reasoning_effort='high'"
alias claude-yolo="claude --dangerously-skip-permissions"
