# verba.nuvo.page

The landing page. Plain HTML and CSS — no build step, no framework, no tracker. The
design tokens in [`styles.css`](./styles.css) are lifted verbatim from the app's
`src/theme.css`, so the site and the product stay the same object in two places: change
a colour there, change it here.

```
website/
  index.html      the page
  styles.css      tokens + layout
  assets/         logo, screenshots, OG card
  _headers        cache + security headers (Cloudflare Pages)
  _redirects      /download → GitHub releases
  robots.txt
  sitemap.xml
```

## Run it locally

```bash
python3 -m http.server 8791 --directory website
# → http://localhost:8791
```

## Deploy — Cloudflare Pages

Connect the GitHub repo once in the Cloudflare dashboard
(**Workers & Pages → Create → Pages → Connect to Git**) and give it:

| Setting | Value |
|---|---|
| Production branch | `master` |
| Framework preset | **None** |
| Build command | *(leave empty)* |
| Build output directory | `website` |
| Root directory | `/` |

There is nothing to compile, so Pages simply uploads the directory. Every push to
`master` that touches `website/` redeploys; every other branch gets a preview URL.

Then, under **Custom domains**, add `verba.nuvo.page`. The `nuvo.page` zone is already
on Cloudflare, so the CNAME is created for you — no DNS to edit by hand.

### Or from the CLI

```bash
npx wrangler pages deploy website --project-name=verba
```

## Keeping it honest

The download links and the version badge are hard-coded to a release tag. When you cut
a new one, update:

- the `v0.1.0` in the hero eyebrow and the download eyebrow,
- the six release URLs in the `#download` section.

The screenshots in `assets/` are copies of `docs/screenshots/`. Recapture there, copy
across, and the OG card (`assets/og.png`) only needs regenerating if the wording on it
changes.
