import type { EngineModule } from "@/engine/core/EngineModule";
import type { EngineContext } from "@/engine/core/EngineContext";
import { registerSelectionCommands } from "./selection.commands";

export const SelectionModule: EngineModule = {
  id: "selection",
  init(ctx: EngineContext) {
    registerSelectionCommands(ctx);
  },
};
