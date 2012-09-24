#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# Global Variable Configuration
export EDITOR="vim"
export LESS="-R"
export GREP_OPTIONS="--color=always -n --exclude-dir=.svn"

# Operation System Specific Setup
if [ $OSTYPE == 'linux-gnu' ]; then
    # Linux Specific Paths
    export PATH="/usr/local/bin/:${PATH}"
    # Enable Bash Completion
    if [ -f /etc/bash_completion ]; then
        . /etc/bash_completion
    fi
elif [ $OSTYPE == 'darwin10.0' ]; then
    # Mac OS X Paths
    export PATH="$(brew --prefix coreutils)/libexec/gnubin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/2.7/bin:${PATH}"
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
