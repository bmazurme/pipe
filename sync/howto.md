# HOWTO: pull a parcel from bridge and run it via the agent

Repeatable steps for taking a `<projectId>-<iid>.subscription.zip[.enc]`
parcel sitting in bridge storage (pushed from reports' Subscription module)
and running it end to end on this machine. Worked example below uses the
`402-3.subscription.zip.enc` parcel (GitLab project 402, issue 3).

## One-time setup (per project)

Skip this section if the project is already in `sync.config.json` (check
with `sync-cli list`).

1. **Add the project** — `<localName>` is just a label you pick, `<path>` is
   a local git clone of the repo the parcel's project maps to:
   ```bash
   sync-cli add <localName> <path>
   ```
2. **Add encryption keys**, if the parcel is `.enc` (it almost always is —
   reports encrypts by default once a keypair exists). Export the keypair
   from reports → Settings → Subscription → Шифрование → "Экспорт" (downloads
   `subscription-encryption-keys-<date>.json`, `{ publicKey, privateKey }`),
   then split it into the two PEM files sync expects:
   ```bash
   python3 -c "
   import json
   with open('<path-to-downloaded-json>') as f:
       d = json.load(f)
   with open('keys/<localName>-public.pem', 'w') as f:
       f.write(d['publicKey'])
   with open('keys/<localName>-private.pem', 'w') as f:
       f.write(d['privateKey'])
   "
   chmod 600 keys/<localName>-private.pem
   ```
   Sanity-check the pair actually matches before relying on it:
   ```bash
   openssl pkey -in keys/<localName>-private.pem -pubout | diff - keys/<localName>-public.pem \
     && echo "MATCH: pair is consistent"
   ```
3. **Edit `sync.config.json`** to add `gitlabProjectId` (the number in the
   parcel filename) and the key paths to that project's entry:
   ```json
   {
     "name": "<localName>",
     "path": "<path>",
     "publicKeyPath": "keys/<localName>-public.pem",
     "privateKeyPath": "keys/<localName>-private.pem",
     "gitlabProjectId": "<projectId>"
   }
   ```
   No `dictionary` field is needed for running via the agent — see "Why no
   dictionary?" below. No `baseBranch` field is needed either if the repo's
   default branch is `main`.

4. **Log in to bridge**, once per machine (mint a personal key from bridge →
   Profile → API-ключи first):
   ```bash
   sync-cli login-api-key <bridge-api-key>
   ```

**Gotcha**: `sync-cli` must resolve to *this* repo's build
(`pipe/sync/dist/cli.js`), not some other global install — check with
`readlink -f "$(which sync-cli)"`. If it points elsewhere (e.g. a separate
standalone `sync` checkout), re-point it: `cd pipe/sync && npm link`. That
only changes where the global command looks; it doesn't touch any files in
the other checkout.

## Pull + review + run

```bash
sync-cli agent-runner <localName> --review
```

Worked example for `402-3.subscription.zip.enc`:
```bash
sync-cli agent-runner bff --review
```

What this does, in order:
1. Lists bridge storage, finds the parcel matching `gitlabProjectId`.
2. Downloads and decrypts it with `privateKeyPath`.
3. Creates an isolated git worktree at `.agent-work/<projectId>-<iid>`,
   branched off the project's `baseBranch` (default `main`) — **your main
   checkout's working tree is untouched**, dirty or not.
4. Writes the parcel's files into the worktree, plus `ISSUE.md`
   (title/description) and `issue-images/*` for any images the issue
   description embedded.
5. Because of `--review`, pauses here: prints the issue and image list,
   offers to open the description in `$EDITOR`/`$VISUAL` (rewrites
   `ISSUE.md` if you change it), asks which Claude model to run it with
   (blank = default), and asks to confirm.
6. On confirming: commits "before" and pushes the branch to `origin`, runs
   Claude non-interactively (`--dangerously-skip-permissions`, scoped to the
   worktree) against the reviewed issue text, commits "after", pushes again,
   and — if Claude exited cleanly — **pushes the result parcel back to
   bridge automatically**. No separate "send it back" step.
7. Declining at the final confirm skips this parcel (nothing pushed, nothing
   committed) and leaves it unclaimed on bridge for next time.

Real side effects worth knowing before confirming: it pushes two new commits
to a branch on the real `origin` remote, and Claude runs with tool
permissions skipped (isolated to the worktree, but with normal
network/process access from there).

## Why no dictionary?

`agent-runner` is deliberately dictionary-free — it always passes an empty
dictionary to `extractIssue`, so `ISSUE.md` keeps whatever placeholders the
parcel already carries instead of decoding them. De-/anonymization is
reports' responsibility on the way back in. This also means a project entry
used only for `agent-runner` doesn't need a `dictionary` field at all, and
won't error even if `dictionaries/<name>.json` doesn't exist locally.

(Contrast: `sync-cli pull-issue` *does* load `project.dictionary` if one is
configured, and will throw a clear "Dictionary not found" error if that path
doesn't exist. It also refuses to run against a dirty working tree, unlike
`agent-runner`, since it writes directly into the project path instead of an
isolated worktree.)

## Troubleshooting

- **`unknown command 'login-api-key'` (or any command that should exist)**
  — `sync-cli` is resolving to a different install. See the gotcha above.
- **RSA/crypto decrypt error** — the configured `privateKeyPath` doesn't
  match the public key the parcel was encrypted with. Confirms the keypair
  in use isn't the original one; re-export the current keypair from reports
  and re-import it (see step 2), and if the parcel predates that keypair,
  it'll need to be re-pushed from reports rather than pulled.
- **`Project "<name>" is not tracked`** — check `sync-cli list`; the name
  must match `sync.config.json` exactly (it's a local label, not
  necessarily the GitLab project's real name).
- **Result never shows up on bridge** — check the command's own output for
  `Claude exited with code ... — not pushing a result parcel back to
  bridge`; a non-zero Claude exit intentionally skips the push-back so a
  failed run doesn't overwrite anything.
