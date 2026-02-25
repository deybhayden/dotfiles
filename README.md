# Dotfiles

Linux Dotfiles — supports WSL (Ubuntu) and Arch Linux.

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

## Arch Linux

### Install

```shell
# from a fresh Arch install with a non-root user
mkdir ~/Repos
cd ~/Repos
sudo pacman -S --needed --noconfirm git
git clone https://github.com/deybhayden/dotfiles.git
cd dotfiles
cp .gitconfig ~
cp .zprofile ~
.local/bin/archie.sh
```

> **Note:** `archie.sh` must be run as your normal user (not root). It calls
> `sudo` internally where needed and installs [yay](https://github.com/Jguer/yay)
> as an AUR helper for packages not in the official repos.
