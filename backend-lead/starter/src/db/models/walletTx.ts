import { DataTypes, Model, Sequelize } from 'sequelize';

export type WalletTxKind = 'deposit' | 'wager' | 'withdrawal';
export type WalletTxReferenceType = 'funding_transaction';

export class WalletTx extends Model {
  declare id: string;
  declare seq: string;
  declare walletId: string;
  declare kind: WalletTxKind;
  declare amount: string;
  declare balanceAfter: string;
  declare referenceType: WalletTxReferenceType | null;
  declare referenceId: string | null;
}

export function initWalletTx(sequelize: Sequelize): void {
  WalletTx.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      seq: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      kind: { type: DataTypes.STRING(16), allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      balanceAfter: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      referenceType: { type: DataTypes.STRING(32), allowNull: true },
      referenceId: { type: DataTypes.UUID, allowNull: true },
    },
    { sequelize, tableName: 'wallet_txs', underscored: true, updatedAt: false },
  );
}
