(function(root, factory) {
    // Set up Backbone appropriately for the environment. Start with AMD.
    if (typeof define === 'function' && define.amd) {
        define(['underscore', 'backbone', 'exports'], function(_, Backbone, exports) {
            // Export global even in AMD case in case this script is loaded with
            // others that may still expect a global Backbone.
            root.Backbone = factory(root, exports, _, Backbone);
        });

    // Next for Node.js or CommonJS.
    } else if (typeof exports !== 'undefined') {
        var _ = require('underscore'),
            Backbone = require('backbone');

        factory(root, exports, _, Backbone);
    // Finally, as a browser global.
    } else {
        root.Backbone = factory(root, {}, root._, root.Backbone);
    }

}(this, function(root, exports, _, Backbone) {

    // Resolve the model/collection class that is specified for a relation.
    // Supports lazy resolution when passing in a function.
    function resolveRelationClass(cls) {
        if(_.isFunction(cls)) {
            if(cls.prototype._representsToOne || cls.prototype._representsToMany) {
                return cls;
            } else {
                var resolvedClass = cls();
                if(!resolvedClass.prototype._representsToOne && !resolvedClass.prototype._representsToMany) {
                    throw new Error("The model class for the relation could not be resolved. " +
                        "It must extend either Backbone.RelModel or Backbone.RelCollection.");
                }
                return resolvedClass;
            }
        } else {
            throw new Error("Cannot resolve relation class from " + cls);
        }
    }


    var modelOptions = ['url', 'urlRoot', 'collection'];

    Backbone.RelModel = Backbone.Model.extend({
        references: {},
        embeddings: {},

        constructor: function(attributes, options) {
            var attrs = attributes || {};
            this.cid = _.uniqueId('c');
            options || (options = {});
            this.attributes = {};
            _.extend(this, _.pick(options, modelOptions));

            this.relatedObjects = {};
            this._relatedObjectsToFetch = [];

            // handle default values for relations
            var defaults;
            if (options.parse) attrs = this.parse(attrs, options) || {};

            if (defaults = _.result(this, 'defaults')) {
                defaults = _.clone(defaults);
                _.each(this.relations, function(relDef) {
                    // do not set default value for related object attribute
                    // if attrs contain ID references for this relation
                    if (relDefToIdRef(relDef) in attrs && relDef.key in defaults) {
                        delete defaults[relDef.key];
                    }
                });
                attrs = _.defaults({}, attrs, defaults);
            }
            this.set(attrs, options);
            this.changed = {};

            this.initialize.apply(this, arguments);
        },



    });

    Backbone.RelCollection = Backbone.Collection.extend({


    });

    _.extend(exports, Backbone);
    return Backbone;
}));
