(function(root, factory) {
    if(typeof define === 'function' && define.amd) {
        // AMD

        define(['underscore', 'backbone', 'react'], function(_, Backbone, React) {
            return factory(root, _, Backbone, React);
        });

    } else if(typeof exports !== 'undefined') {
        // for Node.js or CommonJS

        var _ = require('underscore'),
            Backbone = require('backbone'),
            React = require('react');
        module.exports = factory(root, _, Backbone, React);
    } else {
        // as a browser global

        root.Backbone.ReactMixin = factory(root, root._, root.Backbone, root.React);
    }

}(this, function(root, _, Backbone, React) {

    var mixin = {

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
                    prop.off("deepchange", this._handleDeepChange, this);
                }
            }
        },

        /**
         * Starts listening to the 'deepchange' event of the passed model or collection in the component's props
         * to keep the component updated
         */
        reactTo: function(modelOrCollection, key) {
            if(key && this.props[key]) {
                if(this.props[key] == modelOrCollection) {
                    return;
                } else {
                    modelOrCollection.off("deepchange", this._handleDeepChange, this);
                }
            }

            modelOrCollection.on("deepchange", this._handleDeepChange, this);
        },

        _handleDeepChange: function(changedModelOrCollection, opts) {
            if(this._owner) {
                // TODO store opts.setOriginId to be able to decide in shouldComponentUpdate whether to re-render

            } else {
                // at the root component, trigger update the component tree
                this.setProps(this.props);
            }
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