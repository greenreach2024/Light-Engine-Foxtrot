/**
 * GreenReach Wholesale - Persistent Refund Store
 *
 * NeDB-backed store for refund records and broker fee reversals.
 */

import Datastore from 'nedb-promises';
import fs from 'node:fs';
import path from 'node:path';

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || String(process.env.TEST_MODE).toLowerCase() === 'true' || String(process.env.TEST_MODE) === '1';
if (!IS_TEST_ENV) {
  try { fs.mkdirSync(path.resolve('data'), { recursive: true }); } catch {}
}

function createStore(filename) {
  return Datastore.create({
    filename,
    autoload: !IS_TEST_ENV,
    inMemoryOnly: IS_TEST_ENV,
  });
}

const refundsDB = createStore('data/wholesale-refunds.db');
refundsDB.ensureIndex({ fieldName: 'id', unique: true });
refundsDB.ensureIndex({ fieldName: 'sub_order_id' });
refundsDB.ensureIndex({ fieldName: 'master_order_id' });
refundsDB.ensureIndex({ fieldName: 'farm_id' });
refundsDB.ensureIndex({ fieldName: 'status' });
refundsDB.ensureIndex({ fieldName: 'created_at' });
refundsDB.persistence.setAutocompactionInterval(600000);

const brokerFeeReversalsDB = createStore('data/wholesale-broker-fee-reversals.db');
brokerFeeReversalsDB.ensureIndex({ fieldName: 'id', unique: true });
brokerFeeReversalsDB.ensureIndex({ fieldName: 'sub_order_id' });
brokerFeeReversalsDB.ensureIndex({ fieldName: 'refund_record_id' });
brokerFeeReversalsDB.ensureIndex({ fieldName: 'settlement_status' });
brokerFeeReversalsDB.ensureIndex({ fieldName: 'updated_at' });
brokerFeeReversalsDB.persistence.setAutocompactionInterval(600000);

export async function saveRefundRecord(refundRecord) {
  const existing = await refundsDB.findOne({ id: refundRecord.id });
  if (existing) {
    await refundsDB.update(
      { _id: existing._id },
      { $set: { ...refundRecord, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...refundRecord };
  }

  const doc = {
    ...refundRecord,
    created_at: refundRecord.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return refundsDB.insert(doc);
}

export async function getRefundRecord(refundId) {
  return refundsDB.findOne({ id: refundId });
}

export async function listRefundRecords(filters = {}) {
  const query = {};

  if (filters.sub_order_id) query.sub_order_id = filters.sub_order_id;
  if (filters.status) query.status = filters.status;

  let refunds = await refundsDB.find(query);

  if (filters.from_date) {
    const fromTime = new Date(filters.from_date).getTime();
    refunds = refunds.filter(r => new Date(r.created_at).getTime() >= fromTime);
  }

  if (filters.to_date) {
    const toTime = new Date(filters.to_date).getTime();
    refunds = refunds.filter(r => new Date(r.created_at).getTime() <= toTime);
  }

  refunds.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return refunds;
}

export async function saveBrokerFeeReversal(record) {
  const existing = await brokerFeeReversalsDB.findOne({ id: record.id });
  if (existing) {
    await brokerFeeReversalsDB.update(
      { _id: existing._id },
      { $set: { ...record, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...record };
  }

  const doc = {
    ...record,
    updated_at: record.updated_at || new Date().toISOString()
  };

  return brokerFeeReversalsDB.insert(doc);
}

export async function getBrokerFeeReversal(refundRecordId) {
  return brokerFeeReversalsDB.findOne({ refund_record_id: refundRecordId });
}

export default {
  refundsDB,
  brokerFeeReversalsDB,
  saveRefundRecord,
  getRefundRecord,
  listRefundRecords,
  saveBrokerFeeReversal,
  getBrokerFeeReversal
};
