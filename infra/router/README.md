# infra/router — the router on the Dashboard, and a reboot from Telegram

The home link goes through an ASUS RT-AX58U (SSH on the LAN, port 22). An agent on **blue** reads it over SSH every minute and tells bridge;
the owner can ask for a reboot from Telegram. bridge never connects to the router or to the board: the agent *asks* bridge, and the reboot
request comes back in the answer to its own report — the same shape as `infra/boardagent`.

```
Telegram: /router → state + [🔄 Перезагрузить роутер] → «Перезагрузить? …» [✅ Да] [Отмена]
          └─ bridge: a request (pending) ──┐
blue: router-agent.sh, every minute         │
   ping + `ssh router 'sh -s'` ──▶ POST /api/v1/boards/agent/router  ◀── the answer: { rebootRequestId } ─┘
   if there is one: `ssh router reboot` → wait until it stops answering and until it answers again → until 1.1.1.1 answers
   └──▶ POST …/router/reboots/<id>/result { ok, detail } ──▶ bridge ──▶ Telegram «✅ Роутер перезагружен: …»
```

## What is read (all optional — what the firmware does not answer is left out, never guessed)

`nvram` `wan0_state_t` (2 = connected), `wan0_auxstate_t` (1 = no cable), `link_internet` (2 = the router sees the internet), `wan0_ipaddr`,
`productid`; `/proc/uptime`; the WAN port's counters in `/proc/net/dev` (the agent turns two rounds into bit/s); a 3-packet ping from the router
to `PING_TARGET`. If the router does not answer ping from the board, the report says «unreachable» and nothing else; if ping answers but the key is
not accepted, `sshOk: false`.

## Install (on blue, once)

```bash
scp -r infra/router pi@192.168.50.13:/tmp/ && ssh -t pi@192.168.50.13 'sudo bash /tmp/router/install.sh'
```

It makes a key in `/etc/pipe-router/` (root only, kept on later runs), writes `/etc/pipe-router.env` (once), installs the agent and a one-minute
timer, and **prints the public key**. Add it to the router: web interface → Administration → System → «Authorized Keys» (and SSH enabled for the
LAN only). Then see what the router answers, without sending or rebooting anything:

```bash
sudo /usr/local/lib/pipe-router/router-agent.sh probe
```

If the router's login is not `admin`, set `ROUTER_USER` in `/etc/pipe-router.env`. The host key is pinned on the first connection
(`StrictHostKeyChecking=accept-new`) and refused if it ever changes. `--remove` takes the agent and the timer away and leaves the key and the
settings.

## The reboot

- Asked **twice** in Telegram (`/router` → the button → «Да»), and the second button is good for 5 minutes, so a stray tap or an old message does
  nothing. Only the owner's chat counts.
- It is refused, with the reason, when the report is stale (the agent is down), the router does not answer ping (SSH cannot help a hung router: it
  needs its power cut), the agent cannot log in, one is already under way, or the previous one was less than 5 minutes ago.
- A request nobody took in 10 minutes is dropped and you are told. One the agent took and never answered is closed the same way.
- The agent says how it went only after the router **came back** and the internet with it (up to `WAIT_UP_SEC`, 300 s): Telegram needs the
  internet, so the message could not be sent earlier anyway.
- **The button cannot help when the internet is gone**: the press reaches bridge through Telegram, which needs it. It helps with a router that is
  up but wrong (no WAN, packet loss, stuck) while Telegram still works, or from the LAN with `router-agent.sh`-side tools.

## Tests

`bash infra/router/test.sh` (33 checks, Linux: GNU tools; on a Mac run it in a container) — the report built from the router's answer, the speed
from two rounds, the key kept off curl's arguments, every way a reboot can end, and the installer on a stand-in root. Runs in CI's `infra scripts` job.
