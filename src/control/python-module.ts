import { DEFAULT_ARM_PHYSICS, ARM_CONTROL_PERIOD_US } from "../physics/one-axis-arm";
import type { MicroPythonInstance } from "../vendor/micropython";
import { SharedArmChannel, snapshotArmProfile, type ArmRuntimeProfile } from "./channel";

/** Only primitive arguments and bounded JSON results cross this private allowlist. */
export class ArmPythonBridge {
  readonly #channel: SharedArmChannel;
  readonly #profile: ArmRuntimeProfile;
  #active = false;
  #used = false;
  #opened = false;
  #torque = 0;
  constructor(profile: ArmRuntimeProfile) {
    this.#profile = snapshotArmProfile(profile);
    this.#channel = SharedArmChannel.attach(profile.buffer, profile.identity.generation);
  }
  begin(): void {
    if (this.#used) throw new Error("A fresh arm runtime is required for each execution");
    this.#channel.assertLive(); this.#used = true; this.#active = true;
  }
  end(): void { this.#active = false; this.#torque = 0; }
  private check(token: unknown): void {
    if (!this.#active || !this.#opened || token !== 1) throw new Error("Obsolete arm experiment handle");
    this.#channel.assertLive();
  }
  install(runtime: MicroPythonInstance): void {
    const invoke = (operation: unknown, token: unknown, value: unknown): string => {
      try {
        let result: unknown = null;
        if (operation === "open") {
          if (!this.#active || this.#opened) throw new Error("Only one Experiment is allowed per run");
          this.#opened = true; result = 1;
        } else {
          this.check(token);
          switch (operation) {
            case "parameters": {
              const c = this.#profile.conditions, p = DEFAULT_ARM_PHYSICS;
              result = { target_rad: c.targetAngleRad, kp: c.kpNmPerRad, kd: c.kdNmSPerRad,
                gravity_compensation: c.gravityCompensation, gravity_coefficient_nm: p.gravityMPerS2 * (p.armMassKg * p.lengthM / 2 + c.payloadMassKg * p.lengthM),
                payload_mass_kg: c.payloadMassKg, initial_angle_rad: c.initialAngleRad, duration_ms: c.durationMs, control_period_s: ARM_CONTROL_PERIOD_US / 1000000,
                inertia_kg_m2: p.armMassKg * p.lengthM ** 2 / 3 + c.payloadMassKg * p.lengthM ** 2 };
              break;
            }
            case "read": { const row = this.#channel.readRows(this.#channel.tick); result = [row[0], row[1]]; break; }
            case "torque":
              if (typeof value !== "string" || value.length > 400) throw new Error("Torque must be finite");
              const torque: unknown = JSON.parse(value);
              if (typeof torque !== "number" || !Number.isFinite(torque)) throw new Error("Torque must be finite");
              this.#torque = torque; break;
            case "step": this.#channel.step(this.#torque, this.#profile.conditions.durationMs / 10); break;
            case "tick": result = this.#channel.tick; break;
            case "steps": result = this.#profile.conditions.durationMs / 10; break;
            default: throw new Error("Unknown control operation");
          }
        }
        return JSON.stringify({ ok: true, value: result });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Arm control failed" });
      }
    };
    // The upstream JsProxy attribute lookup traverses prototypes. Supply no route
    // from this callback/module to Function or Object constructors. Its own call
    // adapter preserves the pinned bridge's bound-method invocation convention.
    const call = (_receiver: unknown, ...args: unknown[]) => Reflect.apply(invoke, undefined, args);
    Object.setPrototypeOf(call, null); Object.freeze(call);
    Object.setPrototypeOf(invoke, null);
    Object.defineProperty(invoke, "call", { value: call }); Object.freeze(invoke);
    runtime.registerJsModule("_web_lab_control", Object.freeze(Object.assign(Object.create(null), { invoke })));
    runtime.runPython(CONTROL_PYTHON_SOURCE);
  }
}
export const CONTROL_PYTHON_SOURCE = `
import sys as _sys
import json as _json
import _web_lab_control as _bridge
def _call(operation, token=0, value=0):
    response = _json.loads(_bridge.invoke(operation, token, value))
    if not response["ok"]:
        raise RuntimeError(response["error"])
    return response["value"]
class _Joint:
    def __init__(self, token):
        self._token = token
    def read(self):
        return tuple(_call("read", self._token))
    def set_torque(self, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError("torque must be a finite number")
        _call("torque", self._token, _json.dumps(value))
class Experiment:
    def __init__(self):
        self._token = _call("open")
    def parameters(self):
        return _call("parameters", self._token)
    def joint(self, name):
        if name != "arm":
            raise ValueError("unknown joint")
        _call("tick", self._token)
        return _Joint(self._token)
    def step(self):
        _call("step", self._token)
    @property
    def steps(self):
        return _call("steps", self._token)
    @property
    def time_s(self):
        return _call("tick", self._token) / 100
_control = type("_ControlModule", (), {})()
_control.Experiment = Experiment
_package = type("_WebLabModule", (), {})()
_package.control = _control
_sys.modules["weblab"] = _package
_sys.modules["weblab.control"] = _control
`;
export const ARM_CONTROL_SOURCE = `from math import cos
from weblab.control import Experiment

experiment = Experiment()
arm = experiment.joint("arm")
parameters = experiment.parameters()
for _ in range(experiment.steps):
    angle, speed = arm.read()
    torque = parameters["kp"] * (parameters["target_rad"] - angle) - parameters["kd"] * speed
    if parameters["gravity_compensation"]:
        torque += parameters["gravity_coefficient_nm"] * cos(angle)
    arm.set_torque(torque)
    experiment.step()
`;
