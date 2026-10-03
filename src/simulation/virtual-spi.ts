import type { SpiConfiguration, SpiTargetPort } from "../device-api/types";

export interface VirtualSpiTarget {
  readonly id: string;
  readonly port: SpiTargetPort;
  readonly fallback?: boolean;
  isSelected?(): boolean;
}

export class VirtualSpiBus implements SpiTargetPort {
  readonly kind = "spi-target" as const;
  readonly id: number;
  readonly #targets: VirtualSpiTarget[] = [];

  constructor(id: number) {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new RangeError("SPI bus id must be a non-negative integer.");
    }
    this.id = id;
  }

  attach(target: VirtualSpiTarget): void {
    if (target.id.length === 0 || this.#targets.some((candidate) => candidate.id === target.id)) {
      throw new Error(`Duplicate or empty SPI target id: ${target.id}`);
    }
    if (target.fallback === true && this.#targets.some((candidate) => candidate.fallback === true)) {
      throw new Error(`SPI${this.id} already has a fallback target.`);
    }
    if (target.fallback !== true && target.isSelected === undefined) {
      throw new Error(`SPI target ${target.id} requires a select state.`);
    }
    this.#targets.push(target);
  }

  configure(configuration: SpiConfiguration): void {
    for (const target of this.#targets) {
      target.port.configure(configuration);
    }
  }

  transfer(writeData: Uint8Array): Uint8Array {
    const selected = this.#targets.filter(
      (target) => target.fallback !== true && target.isSelected?.() === true,
    );
    if (selected.length > 1) {
      throw new Error(
        `SPI${this.id} has multiple selected targets: ${selected.map((target) => target.id).join(", ")}.`,
      );
    }
    const target = selected[0] ?? this.#targets.find((candidate) => candidate.fallback === true);
    return target?.port.transfer(writeData) ?? new Uint8Array(writeData.length);
  }
}
