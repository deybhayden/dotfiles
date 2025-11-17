#!/usr/bin/env zsh

# asdf
export ASDF_DATA_DIR="$HOME/.asdf"
fpath=($ASDF_DATA_DIR/completions $fpath)

# direnv
eval "$(direnv hook zsh)"

# Final path setup
export PATH="node_modules/.bin:$ASDF_DATA_DIR/shims:$HOME/.local/bin:$PATH"
typeset -U PATH
