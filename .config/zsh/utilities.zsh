#!/usr/bin/env zsh

function ecs-task-sh() {
  aws ecs execute-command --region "$AWS_REGION" --cluster "$1" --task "$2" --command "/bin/sh" --interactive
}

function gpg-encrypt-file() {
  gpg --encrypt --sign --armor -r $1 $2
}

function asdf() {
  if [[ "$1" == "update" ]]; then
    local asdf_bin="$HOME/.local/bin/asdf"
    local asdf_data_dir="${ASDF_DATA_DIR:-$HOME/.asdf}"
    local latest_version current_version os arch archive download_url tmp_dir

    command asdf plugin update --all
    echo "\033[0;32masdf plugins updated.\033[0m"

    latest_version=$(curl -fsSL https://api.github.com/repos/asdf-vm/asdf/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    current_version=$(command asdf --version | awk '{print $2}')

    if [[ -z "$latest_version" ]]; then
      echo "\033[0;31mUnable to determine the latest asdf release.\033[0m"
      return 1
    fi

    if [[ "$latest_version" == "$current_version" ]]; then
      echo "\033[0;32masdf is up to date (version $current_version).\033[0m"
      return 0
    fi

    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    case "$(uname -m)" in
      x86_64|amd64)
        arch="amd64"
        ;;
      arm64|aarch64)
        arch="arm64"
        ;;
      *)
        echo "\033[0;31mUnsupported architecture: $(uname -m).\033[0m"
        return 1
        ;;
    esac

    archive="asdf-${latest_version}-${os}-${arch}.tar.gz"
    download_url="https://github.com/asdf-vm/asdf/releases/download/${latest_version}/${archive}"
    tmp_dir=$(mktemp -d) || return 1

    mkdir -p "$HOME/.local/bin" "$asdf_data_dir/completions"

    if ! curl -fsSL "$download_url" -o "$tmp_dir/$archive"; then
      rm -rf "$tmp_dir"
      return 1
    fi

    if ! tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"; then
      rm -rf "$tmp_dir"
      return 1
    fi

    if ! install -m 755 "$tmp_dir/asdf" "$asdf_bin"; then
      rm -rf "$tmp_dir"
      return 1
    fi

    "$asdf_bin" completion zsh > "$asdf_data_dir/completions/_asdf"
    rm -rf "$tmp_dir"

    echo "\033[0;32masdf updated to version $latest_version.\033[0m"
  else
    command asdf "$@"
  fi
}

# agent-browser
function agent-browser() {
  if [[ "$1" == "update" ]]; then
    ASDF_NODEJS_VERSION=24.14.1 asdf exec npm install -g agent-browser@latest --loglevel=error
    echo -e "\033[0;32mAgent Browser updated.\033[0m"
  else
    ASDF_NODEJS_VERSION=24.14.1 asdf exec agent-browser "$@"
  fi
}

# pi
function pi() {
  if [[ "$1" == "update" ]]; then
    ASDF_NODEJS_VERSION=24.14.1 asdf exec npm install -g @mariozechner/pi-coding-agent --loglevel=error
    echo -e "\033[0;32mPi updated.\033[0m"
    ASDF_NODEJS_VERSION=24.14.1 asdf exec pi update
  else
    ASDF_NODEJS_VERSION=24.14.1 asdf exec pi "$@"
  fi
}

function pi-bb-review() {
  pi --provider openai-codex --model gpt-5.4 --thinking xhigh "/bitbucket review $@"
}

function pi-bb-respond() {
  pi --provider anthropic --model opus-4-6 --thinking high "/bitbucket respond $@"
}

function pi-gh-review() {
  pi --provider openai-codex --model gpt-5.4 --thinking xhigh "/github review $@"
}

function pi-gh-respond() {
  pi --provider anthropic --model opus-4-6 --thinking high "/github respond $@"
}