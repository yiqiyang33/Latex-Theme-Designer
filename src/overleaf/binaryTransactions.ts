import * as fs from 'fs/promises';
import { atomicWriteText, metadataPath, TRANSACTIONS_NAME } from './manifest';
import { assertValidTransactions, validateTransactionList } from './metadataValidation';

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
  expectedSha1?: string;
  stage: BinaryTransactionStage;
  createdAt: string;
}

export class BinaryTransactionStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

  async list(): Promise<BinaryTransaction[]> {
    const target = metadataPath(this.root, TRANSACTIONS_NAME);
    const raw = await fs.readFile(target, 'utf8').catch(() => undefined);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const validationError = validateTransactionList(parsed);
      if (validationError) throw new Error(validationError);
      return parsed as BinaryTransaction[];
    } catch (error) {
      await fs.rename(target, `${target}.corrupt-${Date.now()}`).catch(() => undefined);
      console.warn(`Overleaf binary transactions at ${target} were quarantined: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
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
    assertValidTransactions(records);
    return atomicWriteText(metadataPath(this.root, TRANSACTIONS_NAME), `${JSON.stringify(records, null, 2)}\n`);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.catch(() => undefined).then(operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }
}
