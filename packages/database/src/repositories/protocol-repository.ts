import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { ProtocolCategory } from '@eoi/shared';
import type { Database } from '../client';
import { protocolContracts, protocols, walletLabels } from '../schema';

type Hex = `0x${string}`;

export interface ProtocolDefinition {
  id: string;
  name: string;
  category: ProtocolCategory;
  website: string;
  contracts: { address: Hex; role: string }[];
}

export const PROTOCOL_LABEL_SOURCE_PREFIX = 'protocol-registry:';

/**
 * Mirrors the in-code protocol registry into the database so SQL analytics can join
 * against it. The code is the source of truth; this sync is idempotent and removes
 * contracts that were dropped from the registry.
 */
export class ProtocolRepository {
  constructor(
    private readonly db: Database,
    private readonly chainId: number,
  ) {}

  async sync(definitions: readonly ProtocolDefinition[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const def of definitions) {
        await tx
          .insert(protocols)
          .values({ id: def.id, name: def.name, category: def.category, website: def.website })
          .onConflictDoUpdate({
            target: protocols.id,
            set: {
              name: def.name,
              category: def.category,
              website: def.website,
              updatedAt: sql`now()`,
            },
          });
      }

      const rows = definitions.flatMap((def) =>
        def.contracts.map((c) => ({
          chainId: this.chainId,
          address: c.address,
          protocolId: def.id,
          role: c.role,
        })),
      );
      const keep = rows.map((r) => r.address);
      await tx
        .delete(protocolContracts)
        .where(
          keep.length > 0
            ? and(
                eq(protocolContracts.chainId, this.chainId),
                notInArray(protocolContracts.address, keep),
              )
            : eq(protocolContracts.chainId, this.chainId),
        );
      await tx
        .delete(walletLabels)
        .where(
          and(
            eq(walletLabels.chainId, this.chainId),
            sql`${walletLabels.source} LIKE ${`${PROTOCOL_LABEL_SOURCE_PREFIX}%`}`,
          ),
        );
      if (rows.length === 0) return;

      await tx
        .insert(protocolContracts)
        .values(rows)
        .onConflictDoUpdate({
          target: [protocolContracts.chainId, protocolContracts.address],
          set: { protocolId: sql.raw('excluded.protocol_id'), role: sql.raw('excluded.role') },
        });
      await tx.insert(walletLabels).values(
        definitions.flatMap((def) =>
          def.contracts.map((c) => ({
            chainId: this.chainId,
            address: c.address,
            label: `${def.name}: ${c.role}`,
            category: def.category,
            source: `${PROTOCOL_LABEL_SOURCE_PREFIX}${def.id}`,
          })),
        ),
      );
    });
  }
}
