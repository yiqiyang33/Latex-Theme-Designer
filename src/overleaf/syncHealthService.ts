import { ManifestFile, OverleafCodexManifest } from './types';
import { toPosixPath } from './util';

export interface RemoteReadPlan {
  docsToJoin: ManifestFile[];
  binariesToGet: ManifestFile[];
  reusedPaths: Set<string>;
}

export class SyncHealthService {
  planRemoteReads(
    previous: OverleafCodexManifest,
    remote: OverleafCodexManifest,
    options: { mode: 'incremental' | 'full'; paths?: Iterable<string> }
  ): RemoteReadPlan {
    const requested = options.paths ? new Set([...options.paths].map(toPosixPath)) : undefined;
    const plan: RemoteReadPlan = {
      docsToJoin: [],
      binariesToGet: [],
      reusedPaths: new Set<string>()
    };
    for (const file of Object.values(remote.files)) {
      if (requested && !requested.has(file.path)) continue;
      const previousFile = previous.files[file.path];
      if (options.mode === 'incremental' && canReuseRemoteMetadata(previousFile, file)) {
        plan.reusedPaths.add(file.path);
      } else if (file.entityType === 'doc') {
        plan.docsToJoin.push(file);
      } else {
        plan.binariesToGet.push(file);
      }
    }
    return plan;
  }
}

export function canReuseRemoteMetadata(previous: ManifestFile | undefined, remote: ManifestFile): boolean {
  if (!previous?.sha1 || previous.entityId !== remote.entityId || previous.entityType !== remote.entityType) {
    return false;
  }
  if (remote.entityType === 'doc') {
    return previous.version !== undefined
      && remote.version !== undefined
      && previous.version === remote.version;
  }
  if (previous.remoteBlobHash !== undefined && remote.remoteBlobHash !== undefined) {
    return previous.remoteBlobHash === remote.remoteBlobHash;
  }
  return previous.remoteRevision !== undefined
    && remote.remoteRevision !== undefined
    && previous.remoteRevision === remote.remoteRevision;
}
