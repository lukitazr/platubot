import './polyfill.js';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { connectDB } from './connection.js';

export const jsonModelEvents = {
  onWrite: null
};

class MongoDocument {
  constructor(modelInfo, data) {
    this._modelInfo = modelInfo;
    Object.assign(this, data);
  }

  _getId() {
    return this._id || this.id;
  }

  async save() {
    return this._modelInfo.updateDocument(this);
  }

  async update(updateData) {
    Object.assign(this, updateData);
    return this.save();
  }

  async delete() {
    const id = this._getId();
    if (!id) throw new Error('Cannot delete document without an _id or id property.');
    return this._modelInfo.deleteById(id);
  }

  toJSON() {
    const copy = { ...this };
    delete copy._modelInfo;
    return copy;
  }
}

export default class JsonModel {
  constructor(collectionName, schemaDefaults = {}, options = {}) {
    this.collectionName = collectionName;
    this.schemaDefaults = schemaDefaults;
    this.discriminatorKey = options.discriminatorKey || null;
    this.discriminators = options.discriminators || {};

    const schema = new mongoose.Schema(
      { _id: { type: mongoose.Schema.Types.Mixed } },
      { strict: false, versionKey: false, collection: collectionName }
    );

    this.mongooseModel = mongoose.models[collectionName] || mongoose.model(collectionName, schema);
  }

  async _ensureConnected() {
    await connectDB();
  }

  _wrap(doc) {
    if (!doc) return null;
    const plainObj = doc.toObject ? doc.toObject() : { ...doc };
    delete plainObj._modelInfo;
    return new MongoDocument(this, plainObj);
  }

  _applyDefaults(data) {
    let defaults = this.schemaDefaults;

    if (typeof defaults === 'function') {
      defaults = defaults(data);
    }

    const defaultedData = { ...defaults, ...data };
    const fieldsToExclude = new Set();

    const discKeys = Array.isArray(this.discriminatorKey)
      ? this.discriminatorKey
      : (this.discriminatorKey ? [this.discriminatorKey] : []);

    for (const key of discKeys) {
      const val = data && data[key];
      const discMap = this.discriminators[key] || this.discriminators;
      const subDefaults = discMap && discMap[val];

      if (subDefaults) {
        const resolved = typeof subDefaults === 'function' ? subDefaults(data) : subDefaults;

        for (const k in resolved) {
          if (k === '_excludeFields') {
            if (Array.isArray(resolved._excludeFields)) {
              resolved._excludeFields.forEach(f => fieldsToExclude.add(f));
            }
          } else {
            defaultedData[k] = resolved[k];
          }
        }
      }
    }

    for (const key in defaults) {
      if (
        key !== '_excludeFields' &&
        typeof defaults[key] === 'object' &&
        defaults[key] !== null &&
        !Array.isArray(defaults[key]) &&
        defaultedData[key] !== undefined &&
        !fieldsToExclude.has(key)
      ) {
        defaultedData[key] = { ...defaults[key], ...(data[key] || {}) };
      }
    }

    for (const field of fieldsToExclude) {
      delete defaultedData[field];
    }

    delete defaultedData._excludeFields;
    return defaultedData;
  }

  _buildIdQuery(id) {
    if (!id) return { _id: null };
    if (typeof id === 'object' && !Array.isArray(id)) {
      return id;
    }
    const idStr = String(id);
    const idNum = !isNaN(id) ? Number(id) : null;

    const conditions = [{ _id: id }, { _id: idStr }, { id: idStr }];
    if (idNum !== null) {
      conditions.push({ _id: idNum });
      conditions.push({ id: idNum });
    }

    return { $or: conditions };
  }

  async updateDocument(docInstance) {
    await this._ensureConnected();
    const rawData = { ...docInstance };
    delete rawData._modelInfo;

    const targetId = rawData._id || rawData.id;
    if (!targetId) {
      throw new Error(`Cannot update document in collection ${this.collectionName} without _id or id.`);
    }

    const filter = this._buildIdQuery(targetId);
    await this.mongooseModel.updateOne(filter, { $set: rawData }, { upsert: true });

    if (jsonModelEvents.onWrite) {
      try {
        jsonModelEvents.onWrite(this.collectionName);
      } catch (err) {
        console.error('Error in jsonModelEvents.onWrite:', err);
      }
    }
    return this._wrap(rawData);
  }

  async create(data) {
    await this._ensureConnected();

    if (Array.isArray(data)) {
      const mapped = data.map(item => {
        const withDefaults = this._applyDefaults(item);
        if (!withDefaults._id) withDefaults._id = withDefaults.id || crypto.randomUUID();
        return withDefaults;
      });
      const createdDocs = await this.mongooseModel.insertMany(mapped);
      return createdDocs.map(d => this._wrap(d));
    }

    const newData = this._applyDefaults(data);
    if (!newData._id) {
      newData._id = newData.id || crypto.randomUUID();
    }

    const created = await this.mongooseModel.create(newData);
    return this._wrap(created);
  }

  async find(query = {}) {
    await this._ensureConnected();
    const docs = await this.mongooseModel.find(query).lean();
    return docs.map(d => this._wrap(d));
  }

  async findOne(query = {}) {
    await this._ensureConnected();
    const doc = await this.mongooseModel.findOne(query).lean();
    return this._wrap(doc);
  }

  async findById(id) {
    return this.findOne(this._buildIdQuery(id));
  }

  async updateById(id, updateData) {
    await this._ensureConnected();
    const filter = this._buildIdQuery(id);
    const doc = await this.mongooseModel.findOneAndUpdate(
      filter,
      { $set: updateData },
      { returnDocument: 'after', upsert: false }
    ).lean();
    return this._wrap(doc);
  }

  async upsertById(id, data) {
    await this._ensureConnected();
    const existing = await this.findById(id);
    if (existing) {
      return this.updateById(id, data);
    } else {
      const recordData = { ...data };
      if (!recordData._id) recordData._id = id;
      if (!recordData.id) recordData.id = id;
      return this.create(recordData);
    }
  }

  async deleteById(id) {
    await this._ensureConnected();
    const filter = this._buildIdQuery(id);
    const res = await this.mongooseModel.deleteOne(filter);
    return { deletedCount: res.deletedCount };
  }

  async update(query, update, options = {}) {
    await this._ensureConnected();
    if (options.multi) {
      const res = await this.mongooseModel.updateMany(query, update, options);
      return { n: res.modifiedCount || res.matchedCount, ok: 1 };
    } else {
      const doc = await this.mongooseModel.findOneAndUpdate(query, update, {
        returnDocument: 'after',
        upsert: options.upsert,
        ...options
      }).lean();
      return this._wrap(doc);
    }
  }

  async findOneAndUpdate(query, update, options = {}) {
    return this.update(query, update, { ...options, multi: false });
  }

  async deleteOne(query) {
    await this._ensureConnected();
    const res = await this.mongooseModel.deleteOne(query);
    return { deletedCount: res.deletedCount };
  }

  async deleteMany(query) {
    await this._ensureConnected();
    const res = await this.mongooseModel.deleteMany(query);
    return { deletedCount: res.deletedCount };
  }
}
