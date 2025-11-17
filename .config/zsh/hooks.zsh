#!/usr/bin/env zsh

# nvm
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# direnv
eval "$(direnv hook zsh)"

# Final path setup
export PATH="node_modules/.bin:$HOME/.local/bin:$PATH"
typeset -U PATH
