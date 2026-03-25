/**
 * NeDB-backed fulfillment record store.
 * Replaces the in-memory Map that was losing data on EB restarts.
 */

import Datastore from '@seald-io/nedb';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const fulfillmentDB = new Datastore({ filename: path.join(DATA_DIR, 'wholesale-fulfillment.db'), autoload: true });
const invoiceDB = new Datastore({ filename: path.join(DATA_DIR, 'wholesale-invoices.db'), autoload: true });

fulfillmentDB.ensureIndex({ fieldName: 'sub_order_id', unique: true });
invoiceDB.ensureIndex({ fieldName: 'invoice_id', unique: true });

// Compact every 10 minutes
fulfillmentDB.persistence.setAutocompactionInterval(600000);
invoiceDB.persistence.setAutocompactionInterval(600000);

export async function getFulfillmentRecord(subOrderId) {
  return new Promise((resolve, reject) => {
    fulfillmentDB.findOne({ sub_order_id: subOrderId }, (err, doc) => {
      if (err) return reject(err);
      resolve(doc || null);
    });
  });
}

export async function saveFulfillmentRecord(record) {
  return new Promise((resolve, reject) => {
    fulfillmentDB.update(
      { sub_order_id: record.sub_order_id },
      { $set: { ...record, updated_at: new Date().toISOString() } },
      { upsert: true },
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

export async function listFulfillmentRecords() {
  return new Promise((resolve, reject) => {
    fulfillmentDB.find({}).sort({ updated_at: -1 }).exec((err, docs) => {
      if (err) return reject(err);
      resolve(docs || []);
    });
  });
}

export async function getInvoiceRecord(invoiceId) {
  return new Promise((resolve, reject) => {
    invoiceDB.findOne({ invoice_id: invoiceId }, (err, doc) => {
      if (err) return reject(err);
      resolve(doc || null);
    });
  });
}

export async function saveInvoiceRecord(record) {
  return new Promise((resolve, reject) => {
    invoiceDB.update(
      { invoice_id: record.invoice_id },
      { $set: { ...record, updated_at: new Date().toISOString() } },
      { upsert: true },
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}
