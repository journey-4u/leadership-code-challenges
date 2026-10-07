'use strict';

// Append-only ledger. SUM(amount) per wallet == wallets.balance at every commit.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_txs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      seq: { type: Sequelize.BIGINT, allowNull: false, autoIncrement: true, unique: true },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      kind: { type: Sequelize.STRING(16), allowNull: false },
      // Signed: credits positive, debits negative.
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      balance_after: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      reference_type: { type: Sequelize.STRING(32), allowNull: true },
      reference_id: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.addConstraint('wallet_txs', {
      fields: ['kind'],
      type: 'check',
      name: 'wallet_txs_kind_check',
      where: { kind: ['deposit', 'wager', 'withdrawal'] },
    });
    await queryInterface.addConstraint('wallet_txs', {
      fields: ['balance_after'],
      type: 'check',
      name: 'wallet_txs_balance_after_nonneg',
      where: { balance_after: { [Sequelize.Op.gte]: 0 } },
    });
    // One ledger entry per funding transaction, enforced by the database.
    await queryInterface.addIndex('wallet_txs', ['reference_type', 'reference_id'], {
      unique: true,
      name: 'wallet_txs_reference_unique',
      where: { reference_id: { [Sequelize.Op.ne]: null } },
    });
    await queryInterface.addIndex('wallet_txs', ['wallet_id', 'seq'], {
      name: 'wallet_txs_wallet_id_seq',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wallet_txs');
  },
};
