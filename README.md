# Dotfiles

Linux Dotfiles — supports WSL (Ubuntu).

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

### WSL2 Config

In order to have network traffic mirrored on WSL2 (you can access localhost seamlessly across both systems), you'll want the following
in your `$HOME/.wslconfig`

```ini
[wsl2]
networkingMode=mirrored
```

If you changed that, restart wsl with `wsl --shutdown` and open a new wsl terminal and you should be good.
