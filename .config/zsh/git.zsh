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

function gbdl() {
  git branch -D $(git branch --list "$1")
}
compdef _git gbdl=git-branch
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

function gwtclean() {
  local main_wt
  main_wt=$(git worktree list --porcelain 2>/dev/null | head -1 | awk '{print $2}')
  if [[ -z "$main_wt" ]]; then
    echo "Not inside a git repository." >&2
    return 1
  fi

  local worktrees=()
  while IFS= read -r wt; do
    [[ "$wt" != "$main_wt" ]] && worktrees+=("$wt")
  done < <(git worktree list --porcelain | grep '^worktree ' | awk '{print $2}')

  if [[ ${#worktrees[@]} -eq 0 ]]; then
    echo "No extra worktrees to remove."
    return 0
  fi

  echo "The following worktrees will be removed:"
  printf "  %s\n" "${worktrees[@]}"
  echo ""
  read -q "confirm?Remove all listed worktrees? [y/N] " || { echo ""; return 0; }
  echo ""

  for wt in "${worktrees[@]}"; do
    echo "Removing $wt..."
    git worktree remove --force "$wt"
  done

  git worktree prune
  echo "Done. Remaining worktrees:"
  git worktree list
}

# github cli
alias gha="gh auth status"
alias ghs="gh auth switch"