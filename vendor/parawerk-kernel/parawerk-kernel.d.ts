// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare var RuntimeExports: {
    /** @type {any} */
    wasmMemory: any;
};
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
interface EmbindModule {
  release(_0: number): void;
  shapeCount(): number;
  version(): string;
  makeBox(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: EmbindString): any;
  makeCylinder(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: EmbindString): any;
  booleanOperation(_0: number, _1: number, _2: number): any;
  extrudeProfile(_0: any, _1: any, _2: number, _3: number, _4: any, _5: EmbindString): any;
  revolveProfile(_0: any, _1: any, _2: any, _3: number, _4: number, _5: any, _6: EmbindString): any;
  cutHoles(_0: number, _1: any, _2: any, _3: any, _4: EmbindString): any;
  combineCopies(_0: number, _1: number, _2: any, _3: number, _4: EmbindString): any;
  shell(_0: number, _1: any, _2: number, _3: boolean, _4: EmbindString): any;
  trimByPlane(_0: number, _1: any, _2: EmbindString): any;
  fillet(_0: number, _1: any, _2: number, _3: any, _4: EmbindString): any;
  chamfer(_0: number, _1: any, _2: number, _3: any, _4: EmbindString): any;
  chamferUneven(_0: number, _1: any, _2: number, _3: number, _4: boolean, _5: boolean, _6: any, _7: EmbindString): any;
  naming(_0: number): any;
  faceGeometry(_0: number, _1: number): any;
  edgeGeometry(_0: number, _1: number): any;
  distance(_0: number, _1: number, _2: number, _3: number, _4: number): any;
  counts(_0: number): any;
  boundingBox(_0: number): any;
  massProperties(_0: number): any;
  mesh(_0: number, _1: number, _2: number): any;
  exportMesh(_0: number, _1: number, _2: number): any;
  exportStep(_0: number): any;
  importStep(_0: any): any;
  importStepText(_0: EmbindString, _1: EmbindString): any;
  draftSides(_0: number, _1: any, _2: number, _3: EmbindString): any;
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
