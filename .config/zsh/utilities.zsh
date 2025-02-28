#!/usr/bin/env zsh

function drsh() {
  docker run -it --rm -v $(pwd):/code -w /code $1 /bin/sh
}

function acm-ls-certs() {
  for region in $(ec2-regions); do
    echo $region
    echo "\n$(aws --region $region acm list-certificates | jq -r '.CertificateSummaryList[]')\n"
  done
}

function aws-whoami() {
  aws sts get-caller-identity
}

function ec2-network-check() {
  aws ec2 describe-network-interfaces --filters Name=$1,Values=$2 --output json
}

function ec2-regions() {
  aws ec2 describe-regions | jq -r '.Regions[].RegionName'
}

function ecs-task-sh() {
  aws ecs execute-command --region "$AWS_REGION" --cluster "$1" --task "$2" --command "/bin/sh" --interactive
}

function gpg-encrypt-file() {
  gpg --encrypt --sign --armor -r $1 $2
}

function kb-decrypt() {
  echo $1 | base64 --decode | keybase pgp decrypt
}

function kc-run-ubuntu() {
  kubectl run benz-ubuntu --rm -i --tty --image ubuntu -- bash
}

function myip-ingress() {
  dig +short txt ch whoami.cloudflare @1.0.0.1 | xargs sh -c 'echo "$@"/32' ip
}

function pip-clean() {
  pip freeze | xargs pip uninstall -y
}

function zulu() {
  date -u +"%Y-%m-%dT%H:%M:%SZ" | tr -d "\n"
}
