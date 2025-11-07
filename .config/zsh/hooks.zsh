#!/usr/bin/env zsh

if [ -n "$HOMEBREW_PREFIX" ]; then
  # nvm
  [ -s "$HOMEBREW_PREFIX/opt/nvm/nvm.sh" ] && \. "$HOMEBREW_PREFIX/opt/nvm/nvm.sh"
  [ -s "$HOMEBREW_PREFIX/opt/nvm/etc/bash_completion.d/nvm" ] && \. "$HOMEBREW_PREFIX/opt/nvm/etc/bash_completion.d/nvm"
else
  # nvm
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
fi

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
