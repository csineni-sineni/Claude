Stage all changes and create a git commit.

1. Run `git status` to see what has changed.
2. Run `git diff` (staged and unstaged) to understand the changes.
3. Run `git log --oneline -5` to match the repo's commit style.
4. Stage all relevant modified files (avoid committing secrets or generated artifacts).
5. Write a concise, imperative commit message that explains *why* the change was made.
6. Commit the changes.
7. Report the commit hash and message to the user.

If there is nothing to commit, say so clearly.
