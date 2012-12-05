#
# ~/.bashrc
#

# Color Constants

BLUE="\[\033[0;34m\]"
GREEN="\[\033[0;32m\]"
CYAN="\[\033[0;36m\]"
RED="\[\033[0;31m\]"
PURPLE="\[\033[0;35m\]"
YELLOW="\[\033[0;33m\]"
LGRAY="\[\033[0;37m\]"
DGRAY="\[\033[1;30m\]"
LBLUE="\[\033[1;34m\]"
LGREEN="\[\033[1;32m\]"
LCYAN="\[\033[1;36m\]"
LRED="\[\033[1;31m\]"
LPURPLE="\[\033[1;35m\]"
LYELLOW="\[\033[1;33m\]"
WHITE="\[\033[1;37m\]"
NORMAL="\[\033[0;00m\]"

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# Global Variable Configuration
export EDITOR="vim"
export GREP_OPTIONS="--color=always -n"
export LESS="-R"

# Operation System Specific Setup
if [ $OSTYPE == 'linux-gnu' ]; then
    # Linux Specific Paths
    export PATH="/usr/local/bin/:${PATH}"
    # Enable Bash Completion
    if [ -f /etc/bash_completion ]; then
        . /etc/bash_completion
    fi
elif [ $OSTYPE == 'darwin11' ]; then
    # Mac OS X Paths
    export PATH="$(brew --prefix coreutils)/libexec/gnubin:/usr/local/share/npm/bin:/usr/local/sbin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/2.7/bin:${PATH}"
    # Use MacVim
    alias vim='/Applications/MacVim.app/Contents/MacOS/Vim'
    alias winpdb='python2.7-32 /Library/Frameworks/Python.framework/Versions/2.7/bin/winpdb'
    export EDITOR='/Applications/MacVim.app/Contents/MacOS/Vim'
    # Enable Bash Completion
    if [ -f `brew --prefix`/etc/bash_completion ]; then
        . `brew --prefix`/etc/bash_completion
    fi
fi

# Aliases
alias ls='ls --color=auto'
alias pylab='ipython --pylab'
# Aliases for updating and logging into SSH sites
alias gocalvary='ssh calvaryag@mycalvaryassembly.org'
alias update-calvary='ssh calvaryag@mycalvaryassembly.org -k "cd calvaryag; ~/bin/hg pull -u; ~/webapps/django/myproject/manage.py syncdb; ~/webapps/django/apache2/bin/restart"'
alias goleona='ssh leonamay@leonamayphotography.com'
alias update-leona='ssh leonamay@leonamayphotography.com -k "cd leonamay; ~/bin/hg pull -u; ~/webapps/django/myproject/manage.py syncdb; ~/webapps/django/apache2/bin/restart"'

# Increase history to 10,000 entries... erase duplicates, and append on shell exit instead of overwrite.
export HISTSIZE=10000
export HISTCONTROL=erasedups
shopt -s histappend

branch_git() {
    git branch &>/dev/null || return 1
    HEAD="$(git symbolic-ref HEAD 2>/dev/null)"
    BRANCH="${HEAD##*/}"
    echo ":${BRANCH:-unknown}"
}

modified_git() {
    [[ -n "$(git status --porcelain 2>/dev/null | grep -F 'M ')" ]] && echo "!"
}

# Add fancy git bash prompt.
export PS1="${GREEN}\u ${LCYAN}\W${YELLOW}\$(branch_git)${RED}\$(modified_git)${WHITE}\$ ${NORMAL}"
