#!/usr/bin/env zsh

# nvm
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
# aws
complete -C /usr/local/bin/aws_completer aws
# terraform
complete -o nospace -C /usr/bin/terraform terraform

# pyenv
if [ -z "$PIPENV_ACTIVE" ] && [ -z "$POETRY_ACTIVE" ]; then
  # only init pyenv if pipenv is not active
  command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init -)"
fi

# direnv
eval "$(direnv hook zsh)"

# kubernetes
if type kubectl >/dev/null; then
  source <(kubectl completion zsh)
  source <(kubectl-argo-rollouts completion zsh)
fi

# Final path setup
export PATH="node_modules/.bin:$HOME/.local/bin:$HOME/.krew/bin:$PATH"
