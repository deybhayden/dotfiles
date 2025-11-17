#!/usr/bin/env zsh

function ecs-task-sh() {
  aws ecs execute-command --region "$AWS_REGION" --cluster "$1" --task "$2" --command "/bin/sh" --interactive
}

function gpg-encrypt-file() {
  gpg --encrypt --sign --armor -r $1 $2
}

function agent-browser() {
  ASDF_NODEJS_VERSION=22.22.0 asdf exec agent-browser "$@"
}

# pi
function pi() {
  ASDF_NODEJS_VERSION=22.22.0 asdf exec pi "$@"
}

function pi-update() {
  ASDF_NODEJS_VERSION=22.22.0 asdf exec npm install -g @mariozechner/pi-coding-agent@latest --loglevel=error
  echo "\033[0;32mPi updated.\033[0m"
}

function pi-bb-review() {
  pi --provider openai-codex --model gpt-5.3-codex --thinking xhigh "/bitbucket review $@"
}

function pi-bb-respond() {
  pi --provider anthropic --model opus-4-6 --thinking xhigh "/bitbucket respond $@"
}

function pi-gh-review() {
  pi --provider openai-codex --model gpt-5.3-codex --thinking xhigh "/github review $@"
}

function pi-gh-respond() {
  pi --provider anthropic --model opus-4-6 --thinking xhigh "/github respond $@"
}