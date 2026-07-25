# Nuthatch Deployment

The Nuthatch nest is versioned with DeepTrace in the
[`ikodo0/deeptrace`](https://github.com/ikodo0/deeptrace) repository under
`nest/`.

## Target

- Proxmox node: `pve`
- Container: CT 104 (`wallet-intel`)
- Installed Nuthatch version: `0.6.1`
- Deployment directory: `/var/lib/nuthatch`
- Service user and group: `nuthatch:nuthatch`
- Service unit: `nuthatch.service`
- Local listener: `127.0.0.1:8288`
- Tailnet endpoint: `https://<TAILNET_HOST>`
- Admin UI: disabled with `--no-admin`

The systemd unit uses:

```text
WorkingDirectory=/var/lib/nuthatch
EnvironmentFile=/etc/default/nuthatch
ExecStart=/usr/local/bin/nuthatch dev --dir ${NUTHATCH_DIR} --listen ${NUTHATCH_LISTEN} $NUTHATCH_EXTRA_ARGS
```

`nest/nuthatch.toml` reads three ordered RPC URLs from
`BASE_RPC_URL_PRIMARY`, `BASE_RPC_URL_SECONDARY`, and
`BASE_RPC_URL_TERTIARY`. Define all three in `/etc/default/nuthatch`, using
independent providers. Keyed URLs are allowed in that root-owned environment
file but must never be committed, printed by a probe, or copied into evidence.
The staging `nuthatch check` process must load the same environment file.

## Deploy

Autodeploy ships only the contents of `nest/`; the Nuthatch binary is managed
separately on CT 104. The deployment must:

1. Stage the new nest without replacing the active directory.
2. Run `nuthatch check` against the staged nest.
3. Stop if validation fails, leaving the active nest and service unchanged.
4. Sync the validated nest to `/var/lib/nuthatch` with ownership
   `nuthatch:nuthatch`.
5. Restart `nuthatch.service`.
6. Require `/ready` to return HTTP 200 before declaring success.

Nuthatch remains bound to loopback. Tailscale Serve publishes port 8288 only
inside the tailnet; do not enable Funnel or a LAN listener.

## Backfill watchdog

`npm run watch:nuthatch` performs one loopback-only `/ready` sample and stores
the last observed high-water block. It alerts when the indexed block regresses,
`ready` is false, or a lagging indexer has made no progress for 600 seconds.
The reported `stalled` field is diagnostic only and never controls the alarm.
Output is one credential-free JSON line. Exit code `0` is healthy/observing,
`2` is a confirmed alert, and `1` is a watchdog or endpoint error.

Install the report-only timer on CT 104 after `/opt/deeptrace` contains this
revision:

```sh
install -m 0644 /opt/deeptrace/deploy/systemd/nuthatch-watchdog.service \
  /etc/systemd/system/nuthatch-watchdog.service
install -m 0644 /opt/deeptrace/deploy/systemd/nuthatch-watchdog.timer \
  /etc/systemd/system/nuthatch-watchdog.timer
systemctl daemon-reload
systemctl enable --now nuthatch-watchdog.timer
```

Inspect alerts with:

```sh
systemctl status nuthatch-watchdog.service
journalctl -u nuthatch-watchdog.service -n 20
```

The repository has no alert destination or privileged recovery unit, so the
watchdog deliberately runs as `nuthatch` and cannot restart services. On a
confirmed `no_progress` alert, an operator must run
`systemctl restart nuthatch.service`, then verify that `last_block` advances
across at least two timer intervals. Wire the failed unit into the host's
existing alert target before enabling unattended recovery. Do not grant the
watchdog user `systemctl` privileges or expose port 8288 publicly.
