#!/usr/bin/env zsh

if [[ -v $HOMEBREW_PREFIX ]]; then
  # nvm
  [ -s "$HOMEBREW_PREFIX/opt/nvm/nvm.sh" ] && . "$HOMEBREW_PREFIX/opt/nvm/nvm.sh"
  # aws
  complete -C $HOMEBREW_PREFIX/bin/aws_completer aws
  # terraform
  complete -o nospace -C $HOMEBREW_PREFIX/bin/terraform terraform
else
  # nvm
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
  # aws
  complete -C /usr/local/bin/aws_completer aws
  # terraform
  complete -o nospace -C /usr/bin/terraform terraform
  # pnpm
  export PNPM_HOME="/home/ben/.local/share/pnpm"
  case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
  esac
  # pnpm end
fi

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
