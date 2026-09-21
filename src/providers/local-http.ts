import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

/** Local providers never follow redirects or send credentials. */
export class LocalInferenceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LocalInferenceError";
  }
}

export function localBaseUrl(value: string | undefined, defaultUrl: string): URL {
  let url: URL;
  try { url = new URL(value ?? defaultUrl); }
  catch { throw new LocalInferenceError("LOCAL_URL_INVALID", "Specify an HTTP URL on localhost, 127.0.0.1 or [::1]."); }
  const local = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (!local || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new LocalInferenceError("LOCAL_URL_INVALID", "Local inference requires a loopback HTTP(S) URL without credentials, query or fragment. Remote endpoints are not accepted.");
  }
  // Pin localhost to a loopback address instead of relying on configurable DNS.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function localSignal(timeoutMs: number, upstream?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "timeoutMs must be an integer from 1 to 3600000.");
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new LocalInferenceError("LOCAL_CANCELLED", "Local inference was cancelled; no response was saved."));
  if (upstream?.aborted) abort();
  else upstream?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new LocalInferenceError("LOCAL_TIMEOUT", `Local inference exceeded ${timeoutMs} ms; reduce context/output or increase the timeout.`)), timeoutMs);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); upstream?.removeEventListener("abort", abort); } };
}

type JsonRequest = { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; maxBytes?: number };

export async function localJson<T = Record<string, unknown>>(base: URL, endpoint: string, options: JsonRequest = {}): Promise<T> {
  const checkedBase = localBaseUrl(base.href, base.href);
  const url = new URL(endpoint, checkedBase);
  if (url.origin !== checkedBase.origin || url.username || url.password || url.hash) {
    throw new LocalInferenceError("LOCAL_URL_INVALID", "Local API paths must remain on the configured loopback server.");
  }
  const budget = options.maxBytes ?? 4 * 1024 * 1024;
  const ownDeadline = options.signal ? undefined : localSignal(10_000);
  const signal = options.signal ?? ownDeadline!.signal;
  try {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    // Built-in HTTP connects directly and ignores HTTP_PROXY / NODE_USE_ENV_PROXY.
    // Global fetch dispatchers can route even loopback requests through an external proxy.
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: options.method ?? (body === undefined ? "GET" : "POST"),
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }) },
        signal, agent: false,
      }, resolve);
      request.on("error", reject);
      request.end(body);
    });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      response.destroy();
      throw new LocalInferenceError("LOCAL_REDIRECT_REJECTED", "The local inference server returned a redirect. Configure the final loopback endpoint directly.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response) {
      const bytes = chunk as Buffer;
      size += bytes.byteLength;
      if (size > budget) {
        response.destroy();
        throw new LocalInferenceError("LOCAL_RESPONSE_TOO_LARGE", `The local server response exceeded ${budget} bytes.`);
      }
      chunks.push(bytes);
    }
    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new LocalInferenceError("LOCAL_RESPONSE_INVALID", `The local server returned invalid JSON (HTTP ${status}). Check the endpoint and server logs.`); }
    if (status < 200 || status >= 300) {
      // Server errors can echo prompt text; report the status without persisting that text.
      const action = status === 404 ? "Check that the model is installed and the API endpoint is correct."
        : status === 401 || status === 403 ? "Check the local server's authentication and access configuration; this adapter does not send credentials."
        : status === 400 || status === 422 ? "Check the model's context size and reasoning support."
        : "Check the local server logs, memory and model availability.";
      throw new LocalInferenceError("LOCAL_HTTP_ERROR", `Local server returned HTTP ${status}. ${action}`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new LocalInferenceError("LOCAL_RESPONSE_INVALID", "Expected a JSON object from the local server.");
    }
    if ("error" in payload) throw new LocalInferenceError("LOCAL_SERVER_ERROR", "The local server reported an inference error. Check its logs; no response was saved.");
    return payload as T;
  } catch (error) {
    if (signal.aborted) throw signal.reason instanceof LocalInferenceError ? signal.reason : new LocalInferenceError("LOCAL_CANCELLED", "Local inference was cancelled.");
    if (error instanceof LocalInferenceError) throw error;
    throw new LocalInferenceError("LOCAL_CONNECTION_FAILED", `Cannot reach the local inference API at ${checkedBase.origin}. Start the runtime and verify its loopback address.`);
  } finally { ownDeadline?.dispose(); }
}
