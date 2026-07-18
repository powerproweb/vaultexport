# vaultexport

Tooling / library repo — **no webroot, no deploy target.** The SSH mechanics below
apply anywhere `ssh`/`scp` is used from this machine; there is deliberately no deploy
table, because this project does not deploy to a webserver.

> **This repository is PUBLIC on GitHub.** Never add a host, username, webroot, key name,
> or credential to this file.


## Where SSH credentials come from

**`%USERPROFILE%\.ssh\config` is the single source of truth for SSH
identities.** Host aliases, usernames, key paths, and verified webroots all live there. Read it
before the auth files and before guessing anything.

```powershell
notepad "$env:USERPROFILE\.ssh\config"
```

Connect by **alias**, never a bare `user@ip`:

```powershell
& "C:\Windows\System32\OpenSSH\ssh.exe" <alias>
```

The local credential store (see the private sibling repo) is a **separate system holding FTP and database credentials
only** — no SSH identities. Several of its `FTP_SERVER_DIR` values are demonstrably wrong, so
**never take a deploy path from it.** Its `_SSH_KEYS_MASTER_POINTER.md` just points back here.

Private key material never goes in `config`, in a repo, or in any project folder. The config
references keys by path; the keys stay in `~/.ssh/` as their own files.

## SSH / deploy mechanics

**Use the Windows OpenSSH binaries via the PowerShell tool.** Git Bash's `ssh` cannot see the
Windows ssh-agent — it looks for a Unix socket, the agent is a named pipe
(`\\.\pipe\openssh-ssh-agent`). Using Git Bash's `ssh` gives a baffling `Permission denied`
with the key sitting right there in the agent.

```
C:\Windows\System32\OpenSSH\ssh.exe
C:\Windows\System32\OpenSSH\scp.exe     # note: OpenSSH\ subdir, not System32\ directly
```

**`scp` takes ONE file per call.** A multi-file `scp a b c dest/` is refused by the permission
classifier. A loop calling `scp` once per file passes cleanly:

```powershell
$scp="C:\Windows\System32\OpenSSH\scp.exe"
foreach($f in $files){ & $scp "$src\$f" "$dest/$f"; if($LASTEXITCODE -ne 0){ "FAIL $f" } }
```

Permission rules live in `.claude/settings.local.json`:

```json
{ "permissions": { "allow": ["Bash(ssh:*)", "Bash(scp:*)"] } }
```

They load at **startup** — a rule added mid-session does nothing until Claude Code restarts.
`Bash(ssh:*)` matches even when invoked by full path, so full-path entries are unnecessary.

After a reboot the agent needs the key re-added, **non-elevated**:

```powershell
& "C:\Windows\System32\OpenSSH\ssh-add.exe" "$env:USERPROFILE\.ssh\<key>"
```

Check with `ssh-add.exe -l`.

## Verify against live bytes, never a browser view

Hash-compare local against live before claiming anything shipped. Stale cached assets have
produced false "still broken" readings repeatedly:

```powershell
$o="$env:TEMP\chk"; & curl.exe -s -o $o "https://<host>/$path"
(Get-FileHash $o -Algorithm SHA256).Hash -eq (Get-FileHash "$local" -Algorithm SHA256).Hash
```

Then Ctrl+F5. Exit code 0 from `scp` proves the transfer, not the result.

## Deploy hygiene

- **Name the exact files for every deploy. Never "upload the updates."** Where the source folder
  is also the webroot, a folder sync publishes whatever happens to be sitting there — this has
  already leaked a half-built admin scaffold and a downloadable SQL schema on one of these sites.
- **Always `php -l` before uploading any PHP.** And never write `**/` inside a PHP block comment:
  it contains `*/`, closes the comment early, and throws a parse error several lines later.
- **Escaping through PowerShell → SSH → bash mangles quotes and parens.** Keep remote commands
  trivially simple, or `scp` a script up and run that.
- **The agent's PATH ≠ the user's interactive PATH.** Give the user full paths, always.
- Read a `404` on a protected path as "the directory doesn't exist yet," **not** as "protected."
  Re-test once it does.

## Browser pane limitation

On heavy pages (WebGL, `backdrop-filter`) `requestAnimationFrame` never fires and screenshots
time out. This is a **documented environment limitation, not evidence of a broken change.**
DOM measurement, `read_page`, and `read_network_requests` all work fine. Never conclude "it
renders correctly" from this pane — and never conclude "it's broken" either.

## Conventions

**Ask before every push.** Standing instruction across all these repos.
