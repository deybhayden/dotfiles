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
alias aws-whoami="aws sts get-caller-identity"

# pi
alias pi-code-review="pi --provider openai-codex --model gpt-5.3-codex --thinking xhigh '/review'"
alias pi-thinker="pi --provider openai-codex --model gpt-5.3-codex --thinking xhigh"
alias pi-builder="pi --provider anthropic --model claude-opus-4-6 --thinking high"
alias pi-chore="pi --provider anthropic --model claude-sonnet-4-5 --thinking medium"