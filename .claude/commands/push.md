Push the current branch to the remote repository.

1. Run `git status` to confirm there are no uncommitted changes (warn the user if there are).
2. Run `git branch --show-current` to identify the current branch.
3. Push with `git push -u origin <branch>`.
4. If the push fails due to a network error, retry up to 4 times with exponential backoff (2 s, 4 s, 8 s, 16 s).
5. If the push is rejected because the remote has diverged, report this to the user and ask how to proceed — do NOT force-push without explicit permission.
6. Report success (including the remote URL) or a clear error message.
