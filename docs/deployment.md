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
- Tailnet endpoint: `https://wallet-intel.tail8ae57d.ts.net`
- Admin UI: disabled with `--no-admin`

The systemd unit uses:

```text
WorkingDirectory=/var/lib/nuthatch
EnvironmentFile=/etc/default/nuthatch
ExecStart=/usr/local/bin/nuthatch dev --dir ${NUTHATCH_DIR} --listen ${NUTHATCH_LISTEN} $NUTHATCH_EXTRA_ARGS
```

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
