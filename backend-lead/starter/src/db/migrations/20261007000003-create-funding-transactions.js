'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('funding_transactions', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      member_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'members', key: 'id' },
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      type: { type: Sequelize.STRING(16), allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'Pending' },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      // Amount reported by the PSP callback (deposits only).
      psp_amount: { type: Sequelize.DECIMAL(36, 18), allowNull: true },
      turnover_multiplier: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      psp_ref: { type: Sequelize.STRING(64), allowNull: true },
      status_reason: { type: Sequelize.STRING(128), allowNull: true },
      finalized_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.addConstraint('funding_transactions', {
      fields: ['type'],
      type: 'check',
      name: 'funding_transactions_type_check',
      where: { type: ['deposit', 'withdrawal'] },
    });
    await queryInterface.addConstraint('funding_transactions', {
      fields: ['status'],
      type: 'check',
      name: 'funding_transactions_status_check',
      where: { status: ['Pending', 'Completed', 'Failed', 'Flagged'] },
    });
    await queryInterface.addConstraint('funding_transactions', {
      fields: ['amount'],
      type: 'check',
      name: 'funding_transactions_amount_positive',
      where: { amount: { [Sequelize.Op.gt]: 0 } },
    });
    await queryInterface.addConstraint('funding_transactions', {
      fields: ['turnover_multiplier'],
      type: 'check',
      name: 'funding_transactions_turnover_multiplier_nonneg',
      where: { turnover_multiplier: { [Sequelize.Op.gte]: 0 } },
    });
    await queryInterface.addIndex('funding_transactions', ['psp_ref'], {
      unique: true,
      name: 'funding_transactions_psp_ref_unique',
      where: { psp_ref: { [Sequelize.Op.ne]: null } },
    });
    await queryInterface.addIndex('funding_transactions', ['wallet_id', 'created_at'], {
      name: 'funding_transactions_wallet_id_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('funding_transactions');
  },
};
