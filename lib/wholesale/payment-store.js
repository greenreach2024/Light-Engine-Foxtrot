/**
 * GreenReach Wholesale - Persistent Payment Store
 *
 * NeDB-backed store for payment reconciliation/webhook processing state.
 */

import Datastore from 'nedb-promises';

const paymentsDB = Datastore.create({ filename: 'data/wholesale-payments.db', autoload: true });
paymentsDB.ensureIndex({ fieldName: 'provider_payment_id', unique: true });
paymentsDB.ensureIndex({ fieldName: 'provider' });
paymentsDB.ensureIndex({ fieldName: 'status' });
paymentsDB.ensureIndex({ fieldName: 'created_at' });
paymentsDB.persistence.setAutocompactionInterval(600000);

export async function getPaymentRecord(providerPaymentId) {
  return paymentsDB.findOne({ provider_payment_id: providerPaymentId });
}

export async function savePaymentRecord(paymentRecord) {
  const existing = await getPaymentRecord(paymentRecord.provider_payment_id);

  if (existing) {
    await paymentsDB.update(
      { _id: existing._id },
      { $set: { ...paymentRecord, updated_at: new Date().toISOString() } }
    );
    return { ...existing, ...paymentRecord };
  }

  const doc = {
    ...paymentRecord,
    id: paymentRecord.id || `PR-${Date.now()}`,
    events: paymentRecord.events || [],
    processed_event_keys: paymentRecord.processed_event_keys || [],
    created_at: paymentRecord.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return paymentsDB.insert(doc);
}

export async function listPaymentRecords(filters = {}) {
  const query = {};

  if (filters.status) query.status = filters.status;

  let records = await paymentsDB.find(query);

  if (filters.from_date) {
    const fromTime = new Date(filters.from_date).getTime();
    records = records.filter(r => new Date(r.created_at).getTime() >= fromTime);
  }

  if (filters.to_date) {
    const toTime = new Date(filters.to_date).getTime();
    records = records.filter(r => new Date(r.created_at).getTime() <= toTime);
  }

  records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return records;
}

export async function addProcessedEvent(providerPaymentId, eventKey, eventData) {
  const paymentRecord = await getPaymentRecord(providerPaymentId);
  if (!paymentRecord) return { found: false, duplicate: false, paymentRecord: null };

  const processedEventKeys = paymentRecord.processed_event_keys || [];
  if (processedEventKeys.includes(eventKey)) {
    return { found: true, duplicate: true, paymentRecord };
  }

  const events = paymentRecord.events || [];
  events.push(eventData);

  processedEventKeys.push(eventKey);

  const updated = {
    ...paymentRecord,
    events,
    processed_event_keys: processedEventKeys,
    updated_at: new Date().toISOString()
  };

  await savePaymentRecord(updated);

  return {
    found: true,
    duplicate: false,
    paymentRecord: updated
  };
}

export default {
  paymentsDB,
  getPaymentRecord,
  savePaymentRecord,
  listPaymentRecords,
  addProcessedEvent
};
