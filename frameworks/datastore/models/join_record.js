sc_require('models/record');


SC.JoinRecord = SC.Record.extend({

    primaryKey: null,

    leftRecord: null,
    rightRecord: null,
    leftJoinKey: null,
    rightJoinKey: null,

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
    }.observes('*leftRecord.*', '*rightRecord.*'),

    unknownProperty: function(key, value) {
        var leftRecord = this.get('leftRecord'),
            rightRecord = this.get('rightRecord'),
            leftValue = leftRecord ? leftRecord.get(key) : undefined,
            rightValue = rightRecord ? rightRecord.get(key) : undefined;

        if (value !== undefined) {
            if (leftValue !== undefined) {
                leftRecord.set(key, value);
            } else if (rightValue !== undefined) {
                rightRecord.set(key, value);
            }
        }
        return leftValue !== undefined ? leftValue : rightValue;
    },

    recordsMatch: function() {
        var leftKey = this.get('leftRecord').get(this.get('leftJoinKey')),
            rightKey = this.get('rightRecord').get(this.get('rightJoinKey'));

        if (leftKey === rightKey) return YES;
        if (!SC.none(leftKey) && SC.none(rightKey) && this.get('joinType') === SC.Query.JOIN_TYPE_LEFT) return YES;
        return NO;
    }

});