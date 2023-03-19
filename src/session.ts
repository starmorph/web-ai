import localforage from "localforage";
import * as ort from "onnxruntime-web";
import * as pako from "pako";
import * as Comlink from "comlink";

export const clearCache = async () => {
  await localforage.clear();
};

export interface SessionParameters {
  numThreads: number;
  executionProviders: string[];
  memoryLimitMB: number;
  cacheSizeMB: number;
  wasmRoot: string;
  tokenizersPath: string;
}

export const SessionParams: SessionParameters = {
  numThreads: 0,
  executionProviders: ["wasm"],
  memoryLimitMB: 0,
  cacheSizeMB: 500,
  wasmRoot: "https://edge-ai-models.s3.us-east-2.amazonaws.com/onnx-13/",
  tokenizersPath: "https://edge-ai-models.s3.us-east-2.amazonaws.com/tokenizers.wasm",
};

export class Session {
  ortSession: ort.InferenceSession | undefined;
  cacheSize: number;

  constructor() {
    const cacheSize = SessionParams.cacheSizeMB * 1e6;
    localforage.config({
      name: "Web-AI",
      version: 1.0,
      driver: localforage.INDEXEDDB,
      size: cacheSize,
      storeName: "model_storage",
    });
    this.cacheSize = cacheSize;
  }

  init = async (modelPath: string) => {
    ort.env.wasm.numThreads = SessionParams.numThreads;
    ort.env.wasm.wasmPaths = SessionParams.wasmRoot;
    let modelData: ArrayBuffer = new ArrayBuffer(0);
    try {
      const cachedData = await localforage.getItem(modelPath);
      if (cachedData !== null) {
        modelData = cachedData as ArrayBuffer;
      } else {
        modelData = await this.fetchData(modelPath);
      }
    } catch (err) {
      console.error("unable to load the data from cache");
      console.error(err);
      modelData = await this.fetchData(modelPath);
    }
    const session = await ort.InferenceSession.create(modelData, {
      executionProviders: SessionParams.executionProviders,
      graphOptimizationLevel: "all",
      executionMode: "parallel",
    });
    this.ortSession = session;
  };

  fetchData = async (modelPath: string): Promise<ArrayBuffer> => {
    const extension = modelPath.split(".").pop();
    let modelData = await fetch(modelPath).then((resp) => resp.arrayBuffer());
    if (extension === "gz") {
      modelData = pako.inflate(modelData);
    }
    if (modelData.byteLength > this.cacheSize) {
      console.warn("the model is too large to be cached");
    } else {
      await this.validateCache(modelData);
      localforage.setItem(modelPath, modelData);
    }
    return modelData;
  };

  validateCache = async (modelData: ArrayBuffer) => {
    try {
      const cacheKeys = await localforage.keys();
      let cacheSize = 0;
      const cacheItemSizes = new Map<string, number>();
      for (const key of cacheKeys) {
        const data = (await localforage.getItem(key)) as ArrayBuffer;
        cacheSize += data.byteLength;
        cacheItemSizes.set(key, data.byteLength);
      }
      let newCacheSize = cacheSize + modelData.byteLength;
      while (newCacheSize > this.cacheSize) {
        const [key, size] = cacheItemSizes.entries().next().value;
        cacheItemSizes.delete(key);
        newCacheSize -= size;
        await localforage.removeItem(key);
      }
    } catch (err) {
      console.error("unable to validate the cache");
      console.error(err);
    }
  };

  run = async (input: ort.InferenceSession.OnnxValueMapType): Promise<ort.InferenceSession.OnnxValueMapType> => {
    if (!this.ortSession) {
      throw Error("the session is not initialized. Call `init()` method first.");
    }
    return await this.ortSession.run(input);
  };

  inputNames = (): readonly string[] => {
    if (!this.ortSession) {
      throw Error("the session is not initialized. Call `init()` method first.");
    }
    return this.ortSession.inputNames;
  };

  outputNames = (): readonly string[] => {
    if (!this.ortSession) {
      throw Error("the session is not initialized. Call `init()` method first.");
    }
    return this.ortSession.outputNames;
  };
}

if (typeof self !== "undefined") {
  Comlink.expose(Session);
}
