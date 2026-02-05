#!/usr/bin/env zsh

function ecs-task-sh() {
  aws ecs execute-command --region "$AWS_REGION" --cluster "$1" --task "$2" --command "/bin/sh" --interactive
}

function gpg-encrypt-file() {
  gpg --encrypt --sign --armor -r $1 $2
}

# pi
function pi-update() {
  if "$NVM_BIN/npm" list -g --depth=0 @mariozechner/pi-coding-agent >/dev/null 2>&1; then
    "$NVM_BIN/npm" install -g @mariozechner/pi-coding-agent@latest --loglevel=error
    echo "\033[0;32mPi updated.\033[0m"
  else
    echo "\033[0;33mPi not installed; skipping update.\033[0m"
  fi
}

function pi-bb-review() {
  pi --provider openai-codex --model gpt-5.3-codex --thinking xhigh "/bitbucket review $@"
}

function pi-bb-respond() {
  pi --provider anthropic --model opus-4-6 --thinking high "/bitbucket respond $@"
}

function pi-gh-review() {
  pi --provider openai-codex --model gpt-5.3-codex --thinking xhigh "/github review $@"
}

function pi-gh-respond() {
  pi --provider anthropic --model opus-4-6 --thinking high "/github respond $@"
}