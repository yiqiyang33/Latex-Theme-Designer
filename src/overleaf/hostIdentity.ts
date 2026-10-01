import * as crypto from 'crypto';
import { readFileSync, readlinkSync } from 'fs';
import * as os from 'os';
import { processAlive, processStartSignature } from './util';

/** The machine, kernel boot and PID namespace a process runs in. */
export interface HostIdentity {
  hostname: string;
  bootId?: string;
  pidNamespace?: string;
}

/**
 * How the host that wrote a lock record relates to this one:
 * - `same`: this machine and boot, so the record's PID can be checked locally;
 * - `rebooted`: this machine before a reboot, so every process it names is gone;
 * - `foreign`: another machine (or PID namespace), where a local PID check means nothing;
 * - `legacy`: written by a version that recorded no host at all.
 */
export type HostRelation = 'same' | 'rebooted' | 'foreign' | 'legacy';

let currentIdentity: HostIdentity | undefined;

export function currentHostIdentity(): HostIdentity {
  if (!currentIdentity) {
    const bootId = readProcText('/proc/sys/kernel/random/boot_id');
    const pidNamespace = readProcLink('/proc/self/ns/pid');
    currentIdentity = {
      hostname: os.hostname(),
      ...(bootId ? { bootId } : {}),
      ...(pidNamespace ? { pidNamespace } : {})
    };
  }
  return currentIdentity;
}

/** The host fields every lock record carries, so readers on other machines can tell it apart. */
export function hostRecordFields(host: HostIdentity = currentHostIdentity()): HostIdentity {
  return {
    hostname: host.hostname,
    ...(host.bootId ? { bootId: host.bootId } : {}),
    ...(host.pidNamespace ? { pidNamespace: host.pidNamespace } : {})
  };
}

/**
 * Locks live under $HOME, which on a cluster is an NFS share mounted by every login node, so a PID
 * in a lock record is only meaningful on the host that wrote it. The boot id decides first because
 * it survives hostname changes and tells a reboot apart from another machine.
 */
export function hostRelation(record: Partial<HostIdentity>, self: HostIdentity = currentHostIdentity()): HostRelation {
  const hostname = typeof record.hostname === 'string' ? record.hostname : undefined;
  const bootId = typeof record.bootId === 'string' ? record.bootId : undefined;
  if (!hostname && !bootId) return 'legacy';
  if (bootId && self.bootId) {
    if (bootId !== self.bootId) return hostname === self.hostname ? 'rebooted' : 'foreign';
    const pidNamespace = typeof record.pidNamespace === 'string' ? record.pidNamespace : undefined;
    return pidNamespace && self.pidNamespace && pidNamespace !== self.pidNamespace ? 'foreign' : 'same';
  }
  return hostname === self.hostname ? 'same' : 'foreign';
}

/** Whether `pid` on this host is still the process that recorded `processStart`. */
export async function localProcessMatches(pid: number, processStart?: string): Promise<boolean> {
  if (!processAlive(pid)) return false;
  if (!processStart) return true;
  const currentStart = await processStartSignature(pid);
  return !currentStart || currentStart === processStart;
}

export interface ShortLockRecord extends Partial<HostIdentity> {
  pid?: number;
  processStart?: string;
}

/**
 * Staleness of a short-lived lock (shared configuration, compile output). A holder on this host is
 * checked by PID. One on another host cannot be, so its lock counts as abandoned only once it has
 * outlived any legitimate hold (`foreignStaleMs`). Records without host fields keep the PID check
 * older versions used.
 */
export async function shortLockIsStale(
  record: ShortLockRecord,
  lockAgeMs: number,
  foreignStaleMs: number,
  self: HostIdentity = currentHostIdentity()
): Promise<boolean> {
  const relation = hostRelation(record, self);
  if (relation === 'same' || relation === 'legacy') {
    return typeof record.pid !== 'number' || !await localProcessMatches(record.pid, record.processStart);
  }
  return lockAgeMs >= foreignStaleMs;
}

/**
 * How long a lock has been held, taking the younger of its recorded creation time and its
 * directory's mtime, so neither a skewed clock nor a touched directory makes it look older.
 */
export function lockAgeMs(createdAt: string | number | undefined, stat?: { mtimeMs: number }, now = Date.now()): number {
  const created = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt ?? '');
  const ages = [
    ...(Number.isFinite(created) ? [now - created] : []),
    ...(stat ? [now - stat.mtimeMs] : [])
  ];
  return ages.length ? Math.max(0, Math.min(...ages)) : 0;
}

/** A short, stable tag for a host, for file names that must differ between machines. */
export function hostTag(host: HostIdentity = currentHostIdentity()): string {
  return crypto.createHash('sha256')
    .update(`${host.hostname}\0${host.bootId ?? ''}\0${host.pidNamespace ?? ''}`)
    .digest('hex')
    .slice(0, 8);
}

export function describeHost(host: Partial<HostIdentity> | undefined): string {
  return typeof host?.hostname === 'string' && host.hostname ? host.hostname : 'another machine';
}

function readProcText(target: string): string | undefined {
  try {
    return readFileSync(target, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function readProcLink(target: string): string | undefined {
  try {
    return readlinkSync(target) || undefined;
  } catch {
    return undefined;
  }
}
