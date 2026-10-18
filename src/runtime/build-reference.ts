import artifacts from "../../runtime/micropython/artifacts.sha256?raw";
import versions from "../../runtime/micropython/versions.env?raw";
const version = /^MICROPYTHON_VERSION=(.+)$/m.exec(versions)?.[1];
const buildHash = /^([a-f0-9]{64}) +src\/vendor\/micropython-build\/micropython.wasm$/m.exec(artifacts)?.[1];
if (!version || !buildHash) throw new Error("Missing pinned runtime metadata");
export const MANAGED_EXPERIMENT_RUNTIME = Object.freeze({ id: "web-lab-restricted", version, buildHash });
