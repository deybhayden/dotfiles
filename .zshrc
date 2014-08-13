# Path to your oh-my-zsh installation.
export ZSH="$HOME"/.oh-my-zsh

# Install ohmyzsh if it is missing
[[ ! -d $ZSH ]] && sh -c "$(curl -fsSL https://raw.github.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"

# Set name of the theme to load.
# Look in ~/.oh-my-zsh/themes/
# Optionally, if you set this to "random", it'll load a random theme each
# time that oh-my-zsh is loaded.
ZSH_THEME='dpoggi'

# Uncomment the following line to display red dots whilst waiting for completion.
COMPLETION_WAITING_DOTS='true'

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(aws brew git github pip npm)

# User configuration
export PATH='/usr/local/opt/gnu-tar/libexec/gnubin:/usr/local/opt/gnu-sed/libexec/gnubin:/usr/local/opt/coreutils/libexec/gnubin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
export MANPATH="/usr/local/opt/gnu-tar/libexec/gnuman:/usr/local/opt/gnu-sed/libexec/gnuman:/usr/local/opt/coreutils/libexec/gnuman:/usr/local/man:$MANPATH"

source $ZSH/oh-my-zsh.sh

export LANG=en_US.UTF-8
export EDITOR='vim'

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
alias s='ssh'
alias ez='vim ~/.zshrc'
alias zsrc='. ~/.zshrc'
alias ev='vim ~/.vimrc'
alias .f='cd ~/Repos/DotFiles'
alias htop='sudo htop'
alias gdc='git diff --cached'
# Smash last changes into one commit, don't edit the message and force push to remote
alias ggsmash='git commit --all --amend --no-edit ; ggpush -f'
# Open last commit in the browser
alias ggfresh='git browse -- commit/$(git log -1 --pretty=format:"%H")'
# IPython with numpy & matplotlib
alias pylab='ipython --pylab'

# Base16 Shell
BASE16_SHELL="$HOME/.config/base16-shell/base16-atelierforest.dark.sh"
[[ -s $BASE16_SHELL  ]] && source $BASE16_SHELL

# Set Slack token if it exists
[[ -f "$HOME"/.slack ]] && source "$HOME"/.slack

# Add work stuff if it exists
[[ -f "$HOME"/.work ]] && source "$HOME"/.work


# Activate virtualenv bottles named .venv automatically upon cd
function chpwd() {
    if [ -d .venv ]; then
        . .venv/bin/activate
    fi
}

# Serve HTML Directory at specified port (8000 is the default)
function pyserve() {
    pushd $1
    python2 -m SimpleHTTPServer $2
    popd
}

# vim:set ft=zsh et sw=2:
