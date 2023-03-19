import * as ort from "onnxruntime-web";
import * as Comlink from "comlink";
import { Remote, wrap } from "comlink";
import { Session } from "./session";

ort.env.wasm.proxy = true;
ort.env.wasm.wasmPaths = "https://edge-ai-models.s3.us-east-2.amazonaws.com/onnx-13/";

export const createSession = async (modelPath: string, proxy: boolean): Promise<Session | Comlink.Remote<Session>> => {
  if (proxy && typeof document !== "undefined") {
    const worker = new Worker(new URL("./session.js", import.meta.url), { type: "module" });
    const Channel = wrap<typeof Session>(worker);
    const session: Remote<Session> = await new Channel();
    await session.init(modelPath);
    return session;
  } else {
    const session = new Session();
    await session.init(modelPath);
    return session;
  }
};
