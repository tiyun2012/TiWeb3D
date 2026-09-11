import type { EngineContext } from "@/engine/core/EngineContext";
import { SELECTION_CHANGED } from "./selection.events";
import type { SelectionCommandAPI } from "./selection.types";

export function registerSelectionCommands(ctx: EngineContext) {
  const api: SelectionCommandAPI = {
    setSelected(ids: string[]) {
      ctx.engine.setSelected(ids);
      ctx.events.emit(SELECTION_CHANGED, { ids });
    },
    clear() {
      ctx.engine.setSelected([]);
      ctx.events.emit(SELECTION_CHANGED, { ids: [] });
    },
  };

  ctx.commands.selection = api;
}
