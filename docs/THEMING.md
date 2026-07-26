# Theming and white-label use

The visual system is token-driven. Command Administration → Theme edits the same values exposed by `GET /api/config` and stored by `PUT /api/admin/settings`.

| Token | Purpose |
|---|---|
| `background` | Vanta-black page foundation |
| `surface` | Panels, glass layers, and elevated regions |
| `accent` | Deep brand color |
| `accentStrong` | Active controls, focus, and highlights |
| `text` | Primary foreground |
| `muted` | Secondary labels and metadata |
| `radius` | Shared component corner radius |
| `fontScale` | Global navigation and interface scale |

The frontend maps these values to CSS custom properties in `platform.css`. New components should use the `--brand-*` tokens instead of fixed brand colors.

The public name, support email, shop visibility, membership visibility, and registration availability are also managed through the same settings record. This makes one codebase suitable for licensed or client-specific branded deployments without forking the component structure.

For a packaged theme:

1. Set the desired tokens in Command Administration.
2. Export the settings record through the API or record the seven token values.
3. Replace `icon.svg` and the web-manifest name for the licensed brand.
4. Keep payment and service credentials in the deployment environment, never in theme files.
