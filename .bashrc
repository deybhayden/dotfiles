#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# Colorful PS1
PS1="\[\e[0;31m\]\u\[\e[0;37m\]@\[\e[0;31m\]\h \[\e[0;37m\][\t] \[\e[0;36m\]\w: \[\e[0m\]$ "

# Global Variable Configuration
export EDITOR="vim"
export LESS="-R"
export GREP_OPTIONS="--color=always --exclude-dir=.svn"
export LS_COLORS="di=34:ex=32:or=31:mi=31:ln=36:*.tar.gz=35:*.tar.bz2=35:*.diff=33"
# Subversion Repo Shortcuts
export BC="svn+ssh://svn/srv/svnroot/britecore"
export BC_OLD="svn+ssh://svn/srv/svnroot/britecore_old"
export IQ="svn+ssh://svn/srv/svnroot/iwsquotes"
# Path Updates
export PATH='/opt/go/bin/':'/opt/go/pkg/tool/linux_amd64/':'/usr/local/bin/':$PATH

# Aliases
alias ls='ls --color=auto'
# Aliases for updating and logging into SSH sites
alias gocalvary='ssh calvaryag@mycalvaryassembly.org'
alias update-calvary='ssh calvaryag@mycalvaryassembly.org -k "cd calvaryag; ~/bin/hg pull -u; ~/webapps/django/myproject/manage.py syncdb; ~/webapps/django/apache2/bin/restart"'
alias goleona='ssh leonamay@leonamayphotography.com'
alias update-leona='ssh leonamay@leonamayphotography.com -k "cd leonamay; ~/bin/hg pull -u; ~/webapps/django/myproject/manage.py syncdb; ~/webapps/django/apache2/bin/restart"'
alias goxen='ssh britecore.xen'
