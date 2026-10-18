import { ArmRuntimeSession } from "../../src/control/session";
import { DEFAULT_ARM_CONTROL } from "../../src/physics/arm-control";
import { ARM_CONTROL_SOURCE } from "../../src/control/python-module";

let generation = 0;
const f = { session: null as ArmRuntimeSession | null, runtimeWorkers: [] as Worker[], simulationWorkers: [] as Worker[],
  frames: [] as unknown[], output: "", result: null as unknown, job: null as Promise<unknown> | null,
  async run(source = ARM_CONTROL_SOURCE, changes = {}, project?: any) {
    f.session?.stop(); f.frames = []; f.output = ""; f.result = null;
    const session = new ArmRuntimeSession({ setId: "fixture-arm", generation: ++generation, conditions: { ...DEFAULT_ARM_CONTROL, ...changes }, project,
      onOutput: (_type, text) => { f.output += text; }, onFrame: frame => f.frames.push(frame),
      runtimeFactory: () => { const worker = new Worker(new URL("../../src/runtime/micropython.worker.ts", import.meta.url), { type: "module" }); f.runtimeWorkers.push(worker); return worker; },
      simulationFactory: () => { const worker = new Worker(new URL("../../src/control/simulation.worker.ts", import.meta.url), { type: "module" }); f.simulationWorkers.push(worker); return worker; } });
    f.session = session;
    await session.start();
    const result = await session.execute(source);
    if (f.session === session) f.result = result;
    return result;
  },
  begin(source?: string, changes?: object, project?: any) { f.job = f.run(source, changes, project); void f.job.catch(error => { f.result = { startupError: String(error) }; }); },
};
(window as any).armFixture = f;
