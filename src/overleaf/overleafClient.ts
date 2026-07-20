import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { createRequire } from 'module';
import { Readable } from 'stream';
import FormData from 'form-data';
import fetch, { Response } from 'node-fetch';
import * as mime from 'mime-types';
import { v4 as uuidv4 } from 'uuid';
import {
  CompileResponse,
  EntityType,
  Identity,
  JoinDocResult,
  OnlineUser,
  OtUpdate,
  OverleafDoc,
  OverleafFileRef,
  OverleafFolder,
  OverleafProject,
  ProjectSummary,
  NetworkTimeouts,
  SyncCodeResponse,
  SyncPdfResponse,
  UploadFileResult
} from './types';
import { normalizeServerUrl } from './util';

type HttpMethod = 'GET' | 'POST' | 'DELETE';
type SocketHandler = (...args: unknown[]) => void;

interface RequestOptions {
  body?: Record<string, unknown> | FormData;
  headers?: Record<string, string>;
  includeCsrfHeader?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUTS: NetworkTimeouts = {
  connectMs: 20_000,
  projectJoinMs: 30_000,
  httpMs: 60_000,
  joinDocMs: 30_000,
  otAckMs: 15_000
};

export class OverleafHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly responseBody?: string
  ) {
    super(message);
    this.name = 'OverleafHttpError';
  }
}

export class OverleafClient {
  private readonly agent: http.Agent | https.Agent;
  private identity?: Identity;
  public readonly timeoutMs: number;
  public readonly timeouts: NetworkTimeouts;

  constructor(
    private readonly serverUrl: string,
    identity?: Identity,
    timeoutSeconds?: number,
    timeouts: Partial<NetworkTimeouts> = {}
  ) {
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.identity = identity;
    const legacyMs = (timeoutSeconds ?? 60) * 1000;
    this.timeouts = {
      ...DEFAULT_TIMEOUTS,
      httpMs: legacyMs,
      ...timeouts
    };
    this.timeoutMs = this.timeouts.httpMs;
    this.agent = new URL(this.serverUrl).protocol === 'http:'
      ? new http.Agent({ keepAlive: true })
      : new https.Agent({ keepAlive: true });
  }

  setIdentity(identity: Identity): void {
    this.identity = identity;
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getIdentity(): Identity | undefined {
    return this.identity;
  }

  async loginWithCookie(cookies: string): Promise<Identity> {
    const res = await this.fetchWithTimeout(this.urlFor('project'), {
      method: 'GET',
      redirect: 'manual',
      agent: this.agent,
      headers: {
        Cookie: cookies,
        Connection: 'keep-alive'
      }
    });

    if (res.status >= 300 && res.status < 400) {
      throw new Error('Cookie login was redirected. The cookie is probably expired or incomplete.');
    }

    const html = await res.text();
    const csrfToken = extractCsrfToken(html);
    if (!csrfToken) {
      throw new Error('Could not find a CSRF token on the Overleaf project page.');
    }

    const identity: Identity = {
      csrfToken,
      cookies,
      userId: extractFirst(html, [
        /"user_id"\s*:\s*"([^"]+)"/,
        /"userId"\s*:\s*"([^"]+)"/,
        /"id"\s*:\s*"([^"]+)"/
      ]),
      userEmail: extractFirst(html, [
        /"email"\s*:\s*"([^"]+)"/,
        /"userEmail"\s*:\s*"([^"]+)"/
      ])
    };

    this.identity = await this.refreshSocketCookie(identity);
    return this.identity;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    try {
      const result = await this.requestJson<{ projects: unknown[] }>('POST', 'api/project', {
        body: {}
      });
      return normalizeProjects(result.projects);
    } catch {
      const result = await this.requestJson<{ projects: unknown[] }>('GET', 'user/projects');
      return normalizeProjects(result.projects);
    }
  }

  async addDoc(projectId: string, parentFolderId: string, filename: string): Promise<OverleafDoc> {
    const result = await this.requestJson<{ _id: string }>('POST', `project/${projectId}/doc`, {
      body: {
        parent_folder_id: parentFolderId,
        name: filename
      },
      includeCsrfHeader: true
    });
    return { _id: result._id, name: filename };
  }

  async addFolder(projectId: string, parentFolderId: string, folderName: string): Promise<OverleafFolder> {
    return this.requestJson<OverleafFolder>('POST', `project/${projectId}/folder`, {
      body: {
        parent_folder_id: parentFolderId,
        name: folderName
      },
      includeCsrfHeader: true
    });
  }

  async uploadFile(
    projectId: string,
    parentFolderId: string,
    filename: string,
    content: Uint8Array
  ): Promise<UploadFileResult> {
    const form = new FormData();
    form.append('targetFolderId', parentFolderId);
    form.append('name', filename);
    form.append('type', mime.lookup(filename) || 'application/octet-stream');
    form.append('qqfile', Readable.from(content), { filename });

    const result = await this.requestJson<{
      success?: boolean;
      entity_id?: string;
      entity_type?: string;
      hash?: string;
    }>('POST', `project/${projectId}/upload?folder_id=${encodeURIComponent(parentFolderId)}`, {
      body: form,
      includeCsrfHeader: true
    });

    if (!result.entity_id) {
      throw new Error('Overleaf upload did not return an entity id.');
    }

    return {
      _id: result.entity_id,
      name: filename,
      hash: result.hash,
      entityType: result.entity_type === 'doc' ? 'doc' : 'file'
    };
  }

  async downloadProjectFile(projectId: string, fileId: string, signal?: AbortSignal): Promise<Uint8Array> {
    return this.downloadRelative(`project/${projectId}/file/${fileId}`, true, signal);
  }

  async deleteEntity(projectId: string, entityType: EntityType, entityId: string): Promise<void> {
    await this.requestText('DELETE', `project/${projectId}/${entityType}/${entityId}`, {
      includeCsrfHeader: true
    });
  }

  async renameEntity(projectId: string, entityType: EntityType, entityId: string, name: string): Promise<void> {
    await this.requestText('POST', `project/${projectId}/${entityType}/${entityId}/rename`, {
      body: { name },
      includeCsrfHeader: true
    });
  }

  async moveEntity(projectId: string, entityType: EntityType, entityId: string, newParentFolderId: string): Promise<void> {
    await this.requestText('POST', `project/${projectId}/${entityType}/${entityId}/move`, {
      body: { folder_id: newParentFolderId },
      includeCsrfHeader: true
    });
  }

  async deleteAuxFiles(projectId: string): Promise<void> {
    await this.requestText('DELETE', `project/${projectId}/output`, {
      includeCsrfHeader: true
    });
  }

  async compile(
    projectId: string,
    rootResourcePath: string | null,
    draft = false,
    stopOnFirstError = false
  ): Promise<CompileResponse> {
    return this.requestJson<CompileResponse>('POST', `project/${projectId}/compile?auto_compile=true`, {
      body: {
        check: 'silent',
        draft,
        incrementalCompilesEnabled: true,
        rootResourcePath,
        stopOnFirstError
      },
      includeCsrfHeader: true
    });
  }

  async stopCompile(projectId: string): Promise<void> {
    await this.requestText('POST', `project/${projectId}/compile/stop`, {
      includeCsrfHeader: true
    });
  }

  async downloadCompileOutput(outputUrl: string, compile: CompileResponse): Promise<Uint8Array> {
    if (/^https?:\/\//i.test(outputUrl)) {
      return this.downloadAbsolute(outputUrl, false);
    }

    if (compile.pdfDownloadDomain && compile.clsiServerId) {
      const cleanOutput = outputUrl.replace(/^\/+/, '');
      const cdnUrl = `${compile.pdfDownloadDomain.replace(/\/+$/, '')}/${cleanOutput}`
        + `?compileGroup=${encodeURIComponent(compile.compileGroup)}`
        + `&clsiserverid=${encodeURIComponent(compile.clsiServerId)}`
        + '&enable_pdf_caching=true';
      return this.downloadAbsolute(cdnUrl, false);
    }

    return this.downloadRelative(outputUrl.replace(/^\/+/, ''), true);
  }

  async syncCode(projectId: string, file: string, line: number, column: number, buildId: string): Promise<SyncCodeResponse> {
    const route = `project/${projectId}/sync/code?file=${encodeURIComponent(file)}`
      + `&line=${line}&column=${column}&editorId=${uuidv4()}&buildId=${encodeURIComponent(buildId)}`;
    return this.requestJson<SyncCodeResponse>('GET', route);
  }

  async syncPdf(projectId: string, page: number, h: number, v: number, buildId: string): Promise<SyncPdfResponse | undefined> {
    const route = `project/${projectId}/sync/pdf?page=${page}&h=${h.toFixed(2)}&v=${v.toFixed(2)}`
      + `&editorId=${uuidv4()}&buildId=${encodeURIComponent(buildId)}`;
    const result = await this.requestJson<{ code?: SyncPdfResponse[] }>('GET', route);
    return result.code?.[0];
  }

  async connectSocket(projectId: string, signal?: AbortSignal): Promise<OverleafSocketSession> {
    this.requireIdentity();
    const query = `?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`;
    const first = new OverleafSocketSession(this.serverUrl, this.identity!, this.timeouts, query);
    try {
      await first.waitForConnect(signal);
      const project = await first.waitForJoinProjectResponse(signal);
      first.setProject(project);
      return first;
    } catch (firstError) {
      first.disconnect();
      const fallback = new OverleafSocketSession(this.serverUrl, this.identity!, this.timeouts, undefined);
      try {
        await fallback.waitForConnect(signal);
        const project = await fallback.joinProject(projectId, signal);
        fallback.setProject(project);
        return fallback;
      } catch (fallbackError) {
        fallback.disconnect();
        throw new Error(
          'Overleaf realtime connection failed. '
          + `Project-query attempt: ${errorMessage(firstError)}. `
          + `Fallback attempt: ${errorMessage(fallbackError)}.`
        );
      }
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: Record<string, unknown> = {},
    timeoutMs = this.timeouts.httpMs,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    const abort = (): void => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      abort();
    } else {
      externalSignal?.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error(`HTTP request timed out after ${timeoutMs / 1000} seconds.`)), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  private async refreshSocketCookie(identity: Identity): Promise<Identity> {
    const res = await this.fetchWithTimeout(this.urlFor('socket.io/socket.io.js'), {
      method: 'GET',
      redirect: 'manual',
      agent: this.agent,
      headers: {
        Cookie: identity.cookies,
        Connection: 'keep-alive'
      }
    });
    const setCookie = res.headers.raw()['set-cookie']?.[0]?.split(';')[0];
    if (setCookie && !identity.cookies.includes(setCookie)) {
      return {
        ...identity,
        cookies: `${identity.cookies}; ${setCookie}`
      };
    }
    return identity;
  }

  private async requestJson<T>(method: HttpMethod, route: string, options: RequestOptions = {}): Promise<T> {
    const text = await this.requestText(method, route, options);
    return text ? JSON.parse(text) as T : {} as T;
  }

  private async requestText(method: HttpMethod, route: string, options: RequestOptions = {}): Promise<string> {
    const identity = this.requireIdentity();
    const headers: Record<string, string> = {
      Cookie: identity.cookies,
      Connection: 'keep-alive',
      ...options.headers
    };

    let body: unknown;
    if (options.body instanceof FormData) {
      Object.assign(headers, options.body.getHeaders());
      body = options.body;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        _csrf: identity.csrfToken,
        ...options.body
      });
    }

    if (options.includeCsrfHeader) {
      headers['X-Csrf-Token'] = identity.csrfToken;
    }

    const res = await this.fetchWithTimeout(this.urlFor(route), {
      method,
      redirect: 'manual',
      agent: this.agent,
      headers,
      body: body as never
    }, this.timeouts.httpMs, options.signal);

    await assertOk(res, route);
    return res.status === 204 ? '' : res.text();
  }

  private async downloadRelative(route: string, includeCookies: boolean, signal?: AbortSignal): Promise<Uint8Array> {
    return this.downloadAbsolute(this.urlFor(route), includeCookies, signal);
  }

  private async downloadAbsolute(url: string, includeCookies: boolean, signal?: AbortSignal): Promise<Uint8Array> {
    const identity = includeCookies ? this.requireIdentity() : undefined;
    const chunks: Buffer[] = [];
    let currentUrl = url;
    let offset = 0;
    let expectedTotal: number | undefined;
    let redirects = 0;
    let ranges = 0;

    while (true) {
      const res = await this.fetchWithTimeout(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        agent: this.agent,
        headers: {
          Connection: 'keep-alive',
          ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}),
          ...(identity ? { Cookie: identity.cookies } : {})
        }
      }, this.timeouts.httpMs, signal);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || redirects >= 5) {
          throw new OverleafHttpError(`Overleaf download redirect failed for ${path.basename(currentUrl)}.`, res.status);
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirects += 1;
        continue;
      }

      if (res.status !== 200 && res.status !== 206) {
        await assertOk(res, currentUrl);
      }

      const chunk = await res.buffer();
      if (res.status === 200) {
        if (offset > 0) {
          throw new Error('Overleaf ignored a Range request after returning partial content.');
        }
        chunks.push(chunk);
        break;
      }

      if (ranges >= 128) {
        throw new Error('Overleaf download returned too many partial responses.');
      }
      const range = parseContentRange(res.headers.get('content-range'));
      if (range.start !== offset || range.end < range.start || chunk.length !== range.end - range.start + 1) {
        throw new Error(`Invalid Overleaf Content-Range response: ${res.headers.get('content-range') ?? 'missing'}.`);
      }
      if (expectedTotal !== undefined && range.total !== expectedTotal) {
        throw new Error('Overleaf changed the total download size between partial responses.');
      }
      expectedTotal = range.total;
      chunks.push(chunk);
      const nextOffset = range.end + 1;
      if (nextOffset <= offset) {
        throw new Error('Overleaf repeated a partial download range.');
      }
      offset = nextOffset;
      ranges += 1;
      if (offset === expectedTotal) {
        break;
      }
      if (offset > expectedTotal) {
        throw new Error('Overleaf partial download exceeded its declared size.');
      }
    }

    const result = Buffer.concat(chunks);
    if (expectedTotal !== undefined && result.length !== expectedTotal) {
      throw new Error(`Overleaf partial download was incomplete (${result.length}/${expectedTotal} bytes).`);
    }
    return new Uint8Array(result);
  }

  private requireIdentity(): Identity {
    if (!this.identity) {
      throw new Error('Not logged in to Overleaf.');
    }
    return this.identity;
  }

  private urlFor(route: string): string {
    if (/^https?:\/\//i.test(route)) {
      return route;
    }
    return new URL(route.replace(/^\/+/, ''), this.serverUrl).toString();
  }
}

export class OverleafSocketSession {
  private readonly socket: any;
  private project?: OverleafProject;
  public publicId?: string;
  private readonly timeouts: NetworkTimeouts;

  constructor(serverUrl: string, private readonly identity: Identity, timeouts: NetworkTimeouts, query?: string) {
    this.timeouts = timeouts;
    const runtimeRoot = path.join(__dirname, 'vendor', 'socket.io-client');
    const socketIo = loadSocketIoClient(runtimeRoot);
    patchSocketIoHandshake(socketIo, runtimeRoot);
    const connect = socketIo.connect.bind(socketIo);
    const origin = new URL(normalizeServerUrl(serverUrl)).origin;
    this.socket = connect(`${origin}${query ?? ''}`, {
      reconnect: false,
      'force new connection': true,
      overleafCodexCookie: identity.cookies,
      overleafCodexOrigin: origin,
      overleafCodexTimeoutMs: timeouts.connectMs,
      extraHeaders: {
        Origin: origin,
        Cookie: identity.cookies
      }
    });
    this.socket.on('connectionAccepted', (_payload: unknown, publicId: unknown) => {
      if (typeof publicId === 'string') {
        this.publicId = publicId;
      }
    });
  }

  setProject(project: OverleafProject): void {
    this.project = project;
  }

  getProject(): OverleafProject | undefined {
    return this.project;
  }

  waitForConnect(signal?: AbortSignal, timeoutMs?: number): Promise<void> {
    const ms = timeoutMs ?? this.timeouts.connectMs;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        this.socket.removeListener('connect', onConnect);
        this.socket.removeListener('connect_failed', onFailed);
        this.socket.removeListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve();
      };
      const onConnect = (): void => finish();
      const onFailed = (): void => finish(new Error('Failed to connect to Overleaf realtime server.'));
      const onError = (error: unknown): void => finish(error instanceof Error ? error : new Error(String(error)));
      const onAbort = (): void => finish(abortError(signal));
      const timer = setTimeout(() => finish(new Error('Timed out connecting to Overleaf realtime server.')), ms);
      this.socket.once('connect', onConnect);
      this.socket.once('connect_failed', onFailed);
      this.socket.once('error', onError);
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async joinProject(projectId: string, signal?: AbortSignal): Promise<OverleafProject> {
    const rejectPromise = new Promise<never>((_, reject) => {
      this.socket.once('connectionRejected', (error: { message?: string }) => {
        reject(new Error(error?.message || 'Overleaf rejected the realtime connection.'));
      });
    });
    const joinPromise = this.emitAck('joinProject', this.timeouts.projectJoinMs, signal, { project_id: projectId })
      .then(values => values[0] as OverleafProject);
    return Promise.race([rejectPromise, joinPromise]);
  }

  waitForJoinProjectResponse(signal?: AbortSignal, timeoutMs?: number): Promise<OverleafProject> {
    const ms = timeoutMs ?? this.timeouts.projectJoinMs;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        this.socket.removeListener('joinProjectResponse', onResponse);
        this.socket.removeListener('connectionRejected', onRejected);
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (error?: Error, project?: OverleafProject): void => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve(project!);
      };
      const onResponse = (result: { publicId?: string; project?: OverleafProject }): void => {
        this.publicId = result.publicId;
        if (!result.project) {
          finish(new Error('Overleaf did not return a project in joinProjectResponse.'));
          return;
        }
        finish(undefined, result.project);
      };
      const onRejected = (error: { message?: string }): void => finish(new Error(error?.message || 'Overleaf rejected the realtime connection.'));
      const onAbort = (): void => finish(abortError(signal));
      const timer = setTimeout(() => finish(new Error('Timed out waiting for Overleaf project state.')), ms);
      this.socket.once('joinProjectResponse', onResponse);
      this.socket.once('connectionRejected', onRejected);
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async joinDoc(docId: string, signal?: AbortSignal): Promise<JoinDocResult> {
    const values = await this.emitAck('joinDoc', this.timeouts.joinDocMs, signal, docId, { encodeRanges: true });
    const lines = values[0] as string[];
    const version = values[1] as number;
    return {
      content: lines.map(decodePackedUtf8).join('\n'),
      version
    };
  }

  async leaveDoc(docId: string): Promise<void> {
    await this.emitAck('leaveDoc', this.timeouts.joinDocMs, undefined, docId);
  }

  async applyOtUpdate(docId: string, update: OtUpdate, signal?: AbortSignal): Promise<void> {
    await this.emitAck('applyOtUpdate', this.timeouts.otAckMs, signal, docId, update);
  }

  async getConnectedUsers(): Promise<OnlineUser[]> {
    const values = await this.emitAck('clientTracking.getConnectedUsers', this.timeouts.otAckMs);
    return values[0] as OnlineUser[] ?? [];
  }

  async updatePosition(docId: string, row: number, column: number): Promise<void> {
    await this.emitAck('clientTracking.updatePosition', this.timeouts.otAckMs, undefined, {
      doc_id: docId,
      row,
      column
    });
  }

  on(event: string, handler: SocketHandler): void {
    this.socket.on(event, handler);
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  private emitAck(event: string, timeoutMs: number, signal?: AbortSignal, ...args: unknown[]): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (error?: Error, values?: unknown[]): void => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve(values ?? []);
      };
      const onAbort = (): void => finish(abortError(signal));
      const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${event} acknowledgement.`)), timeoutMs);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.socket.emit(event, ...args, (error: unknown, ...values: unknown[]) => {
        if (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        finish(undefined, values);
      });
    });
  }
}

export interface ParsedContentRange {
  start: number;
  end: number;
  total: number;
}

export function parseContentRange(value: string | null): ParsedContentRange {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) {
    throw new Error(`Invalid or missing Content-Range header: ${value ?? 'missing'}.`);
  }
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('Operation cancelled.');
}

export function loadSocketIoClient(runtimeRoot = path.join(__dirname, 'vendor', 'socket.io-client')): any {
  const requireFromExtension = createRequire(__filename);
  const entry = path.join(runtimeRoot, 'lib', 'io.js');
  let loaded: any;
  try {
    loaded = requireFromExtension(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load Overleaf Socket.IO runtime from ${entry}: ${message}. Rebuild or reinstall the extension.`);
  }
  const candidates = [
    loaded,
    loaded?.default,
    loaded?.io
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.connect === 'function') {
      return candidate;
    }
  }
  if (typeof loaded === 'function') {
    return {
      ...loaded,
      connect: loaded
    };
  }
  const shape = loaded && typeof loaded === 'object' ? Object.keys(loaded).join(', ') : typeof loaded;
  throw new Error(`Could not load socket.io-client connect function. Loaded shape: ${shape || 'empty'}.`);
}

function loadSocketIoWebSocket(runtimeRoot: string): any {
  const entry = path.join(runtimeRoot, 'lib', 'io.js');
  const requireFromRuntime = createRequire(entry);
  let loaded: any;
  try {
    // Keep this require indirect: esbuild must not turn the legacy ws module
    // into another synthetic CommonJS wrapper. Node resolves it from the
    // prepared Socket.IO runtime's node_modules directory.
    loaded = requireFromRuntime('ws');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load the Overleaf WebSocket runtime from ${path.join(runtimeRoot, 'node_modules', 'ws')}: ${message}. Rebuild or reinstall the extension.`);
  }
  const candidate = loaded?.default ?? loaded;
  if (typeof candidate !== 'function') {
    const shape = loaded && typeof loaded === 'object' ? Object.keys(loaded).join(', ') : typeof loaded;
    throw new Error(`The Overleaf WebSocket runtime has invalid exports (${shape || 'empty'}). Rebuild or reinstall the extension.`);
  }
  return candidate;
}

function patchSocketIoHandshake(socketIo: any, runtimeRoot: string): void {
  if (socketIo.__overleafCodexHandshakePatched || !socketIo.Socket?.prototype) {
    return;
  }

  const originalHandshake = socketIo.Socket.prototype.handshake;
  const originalWebsocketOpen = socketIo.Transport?.websocket?.prototype?.open;
  const originalXhrRequest = socketIo.Transport?.XHR?.prototype?.request;
  const Ws = originalWebsocketOpen ? loadSocketIoWebSocket(runtimeRoot) : undefined;

  if (originalWebsocketOpen) {
    socketIo.Transport.websocket.prototype.open = function patchedWebsocketOpen(this: any): unknown {
      const cookie = this.socket?.options?.overleafCodexCookie;
      if (!cookie) {
        return originalWebsocketOpen.call(this);
      }

      const query = socketIo.util.query(this.socket.options.query);
      this.websocket = new Ws(this.prepareUrl() + query, undefined, {
        origin: this.socket.options.overleafCodexOrigin,
        headers: {
          Cookie: cookie,
          Origin: this.socket.options.overleafCodexOrigin
        }
      });

      this.websocket.onopen = () => {
        this.onOpen();
        this.socket.setBuffer(false);
      };
      this.websocket.onmessage = (event: { data: string }) => this.onData(event.data);
      this.websocket.onclose = () => {
        this.onClose();
        this.socket.setBuffer(true);
      };
      this.websocket.onerror = (error: unknown) => this.onError(error);
      return this;
    };
  }

  if (originalXhrRequest) {
    socketIo.Transport.XHR.prototype.request = function patchedXhrRequest(this: any, method?: string): unknown {
      const req = originalXhrRequest.call(this, method);
      const cookie = this.socket?.options?.overleafCodexCookie;
      if (cookie && req?.setRequestHeader) {
        req.setDisableHeaderCheck?.(true);
        req.setRequestHeader('Cookie', cookie);
        req.setRequestHeader('Origin', this.socket.options.overleafCodexOrigin);
      }
      return req;
    };
  }

  socketIo.Socket.prototype.handshake = function patchedHandshake(this: any, fn: (...args: string[]) => void): void {
    const cookie = this.options?.overleafCodexCookie;
    if (!cookie) {
      originalHandshake.call(this, fn);
      return;
    }

    const secure = Boolean(this.options.secure);
    const port = this.options.port || (secure ? 443 : 80);
    const query = socketIo.util.query(this.options.query, `t=${Date.now()}`);
    const url = [
      `http${secure ? 's' : ''}:/`,
      `${this.options.host}:${port}`,
      this.options.resource,
      socketIo.protocol,
      query
    ].join('/');

    requestSocketHandshake(url, {
      cookie,
      origin: this.options.overleafCodexOrigin,
      timeoutMs: this.options.overleafCodexTimeoutMs ?? 60000
    })
      .then(result => {
        this.options.overleafCodexCookie = mergeCookieHeader(cookie, result.setCookies);
        fn(...result.parts);
      })
      .catch(error => {
        this.connecting = false;
        this.onError(error instanceof Error ? error.message : String(error));
      });
  };

  socketIo.__overleafCodexHandshakePatched = true;
}

type SocketHandshakeParts = [string, string, string, string];

interface SocketHandshakeResult {
  parts: SocketHandshakeParts;
  setCookies: string[];
}

interface SocketHandshakeRequestOptions {
  cookie: string;
  origin: string;
  timeoutMs: number;
  attempts?: number;
}

export async function requestSocketHandshake(
  url: string,
  options: SocketHandshakeRequestOptions
): Promise<SocketHandshakeResult> {
  const attempts = Math.max(1, options.attempts ?? 3);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptUrl = new URL(url);
    attemptUrl.searchParams.set('t', String(Date.now()));
    try {
      return await requestSocketHandshakeOnce(attemptUrl, options);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || !isRetryableSocketHandshakeError(error)) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function parseSocketHandshakeBody(body: string): SocketHandshakeParts {
  const normalized = body.trim();
  const match = /^([^:\s]+):(\d+):(\d+):([a-z0-9_-]+(?:,[a-z0-9_-]+)*)$/i.exec(normalized);
  if (!match) {
    throw new Error(`Invalid Socket.IO handshake response: ${normalized.slice(0, 200) || 'empty body'}`);
  }
  return [match[1], match[2], match[3], match[4]];
}

export function mergeCookieHeader(cookieHeader: string, setCookies: string[]): string {
  const cookies = new Map<string, string>();
  for (const item of cookieHeader.split(';')) {
    const cookie = item.trim();
    const separator = cookie.indexOf('=');
    if (separator > 0) {
      cookies.set(cookie.slice(0, separator).trim(), cookie.slice(separator + 1).trim());
    }
  }
  for (const item of setCookies) {
    const cookie = item.split(';', 1)[0].trim();
    const separator = cookie.indexOf('=');
    if (separator > 0) {
      cookies.set(cookie.slice(0, separator).trim(), cookie.slice(separator + 1).trim());
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function requestSocketHandshakeOnce(
  url: URL,
  options: SocketHandshakeRequestOptions
): Promise<SocketHandshakeResult> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'http:' ? http : https;
    const request = transport.request(url, {
      method: 'GET',
      agent: false,
      headers: {
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        Connection: 'close',
        Cookie: options.cookie,
        Origin: options.origin,
        'User-Agent': 'Overleaf Codex'
      }
    }, response => {
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (streamError?: Error): void => {
        if (settled) {
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        const statusCode = response.statusCode ?? 0;

        if (statusCode === 200) {
          try {
            const parts = parseSocketHandshakeBody(body);
            settled = true;
            const setCookieHeader = response.headers['set-cookie'];
            resolve({
              parts,
              setCookies: Array.isArray(setCookieHeader)
                ? setCookieHeader
                : setCookieHeader ? [setCookieHeader] : []
            });
            return;
          } catch (error) {
            if (!streamError) {
              settled = true;
              reject(error);
              return;
            }
          }
        }

        settled = true;
        if (statusCode >= 300 && statusCode < 400) {
          reject(new Error(`Overleaf socket handshake was redirected (HTTP ${statusCode}). Log in again with a fresh Cookie.`));
          return;
        }
        if (statusCode !== 200) {
          reject(new Error(`Overleaf socket handshake failed with HTTP ${statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        reject(streamError ?? new Error(`Invalid Socket.IO handshake response: ${body.slice(0, 200) || 'empty body'}`));
      };

      response.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        if (chunks.reduce((total, item) => total + item.length, 0) > 64 * 1024) {
          request.destroy(new Error('Overleaf socket handshake response was unexpectedly large.'));
        }
      });
      response.once('end', () => finish());
      response.once('aborted', () => finish(new Error('Overleaf socket handshake response was aborted.')));
      response.once('error', error => finish(error));
      response.once('close', () => {
        if (!settled) {
          finish(new Error('Overleaf socket handshake response closed prematurely.'));
        }
      });
    });

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`Timed out fetching the Overleaf socket handshake after ${options.timeoutMs / 1000} seconds.`));
    });
    request.once('error', reject);
    request.end();
  });
}

function isRetryableSocketHandshakeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !/HTTP [34]\d\d|Log in again/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function encodePackedUtf8(text: string): string {
  return Buffer.from(text, 'utf8').toString('latin1');
}

export function decodePackedUtf8(text: string): string {
  return Buffer.from(text, 'latin1').toString('utf8');
}

function extractCsrfToken(html: string): string | undefined {
  return extractFirst(html, [
    /(?:window\.)?csrfToken\s*=\s*['"]([^'"]+)['"]/,
    /<meta[^>]+name=['"]ol-csrfToken['"][^>]+content=['"]([^'"]+)['"]/i,
    /<meta[^>]+content=['"]([^'"]+)['"][^>]+name=['"]ol-csrfToken['"]/i,
    /<meta[^>]+name=['"]csrf-token['"][^>]+content=['"]([^'"]+)['"]/i,
    /"csrfToken"\s*:\s*"([^"]+)"/
  ]);
}

function extractFirst(input: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function normalizeProjects(projects: unknown[]): ProjectSummary[] {
  return projects
    .map(project => project as Record<string, unknown>)
    .map(project => ({
      id: String(project.id ?? project._id ?? ''),
      name: String(project.name ?? 'Untitled Project'),
      accessLevel: project.accessLevel ? String(project.accessLevel) : undefined,
      archived: Boolean(project.archived),
      trashed: Boolean(project.trashed),
      lastUpdated: project.lastUpdated ? String(project.lastUpdated) : undefined
    }))
    .filter(project => project.id.length > 0);
}

async function assertOk(res: Response, route: string): Promise<void> {
  if (res.status >= 200 && res.status < 300) {
    return;
  }
  const body = await res.text().catch(() => '');
  let code: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    code = typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    code = undefined;
  }
  throw new OverleafHttpError(
    `Overleaf request failed (${res.status}) for ${path.basename(route)}: ${body.slice(0, 500)}`,
    res.status,
    code,
    body.slice(0, 500)
  );
}
