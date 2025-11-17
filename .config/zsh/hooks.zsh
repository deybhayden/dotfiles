#!/usr/bin/env zsh

# nvm
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# pyenv
if [ -z "$PIPENV_ACTIVE" ] && [ -z "$POETRY_ACTIVE" ] && [ -z "$VIRTUAL_ENV" ]; then
  # only init pyenv if pipenv is not active
  command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init -)"
fi

# direnv
eval "$(direnv hook zsh)"

# Final path setup
export PATH="node_modules/.bin:$HOME/.local/bin:$PATH"
