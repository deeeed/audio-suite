export type WebOrtTensor = {
  data: unknown;
  dims: number[];
  getData?: () => Promise<unknown>;
};

export type WebOrtSession = {
  inputNames?: string[];
  outputNames?: string[];
  run(
    feeds: Record<string, WebOrtTensor>
  ): Promise<Record<string, WebOrtTensor>>;
};

export type WebOrtRuntime = {
  env: {
    wasm: {
      wasmPaths: string;
    };
  };
  InferenceSession: {
    create(
      path: string,
      options?: {
        executionProviders?: string[];
        externalData?: Array<
          | string
          | {
              data: ArrayBuffer | Uint8Array;
              path: string;
            }
        >;
      }
    ): Promise<WebOrtSession>;
  };
  Tensor: new (
    type: string,
    data: Float32Array | Uint8Array | BigInt64Array,
    dims: number[]
  ) => WebOrtTensor;
};
