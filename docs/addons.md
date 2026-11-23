# Add-ons: install and write one

An add-on adds a tab to the site (for example the game server panel, or a small tool such as a mod configuration generator). It is optional and **off by default**. This page is for the administrator who installs add-ons and for authors who write them. The exact rules, tables and routes are in [RULES.md](RULES.md#optional-server-add-on).

## Trust model

An add-on's JavaScript runs in the site's page, on the same origin, with the rights of the signed-in user. Only install add-ons you trust. The `capabilities` and `description` an add-on declares are shown to the administrator before activation, but they are informative: nothing enforces them.

## Two kinds

| Kind | What it is | When to use it |
| --- | --- | --- |
| **Static folder** | A folder with `addon.json`, a script and a stylesheet, mounted read-only. No container. | A tool that only needs the browser (a form, a generator, a calculator). |
| **Container** | A small service (any language) that serves its own files and API. | An add-on that needs a server side (game server control, files, secrets). |

## Install (administrator)

1. Declare it in the `.env` of the site (see the deployment guide, section "Optional server add-ons"):
   - container: `ADDONS=key=http://host:port` (key: 1 to 20 characters of `a-z`, `0-9`, `-`; origin only, no path, no spaces after commas). `ADDON_URL=<origin>` still works and means `main=<origin>`;
   - static folder: put `<key>/addon.json` and its files in the folder set by `ADDONS_PATH` (default `./addons`).
2. Redeploy the site (web and api containers read these settings).
3. Sign in as the administrator, open **Administration**: each entry has its own tab. Read the description and capabilities, **enable** it, then grant each account `read` or `action`. An entry stays hidden for everyone until it is enabled, and the administrator is implicitly `action`.

An add-on is reached at `/addon/<key>/` and every file of a static folder needs a signed-in session.

## Manifest (contract version 2)

Every add-on describes itself with a static, public JSON document: `addon.json` in a static folder, `GET /addon/api/manifest` for a container. The schema is `contract/manifest.schema.json`. Example:

```json
{
  "api_version": 2,
  "entries": [
    {
      "id": "hello",
      "version": "0.1.0",
      "name": { "fr": "Bonjour", "en": "Hello" },
      "description": { "fr": "Exemple minimal.", "en": "Minimal example." },
      "element": "addon-hello",
      "capabilities": ["tab"],
      "script": "/addon/main.js",
      "styles": "/addon/styles.css"
    }
  ]
}
```

- At most 20 entries. `id`: `a-z`, `0-9`, `-`, 1 to 20 characters, **unique across all add-ons of the site**. `element`: `addon-` followed by 1 to 30 of `a-z`, `0-9`, `-`, also unique across add-ons.
- `name` and `description` need `fr` and `en` (name up to 40 characters, description up to 200). `version`: up to 20 characters.
- `capabilities`: `tab` (a screen in the top bar) and `map-layer` (declared and shown to the administrator, but not mounted yet, see "Not available yet").
- `script` and `styles` are written **relative to the add-on** (`/addon/main.js`, no `..`, no `//`, no scheme). The site rewrites them to `/addon/<key>/main.js`: an add-on never needs to know its key.
- A manifest the site cannot accept is ignored as a whole; the other add-ons keep working. The site re-reads manifests every 30 seconds.

## The element

The script is loaded once as a module (`<script type="module">`, same origin, so the site's content security policy applies: no inline script, no inline style) and must define the custom element named in the manifest. The site mounts it in a wrapper `<div data-addon>` when its tab is first opened and keeps it mounted (hidden) afterwards, so an unsaved draft survives a change of screen. It sets three attributes:

| Attribute | Value |
| --- | --- |
| `lang` | The site's language (`fr`, `en`, `de`). |
| `active` | `"true"` while its tab is shown, `"false"` otherwise. |
| `base` | Its public prefix, `/addon/<key>/`. Use it for any request to the add-on itself. |

Attributes can arrive **after** the element is connected: read them in `attributeChangedCallback`, not only in `connectedCallback`. A complete example is `frontend/e2e/fixtures/addons/hello` (one form, one JSON download, no build step).

**Style.** Scope every CSS rule under `[data-addon]` and use the site's tokens (`--gold`, `--panel`, `--bad`...) and shared classes (`.tiles`, `.tile`, `.meta`, `.hint`, `.actions`, `button.danger`). No hexadecimal colours, no inline styles, no `text-transform: uppercase`. The reference rules are in the add-on repository (`docs/style-contract.md`).

## An add-on with a backend

The container serves its own files and API under `/addon/...` (for example `/addon/main.js`, `/addon/api/status`). The site's web server strips the `/addon/<key>` prefix before forwarding, so the container never sees its key; the browser reaches it at `base + 'api/...'`. An encoded slash (`%2F`) in a path is decoded by that step: do not rely on it in a path parameter.

**Who is calling.** The add-on does not manage accounts or access lists. For each request it forwards the browser's `Cookie` header, without following redirects, to the site:

```
GET {SITE_URL}/api/v1/addons/<entry id>/me
```

| Answer | Meaning |
| --- | --- |
| `200 {"user_key", "username", "is_admin", "level"}` | The caller may use this entry. `level` is `read` or `action`. `user_key` is `<id>:<created_at>`, stable for one account. |
| `401` | Not signed in. |
| `403` | Unknown entry, disabled entry, or no access: always the same answer. |
| anything else, timeout, invalid body | Treat as unavailable and **refuse** (fail closed). |

Use `level` as the only authority: `read` for reading, `action` for anything that changes something. Protect your own write routes against cross-site requests too; the reference add-on requires a custom header (`X-Addon: 1`) and a matching `Origin` on every write.

The reference implementation with a backend is the game server add-on ([`enshrouded-map-addon`](https://github.com/lokidata/enshrouded-map-addon)).

## Not available yet

- **Map layers.** `map-layer` is accepted in a manifest but nothing mounts it. A page API to draw markers on the map (for example players reported by a game server mod) is the next phase.
- **Helper packages.** A JavaScript package, a Python helper, a template repository and an `addon-lint` check are planned. Until then, copy the example and the reference add-on.

See [TODO.md](TODO.md) for the open items.
