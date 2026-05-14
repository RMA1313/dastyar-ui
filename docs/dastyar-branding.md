# Dastyar Branding Strategy

## 1. Goal

- Product name: `دستیار`
- Language: Persian / Farsi
- Direction: RTL
- Font: Vazirmatn
- Keep Open WebUI upstream compatibility.

## 2. Upstream-friendly strategy

- Keep changes small and isolated.
- Prefer global shell/config/style changes over component-level edits.
- Avoid broad refactors.
- Avoid backend and API changes.
- Avoid package and lockfile changes unless absolutely required.
- Use separate commits for each concern.

## 3. Allowed change areas

Preferred files and directories:

- `src/lib/i18n/**`
- `src/routes/+layout.svelte`
- `src/app.css`
- `src/app.html`
- `src/routes/auth/+page.svelte` only if needed for visible auth branding/localization
- `static/manifest.json`
- `static/static/site.webmanifest`
- `static/opensearch.xml`
- `static/favicon*`
- `static/static/logo*`
- `docs/**`

## 4. Avoided change areas

Do not modify unless absolutely necessary:

- `backend/**`
- `src/lib/apis/**`
- `src/lib/utils/**`
- `src/lib/components/**` except tiny RTL fixes if required
- `package.json`
- `package-lock.json`
- lockfiles
- generated files

## 5. Planned commit sequence

Use this exact sequence:

- `docs: document Dastyar branding strategy`
- `i18n: improve Persian localization`
- `rtl: apply global Persian direction`
- `font: use Vazirmatn for Persian UI`
- `branding: update visible app identity to Dastyar`
- `theme: add Dastyar brand colors`
- `auth: verify Persian RTL auth experience`
- `docs: add testing and maintenance notes`

## 6. Implementation principles

- Use existing Persian locale files if present.
- Do not create duplicate locale structures unnecessarily.
- Keep `fa` as the preferred Persian locale if supported.
- Preserve compatibility with existing Persian variants such as `fa-IR` if they exist.
- Set RTL at document level only when Persian is active.
- Keep code blocks and monospace content LTR.
- Keep auth behavior unchanged.
- Replace only visible branding, not internal package names or backend identifiers.

## 7. Testing checklist

Manual checks required for:

- desktop
- tablet
- mobile
- auth page
- chat page
- settings
- admin panel
- sidebar/navigation
- modals/dropdowns
- notifications/toasts
- forms and validation errors
- markdown and code blocks
- dark/light themes
- upstream rebase test

## 8. Maintenance workflow

Use these commands for future updates:

```bash
git fetch upstream
git rebase upstream/main
```

If the upstream default branch is `master`, rebase against that instead:

```bash
git rebase upstream/master
```

Then run:

```bash
npm run build
```

Finish with a manual UI smoke test.
