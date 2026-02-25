#!/usr/bin/env zsh

# history
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_SAVE_NO_DUPS
setopt HIST_EXPIRE_DUPS_FIRST
export HISTFILE="$HOME/.zsh_history"
export HISTSIZE=100000
export SAVEHIST=100000

# keybindings
bindkey -e
bindkey "^[[H" beginning-of-line
bindkey "^[[F" end-of-line
bindkey "^[[3~" delete-char
bindkey "^[[1;5C" forward-word
bindkey "^[[1;5D" backward-word
WORDCHARS='~!#$%^&*(){}[]<>?+;-_'

# no cd
setopt auto_cd

# source z'goodies
if ! [[ -o login ]]; then
  # wsl is not a login shell
  source $HOME/.zprofile
fi
# source zsh-syntax-highlighting (path differs by distro)
if [[ -f /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]]; then
  source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
elif [[ -f /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]]; then
  source /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi

# init completion system early so compdef works in sourced files
autoload -U compinit && compinit
autoload -U +X bashcompinit && bashcompinit

# source other zsh files
for zfile in "${ZSH:-$HOME/.config/zsh}"/*.zsh; do
  source "$zfile"
done
export ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.config/zsh/custom}"
if [[ -d $ZSH_CUSTOM ]]; then
  for zfile in "$ZSH_CUSTOM"/*.zsh; do
    source "$zfile"
  done
fi

# enable substitution in the prompt
setopt prompt_subst

# config for prompt
if [[ -n "$SSH_TTY" ]]; then
  prompt='%B%F{yellow}%n@%m%f%b %B%F{blue}%1/%f%b %F{green}$(git_prompt_branch)%f$ '
else
  prompt='%B%F{blue}%1/%f%b %F{green}$(git_prompt_branch)%f$ '
fi
