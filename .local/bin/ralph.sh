#!/bin/bash
# Usage: ./ralph.sh [-i] [plan|build] [max_iterations]
#
# Options:
#   -i, --interactive   Run interactively with colorized output (single run, no loop)
#
# Modes:
#   plan                Use PROMPT_plan.md
#   build (default)     Use PROMPT_build.md
#
# Examples:
#   ./ralph.sh                  # Build mode, unlimited loops, headless
#   ./ralph.sh plan             # Plan mode, unlimited loops, headless
#   ./ralph.sh plan 5           # Plan mode, 5 loops max, headless
#   ./ralph.sh -i               # Build mode, interactive (single run)
#   ./ralph.sh -i plan          # Plan mode, interactive (single run)

INTERACTIVE=false
MODE="build"
PROMPT_FILE="PROMPT_build.md"
MAX_ITERATIONS=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--interactive)
            INTERACTIVE=true
            shift
            ;;
        plan)
            MODE="plan"
            PROMPT_FILE="PROMPT_plan.md"
            shift
            ;;
        build)
            MODE="build"
            PROMPT_FILE="PROMPT_build.md"
            shift
            ;;
        [0-9]*)
            MAX_ITERATIONS=$1
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./ralph.sh [-i] [plan|build] [max_iterations]"
            exit 1
            ;;
    esac
done

CURRENT_BRANCH=$(git branch --show-current)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Mode:   $MODE"
echo "Prompt: $PROMPT_FILE"
echo "Branch: $CURRENT_BRANCH"
if [ "$INTERACTIVE" = true ]; then
    echo "Run:    interactive (single run)"
else
    [ $MAX_ITERATIONS -gt 0 ] && echo "Max:    $MAX_ITERATIONS iterations" || echo "Max:    unlimited"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

if [ "$INTERACTIVE" = true ]; then
    # Interactive mode: single run with colorized output
    claude --dangerously-skip-permissions --model opus "$(cat "$PROMPT_FILE")"

    # Push after completion (user will /exit or ctrl+c when done)
    echo -e "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Session ended. Pushing changes..."
    # Get the upstream branch from tracking config
    UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null | sed 's|^origin/||')
    if [ -n "$UPSTREAM" ]; then
        git push origin HEAD:"$UPSTREAM" || echo "Failed to push. Check upstream with: git branch -vv"
    else
        git push || echo "Failed to push. Check upstream with: git branch -vv"
    fi
else
    # Headless mode: loop with -p flag
    ITERATION=0
    while true; do
        if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
            echo "Reached max iterations: $MAX_ITERATIONS"
            break
        fi

        claude -p --dangerously-skip-permissions --model opus --verbose < "$PROMPT_FILE"

        # Get the upstream branch from tracking config
        UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null | sed 's|^origin/||')
        if [ -n "$UPSTREAM" ]; then
            git push origin HEAD:"$UPSTREAM" || echo "Failed to push. Check upstream with: git branch -vv"
        else
            git push || echo "Failed to push. Check upstream with: git branch -vv"
        fi

        ITERATION=$((ITERATION + 1))
        echo -e "\n\n======================== LOOP $ITERATION ========================\n"
    done
fi
