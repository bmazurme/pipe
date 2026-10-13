# Raspberry Pi: доступ, сеть, роутер

Часть плана [docs/ha-dr-plan.md](../../docs/ha-dr-plan.md). Состояние на
**2026-10-12** (проверено по SSH, только чтение, кроме `ubuntu-white`, которую настроили).

| Плата | Адрес (сейчас) | MAC `eth0` | Ethernet | Wi-Fi |
|---|---|---|---|---|
| `ubuntu-white` | **192.168.50.11** (резервация применена 2026-10-12) | `2c:cf:67:ce:a4:e6` | **link есть, но 10 Мбит/с** | **выключен (сделано)** |
| `ubuntu-red` | **192.168.50.12** (Ethernet-only, сделано) | `d8:3a:dd:bf:99:18` | link есть, **10 Мбит/с** | **выключен (сделано)** |
| `ubuntu-blue` | **192.168.50.13** (Ethernet-only, сделано) | `2c:cf:67:b6:ce:77` | link есть, **10 Мбит/с** | **выключен (сделано)** |
| `ubuntu-green` | **192.168.50.14** (Ethernet-only, сделано) | `2c:cf:67:9f:b8:23` | link есть, **10 Мбит/с** | **выключен (сделано)** |

## 0. Что уже сделано автоматически

- **`ubuntu-white`:** Ethernet-only. Конфигурация netplan переписана (только `eth0`,
  DHCP), Wi-Fi убран из конфигурации, cloud-init больше не пишет её заново, в
  `/boot/firmware/config.txt` добавлено `dtoverlay=disable-wifi` (радио выключится
  совсем после перезагрузки). Резервная копия: `/root/netplan-backup-*`. SSH не
  прерывался; скрипт отработал с «страховкой» (см. §3) и сам её снял.
- На остальных трёх я **ничего не менял**: у них `sudo` требует пароль, а я его не знаю.
  Всё, что ниже, нужно выполнить вам (один раз ввести пароль).

## 1. Вход по SSH без пароля

Вход по ключу **уже работает** на всех четырёх платах (пользователь `pi`). Проверка:

```bash
for h in 192.168.50.3 192.168.50.89 192.168.50.117 192.168.50.240; do
  ssh -o BatchMode=yes -o ConnectTimeout=5 pi@$h 'echo "$(hostname): ключ работает"'
done
```

`BatchMode=yes` запрещает спрашивать пароль: если строка выводится, значит вход идёт
именно по ключу. Новый ключ на плату добавляется так (с компьютера, один раз попросит пароль):
`ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@<адрес>`.

### 1.1. (по желанию) Запретить вход по паролю

Рекомендуется после проверки выше — на платах `ufw` и `fail2ban` выключены, а
порт 22 — единственная дверь:

```bash
scp infra/pi/harden-ssh.sh pi@192.168.50.89:/tmp/
ssh -t pi@192.168.50.89 'sudo bash /tmp/harden-ssh.sh'
```

Скрипт отказывается работать, если у пользователя нет ни одного ключа, проверяет
конфигурацию (`sshd -t`) до перезагрузки сервиса и при ошибке откатывает изменение.
**Держите одну сессию открытой и проверьте вторую**, прежде чем закрывать первую.
На `ubuntu-white` вход по паролю уже отключён.

## 2. `sudo` без пароля и доступ к Docker/датчикам без `sudo`

Для `red`, `blue`, `green` (на `white` уже есть). С компьютера, по одной плате:

```bash
for h in 192.168.50.89 192.168.50.117 192.168.50.240; do
  scp infra/pi/enable-passwordless-sudo.sh pi@$h:/tmp/
  ssh -t pi@$h 'sudo bash /tmp/enable-passwordless-sudo.sh'     # спросит пароль sudo — введите его
done
```

Скрипт **копируется на плату и запускается там** (а не подаётся через `ssh ... 'sudo bash -s' < файл`): при подаче
скрипта через stdin у `ssh` нет терминала, и `sudo` отвечает «a terminal is required to read the password». `-t` даёт
терминал, `sudo` один раз спросит пароль. Что делает скрипт:

1. Пишет `/etc/sudoers.d/90-pi-nopasswd` со строкой `pi ALL=(ALL) NOPASSWD:ALL`,
   **сначала проверяет её `visudo -cf`**, ставит с правами `0440` и проверяет всю
   конфигурацию — опечатка не сломает `sudo`.
2. Добавляет `pi` в группы `docker` (команды `docker ...` без `sudo`) и `video`
   (`vcgencmd`: температура, троттлинг, версия загрузчика).

Группы применятся после нового входа по SSH. Проверка:

```bash
ssh pi@192.168.50.89 'sudo -n true && echo "sudo без пароля: ок"; docker ps >/dev/null && echo "docker без sudo: ок"; vcgencmd measure_temp'
```

(`docker` без `sudo` на red/blue/green у вас уже работает — `pi` в группе `docker`.)

> Безопасность: `NOPASSWD:ALL` означает, что любой, кто зашёл как `pi`, получает root.
> Это приемлемо только вместе с входом по ключам (§1.1) и закрытой от интернета сетью
> (§4). Для автоматической настройки (Ansible) этого достаточно; позже можно завести
> отдельного пользователя `deploy`.

## 3. Только Ethernet

### 3.1. Сначала — физика (без этого скрипт откажется работать)

**Важно про blue/green:** «нет link» там было **ошибкой диагностики** — в их netplan вообще не было `eth0` (`networkctl`: `unmanaged`, интерфейс административно выключен), поэтому ядро не могло показать link. Скрипт теперь сам добавляет `eth0` на DHCP и проверяет link до отключения Wi-Fi. Раньше этот пункт читался так: «Сейчас они связаны только по Wi-Fi. Проверьте:
кабель вставлен в плату и в порт коммутатора, порт светится, кабель целый. На фото видны
синие патч-корды — убедитесь, что для каждой платы кабель доходит до своего порта.

**`white` и `red`: link есть, но 10 Мбит/с** (должно быть 1000). Ethernet-партнёр
(коммутатор) сам объявляет только 10BASE-T — то есть скорость ограничена на стороне
коммутатора или кабеля, а не платы (плата объявляет всё до 1000BASE-T). Что проверить, по
порядку:

1. **Переключатель режима на коммутаторе.** У PoE-коммутаторов этого класса часто есть
   режим дальней связи («Extend»/«CCTV»), который ограничивает PoE-порты **10 Мбит/с**.
   Посмотрите корпус Mercusys MS105GP: переключатель/кнопка режима должна стоять в
   стандартном положении. (Это гипотеза — точное название переключателя и положения
   смотрите в паспорте.)
2. **Кабель.** Для 1 Гбит/с нужны все 4 пары. Короткие патч-корды Cat5e/Cat6 с
   нормальными разъёмами; заменить кабель на заведомо исправный.
3. **Порт и коммутатор.** Переткнуть плату в другой порт или на второй коммутатор.

Проверка после правки: `ssh pi@<адрес> 'cat /sys/class/net/eth0/speed'` должно дать `1000`.

### 3.2. Отключить Wi-Fi (скрипт со «страховкой»)

Порядок для каждой платы: **1)** кабель подключён и link есть (§3.1) → **2)** на роутере
сделана DHCP-резервация (§4) → **3)** запуск:

```bash
scp infra/pi/ethernet-only.sh pi@192.168.50.240:/tmp/
ssh -t pi@192.168.50.240 'sudo systemd-run --unit=pi-ethernet-only --collect /bin/bash /tmp/ethernet-only.sh'
# результат (сеанс SSH может оборваться — это нормально, зайдите по НОВОМУ адресу eth0):
ssh pi@<новый-адрес> 'sudo journalctl -u pi-ethernet-only --no-pager | tail'
```

Что делает скрипт:

- **не начнёт**, если у `eth0` нет link или нет IPv4-адреса (нельзя отрезать плату, которая
  доступна только по Wi-Fi);
- копирует `/etc/netplan` в `/root/netplan-backup-<время>`, убирает из конфигурации `wifis`,
  ставит `eth0` на DHCP, отключает генерацию сети cloud-init, выключает радио
  (`nmcli radio wifi off` и `dtoverlay=disable-wifi`);
- **страховка:** запускает таймер, который через 3 минуты вернёт старую конфигурацию, если
  новая не докажет работоспособность (шлюз и интернет доступны через `eth0`); если всё хорошо,
  сам снимает таймер;
- работает в отдельной службе `systemd`, поэтому доживает до конца, даже если ваш сеанс SSH
  оборвётся вместе с Wi-Fi-адресом.

Скрипт проверен на `ubuntu-white` (отработал, SSH не прерывался).

> `red`: сейчас там работает стек `redis` (3000/8081/6379) и Swarm. Скрипт сеть не ломает, но
> адрес платы после отключения Wi-Fi может поменяться — стек доступен по новому адресу.

## 4. Роутер ASUS RT-AX58U (WAN IP 89.207.218.46)

Проверено извне: **egress всех Pi — `89.207.218.46`** (то есть это ваш настоящий белый адрес,
не CGNAT), провайдер — Lovitel (`89-207-218-46.lealta.ru`).

### 4.1. ⚠ Срочно: закрыть AiCloud на WAN

Снаружи на `https://89.207.218.46/` (порт 443) отвечает **не ваша плата, а сам роутер**: ASUS
**AiCloud** (WebDAV, сертификат `RT-AX58U-FD70`). Это доступный из интернета вход в роутер
(AiCloud уже не раз был источником уязвимостей), и он **занимает порт 443**, который понадобится
под резервный сайт. Отключить:

- **AiCloud 2.0 → выключить** (Администрирование → AiCloud 2.0), а также общий доступ к USB-накопителям
  из интернета, если он есть;
- **Администрирование → Система → «Разрешить веб-доступ из WAN» → Нет**; «Включить SSH» → **Нет** (или «Только LAN»);
- **WAN → Виртуальный сервер/Переадресация портов:** посмотреть таблицу и удалить всё лишнее;
- **LAN → UPnP:** выключить (устройства не должны сами открывать порты);
- обновить прошивку роутера до последней.

Проверка: `curl -sk -m 8 -o /dev/null -w '%{http_code}\n' https://89.207.218.46/` должен давать `000`
(нет ответа), пока вы сами ничего не пробросили.

> Замечание о моей проверке: с моего компьютера на этот момент весь трафик шёл через сторонний
> VPN (внешний адрес `95.81.127.173`), поэтому простая проверка «порт открыт» (`nc -z`) давала
> ложные «open» на любых портах — считаю достоверным только ответ `curl` от роутера на 443.

### 4.2. DHCP-резервации (чтобы адрес платы не менялся)

Именно смена адресов (`192.168.50.80` в Swarm исчез) сломала старый кластер. LAN → DHCP-сервер →
**«Включить ручное назначение» → Да** → добавить:

| Плата | MAC (`eth0`) | Рекомендуемый адрес |
|---|---|---|
| `ubuntu-white` | `2c:cf:67:ce:a4:e6` | 192.168.50.11 |
| `ubuntu-red` | `d8:3a:dd:bf:99:18` | 192.168.50.12 |
| `ubuntu-blue` | `2c:cf:67:b6:ce:77` | 192.168.50.13 |
| `ubuntu-green` | `2c:cf:67:9f:b8:23` | 192.168.50.14 |

Нужны **MAC именно `eth0`** (не Wi-Fi: `wlan0` отличается последним байтом). Чистый блок
`.11–.14` проще запомнить, но можно оставить и текущие адреса — главное, чтобы они были закреплены.
После применения перезагрузите плату или `sudo netplan apply`, затем проверьте
`ssh pi@<адрес> hostname` и сообщите мне новые адреса.

### 4.3. Что понадобится позже (не делать сейчас)

- Переадресация **TCP 80/443** на виртуальный адрес резервного сайта (после этапа 5) и **UDP 51820** (WireGuard).
- Резерв канала: LTE-роутер (WAN failover) — в списке покупок плана.
- DDNS у ASUS (`asuscomm.com`) — как запасной вариант, если адрес провайдера когда-нибудь сменится
  (сейчас он выглядит постоянным — **уточните у провайдера, статический ли он**).

## 5. Ubuntu 24.04 LTS или текущая ОС

**Удалённо поставить 24.04 нельзя:** ОС запущена с самого NVMe, который нужно перезаписать, а
это возможно только с другого носителя (NVMe в USB-корпусе, microSD) — то есть руками у платы.
Понижать 25.04 → 24.04 на месте тоже нельзя.

Поэтому по вашему правилу **остаёмся на текущей ОС**: `white` — Ubuntu 25.10, `red/blue/green` —
25.04. Они **без обновлений безопасности** (EOL: 25.04 — 15.01.2026, 25.10 — 09.07.2026),
поэтому это временное решение: плату нужно будет перезаписать на 24.04 LTS в окне работ (когда
решено, что делать со стеками `redis`, `pi`, `home` на них — см. план).

До переустановки: платы только во внутренней сети (§4.1), SSH по ключам (§1.1), не публиковать
через роутер ничего с них.

## Docker and Swarm

State since 2026-10-12. The old stacks are **stopped, not deleted** — their volumes and images are intact and
restart policies are `no`, so nothing comes back after a reboot. Specs of the old `redis` stack are in
`~/backups/swarm-<ts>/` on red (mode 700). The previous Swarm membership of each board was moved to
`/var/lib/docker/swarm.old-<ts>`.

| Node | Address | Role | Docker |
|---|---|---|---|
| white | 192.168.50.11 | manager (leader) | 29.7.2 (Ubuntu 25.10 repo) |
| red | 192.168.50.12 | manager | 29.2.1 |
| blue | 192.168.50.13 | manager | 29.2.1 |
| green | 192.168.50.14 | worker | 29.2.1 |

Three managers tolerate losing one. Plucky (25.04) only offers 29.2.1; the 29.x engines interoperate. All nodes
carry the labels `pi=true` and `role=manager|worker`.

**Clock before Docker (after a power cut).** A Pi has no battery clock; after a cold start dockerd can run with a months-old date, reject the Swarm
certificates as "not yet valid" and stay out of the cluster (`docker info` → `Swarm: error`) until restarted — found in the failover rehearsal.
`docker-prep.sh`'s `After=time-sync.target` alone does not help (the target is reached at once). `clock-before-docker.sh` enables the real wait unit
(`chrony-wait` / `systemd-time-wait-sync`, 120 s timeout) and installs `pipe-swarm-heal.timer` (restarts Docker if Swarm is in `error` and the clock is
synchronised). Run on every board: `scp infra/pi/{clock-before-docker.sh,swarm-heal.sh} pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/clock-before-docker.sh'`.
Tests: `bash infra/pi/test-clock.sh`.

Preparing a board — `docker-prep.sh` is idempotent (moves the old Swarm state aside, upgrades Docker, log rotation
in `daemon.json`, loads `vxlan`/`br_netfilter`/`overlay` on boot, enables the memory cgroup — Ubuntu on the Pi has
none by default, so memory limits would be ignored; reboot once if it says so):

```bash
scp infra/pi/docker-prep.sh pi@HOST:/tmp/ && ssh -t pi@HOST 'sudo bash /tmp/docker-prep.sh'
```

Creating the Swarm (tokens are read on the manager and never printed):

```bash
docker swarm init --advertise-addr 192.168.50.11 --data-path-addr 192.168.50.11            # on white
docker swarm join --token "$(ssh pi@192.168.50.11 docker swarm join-token -q manager)" \
  --advertise-addr 192.168.50.12 --data-path-addr 192.168.50.12 192.168.50.11:2377          # red, blue (their own address)
# green: same with `join-token -q worker`
```

Smoke test passed: a global service with an overlay network ran 4/4 and every task answered across nodes.
