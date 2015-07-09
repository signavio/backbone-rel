(function(root, factory) {
    if(typeof define === 'function' && define.amd) {
        // AMD

        define(['underscore', 'backbone-rel', 'react'], function(_, Backbone, React) {
            return factory(root, _, Backbone, React);
        });

    } else if(typeof exports !== 'undefined') {
        // for Node.js or CommonJS

        var _ = require('underscore'),
            Backbone = require('backbone-rel'),
            React = require('react');
        module.exports = factory(root, _, Backbone, React);
    } else {
        // as a browser global

        root.Backbone.ReactMixin = factory(root, root._, root.Backbone, root.React);
    }

}(this, function(root, _, Backbone) {

    /**
     * Performs equality by iterating through keys on an object and returning
     * false when any key has values which are not strictly equal between
     * objA and objB. Returns true when the values of all keys are strictly equal.
     *
     * @return {boolean}
     */
    function shallowEqual(objA, objB) {
        if (objA === objB) {
            return true;
        }
        var key;
        // Test for A's keys different from B.
        for (key in objA) {
            if (objA.hasOwnProperty(key) &&
                    (!objB.hasOwnProperty(key) || objA[key] !== objB[key])) {
                return false;
            }
        }
        // Test for B'a keys missing from A.
        for (key in objB) {
            if (objB.hasOwnProperty(key) && !objA.hasOwnProperty(key)) {
                return false;
            }
        }
        return true;
    }


    var mixin = {

        _isBackboneBound: true,

        shouldComponentUpdate: function(nextProps, nextState) {
            if(this.shouldComponentUpdateOverride) {
                return this.shouldComponentUpdateOverride.apply(null, arguments);
            }

            return this._needsUpdate ||
                   !shallowEqual(this.props, nextProps) ||
                   !shallowEqual(this.state, nextState);
        },

        componentWillUpdate: function() {
            if(this._needsUpdate) {
                delete this._needsUpdate;
            }
        },

        componentDidMount: function() {
            this.initBackboneProps(this.props, true);
        },

        componentWillReceiveProps: function(nextProps) {
            this.initBackboneProps(nextProps);
        },

        initBackboneProps: function(props, initial) {
            var key,
                prop,
                keysForBackboneProps = [];

            // listen to Backbone models and collections in the props
            for(key in props) {
                prop = props[key];
                if(prop instanceof Backbone.Model || prop instanceof Backbone.Collection) {
                    keysForBackboneProps.push(key);
                    this.reactTo(prop, !initial && key);
                }
            }

            // stop listening to previous props that are not present anymore
            for(key in this.props) {
                if(_.contains(keysForBackboneProps, key)) return;
                prop = this.props[key];
                if(prop instanceof Backbone.Model || prop instanceof Backbone.Collection) {
                    this.stopReacting(prop);
                }
            }
        },

        componentWillUnmount: function() {
            // stop listening to all props
            for(key in this.props) {
                prop = this.props[key];
                if(prop instanceof Backbone.Model || prop instanceof Backbone.Collection) {
                    this.stopReacting(prop);
                }
            }
        },

        /**
         * Starts listening to the 'deepchange' event of the passed model or collection in the component's props
         * to keep the component updated
         */
        reactTo: function(modelOrCollection, key) {

            if(key && this.props[key]) {
                if(this.props[key] === modelOrCollection) {
                    return;
                } else {
                    this.stopReacting(modelOrCollection);
                }
            }

            modelOrCollection.on("deepchange", this._handleDeepChange, this);
            modelOrCollection.on("deepchange_propagated", this._handleDeepChangePropagated, this);
            modelOrCollection.on("forceUpdate", this._handleForceUpdate, this);
        },

        stopReacting: function(modelOrCollection) {
            modelOrCollection.off("deepchange", this._handleDeepChange, this);
            modelOrCollection.off("deepchange_propagated", this._handleDeepChangePropagated, this);
            modelOrCollection.off("forceUpdate", this._handleForceUpdate, this);
        },

        _handleDeepChange: function() {
            if(!this.isMounted()) return;
            this._needsUpdate = true;
        },

        _handleDeepChangePropagated: function () {
            if(!this.isMounted() || this.hasBackboneBoundOwner()) return;
            this.forceUpdate();
        },

        _handleForceUpdate: function () {
            if(!this.isMounted()) return;
            this.forceUpdate();
        },

        hasBackboneBoundOwner: function() {
            var owner = this._reactInternalInstance._currentElement._owner;
            return owner && owner._instance._isBackboneBound;
        },

        /**
         * Returns a ReactLink for updating the specified attr of the passed model (which should be in the component's props)
         * realizing a two-way data binding to Backbone models.
         */
        bindTo: function(model, key, getTransformFn, setTransformFn){
            getTransformFn = getTransformFn || _.identity;
            setTransformFn = setTransformFn || _.identity;
            return {
                value: getTransformFn(model.get(key)),
                requestChange: function(value){
                    model.set(key, setTransformFn(value));
                }.bind(this)
            };
        }

    };

    return mixin;


}));
