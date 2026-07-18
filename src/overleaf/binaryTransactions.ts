import * as fs from 'fs/promises';
import { atomicWriteText, metadataPath, TRANSACTIONS_NAME } from './manifest';

export type BinaryTransactionStage = 'temp-uploaded' | 'original-backed-up' | 'promoted';

export interface BinaryTransaction {
  id: string;
  path: string;
  parentFolderId: string;
  finalName: string;
  tempName: string;
  backupName: string;
  originalEntityId: string;
  tempEntityId: string;
  expectedBlobHash: string;
  stage: BinaryTransactionStage;
  createdAt: string;
}

export class BinaryTransactionStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

  async list(): Promise<BinaryTransaction[]> {
    const raw = await fs.readFile(metadataPath(this.root, TRANSACTIONS_NAME), 'utf8').catch(() => undefined);
    return raw ? JSON.parse(raw) as BinaryTransaction[] : [];
  }

  async upsert(transaction: BinaryTransaction): Promise<void> {
    await this.run(async () => {
      const records = await this.list();
      const index = records.findIndex(item => item.id === transaction.id);
      if (index >= 0) records[index] = transaction; else records.push(transaction);
      await this.write(records);
    });
  }

  async remove(id: string): Promise<void> {
    await this.run(async () => {
      const records = (await this.list()).filter(item => item.id !== id);
      await this.write(records);
    });
  }

  private write(records: BinaryTransaction[]): Promise<void> {
    return atomicWriteText(metadataPath(this.root, TRANSACTIONS_NAME), `${JSON.stringify(records, null, 2)}\n`);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.catch(() => undefined).then(operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }
}
