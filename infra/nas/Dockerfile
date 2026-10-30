# The NAS side of the backup chain: a container that PULLS the latest verified backup from a Pi (infra/backup/pull.sh, unchanged) once a
# day. armv7-capable base on purpose (WD My Cloud EX2 Ultra). No sshd inside: nothing connects TO the NAS, so a compromised board cannot
# reach the copy; the NAS holds a key that is restricted on the Pi to read-only rrsync.
# Alpine 3.16, deliberately old: the NAS's runtime (kernel 4.14 armv7, Docker 20.10) segfaults on newer userlands - Debian bookworm fails to load
# glibc ("ELF load command address/offset not page-aligned"), alpine 3.18 and newer exit 139 on the first command (the same thing that keeps
# the stock registry/postgres images crash-looping there). 3.16 and older run. The container only makes outbound rsync-over-ssh calls to a Pi
# on the LAN, takes no inbound connections and holds no secrets but its own restricted key, so an old userland is an acceptable trade.
# coreutils/bash/util-linux because pull.sh uses GNU date -d, sha256sum, flock.
FROM alpine:3.16

RUN apk add --no-cache rsync openssh-client ca-certificates tzdata util-linux coreutils bash smartmontools jq curl

COPY pull.sh /usr/local/bin/pull.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY healthcheck.sh /usr/local/bin/healthcheck.sh
COPY report.sh /usr/local/bin/report.sh
RUN chmod 0755 /usr/local/bin/pull.sh /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh /usr/local/bin/report.sh

# Unhealthy (in Portainer / `docker ps`) when no backup has been pulled for over 26 hours.
HEALTHCHECK --interval=30m --timeout=20s --start-period=26h CMD ["/usr/local/bin/healthcheck.sh"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["run"]
