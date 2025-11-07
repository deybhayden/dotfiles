# Dotfiles

macOS & Windows Subsystem for Linux (WSL) Dotfiles

To link these files, I recommend using [stow](http://www.gnu.org/software/stow/).

- [zsh](https://github.com/zsh-users)
- [pyenv](https://github.com/pyenv/pyenv)
- [nvm](https://github.com/nvm-sh/nvm)
- [golang](https://go.dev/)

## macOS

Follow along in [macman](https://github.com/deybhayden/macman.git) to set up Homebrew, etc. Then, link these files with stow.

## WSL (Ubuntu)

### Install

```shell
# set up WSL (Ubuntu) and then in the Ubuntu shell
mkdir ~/Repos
cd ~/Repos
sudo apt -y install git
git clone https://github.com/deybhayden/dotfiles.git
cd dotfiles
cp .gitconfig ~
cp .zprofile ~
.local/bin/wsly.sh
```
