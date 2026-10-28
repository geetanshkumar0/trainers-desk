# Auto-deploy: GitHub `main` goes live within 5 minutes

Every 5 minutes the server checks GitHub. If `main` has new commits, it runs the tests on them. If the tests pass, it switches to the new version and restarts Trainer Desk. If the tests fail, or the new version does not start, the version that is live stays live. Everything is written to `data/deploy.log`.

## One-time setup on the server

1. **Give the server read access to the private repository.**
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/trainer_desk_deploy -N "" -C "trainer-desk server"
   cat ~/.ssh/trainer_desk_deploy.pub
   ```
   On GitHub, open the repository's **Settings → Deploy keys → Add deploy key**, paste that key, and leave "Allow write access" **off**. Then tell ssh to use the key for GitHub:
   ```bash
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
     IdentityFile ~/.ssh/trainer_desk_deploy
     IdentitiesOnly yes
   EOF
   ```

2. **Make the server folder a clone of the repository.** Keep `.env` and `data/` from the current server folder; they are not in git.
   ```bash
   git clone git@github.com:geetanshkumar0/trainers-desk.git /opt/trainer-desk
   cp /path/to/old/server/.env /opt/trainer-desk/.env
   cp -r /path/to/old/server/data /opt/trainer-desk/data
   cd /opt/trainer-desk && docker compose up -d
   ```

3. **Run the check every 5 minutes.**
   ```bash
   chmod +x /opt/trainer-desk/deploy/auto-deploy.sh
   ( crontab -l 2>/dev/null | grep -v trainer-desk/deploy/auto-deploy.sh; \
     echo '*/5 * * * * /opt/trainer-desk/deploy/auto-deploy.sh' ) | crontab -
   ```

## Everyday use

- **To change Trainer Desk:** push to `main`. It is live within 5 minutes, once the tests pass on GitHub and on the server.
- **To see what happened:** `tail -n 50 /opt/trainer-desk/data/deploy.log`
- **To go live right now:** `/opt/trainer-desk/deploy/auto-deploy.sh`
- **To pause deploys:** comment out the line in `crontab -e`.
- **To go back to an earlier version:** revert the commit on GitHub (`git revert <commit>` and push). Do not edit files in the server folder: the next deploy resets them to what is on GitHub.
