import { DataTypes, Model, Sequelize } from 'sequelize';
import { FundingTransactionStatus } from '../../domain/fundingTransactionState';

export type FundingTransactionType = 'deposit' | 'withdrawal';

export class FundingTransaction extends Model {
  declare id: string;
  declare memberId: string;
  declare walletId: string;
  declare type: FundingTransactionType;
  declare status: FundingTransactionStatus;
  declare amount: string;
  declare pspAmount: string | null;
  declare turnoverMultiplier: number;
  declare pspRef: string | null;
  declare statusReason: string | null;
  declare finalizedAt: Date | null;
}

export function initFundingTransaction(sequelize: Sequelize): void {
  FundingTransaction.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      walletId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING(16), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'Pending' },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      pspAmount: { type: DataTypes.DECIMAL(36, 18), allowNull: true },
      turnoverMultiplier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      pspRef: { type: DataTypes.STRING(64), allowNull: true },
      statusReason: { type: DataTypes.STRING(128), allowNull: true },
      finalizedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: 'funding_transactions', underscored: true },
  );
}
