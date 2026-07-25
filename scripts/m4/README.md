# M4 contract probe

`contract-probe.mjs` captures the installed Nuthatch CLI and read-only HTTP
surface into `tests/integration/__evidence__/m4` (or `--out-dir`). For P0,
clone an existing non-production nest into a disposable temporary directory
and compare two independent runs:

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
The harness writes normalized JSON evidence files to `--out-dir`. It does not
print the complete capture to stdout.

`http-probe.mjs` probes an already-running instance and prints one JSON document
to stdout:

```sh
NUTHATCH_BASE_URL=http://127.0.0.1:8288 node scripts/m4/http-probe.mjs
```

It exits non-zero unless the freshness view answers both `/sql` and `/explain`
and the `max_rows` ceiling is rejected explicitly. Redirect stdout to a file
only after the command exits successfully. There is no offline mode; a
filesystem-only sandbox cannot produce HTTP acceptance evidence.
