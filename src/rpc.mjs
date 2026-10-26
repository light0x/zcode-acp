// 逐行 JSON 消息通道：既用于 ACP 侧（标准 JSON-RPC 2.0 封装），
// 也用于 ZCode Protocol 侧（无 jsonrpc 字段的 {id,method,params} 封装）。
import { EventEmitter } from "node:events";
import readline from "node:readline";

export class LineRpc extends EventEmitter {
  // withJsonRpc: 出站请求是否携带 "jsonrpc":"2.0"（ACP 侧 true，ZCode 侧 false）
  constructor({ withJsonRpc }) {
    super();
    this.withJsonRpc = withJsonRpc;
    this.nextId = 1;
    this.pending = new Map();
    this.attached = false;
  }

  attach(input, output) {
    if (this.attached) throw new Error("LineRpc already attached");
    this.attached = true;
    this.input = input;
    this.output = output;
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        this.emit("parse-error", text);
        return;
      }
      this._route(msg);
    });
    rl.on("close", () => this.emit("closed"));
  }

  _route(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const waiter = this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(msg.error);
        else waiter.resolve(msg.result);
      } else {
        this.emit("stray-response", msg);
      }
      return;
    }
    if (msg.method === undefined) {
      this.emit("malformed", msg);
      return;
    }
    if (msg.id !== undefined) this.emit("request", msg);
    else this.emit("notification", msg);
  }

  write(obj) {
    if (!this.output || this.output.destroyed) return false;
    return this.output.write(JSON.stringify(obj) + "\n");
  }

  request(method, params) {
    const id = this.withJsonRpc === false ? this.nextId++ : `c-${this.nextId++}`;
    const envelope = { id, method, params: params ?? {} };
    if (this.withJsonRpc) envelope.jsonrpc = "2.0";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(envelope);
    });
  }

  notify(method, params) {
    const envelope = { method, params: params ?? {} };
    if (this.withJsonRpc) envelope.jsonrpc = "2.0";
    this.write(envelope);
  }

  respond(id, result) {
    const envelope = { id, result: result ?? {} };
    if (this.withJsonRpc) envelope.jsonrpc = "2.0";
    this.write(envelope);
  }

  respondError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    const envelope = { id, error };
    if (this.withJsonRpc) envelope.jsonrpc = "2.0";
    this.write(envelope);
  }
}

export function jsonRpcError(code, message, data) {
  return { code, message, ...(data !== undefined ? { data } : {}) };
}

export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  REQUEST_CANCELLED: -32800,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
};
