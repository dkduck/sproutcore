// ==========================================================================
// Project:   SproutCore - JavaScript Application Framework
// Copyright: ©2006-2011 Strobe Inc. and contributors.
//            Portions ©2008-2011 Apple Inc. All rights reserved.
// License:   Licensed under MIT license (see license.js)
// ==========================================================================

sc_require('models/record');

/**
  @class

  A `RecordArray` wraps an array of `storeKeys` and, optionally, a `Query`
  object. When you access the items of a `RecordArray`, it will automatically
  convert the `storeKeys` into actual `SC.Record` objects that the rest of
  your application can work with.

  Normally you do not create `RecordArray`s yourself.  Instead, a
  `RecordArray` is returned when you call `SC.Store.findAll()`, already
  properly configured. You can usually just work with the `RecordArray`
  instance just like any other array.

  The information below about `RecordArray` internals is only intended for
  those who need to override this class for some reason to do something
  special.

  Internal Notes
  ---

  Normally the `RecordArray` behavior is very simple.  Any array-like
  operations will be translated into similar calls onto the underlying array
  of `storeKeys`.  The underlying array can be a real array or it may be a
  `SparseArray`, which is how you implement incremental loading.

  If the `RecordArray` is created with an `SC.Query` object as well (and it
  almost always will have a `Query` object), then the `RecordArray` will also
  consult the query for various delegate operations such as determining if
  the record array should update automatically whenever records in the store
  changes. It will also ask the `Query` to refresh the `storeKeys` whenever
  records change in the store.

  If the `SC.Query` object has complex matching rules, it might be
  computationally heavy to match a large dataset to a query. To avoid the
  browser from ever showing a slow script timer in this scenario, the query
  matching is by default paced at 100ms. If query matching takes longer than
  100ms, it will chunk the work with setTimeout to avoid too much computation
  to happen in one runloop.


  @extends SC.Object
  @extends SC.Enumerable
  @extends SC.Array
  @since SproutCore 1.0
*/

SC.RecordArray = SC.Object.extend(SC.Enumerable, SC.Array,
  /** @scope SC.RecordArray.prototype */ {

  /**
    The store that owns this record array.  All record arrays must have a
    store to function properly.

    NOTE: You **MUST** set this property on the `RecordArray` when creating
    it or else it will fail.

    @type SC.Store
  */
  store: null,

  /**
    The `Query` object this record array is based upon.  All record arrays
    **MUST** have an associated query in order to function correctly.  You
    cannot change this property once it has been set.

    NOTE: You **MUST** set this property on the `RecordArray` when creating
    it or else it will fail.

    @type SC.Query
  */
  query: null,

  /**
   If YES the RecordArray will update itself when new changes come in from the store,
   if NO updating will not take place.
   Don't set this property directly but use the enable() and disable() methods.

   @property {Boolean}
   */
  enabled: YES,

  /**
   * Set of nested RecordArrays.
   * A RecordArray will automatically be registered as nestedRecordArray when created using
   * a scoped query (like query.from(...).and(...).without(...))
   * Only changes relevant to this RecordArray will be handed down to nested RecordArrays.
   *
   * @property {SC.Set}
   */
  nestedRecordArrays: null,

  /**
    The array of storeKeys as retrieved from the owner store.

    @type SC.Array
  */
  storeKeys: null,

  /**
    The current status for the record array.  Read from the underlying
    store.

    @type Number
  */
  status: SC.Record.EMPTY,

  /**
    The current editable state based on the query. If this record array is not
    backed by an SC.Query, it is assumed to be editable.

    @property
    @type Boolean
  */
  isEditable: function() {
    var query = this.get('query');
    return query ? query.get('isEditable') : YES;
  }.property('query').cacheable(),

  // ..........................................................
  // ARRAY PRIMITIVES
  //

  /** @private
    Returned length is a pass-through to the `storeKeys` array.
		@property
  */
  length: function() {
    this.flush(); // cleanup pending changes
    var storeKeys = this.get('storeKeys');
    return storeKeys ? storeKeys.get('length') : 0;
  }.property('storeKeys').cacheable(),

  /** @private
    A cache of materialized records. The first time an instance of SC.Record is
    created for a store key at a given index, it will be saved to this array.

    Whenever the `storeKeys` property is reset, this cache is also reset.

    @type Array
  */
  _scra_records: null,

  /** @private
    Looks up the store key in the `storeKeys array and materializes a
    records.

    @param {Number} idx index of the object
    @return {SC.Record} materialized record
  */
  objectAt: function(idx) {

    this.flush(); // cleanup pending if needed

    var recs      = this._scra_records,
        storeKeys = this.get('storeKeys'),
        store     = this.get('store'),
        storeKey, ret ;

    if (!storeKeys || !store) return undefined; // nothing to do
    if (recs && (ret=recs[idx])) return ret ; // cached

    // not in cache, materialize
    if (!recs) this._scra_records = recs = [] ; // create cache
    storeKey = storeKeys.objectAt(idx);

    if (storeKey) {
      // if record is not loaded already, then ask the data source to
      // retrieve it
      if (store.peekStatus(storeKey) === SC.Record.EMPTY) {
        store.retrieveRecord(null, null, storeKey);
      }
      recs[idx] = ret = store.materializeRecord(storeKey);
    }
    return ret ;
  },

  /** @private - optimized forEach loop. */
  forEach: function(callback, target) {
    this.flush();

    var recs      = this._scra_records,
        storeKeys = this.get('storeKeys'),
        store     = this.get('store'),
        len       = storeKeys ? storeKeys.get('length') : 0,
        idx, storeKey, rec;

    if (!storeKeys || !store) return this; // nothing to do
    if (!recs) recs = this._scra_records = [] ;
    if (!target) target = this;

    for(idx=0;idx<len;idx++) {
      rec = recs[idx];
      if (!rec) {
        rec = recs[idx] = store.materializeRecord(storeKeys.objectAt(idx));
      }
      callback.call(target, rec, idx, this);
    }

    return this;
  },

  /** @private
    Replaces a range of records starting at a given index with the replacement
    records provided. The objects to be inserted must be instances of SC.Record
    and must have a store key assigned to them.

    Note that most SC.RecordArrays are *not* editable via `replace()`, since they
    are generated by a rule-based SC.Query. You can check the `isEditable` property
    before attempting to modify a record array.

    @param {Number} idx start index
    @param {Number} amt count of records to remove
    @param {SC.RecordArray} recs the records that should replace the removed records

    @returns {SC.RecordArray} receiver, after mutation has occurred
  */
  replace: function(idx, amt, recs) {

    this.flush(); // cleanup pending if needed

    var storeKeys = this.get('storeKeys'),
        len       = recs ? (recs.get ? recs.get('length') : recs.length) : 0,
        i, keys;

    if (!storeKeys) throw "Unable to edit an SC.RecordArray that does not have its storeKeys property set.";

    if (!this.get('isEditable')) throw SC.RecordArray.NOT_EDITABLE;

    // map to store keys
    keys = [] ;
    for(i=0;i<len;i++) keys[i] = recs.objectAt(i).get('storeKey');

    // pass along - if allowed, this should trigger the content observer
    storeKeys.replace(idx, amt, keys);
    return this;
  },

  /**
    Returns YES if the passed can be found in the record array.  This is
    provided for compatibility with SC.Set.

    @param {SC.Record} record
    @returns {Boolean}
  */
  contains: function(record) {
    return this.indexOf(record)>=0;
  },

  /** @private
    Returns the first index where the specified record is found.

    @param {SC.Record} record
    @param {Number} startAt optional starting index
    @returns {Number} index
  */
  indexOf: function(record, startAt) {
    if (!SC.kindOf(record, SC.Record)) {
      SC.Logger.warn("Using indexOf on %@ with an object that is not an SC.Record".fmt(record));
      return -1; // only takes records
    }

    this.flush();

    var storeKey  = record.get('storeKey'),
        storeKeys = this.get('storeKeys');

    return storeKeys ? storeKeys.indexOf(storeKey, startAt) : -1;
  },

  /** @private
    Returns the last index where the specified record is found.

    @param {SC.Record} record
    @param {Number} startAt optional starting index
    @returns {Number} index
  */
  lastIndexOf: function(record, startAt) {
    if (!SC.kindOf(record, SC.Record)) {
      SC.Logger.warn("Using lastIndexOf on %@ with an object that is not an SC.Record".fmt(record));
      return -1; // only takes records
    }

    this.flush();

    var storeKey  = record.get('storeKey'),
        storeKeys = this.get('storeKeys');
    return storeKeys ? storeKeys.lastIndexOf(storeKey, startAt) : -1;
  },

  /**
    Adds the specified record to the record array if it is not already part
    of the array.  Provided for compatibilty with `SC.Set`.

    @param {SC.Record} record
    @returns {SC.RecordArray} receiver
  */
  add: function(record) {
    if (!SC.kindOf(record, SC.Record)) return this ;
    if (this.indexOf(record)<0) this.pushObject(record);
    return this ;
  },

  /**
    Removes the specified record from the array if it is not already a part
    of the array.  Provided for compatibility with `SC.Set`.

    @param {SC.Record} record
    @returns {SC.RecordArray} receiver
  */
  remove: function(record) {
    if (!SC.kindOf(record, SC.Record)) return this ;
    this.removeObject(record);
    return this ;
  },

  // ..........................................................
  // HELPER METHODS
  //

  /**
    Extends the standard SC.Enumerable implementation to return results based
    on a Query if you pass it in.

    @param {SC.Query} query a SC.Query object
		@param {Object} target the target object to use

    @returns {SC.RecordArray}
  */
  find: function(original, query, target) {
    if (query && query.isQuery) {
      return this.get('store').find(query.from(this));
    } else return original.apply(this, SC.$A(arguments).slice(1));
  }.enhance(),

  /**
    Call whenever you want to refresh the results of this query.  This will
    notify the data source, asking it to refresh the contents.

    @returns {SC.RecordArray} receiver
  */
  refresh: function() {
    this.get('store').refreshQuery(this.get('query'));
    return this;
  },

  /**
    Will recompute the results based on the `SC.Query` attached to the record
    array. Useful if your query is based on computed properties that might
    have changed. Use `refresh()` instead of you want to trigger a fetch on
    your data source since this will purely look at records already loaded
    into the store.

    @returns {SC.RecordArray} receiver
  */
  reload: function() {
    this.flush(YES);
    return this;
  },

  /**
    Destroys the record array and all nested RecordArrays. Releases any storeKeys, deregisters with
    the owner store and the parent RecordArrays.

    @returns {SC.RecordArray} receiver
  */
  destroy: function() {
    if (!this.get('isDestroyed')) {
      var parents = this.getPath('query.scope'),
          nestedRecordArrays = this.get('nestedRecordArrays'),
          storeKeys = this.get('storeKeys'),
          len = storeKeys ? storeKeys.get('length') : 0;

      if (parents) parents.forEach(function(scopeItem) {
        scopeItem.source.recordArrayWillDestroy(this);
      }, this);
      if (nestedRecordArrays) nestedRecordArrays.invoke('destroy');
      this.get('store').recordArrayWillDestroy(this);
      if (this._scra_records) this._scra_records.length = 0;
      if (storeKeys) {
          storeKeys.removeArrayObservers({
              target: this,
              willChange: this.arrayContentWillChange,
              didChange: this._storeKeysContentDidChange
          }),
          this.arrayContentWillChange(0, len, 0);
          this.arrayContentDidChange(0, len, 0);
      }
    }
    return sc_super();
  },

  /**
    Called by nested RecordArrays to inform the parent RecordArray of the destroy

    @returns {SC.RecordArray} receiver
  */
  recordArrayWillDestroy: function(recordArray) {
    var nestedRecordArrays = this.get('nestedRecordArrays');
    if (nestedRecordArrays) nestedRecordArrays.remove(recordArray);
    return this;
  },

  /**
    Enables RecordArray flushing.
    Flushes pending changes immediately, if the RecordArray was in a disabled state before.

    @returns {SC.RecordArray} receiver
  */
  enable: function() {
    if (this.get('enabled')) return this;
    this.set('enabled', YES);
    this.flushFromLeafs();
    return this;
  },

  /**
    Disables RecordArray flushing.

    @returns {SC.RecordArray} receiver
  */
  disable: function() {
    this.set('enabled', NO);
    return this;
  },

  // ..........................................................
  // STORE CALLBACKS
  //

  // **NOTE**: `storeWillFetchQuery()`, `storeDidFetchQuery()`,
  // `storeDidCancelQuery()`, and `storeDidErrorQuery()` are tested implicitly
  // through the related methods in `SC.Store`.  We're doing it this way
  // because eventually this particular implementation is likely to change;
  // moving some or all of this code directly into the store. -CAJ

  /** @private
    Called whenever the store initiates a refresh of the query.  Sets the
    status of the record array to the appropriate status.

    @param {SC.Query} query
    @returns {SC.RecordArray} receiver
  */
  storeWillFetchQuery: function(query) {
    var status = this.get('status'),
        K      = SC.Record;
    if ((status === K.EMPTY) || (status === K.ERROR)) status = K.BUSY_LOADING;
    if (status & K.READY) status = K.BUSY_REFRESH;
    this.setIfChanged('status', status);
    return this ;
  },

  /** @private
    Called whenever the store has finished fetching a query.

    @param {SC.Query} query
    @returns {SC.RecordArray} receiver
  */
  storeDidFetchQuery: function(query) {
    this.setIfChanged('status', SC.Record.READY_CLEAN);
    return this ;
  },

  /** @private
    Called whenever the store has cancelled a refresh.  Sets the
    status of the record array to the appropriate status.

    @param {SC.Query} query
    @returns {SC.RecordArray} receiver
  */
  storeDidCancelQuery: function(query) {
    var status = this.get('status'),
        K      = SC.Record;
    if (status === K.BUSY_LOADING) status = K.EMPTY;
    else if (status === K.BUSY_REFRESH) status = K.READY_CLEAN;
    this.setIfChanged('status', status);
    return this ;
  },

  /** @private
    Called whenever the store encounters an error while fetching.  Sets the
    status of the record array to the appropriate status.

    @param {SC.Query} query
    @returns {SC.RecordArray} receiver
  */
  storeDidErrorQuery: function(query) {
    this.setIfChanged('status', SC.Record.ERROR);
    return this ;
  },

  /** @private
    Called by the store whenever it changes the state of certain store keys.
    If the receiver cares about these changes, it will mark itself as dirty and notify
    all nested RecordArrays about this.

    The next time you try to access the record array, it will call `flush()` and
    add the changed keys to the underlying `storeKeys` array if the new records
    match the conditions of the record array's query.

    @param {SC.Array} storeKeys the effected store keys
    @param {SC.Set} recordTypes the record types for the storeKeys.
    @returns {SC.RecordArray} receiver
  */
  storeDidChangeStoreKeys: function(storeKeys, recordTypes) {
    var query =  this.get('query'),
        storeGuid = SC.guidFor(this.get('store'));
    // fast path exits
    if (query.get('location') !== SC.Query.LOCAL) return this;
    if (!query.containsRecordTypes(recordTypes)) return this;
    if (storeKeys.get('length') === 0) return this;

    // ok - we're interested.  mark as dirty and save storeKeys.
    if (!this._scra_changedStoreKeys) this._scra_changedStoreKeys = {};
    var changed = this._scra_changedStoreKeys[storeGuid];
    if (!changed) changed = this._scra_changedStoreKeys[storeGuid] = {
        added: SC.Set.create(),
        deleted: SC.Set.create(),
        updated: SC.Set.create()
    };
    changed.updated.addEach(storeKeys);

    this.parentDidBecomeDirty();
    return this;
  },

  /** @private
    Called by the parent RecordArrays or the store (via storeDidChangeStoreKeys) whenever they become dirty.

    @returns {SC.RecordArray} receiver
  */
  parentDidBecomeDirty: function() {
    var nestedRecordArrays = this.get('nestedRecordArrays');

    this.set('needsFlush', YES);
    // recursively notify all nested RecordArrays too
    if (nestedRecordArrays) nestedRecordArrays.invoke('parentDidBecomeDirty');
    return this;
  },


  /** @private
    Called by the store to register newly created RecordArrays with their parent RecordArrays
    if the query is scoped.

    @returns {SC.RecordArray} receiver
   */
  registerWithParents: function() {
    this.getPath('query.scope').forEach(function(scopeItem) {
      scopeItem.source.registerNestedRecordArray(this);
    }, this);
    return this;
  },

  /** @private
    Called by registerWithParents() to register a RecordArray as nested RecordArray with its parent.

    @param {SC.RecordArray} The RecordArray to register as child with this RecordArray
    @returns {SC.RecordArray} receiver
   */
  registerNestedRecordArray: function(child) {
    var nestedRecordArrays = this.get('nestedRecordArrays');

    if (!nestedRecordArrays) this.set('nestedRecordArrays', nestedRecordArrays = SC.Set.create());
    nestedRecordArrays.add(child);
    return this;
  },

  /** @private
    Called by the parent RecordArray to inform the nested RecordArrays of relevant changes.

    @param {Array} storeKeys that changed in the parent RecordArray
    @returns {SC.RecordArray} receiver
  */
  parentDidChangeStoreKeys: function(added, deleted, updated, parent) {
    var parentGuid = SC.guidFor(parent),
        changed;

    if (added.get('length') + deleted.get('length') + updated.get('length') === 0) return this;
    if (!this._scra_changedStoreKeys) this._scra_changedStoreKeys = {};
    changed = this._scra_changedStoreKeys[parentGuid];
    if (!changed) changed = this._scra_changedStoreKeys[parentGuid] = {
      added: SC.Set.create(),
      deleted: SC.Set.create(),
      updated: SC.Set.create()
    };
    changed.added.addEach(added);
    changed.deleted.addEach(deleted);
    changed.updated.addEach(updated);
    return this;
  },

  /** @private
    Called by the store to flush the RecordArrays after they have be informed about changes in the store.
    flush() is only called on the leafs of the query tree because flush() takes care itself of flushing the
    parents.

    @param {Array} storeKeys that changed in the parent RecordArray
    @returns {SC.RecordArray} receiver
  */
  flushFromLeafs: function() {
    var nestedRecordArrays = this.get('nestedRecordArrays');

    if (nestedRecordArrays) {
      nestedRecordArrays.invoke('flushFromLeafs');
    } else {
      this.flush();
    }
    return this;
  },

  /**
    Applies the query to any pending changed store keys, updating the record
    array contents as necessary.  This method is called automatically anytime
    you access the RecordArray to make sure it is up to date, but you can
    call it yourself as well if you need to force the record array to fully
    update immediately.

    Currently this method only has an effect if the query location is
    `SC.Query.LOCAL`.  You can call this method on any `RecordArray` however,
    without an error.

    @param {Boolean} _flush to force it - use reload() to trigger it
    @returns {SC.RecordArray} receiver
  */
  flush: function(_flush) {
      var query,
          store,
          parents,
          storeKeys,
          queryResult,
          newStoreKeys;

      if (!this.get('needsFlush') && !_flush) return this;
      if (!this.get('enabled')) return this;

      if (this._insideFlush) {
//          this.set('needsFlush', YES);
          return this;
      }

      this.set('needsFlush', NO);

      query = this.get('query'),
      store = this.get('store');
      if (!store || !query || query.get('location') !== SC.Query.LOCAL) return this;

      this._insideFlush = YES;
SC.Benchmark.start('SC.RecordArray#flush');
//if (this.query.recordType === CorePanda.ScanInstance) debugger;
      // if this is a nested RecordArray we have to make sure that all parent RecordArrays are flushed
      // before we flush ourselves, so that changes have a chance to bubble up
      parents = this.getPath('query.scope');
      if (parents) parents.forEach(function(scopeItem) {
          scopeItem.source.flush();
      }, this);

      if (this._scra_changedStoreKeys || !this._flushed) {

          this._flushed = YES;

          storeKeys = this.get('storeKeys');

          queryResult = query.merge(_flush ? null : storeKeys, this._scra_changedStoreKeys, this);
          this._scra_changedStoreKeys = null;
          newStoreKeys = queryResult.storeKeys;

          var differenceSet = this._findDifferences(storeKeys, newStoreKeys);
          if (differenceSet) {
SC.Benchmark.start('SC.RecordArray#flush-notify');
              // replace content without triggering the observer, because we do the change notification ourselves here
              this.storeKeys = newStoreKeys;
              this._notifyStoreKeyChanges(storeKeys, newStoreKeys, differenceSet);
SC.Benchmark.end('SC.RecordArray#flush-notify');
          }

          // notify all nested RecordArrays of the changes considered relevant to this RecordArray
          var nestedRecordArrays = this.get('nestedRecordArrays');
          if (nestedRecordArrays) nestedRecordArrays.invoke('parentDidChangeStoreKeys', queryResult.added, queryResult.deleted, queryResult.updated, this);

      }
SC.Benchmark.end('SC.RecordArray#flush');

      this._insideFlush = NO;
      return this;
  },

  /**
    Finds index range where the two storeKey arrays deviate from each other.
    Returns null if they are identical.

    @param {SC.Array} old store keys
    @param {SC.Array} new store keys
    @returns {SC.IndexSet} Changed index range or null if identical
  */
  _findDifferences: function(oldStoreKeys, storeKeys) {
      if (oldStoreKeys === storeKeys) {
          return null;
      } else if (!oldStoreKeys) {
          if (!storeKeys || !storeKeys.length) return null;
          return SC.IndexSet.create(0, storeKeys.length);
      }
      var oldLen = oldStoreKeys.length,
          newLen = storeKeys.length,
          maxLen = oldLen > newLen ? oldLen : newLen,
          startIdx = 0,
          endIdx = newLen - 1;

      while (oldStoreKeys[startIdx] == storeKeys[startIdx] && startIdx < newLen) {
          startIdx += 1;
      }
      while (oldStoreKeys[endIdx] == storeKeys[endIdx] && endIdx > startIdx) {
          endIdx -= 1;
      }
      if (startIdx < maxLen) return SC.IndexSet.create(startIdx, endIdx >= startIdx ? endIdx - startIdx + 1 : maxLen - startIdx);
      return null;
  },

  /**
    Clears the cache for the changed portion of the record array and calls
    enumerableContentDidChange() with the changed range.

    @param {SC.Array} old store keys
    @param {SC.Array} new store keys
    @param {SC.IndexSet} Changed indexes in the store key array
  */
  _notifyStoreKeyChanges: function(oldStoreKeys, storeKeys, differenceSet) {
    var newLen = storeKeys.length,
        oldLen = oldStoreKeys ? oldStoreKeys.length : 0,
        firstDifference = differenceSet.get('min'),
        recordCache = this._scra_records;

    if (recordCache) {
      differenceSet.forEach(function(index) {
        recordCache[index] = null;
      });
      recordCache.length = newLen;
    }
    this.arrayContentDidChange(firstDifference, oldLen - firstDifference, newLen - firstDifference);
  },


  /**
    Set to YES when the query is dirty and needs to update its storeKeys
    before returning any results.  `RecordArray`s always start dirty and become
    clean the first time you try to access their contents.

    @type Boolean
  */
  needsFlush: YES,

  // ..........................................................
  // EMULATE SC.ERROR API
  //

  /**
    Returns `YES` whenever the status is `SC.Record.ERROR`.  This will allow
    you to put the UI into an error state.

		@property
    @type Boolean
  */
  isError: function() {
    return !!(this.get('status') & SC.Record.ERROR);
  }.property('status').cacheable(),

  /**
    Returns the receiver if the record array is in an error state.  Returns
    `null` otherwise.

		@property
    @type SC.Record
  */
  errorValue: function() {
    return this.get('isError') ? SC.val(this.get('errorObject')) : null ;
  }.property('isError').cacheable(),

  /**
    Returns the current error object only if the record array is in an error
    state. If no explicit error object has been set, returns
    `SC.Record.GENERIC_ERROR.`

		@property
    @type SC.Error
  */
  errorObject: function() {
    if (this.get('isError')) {
      var store = this.get('store');
      return store.readQueryError(this.get('query')) || SC.Record.GENERIC_ERROR;
    } else return null ;
  }.property('isError').cacheable(),

  // ..........................................................
  // INTERNAL SUPPORT
  //

  propertyWillChange: function(key) {
    if (key === 'storeKeys') {
      var storeKeys = this.get('storeKeys');
      var len = storeKeys ? storeKeys.get('length') : 0;

      this.arrayContentWillChange(0, len, 0);
    }

    return sc_super();
  },

  /** @private
    Invoked whenever the `storeKeys` array changes.  Observes changes.
  */
  _storeKeysDidChange: function() {
    var storeKeys = this.get('storeKeys');

    var prev = this._prevStoreKeys, oldLen, newLen;

    if (storeKeys === prev) { return; } // nothing to do

    if (prev) {
      prev.removeArrayObservers({
        target: this,
        willChange: this.arrayContentWillChange,
        didChange: this._storeKeysContentDidChange
      });

      oldLen = prev.get('length');
    } else {
      oldLen = 0;
    }

    this._prevStoreKeys = storeKeys;
    if (storeKeys) {
      storeKeys.addArrayObservers({
        target: this,
        willChange: this.arrayContentWillChange,
        didChange: this._storeKeysContentDidChange
      });

      newLen = storeKeys.get('length');
    } else {
      newLen = 0;
    }

    this._storeKeysContentDidChange(0, oldLen, newLen);

  }.observes('storeKeys'),

  /** @private
    If anyone adds an array observer on to the record array, make sure
    we flush so that the observers don't fire the first time length is
    calculated.
  */
  addArrayObservers: function() {
    this.flush();
    return SC.Array.addArrayObservers.apply(this, arguments);
  },

  /** @private
    Invoked whenever the content of the `storeKeys` array changes.  This will
    dump any cached record lookup and then notify that the enumerable content
    has changed.
  */
  _storeKeysContentDidChange: function(start, removedCount, addedCount) {
    if (this._scra_records) this._scra_records.length=0 ; // clear cache

    this.arrayContentDidChange(start, removedCount, addedCount);
  },

  /** @private */
  init: function() {
    sc_super();
    if (this.getPath('query.location') == SC.Query.REMOTE) this._storeKeysDidChange();
  }

});

SC.RecordArray.mixin(/** @scope SC.RecordArray.prototype */{

  /**
    Standard error throw when you try to modify a record that is not editable

    @type SC.Error
  */
  NOT_EDITABLE: SC.Error.desc("SC.RecordArray is not editable"),
});
