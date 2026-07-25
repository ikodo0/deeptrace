# M4 contract probe

`contract-probe.mjs` captures the installed Nuthatch CLI and read-only HTTP
surface. For P0, clone an existing non-production nest into a disposable
temporary directory and compare two independent runs:

```sh
node scripts/m4/contract-probe.mjs \
  --binary /home/arch/.local/bin/nuthatch \
  --nest-source /path/to/a/local/nest \
  --repeat 2
```

The source nest is never started or modified. Each run uses `nuthatch init
--from` to create a temporary copy, starts that copy on a free loopback port,
probes it, stops it, and removes it. The comparison ignores capture timestamps,
request duration, `/metrics`, and changing index-watermark fields.

For the later read-only smoke test, replace `--nest-source` with `--base-url`.
The harness does not write evidence files; callers retain its complete JSON
stdout as the raw capture and derive Task 2 evidence from that.

In a filesystem-only sandbox that forbids loopback listeners, add `--offline`.
That still proves the CLI capture and disposable `init --from` cycle are
repeatable, but deliberately leaves the `http` array empty; it is not a
substitute for Task 2's HTTP capture on the dev box.
