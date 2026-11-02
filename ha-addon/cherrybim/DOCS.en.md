[Русский](DOCS.md) | **English**

# Cherry BiM for Home Assistant

A panel with a 3D plan of your home, item inventory and MCP tools for the voice assistant. The server is `cherrybim.server` from this repository.

## Installation

1. Copy the `ha-addon/cherrybim` folder to `/addons` on HA (the `addons` Samba share).
2. Go to Settings → Add-ons → Add-on Store → ⋮ → Check for updates («Настройки → Аддоны → Магазин → ⋮ → Проверить обновления») and install "Cherry BiM" from the local add-ons.
3. Put the twin packages (`*.twin.json`) into `/share/cherrybim/packages`. For an example, see `examples/demo`.
4. Start it and enable Show in sidebar («Показывать на боковой панели»).

## Options

| Option | Default | What |
|---|---|---|
| `packages` | `/share/cherrybim/packages` | twin packages, read-only; new files are picked up without a restart |
| `data` | `/share/cherrybim` | items: `items.twin.json`, crossed-out ones in `trash.jsonl`; document copies in `docs/` (copies from packages go there too) |
| `ai_task` | empty | an `ai_task.*` entity that supports attachments: enables the Photo → items («Фото → вещи») button |
| `show_script` | empty | an HA script that puts an image from media on a screen (fields `put`, `zagolovok`, `podpis`): the To TV («На телевизор») button and the MCP tool `show` |
| `audience` | `household` | what to show: `public`, `residents`, `household`, `owner` |

## Voice assistant

The Model Context Protocol integration with the address `http://local-cherrybim:8099/mcp` gives the agent the tools `find`, `contents`, `add_item`, `move_item`, `remove_item`, `show`, `documents`. Add it as the agent's LLM API in the conversation agent settings.

## Security

The server accepts requests only from HA Core (`172.30.32.1`) and the Supervisor (`172.30.32.2`, ingress). Only `light`, `switch` and `fan` entities bound to the plan (`bind["ha.entity"]`) can be toggled from the panel.
