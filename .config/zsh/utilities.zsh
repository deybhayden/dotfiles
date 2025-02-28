#!/usr/bin/env zsh

function aws-whoami() {
  aws sts get-caller-identity
}

function ecs-task-sh() {
  aws ecs execute-command --region "$AWS_REGION" --cluster "$1" --task "$2" --command "/bin/sh" --interactive
}

function gpg-encrypt-file() {
  gpg --encrypt --sign --armor -r $1 $2
}

function myip-ingress() {
  dig +short txt ch whoami.cloudflare @1.0.0.1 | xargs sh -c 'echo "$@"/32' ip
}

function zulu() {
  date -u +"%Y-%m-%dT%H:%M:%SZ" | tr -d "\n"
}
