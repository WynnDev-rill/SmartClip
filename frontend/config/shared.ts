import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

export const sharedResolve = {
  alias: {
    "@": path.resolve(frontendRoot, "src"),
  },
};
