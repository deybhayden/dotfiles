#!/usr/bin/env zsh

function git_current_branch() {
  local ref
  ref=$(git symbolic-ref --quiet HEAD 2>/dev/null)
  local ret=$?
  if [[ $ret != 0 ]]; then
    [[ $ret == 128 ]] && return # no git repo.
    ref=$(git rev-parse --short HEAD 2>/dev/null) || return
  fi
  echo ${ref#refs/heads/}
}

function git_prompt_branch() {
  branch=$(git_current_branch)
  if [[ $branch ]]; then
    echo "$branch "
  fi
}

alias g="git"
alias ga="git add"
alias gb="git branch"
alias gba="git branch --all"
alias gbd="git branch -D"
alias gc="git commit"
alias gca="git commit -a"
alias gcan!="git commit -a --amend --no-edit"
alias gcl="git clone"
alias gclean="git clean -id"
alias gco="git checkout"
alias gcp="git cherry-pick"
alias gd="git diff"
alias gdc="git diff --cached"
alias gf="git fetch"
alias gg="git grep"
alias gl="git pull"
alias glg="git log --stat"
alias glp="git log --stat -p"
alias gp="git push"
alias ggp='git push origin "$(git_current_branch)" --force-with-lease'
alias gr="git remote"
alias grba="git rebase --abort"
alias grbi="git rebase -i"
alias grbc="git rebase --continue"
alias grh="git reset HEAD^ --soft"
alias grs="git restore --staged ."
alias gst="git status"

function gbu() {
  git branch --set-upstream-to=$1
}
compdef _git gbu=git-checkout

function gsmash() {
  git commit -a --no-edit --amend
  git push origin "$(git_current_branch)" --force-with-lease
}
