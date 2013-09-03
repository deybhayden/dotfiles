# Export some global settings
export EDITOR="vim"
export LESS="-R"

# Style for autocomplete
zstyle ':completion:*' completer _complete _ignored _correct _approximate
zstyle ':completion:*:descriptions' format '%U%B%d%b%u'
zstyle ':completion:*:warnings' format '%BSorry, no matches for: %d%b'
zstyle :compinstall filename "$HOME/.zshrc"

# Load autocompletion
autoload -Uz compinit
compinit

autoload -U bashcompinit
bashcompinit

# Nosetest autocomplete
_nosetests()
{
    cur="${COMP_WORDS[COMP_CWORD]}"
    COMPREPLY=(`nosecomplete ${cur} 2>/dev/null`)
}
complete -o nospace -F _nosetests nosetests

# Correct all mistyped commands
setopt correctall
# Ignore entries with a preceding space
setopt hist_ignore_space
# Change directory when typing directory
setopt autocd

# Enable save history of 1000 cmds, write to a certain file
HISTFILE=~/.histfile
HISTSIZE=1000
SAVEHIST=1000

# Emacs-style bindings
bindkey -e

# Enable Antigen bundle system
# https://github.com/zsh-users/antigen
source "$ZSH_DIR/antigen.zsh"

# Enable oh-my-zsh repo
antigen-use oh-my-zsh

# Turn on some different plugins
antigen-bundle git
antigen-bundle golang
antigen-bundle pip

for p in $PLUGINS; do
    antigen-bundle $p end
done

# Turn on syntax highlighting for shell
antigen-bundle zsh-users/zsh-syntax-highlighting

# Pretty Colors
antigen-theme dpoggi

antigen-apply

# Aliases (at the end to overwrite any antigen aliases)
alias ls='ls --color=auto'
alias gg='git grep -n'
compdef _git gg=git-grep
alias gpd='git push --delete'
compdef _git gpd=git-push

# Activate virtualenv bottles named .venv automatically upon cd
function chpwd() {
    if [ -d .venv ]; then
        . .venv/bin/activate
    fi
}
