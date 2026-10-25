# Cherry BiM для Home Assistant

Панель с 3D-планом жилья, учёт вещей и MCP-инструменты для голосового ассистента. Сервер — `cherrybim.server` из этого репозитория.

## Установка

1. Скопируйте папку `ha-addon/cherrybim` в `/addons` на HA (шара Samba `addons`).
2. «Настройки → Аддоны → Магазин → ⋮ → Проверить обновления», установите «Cherry BiM» из локальных.
3. Положите пакеты двойника (`*.twin.json`) в `/share/cherrybim/packages`. Пример — `examples/demo`.
4. Запустите и включите «Показывать на боковой панели».

## Опции

| Опция | По умолчанию | Что |
|---|---|---|
| `packages` | `/share/cherrybim/packages` | пакеты двойника, только чтение; новые файлы подхватываются без перезапуска |
| `data` | `/share/cherrybim` | вещи: `items.twin.json`, вычеркнутые — `trash.jsonl`; копии документов — `docs/` (туда же кладутся копии из пакетов) |
| `ai_task` | пусто | сущность `ai_task.*` с поддержкой вложений: включает кнопку «Фото → вещи» |
| `show_script` | пусто | скрипт HA, который выводит картинку из медиа на экран (поля `put`, `zagolovok`, `podpis`): кнопка «На телевизор» и MCP-инструмент `show` |
| `audience` | `household` | что показывать: `public`, `residents`, `household`, `owner` |

## Голосовой ассистент

Интеграция «Model Context Protocol» с адресом `http://local-cherrybim:8099/mcp` даёт агенту инструменты `find`, `contents`, `add_item`, `move_item`, `remove_item`, `show`, `documents`. Добавьте её LLM API агенту в настройках разговора.

## Безопасность

Сервер принимает запросы только от ядра HA (`172.30.32.1`) и Supervisor (`172.30.32.2`, ingress). Из панели переключаются только `light`, `switch` и `fan`, привязанные к плану (`bind["ha.entity"]`).
