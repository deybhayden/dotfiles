ZSH_DIR=$(dirname `readlink $HOME/.zshrc`)
export PATH="$HOME/bin:$HOME/Documents/go-zone/bin:$(brew --prefix coreutils)/libexec/gnubin:$(brew --prefix findutils)/bin:$(brew --prefix ruby)/bin:/Library/Frameworks/Python.framework/Versions/2.7/bin:/usr/local/share/npm/bin:/usr/local/sbin:/usr/local/bin:${PATH}"
export GOPATH="$HOME/Documents/go-zone"

alias work_haste='HASTE_SERVER=http://hastebin.britecorepro.com haste'
alias vud='vagrant up dev'
alias vhd='vagrant halt dev'
alias vsd='vagrant ssh dev'

PLUGINS=('vagrant' 'brew')
source "$ZSH_DIR/common.zsh"
