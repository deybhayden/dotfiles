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
alias src='source "$HOME/.zshrc"'
alias zulu='date -u +"%Y-%m-%dT%H:%M:%SZ" | tr -d "\n"'
alias myip-ingress="dig +short txt ch whoami.cloudflare @1.0.0.1 | xargs sh -c 'echo \"\$@\"/32' ip"

# ls
alias ls="eza"
alias sl="eza"
alias ll="eza --long --all"

# docker
alias dex="docker exec -it"

# python
alias venv!="source .venv/bin/activate"

# terraform
alias tf="terraform"
alias tg="terragrunt"

# aws
alias aws-sso="aws sso login --sso-session"
alias aws-whoami="aws sts get-caller-identity"

# pi
alias pi-review="pi --provider openai-codex --model gpt-5.4 --thinking xhigh '/review'"
alias pi-codex="pi --provider openai-codex --model gpt-5.3-codex --thinking high"
alias pi-opus="pi --provider anthropic --model claude-opus-4.6 --thinking high"
alias pi-sonnet="pi --provider anthropic --model claude-sonnet-4.6 --thinking medium"
