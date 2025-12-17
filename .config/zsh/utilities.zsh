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

# ai tools
cld() {
    if [[ "$1" == "update" ]]; then
        claude update
    else
        claude --dangerously-skip-permissions "$@"
    fi
}

cdx() {
    if [[ "$1" == "update" ]]; then
        npm install -g @openai/codex@latest
    else
        codex "$@"
    fi
}

gmi() {
    if [[ "$1" == "update" ]]; then
        npm install -g @google/gemini-cli
    else
        gemini "$@"
    fi
}

update-ai-tools() {
  claude update
  npm install -g @openai/codex@latest
  echo "\033[0;32mCodex updated.\033[0m"
  npm install -g @google/gemini-cli
  echo "\033[0;32mGemini updated.\033[0m"
}