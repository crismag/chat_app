# Verification scripts

Browser-driven checks against a running dev server. **They belong here**, inside
this repository, and so does everything they need.

That is not a style preference. These scripts were briefly written into an
unrelated repository because that is where `selenium-webdriver` happened to be
installed — which put one project's files inside another project's working tree
and made this repo's verification depend on a checkout it has no relationship
with. A repository owns its own tooling; if it needs a package, the package is
installed here.

## Running

The dev server must be up (`npm run dev` from the repo root — web on 5173, API
on 8000):

```bash
node scripts/verify/<name>.mjs
```

Screenshots and other output go to `scripts/verify/out/`, which is ignored.
