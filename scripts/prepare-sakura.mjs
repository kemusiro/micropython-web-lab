import { access, writeFile } from "node:fs/promises";
import { createHtaccess } from "./lib/sakura-deployment.mjs";

await access(new URL("../dist/index.html", import.meta.url));
await writeFile(new URL("../dist/.htaccess", import.meta.url), createHtaccess());
console.log("Sakura distribution prepared: dist/.htaccess");
