# Dotfiles

Linux & Windows Subsystem for Linux (WSL) Dotfiles

To link these files, I recommend using [stow](http://www.gnu.org/software/stow/).

## WSL (Ubuntu)

- [apt](https://manpages.ubuntu.com/manpages/trusty/man8/apt.8.html)
- [zsh](https://github.com/zsh-users)
- [pyenv](https://github.com/pyenv/pyenv)
- [nvm](https://github.com/nvm-sh/nvm)

### Install

```shell
# set up WSL (Ubuntu) and then in the Ubuntu shell
mkdir ~/Repos
cd ~/Repos
# if you have git
git clone https://github.com/deybhayden/dotfiles.git
# if not, download and unzip
cd dotfiles
cp .gitconfig ~
cp .zprofile ~
.local/bin/wsly.sh
```
