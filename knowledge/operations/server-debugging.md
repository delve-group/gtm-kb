---
type: Operations Runbook
title: Server Debugging and Incident Capture
description: Operational checklist for diagnosing Coolify, CPU, IO, Docker, and gateway timeout incidents.
resource: /operations/server-debugging.md
tags: [operations, debugging, coolify, incident]
status: current
owner: project
source_paths:
  - ../server_debug.md
last_reviewed: 2026-07-14
timestamp: 2026-07-14
---

Most likely causes, in order
----------------------------

1. Scheduled backup / cron / cleanup.
Your graph looks periodic. Coolify supports scheduled tasks/backups using cron expressions, including hourly schedules, and database backups can involve pg_dump, mysqldump, mongodump, compression, disk writes, and S3 upload — exactly CPU + disk + network.
Source: https://coolify.io/docs/databases/backups

2. One app gets hit by traffic and saturates CPU.
Example: Next.js SSR, PHP workers, Python app, image processing, PDF generation, AI job, scraper traffic, bots, brute force attempts.

3. Database overload.
A bad query, missing index, vacuum/maintenance, backup, or too many concurrent connections can make the web app wait until Traefik returns 504.

4. Docker build/deploy/pull.
Coolify deployments can use CPU, disk, and network heavily. If these spikes correlate with deployments, that is probably it.

5. Docker networking / Coolify proxy isolation.
Coolify’s own docs list custom Docker network isolation as a common cause of random 504s after hours/days, especially if direct IP/port works but the domain fails. If you use custom networks: in Compose, check this carefully.
Source: https://coolify.io/docs/troubleshoot/applications/gateway-timeout

For the Superseller API, every production Compose service must use the external
`coolify` network because PostgreSQL is a separate Coolify resource on that
network. Do not also attach services to an explicit Compose `default` network.
Coolify adds its own deployment network, and an extra `_default` network gives
the routed nginx container an address that `coolify-proxy` cannot reach. Pin
Traefik to the shared network with `traefik.docker.network: coolify` on nginx.

6. Hetzner shared vCPU contention.
Possible, but I would not assume it first. Hetzner shared-resource plans distribute compute across instances and allow bursting; dedicated CCX plans provide exclusive CPU resources and more predictable high CPU performance.
Source: https://docs.hetzner.com/cloud/servers/faq/

Check %steal: steal time means CPU time needed by your VM but not provided by the host because the host allocated it elsewhere.
Source: https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/7/html/virtualization_deployment_and_administration_guide/sect-kvm_guest_timing_management-steal_time_accounting


Run these immediately during the next incident
----------------------------------------------

SSH into the server and run:

date
uptime
free -h
swapon --show
df -h
df -ih
docker stats --no-stream --all
ps -eo pid,ppid,comm,%cpu,%mem,rss,stat,etime,args --sort=-%cpu | head -40

Then:

# CPU, load, IO pressure
vmstat 1 10

# Per-process CPU/memory/IO if sysstat is installed
pidstat -durh -p ALL 1 10

# Disk device saturation
iostat -xz 1 10

# Kernel/OOM/storage problems
dmesg -T | egrep -i 'oom|killed|blocked|hung|reset|error|nvme|ext4' | tail -100

# Docker events around now
docker events --since 30m --until 0s

pidstat, iostat, mpstat, and sar are part of sysstat, which is designed for CPU, per-process, memory, disk, and historical system activity monitoring.
Source: https://github.com/sysstat/sysstat

Install it:

sudo apt update
sudo apt install -y sysstat iotop jq

For Debian/Ubuntu, enable historical collection:

sudo sed -i 's/^ENABLED=.*/ENABLED="true"/' /etc/default/sysstat 2>/dev/null || true
sudo systemctl enable --now sysstat 2>/dev/null || true
sudo systemctl enable --now sysstat-collect.timer sysstat-summary.timer 2>/dev/null || true


Add a spike-capture script
--------------------------

This logs a detailed snapshot only when CPU crosses a threshold. It is exactly what you need.

Create the script:

sudo tee /usr/local/sbin/spike-capture.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -u
umask 077

LOG_DIR="${LOG_DIR:-/var/log/spike-capture}"
INTERVAL="${INTERVAL:-3}"
CORES="$(nproc)"
CPU_THRESHOLD="${CPU_THRESHOLD:-$((CORES * 75))}" # 75% aggregate CPU by default
LOAD_THRESHOLD="${LOAD_THRESHOLD:-200}" # load1 as % of CPU count
COOLDOWN="${COOLDOWN:-60}"

install -d -m 0700 "$LOG_DIR"

LAST_CAPTURE=0

read_cpu() {
  awk '/^cpu / {
    idle=$5+$6
    total=0
    for (i=2; i<=NF; i++) total+=$i
    print total, idle
  }' /proc/stat
}

capture_snapshot() {
  local usage="$1"
  local load1="$2"
  local file="$LOG_DIR/spike-$(date +%F_%H-%M-%S).log"

  {
    echo "===== SPIKE CAPTURE ====="
    echo "date: $(date -Is)"
    echo "hostname: $(hostname)"
    echo "cores: $CORES"
    echo "cpu_total_percent: $usage"
    echo "load1: $load1"
    echo

    echo "===== uptime ====="
    uptime
    echo

    echo "===== memory ====="
    free -h
    echo
    swapon --show || true
    echo

    echo "===== disk space ====="
    df -h
    echo
    df -ih
    echo

    echo "===== top CPU processes ====="
    ps -eo pid,ppid,uid,comm,%cpu,%mem,rss,stat,etime,args --sort=-%cpu | head -60
    echo

    echo "===== top CPU threads ====="
    ps -eLo pid,tid,psr,pcpu,pmem,stat,comm,args --sort=-pcpu | head -80
    echo

    echo "===== top output ====="
    timeout 8 top -b -n1 -w512 | head -120 || true
    echo

    echo "===== vmstat ====="
    timeout 15 vmstat 1 10 || true
    echo

    if command -v mpstat >/dev/null 2>&1; then
      echo "===== mpstat per CPU, including steal ====="
      timeout 10 mpstat -P ALL 1 5 || true
      echo
    fi

    if command -v pidstat >/dev/null 2>&1; then
      echo "===== pidstat CPU/mem/IO ====="
      timeout 15 pidstat -durh -p ALL 1 5 || true
      echo
    fi

    if command -v iostat >/dev/null 2>&1; then
      echo "===== iostat disk saturation ====="
      timeout 10 iostat -xz 1 5 || true
      echo
    fi

    echo "===== network sockets summary ====="
    ss -s || true
    echo

    echo "===== top remote IPs on 80/443, rough ====="
    ss -Htn state established '( sport = :80 or sport = :443 )' 2>/dev/null \
      | awk '{print $5}' \
      | sed -E 's/^\[?([^]]+)\]?.*/\1/' \
      | sort | uniq -c | sort -nr | head -30 || true
    echo

    if command -v docker >/dev/null 2>&1; then
      echo "===== docker ps ====="
      docker ps --no-trunc --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Networks}}\t{{.Ports}}' || true
      echo

      echo "===== docker stats ====="
      docker stats --no-stream --all --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' || true
      echo

      echo "===== docker top for containers using >20% CPU ====="
      docker stats --no-stream --all --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null \
        | awk '{gsub(/%/,"",$2); if (($2+0)>20) print $1}' \
        | head -15 \
        | while read -r c; do
            echo "--- container: $c ---"
            docker top "$c" -eo pid,ppid,comm,pcpu,pmem,args 2>/dev/null | head -40 || true
            echo
          done
      echo

      echo "===== coolify/proxy/traefik logs, last 10 minutes ====="
      docker ps --format '{{.Names}}' \
        | grep -Ei 'coolify|proxy|traefik' \
        | while read -r c; do
            echo "--- logs: $c ---"
            docker logs --since 10m --tail 300 "$c" 2>&1 || true
            echo
          done
      echo
    fi

    echo "===== recent kernel logs ====="
    journalctl -k --since '10 min ago' --no-pager || true
    echo

    echo "===== recent docker service logs ====="
    journalctl -u docker --since '10 min ago' --no-pager || true
    echo

    echo "===== recent cron logs if available ====="
    journalctl -u cron --since '30 min ago' --no-pager 2>/dev/null || true
    grep CRON /var/log/syslog 2>/dev/null | tail -100 || true
    echo

  } > "$file" 2>&1

  gzip -f "$file" &
}

while true; do
  read -r total1 idle1 < <(read_cpu)
  sleep "$INTERVAL"
  read -r total2 idle2 < <(read_cpu)

  dt=$((total2 - total1))
  di=$((idle2 - idle1))

  if [ "$dt" -gt 0 ]; then
    usage="$(awk -v dt="$dt" -v di="$di" -v cores="$CORES" 'BEGIN { printf "%.0f", ((dt-di)/dt)*100*cores }')"
  else
    usage="0"
  fi

  load1="$(awk '{print $1}' /proc/loadavg)"
  load_pct="$(awk -v l="$load1" -v cores="$CORES" 'BEGIN { printf "%.0f", (l/cores)*100 }')"

  sample_file="$LOG_DIR/samples-$(date +%F).log"
  echo "$(date -Is),cpu_total_percent=$usage,load1=$load1,load_pct=$load_pct" >> "$sample_file"

  now="$(date +%s)"
  if { [ "$usage" -ge "$CPU_THRESHOLD" ] || [ "$load_pct" -ge "$LOAD_THRESHOLD" ]; } \
     && [ $((now - LAST_CAPTURE)) -ge "$COOLDOWN" ]; then
    LAST_CAPTURE="$now"
    capture_snapshot "$usage" "$load1"
  fi

  find "$LOG_DIR" -type f -mtime +14 -delete 2>/dev/null || true
done
EOF

sudo chmod +x /usr/local/sbin/spike-capture.sh

Create the systemd service:

sudo tee /etc/systemd/system/spike-capture.service >/dev/null <<'EOF'
[Unit]
Description=Capture process/container diagnostics during CPU spikes
After=docker.service
Wants=docker.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/spike-capture.sh
Restart=always
RestartSec=5
Nice=10
IOSchedulingClass=idle
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now spike-capture.service

Check logs after the next spike:

ls -lah /var/log/spike-capture/
zless /var/log/spike-capture/spike-*.log.gz
tail -200 "/var/log/spike-capture/samples-$(date +%F).log"

The snapshots can contain command arguments, account identifiers, remote IP
addresses, and application logs. Keep the directory root-only, redact secrets
and personal data before sharing a capture, and delete exported copies after
the incident. Daily sample files make the 14-day cleanup effective instead of
allowing one continuously modified `samples.log` file to grow forever.

# Citations

[1] [Coolify database backups](https://coolify.io/docs/databases/backups)
[2] [Coolify gateway timeout troubleshooting](https://coolify.io/docs/troubleshoot/applications/gateway-timeout)
[3] [Hetzner Cloud server FAQ](https://docs.hetzner.com/cloud/servers/faq/)
[4] [Red Hat steal time accounting](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/7/html/virtualization_deployment_and_administration_guide/sect-kvm_guest_timing_management-steal_time_accounting)
[5] [sysstat performance tools](https://github.com/sysstat/sysstat)

# Provenance

Migrated from workspace path `../server_debug.md`. The legacy file was removed
on 2026-07-14 after its content was verified against this runbook. The migrated
capture script was tightened to keep diagnostic data private and bound sample
retention.
