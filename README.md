# Dotfiles

Windows Subsystem for Linux (WSL) Dotfiles

To link these files, I recommend using [stow](http://www.gnu.org/software/stow/).

- [zsh](https://github.com/zsh-users)
- [asdf](https://asdf-vm.com/)
- [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)

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
