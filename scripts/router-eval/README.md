# router-eval — does the task text predict how big the change will be?

Step L0 of the model router (PLAN-LLM-PROVIDERS.md): before building a router that sends simple tasks to a local model, check on
past tasks whether a cheap classifier can tell the simple ones from the rest by reading only the task.

- **Truth** is worked out from the merged pull request of each Improve task (`lib.mjs` `truthOf`): tier 1–4 by files, lines and areas
  of the diff (generated files such as `openapi.json` and `package-lock.json` do not count towards size, but stop a model that
  can only read and write files), +1 for a migration or three areas. `localOk` = tier ≤ 2 and nothing to generate. It is a
  proxy: a task of that size is not necessarily one a given local model can do.
- **Classifiers** see only the task title and text: a keyword heuristic (the baseline), a `claude -p` model, or any
  OpenAI-compatible server (Ollama on mac-fusion, say).

```bash
node scripts/router-eval/run.mjs collect  --limit 40                    # needs the gh CLI; writes .router-eval/tasks.json
node scripts/router-eval/run.mjs classify --by heuristic
node scripts/router-eval/run.mjs classify --by claude --model haiku     # ~3 minutes, a few hundred tokens a task
node scripts/router-eval/run.mjs classify --by openai --url http://localhost:11434/v1 --model qwen3:8b
node scripts/router-eval/run.mjs report                                 # tiers, confusion matrix, and the threshold table
node --test scripts/router-eval/                                        # the pure parts
```

The report's last table is the one to decide by: for "send to a local model when the predicted tier is at most N", how many tasks
that sends and how many of them were more than a file-only model could do.
