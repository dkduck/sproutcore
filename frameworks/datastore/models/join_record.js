sc_require('models/record');


SC.JoinRecord = SC.Record.extend({

    primaryKey: null,

    leftRecord: null,
    rightRecord: null,
    leftJoinKey: null,
    rightJoinKey: null,

    preferredRecord: 'leftRecord',

    joinType: null,

    leftStoreKey: function() {
        var leftRecord = this.get('leftRecord');
        return leftRecord ? leftRecord.get('storeKey') : null;
    }.property('leftRecord').cacheable(),

    rightStoreKey: function() {
        var rightRecord = this.get('rightRecord');
        return rightRecord ? rightRecord.get('storeKey') : null;
    }.property('rightRecord').cacheable(),

    _parentRecordsDidChange: function(sender, key) {
        this.get('store').dataHashDidChange(this.get('storeKey'), null, NO, key);
        if (this.parentRecordsDidChange) this.parentRecordsDidChange(sender, key);
    }.observes('*leftRecord.*', '*rightRecord.*'),

    unknownProperty: function(key, value) {
        var preferredRecord = this.get('preferredRecord'),
            primaryRecord = this.get(preferredRecord),
            secondaryRecord = this.get(preferredRecord === 'leftRecord' ? 'rightRecord' : 'leftRecord'),
            primaryValue = primaryRecord ? primaryRecord.get(key) : undefined,
            secondaryValue = secondaryRecord ? secondaryRecord.get(key) : undefined;

        if (value !== undefined) {
            if (primaryValue !== undefined) {
                primaryRecord.set(key, value);
            } else if (secondaryValue !== undefined) {
                secondaryRecord.set(key, value);
            }
        }
        return primaryValue !== undefined ? primaryValue : secondaryValue;
    },

    recordsMatch: function() {
        var leftKey = this.get('leftRecord').get(this.get('leftJoinKey')),
            rightKey = this.get('rightRecord').get(this.get('rightJoinKey'));

        if (leftKey === rightKey) return YES;
        if (!SC.none(leftKey) && SC.none(rightKey) && this.get('joinType') === SC.Query.JOIN_TYPE_LEFT) return YES;
        return NO;
    }

});