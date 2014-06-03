(function(root, factory) {
    // Set up Backbone appropriately for the environment. Start with AMD.
    if(typeof define === 'function' && define.amd) {
        define(['underscore', 'backbone', 'exports'], function(_, Backbone, exports) {
            // Export global even in AMD case in case this script is loaded with
            // others that may still expect a global Backbone.
            root.Backbone = factory(root, exports, _, Backbone);
        });

    // Next for Node.js or CommonJS.
    } else if(typeof exports !== 'undefined') {
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
    function resolveRelClass(cls) {
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

    // returns the ID reference attribute key for the given reference key
    // e.g.: "userId" for reference with key "user" with idAttribute "id",
    // "typeKey" for a reference "type" to a model with idAttribute "key",
    // "taskIds" for a reference "tasks" to a collection
    function refKeyToIdRefKey(references, key) {
        var capitalize = function(string) {
            return string.charAt(0).toUpperCase() + string.substring(1);
        };
        var modelClass = resolveRelClass(references[key]);
        var idAttribute = modelClass.prototype.idAttribute || "id";
        if(modelClass.prototype._representsToMany) {
            return key.replace(/s{0,1}$/, capitalize(idAttribute)+"s");
        } else {
            return key + capitalize(idAttribute);
        }
    }

    // Wraps the xhr success and error callbacks to hook in additional method invocation
    function wrapOptionsCallbacks(method, options) {
        options = options || {};
        var success = options.success;
        var error = options.error;
        options.success = function(resp) {
            method(options);
            if(success) success(resp);
        };
        options.error = function(resp) {
            method(options);
            if(error) error(resp);
        };
        return options;
    }


    var modelOptions = ['url', 'urlRoot', 'collection'];

    Backbone.RelModel = Backbone.Model.extend({
        references: {},
        embeddings: {},

        // Property to control whether an embedding shall be inlined in this model's JSON representation.
        // Useful when the embedding shall be saved to the server together with its parent.
        // If a key of an embedding is added as a string to this array, the result of #toJSON() will have
        // a property of that key, under which the embedded object's JSON representation is nested.
        inlineJSON: [],

        // Property to control whether referenced objects shall be fetched automcatically when set.
        // - `true` (default) will cause all referenced objects to be fetched automatically
        // - `false` will cause that referenced objects are never fetched automatically
        // - Setting an array of reference key strings, allows to explicitly specify which references
        // shall be auto-fetched.
        autoFetchRelated: true,

        constructor: function(attributes, options) {
            var attrs = attributes || {};

            this.cid = _.uniqueId('c');
            options || (options = {});
            this.attributes = {};
            _.extend(this, _.pick(options, modelOptions));

            this.relatedObjects = {};
            this._relatedObjectsToFetch = [];

            // handle default values for relations
            var defaults,
                references = this.references;
            if(options.parse) attrs = this.parse(attrs, options) || {};

            if(defaults = _.result(this, 'defaults')) {
                defaults = _.extend({}, defaults); // clone
                _.each(_.keys(references), function(refKey) {
                    // do not set default value for referenced object attribute
                    // if attrs contain a corresponding ID reference
                    if(refKeyToIdRefKey(references, refKey) in attrs && refKey in defaults) {
                        delete defaults[refKey];
                    }
                });
                attrs = _.defaults({}, attrs, defaults);
            }
            this.set(attrs, options);
            this.changed = {};

            this.initialize.apply(this, arguments);
        },

        url: function() {
            var base =
                _.result(this, 'urlRoot') ||
                _.result(this.collection, 'url');
            if(base) {
                if(this.isNew()) return base;
                return base.replace(/([^\/])$/, '$1/') + encodeURIComponent(this.id);
            } else if(this.parent) {
                base = _.result(this.parent, 'url');
                suffix = _.result(this, 'urlSuffix');
                if(base && suffix) {
                    return base.replace(/([^\/])$/, '$1/') + suffix.replace(/(\/?)(.*)/, '$2');
                }
            }

            throw new Error('Could not build url for the model');
        },

        urlSuffix: function() {
            var self = this,
                parent = this.parent;
            return parent && _.find(_.keys(parent.embeddings), function(key) {
                return parent.get(key) === self;
            });
        },

        get: function(attr) {
            if(this.embeddings[attr] || this.references[attr]) {
                // return related object if the key corresponds to a reference or embedding
                return this.relatedObjects[attr];
            } else {
                // otherwise return the regular attribute
                return Backbone.Model.prototype.get.apply(this, arguments);
            }
        },

        // Set a hash of model attributes and relations on the object, firing `"change"`. This is
        // the core primitive operation of a model, updating the data and notifying
        // anyone who needs to know about the change in state. The heart of the beast.
        set: function(key, val, options) {
            var attr, attrs, unset, changes, silent, changing, prev, current, referenceKey;
            if(key === null) return this;

            // Handle both `"key", value` and `{key: value}` -style arguments.
            if(typeof key === 'object') {
                attrs = key;
                options = val;
            } else {
                (attrs = {})[key] = val;
            }

            options || (options = {});

            // pass the setOriginId down to the nested set calls via options
            var nestedOptions = _.extend({ setOriginId: _.uniqueId() }, options);
            if(nestedOptions.collection) {
                delete nestedOptions.collection;
            }

            this._deepChangePropagatedFor = [];

            // Run validation.
            if(!this._validate(attrs, options)) return false;

            // Extract attributes and options.
            unset           = options.unset;
            silent          = options.silent;
            changes         = [];
            changing        = this._changing;
            this._changing  = true;

            if(!changing) {
                this._previousAttributes = _.clone(this.attributes);
                this._previousRelatedObjects = _.clone(this.relatedObjects);
                this.changed = {};
            }
            current = this.attributes, prev = this._previousAttributes;

            // Check for changes of `id`.
            if(this.idAttribute in attrs) this.id = attrs[this.idAttribute];

            // Here's some potential do some optimization if performance should become a concern:
            // precalculate the idRefKeys for all references and do a simple lookup
            var findReferenceKey = function(key) {
                var references = this.references;
                if(references[key]) return key;
                return _.find(_.keys(references), function(refKey) {
                    return refKeyToIdRefKey(references, refKey) == key;
                });
            }.bind(this);


            // For each `set` attribute, update or delete the current value.
            for (attr in attrs) {
                val = attrs[attr];

                if(this.embeddings[attr]) {

                    this._setEmbedding(attr, val, nestedOptions, changes);

                } else if(referenceKey = findReferenceKey(attr)) {

                    // side-loaded JSON structures take precedence over ID references
                    if(attr != referenceKey && attrs[referenceKey]) {
                        // is ID ref, but also side-loaded data is present in attrs
                        continue; // ignore attr
                    }
                    this._setReference(referenceKey, val, nestedOptions, changes);

                } else {

                    // default Backbone behavior for plain attribute set
                    if(!_.isEqual(current[attr], val)) changes.push(attr);
                    if(!_.isEqual(prev[attr], val)) {
                        this.changed[attr] = val;
                    } else {
                        delete this.changed[attr];
                    }
                    unset ? delete current[attr] : current[attr] = val;

                }
            }

            var currentAll = _.extend({}, current, this.relatedObjects);

            // Trigger all relevant attribute changes.
            if(!silent) {
                if(changes.length) this._pending = true;
                for (var i = 0, l = changes.length; i < l; i++) {
                    this.trigger('change:' + changes[i], this, currentAll[changes[i]], options);

                }
            }

            // You might be wondering why there's a `while` loop here. Changes can
            // be recursively nested within `"change"` events.
            if(changing) return this;
            if(!silent) {
                while (this._pending) {
                    this._pending = false;
                    this.trigger('change', this, options);
                }
            }
            this._pending = false;
            this._changing = false;

            // Trigger original 'deepchange' event, which will be propagated through the related object graph
            if(changes.length && !_.contains(this._deepChangePropagatedFor, nestedOptions.setOriginId)) {
                this._deepChangePropagatedFor.push(nestedOptions.setOriginId);
                this.trigger('deepchange', this, _.extend({ setOriginId: nestedOptions.setOriginId }, options));
            }

            // finally, fetch all related objects that need a fetch
            this._fetchRelatedObjects();

            return this;
        },

        _setEmbedding: function(key, value, options, changes) {

            var RelClass = resolveRelClass(this.embeddings[key]);
            var current = this.relatedObjects[key];

            if(value && value != current) {

                if(value instanceof Backbone.RelCollection || value instanceof Backbone.RelModel) {
                    // a model object is directly assigned
                    // set its parent
                    this.relatedObjects[key] = value;
                    this.relatedObjects[key].setParent(this, key);
                } else if(!this.relatedObjects[key]) {
                      // || (!_.isArray(value) && !this.relatedObjects[key].isNew() && this.relatedObjects[key].id !== value[this.relatedObjects[key].idAttribute])) {
                    // first assignment of an embedded model        //or assignment of an embedded model with a different ID
                    // create embedded model and set its parent
                    this.relatedObjects[key] = new RelClass(value, options);
                    this.relatedObjects[key].setParent(this, key);
                } else {
                    // update embedded model's attributes
                    this.relatedObjects[key].set(value, options);
                }

            } else {

                // set new embedded object or null/undefined
                this.relatedObjects[key] = value;
            }

            if(options.unset) {
                delete this.relatedObjects[key];
            }

            if(current != this.relatedObjects[key]) {
                changes.push(key);

                this._listenToRelatedObject(key, current);

                // unset current's parent property
                if(current) {
                    current.parent = null;
                }
            }
            if(this._previousRelatedObjects[key] != this.relatedObjects[key]) {
                this.changed[key] = this.relatedObjects[key];
            } else {
                delete this.changed[key];
            }
        },

        _setReference: function(key, value, options, changes) {
            var RelClass = resolveRelClass(this.references[key]),
                idRef = refKeyToIdRefKey(this.references, key);
            var current = this.relatedObjects[key],
                currentId = this.attributes[idRef];

            if(value) {
                if(RelClass.prototype._representsToOne) {
                    // handling to-one relation
                    this._setToOneReference(key, RelClass, value, options);
                    // make sure the ID ref is correctly set in the attributes
                    this.attributes[idRef] = this.relatedObjects[key].id;
                } else if(RelClass.prototype._representsToMany) {
                    // handling to-many relation
                    this._setToManyReference(key, RelClass, value, options);
                    // make sure the ID ref array is correctly set in the attributes
                    this.attributes[idRef] = this.relatedObjects[key].map(function(m) { return m.id; });
                }
            } else {
                // set undefined or null
                this.relatedObjects[key] = value;
                this.attributes[idRef] = value;
            }

            if(options.unset) {
                delete this.relatedObjects[key];
                delete this.attributes[idRef];
            }


            if(!_.isEqual(currentId, this.attributes[idRef])) {
                changes.push(idRef);
            }
            if(current != this.relatedObjects[key]) {
                changes.push(key);
                this._listenToRelatedObject(key, current);
            }

            if(this._previousRelatedObjects[key] != this.relatedObjects[key]) {
                this.changed[key] = this.relatedObjects[key];
            } else {
                delete this.changed[key];
            }
            if(!_.isEqual(this._previousAttributes[idRef], this.attributes[idRef])) {
                this.changed[idRef] = this.attributes[idRef];
            } else {
                delete this.changed[idRef];
            }

        },

        _setToOneReference: function(key, RelClass, value, options) {
            var relatedObject = this.relatedObjects[key];

            var id = value[RelClass.prototype.idAttribute||"id"] || value;

            // reset relatedObject if the ID reference changed
            if(relatedObject && relatedObject.id != id) {
                relatedObject = undefined;
            }

            if(value instanceof Backbone.RelModel) {
                // directly assign a model
                if(value===relatedObject) return;
                relatedObject = value;
                this.relatedObjects[key] = relatedObject;
                return;
            }

            if(value instanceof Object) {
                // if the related model data is side-loaded,
                // create/update the related model instance
                if(relatedObject) {
                    relatedObject.set(value, options);
                } else {
                    relatedObject = new RelClass(value, options);
                }

                relatedObject.isSynced = true;

                // remove side-loaded object from the models to fetch
                if(relatedObject != this)
                    this._relatedObjectsToFetch = _.without(this._relatedObjectsToFetch, relatedObject);
            } else {
                // if only an ID reference is provided,
                // instantiate the model
                if(!relatedObject) {
                    var attrs = {};
                    attrs[RelClass.prototype.idAttribute||"id"] = id;
                    relatedObject = new RelClass(attrs, options);

                    // auto-fetch related model if its url can be built
                    var autoFetch = this.autoFetchRelated === true ||
                        (_.isArray(this.autoFetchRelated) && _.contains(this.autoFetchRelated, key));
                    var url;
                    try { url = _.result(relatedObject, "url"); } catch(e) {}
                    if(autoFetch && url && !relatedObject.isSynced && !relatedObject.isSyncing && !_.contains(this._relatedObjectsToFetch, relatedObject)) {
                        this._relatedObjectsToFetch.push(relatedObject);
                    }
                }

            }

            this.relatedObjects[key] = relatedObject;
        },

        _setToManyReference: function(key, RelClass, value, options) {
            var ItemModel = RelClass.prototype.model;

            var relatedObject = this.relatedObjects[key];

            if(value instanceof Backbone.RelCollection) {
                // a collection model is directly assigned

                if(value===relatedObject) return;

                // teardown relation to old collection
                if(relatedObject) {
                    relatedObject.parent = undefined; // TODO get rid of this here!!!
                }

                // setup relation to the new collection
                relatedObject = value;
                relatedObject.parent = this; // TODO get rid of this here!!!
                this.relatedObjects[key] = relatedObject;
                return;
            }

            // expect an array of IDs or model json objects
            if(!_.isArray(value)) {
                throw new Error("Got an unexpected value to set reference '" + key + "'");
            }

            if(!relatedObject) {
                relatedObject = new RelClass([], {parent: this});
            }

            // iterate all related items and get/initialize/fetch the model objects
            var modelArray = _.map(value, function(itemData) {

                var id = itemData.id || itemData;

                // try to get the related model from the current relatedObject collection
                var item = relatedObject.get(id);

                if(itemData instanceof Backbone.Model) {
                    return itemData;
                }

                if(itemData instanceof Object) {
                    // if the related model data is sideloaded,
                    // create/update the related model instance
                    if(item) {
                        item.set(itemData, options);
                    } else {
                        item = new ItemModel(itemData);
                    }

                    item.isSynced = true;

                    // remove side-loaded object from the models to fetch
                    if(item != this) {
                        this._relatedObjectsToFetch = _.without(this._relatedObjectsToFetch, item);
                    }
                } else {
                    // if only an ID reference is provided
                    // and the relation could not be resolved to an already loaded model,
                    // instantiate the model
                    if(!item) {
                        var attrs = {};
                        attrs[ItemModel.prototype.idAttribute||"id"] = id;
                        item = new ItemModel(attrs, options);

                        // auto-fetch related model if its url can be built
                        var autoFetch = this.autoFetchRelated === true ||
                            (_.isArray(this.autoFetchRelated) && _.contains(this.autoFetchRelated, key));
                        var url;
                        try { url = _.result(item, "url"); } catch(e) {}
                        if(autoFetch && url && !item.isSynced && !item.isSyncing && !_.contains(this._relatedObjectsToFetch, item)) {
                            this._relatedObjectsToFetch.push(item);
                        }
                    }
                }

                return item;
            }, this);

            // important: do not merge into existing models as this might cause running into endless set loops for circular relations
            // merging of related model items' attributes is already done in the _.map() above
            relatedObject.set(modelArray, {merge:false});

            this.relatedObjects[key] = relatedObject;
        },

        _listenToRelatedObject: function(key, current) {
            // stop propagating 'deepchange' of current related object
            if(current) {
                this.stopListening(current, 'deepchange', this._propagateDeepChange);
                if(current._representsToOne) {
                    this.stopListening(current, 'destroy', this._relatedObjectDestroyHandler);
                }
            }

            // start propagating 'deepchange' of new related object
            if(this.relatedObjects[key]) {
                this.listenTo(this.relatedObjects[key], 'deepchange', this._propagateDeepChange);
                if(this.relatedObjects[key]._representsToOne) {
                    this.listenTo(this.relatedObjects[key], 'destroy', this._relatedObjectDestroyHandler);
                }
            }
        },

        // Sets the parent for an embedded object
        // If the optional keyInParent parameter is omitted, is is automatically detected
        setParent: function(parent, keyInParent) {
            var self = this;
            this.keyInParent = keyInParent || _.find(_.keys(parent.embeddings), function(key) {
                return parent.get(key) == self;
            });
            if(!this.keyInParent) {
                throw new Error("A key for the embedding in the parent must be specified as it could not be detected automatically.");
            }

            this.parent = parent;
            if(this.parent.get(this.keyInParent) !== this) {
                this.parent.set(this.keyInParent, this);
            }
        },

        toJSON: function() {
            var self = this;
            var json = Backbone.Model.prototype.toJSON.apply(this, arguments);
            _.each(this.inlineJSON, function(key) {
                var obj = self.get(key);
                if(obj && _.isFunction(obj.toJSON)) {
                    json[key] = obj.toJSON();
                }
            });
            return json;
        },

        fetch: function(options) {
            var result = Backbone.Collection.prototype.fetch.apply(this, arguments);
            var embeddingsKeys = _.keys(this.embeddings);
            for(var i=0; i<embeddingsKeys.length; i++) {
                var key = embeddingsKeys[i];
                var autoFetch = this.autoFetchRelated === true ||
                        (_.isArray(this.autoFetchRelated) && _.contains(this.autoFetchRelated, key));
                if(autoFetch) {
                    if(!this.get(key)) {
                        var RelClass = resolveRelClass(this.embeddings[key]);
                        this.set(key, new RelClass());
                    }
                    var relatedObject = this.get(key);
                    if(!relatedObject.isSyncing && !_.contains(this._relatedObjectsToFetch, relatedObject)) {
                        this._relatedObjectsToFetch.push(relatedObject);
                    }
                }
            }
            this._fetchRelatedObjects();
            return result;
        },

        sync: function(method, obj, options) {
            this._beforeSync();
            options = wrapOptionsCallbacks(this._afterSyncBeforeSet.bind(this), options);
            return Backbone.Model.prototype.sync.apply(this, arguments);
        },

        _beforeSync: function() {
            this.isSyncing = true;

            // make sure that "deepsync" is always triggered after "sync"
            this._relatedObjectsToFetch.push(this);
            var self = this;
            var syncCb = function() {
                self._relatedObjectFetchSuccessHandler(self);
                self.off("error", errorCb);
            };
            var errorCb = function() {
                self._relatedObjectsToFetch.splice(self._relatedObjectsToFetch.indexOf(self), 1);
                self.off("sync", syncCb);
            };
            this.once("sync", syncCb);
            this.once("error", errorCb);
        },

        _afterSyncBeforeSet: function() {
            this.isSynced = true;
            delete this.isSyncing;
        },

        _propagateDeepChange: function(changedModelOrCollection, opts) {
            // make sure that 'deepchange' is only triggered once, also when set operations are nested
            if(_.contains(this._deepChangePropagatedFor, opts.setOriginId)) {
                return;
            }
            this._deepChangePropagatedFor.push(opts.setOriginId);
            this.trigger('deepchange', changedModelOrCollection, opts);
        },

        _fetchRelatedObjects: function() {
            for (var i=0; i<this._relatedObjectsToFetch.length; i++) {
                var model = this._relatedObjectsToFetch[i];
                if(model==this) continue; // do not fetch again while setting

                 // test whether fetching has already been triggered by another relation
                if(model.isSyncing) {
                    model.once("sync", this._relatedObjectFetchSuccessHandler.bind(this, model));
                    continue;
                } else if(model.isSynced) {
                    this._relatedObjectFetchSuccessHandler(model);
                    continue;
                }

                model.fetch({
                    success: this._relatedObjectFetchSuccessHandler.bind(this),
                    error: this._relatedObjectFetchErrorHandler.bind(this)
                });
            }
        },

        // This callback is executed after every successful fetch of related objects after
        // these have been set as a reference auto-fetched as an embedding. It is responsible
        // for eventually triggering the 'deepsync' event.
        _relatedObjectFetchSuccessHandler: function(obj) {
            this._relatedObjectsToFetch.splice(this._relatedObjectsToFetch.indexOf(obj), 1);
            if(this._relatedObjectsToFetch.length === 0) {
                this.trigger("deepsync", this);
            }
        },

        // propagate errors when automatically fetching related models
        _relatedObjectFetchErrorHandler: function(obj, resp, options) {
            this._relatedObjectsToFetch.splice(this._relatedObjectsToFetch.indexOf(obj), 1);
            this.trigger('error', obj, resp, options);
        },

        // This callback ensures that relations are unset, when a related object is destroyed
        _relatedObjectDestroyHandler: function(destroyedObject) {
            _.each(this.relatedObjects, function(relObj, key) {
                if(relObj == destroyedObject) {
                    this.unset(key);
                }
            }, this);
        },

        _representsToOne: true

    });

    Backbone.RelCollection = Backbone.Collection.extend({

        constructor: function() {

            var triggerOriginalDeepChange = function(options) {
                // Trigger original 'deepchange' event, which will be propagated through the related object graph
                var originId = options.setOriginId || _.uniqueId();
                this._deepChangePropagatedFor.push(originId);
                this.trigger('deepchange', this, _.extend({ setOriginId: originId }, options));
            }.bind(this);

            this.on('add remove', function(model, collection, options) {
                triggerOriginalDeepChange(options);
            });
            this.on('reset', function(collection, options) {
                triggerOriginalDeepChange(options);
            });
            //this.on('sort', function(collection, options) {
            //    triggerOriginalDeepChange(options);
            //});

            return Backbone.Collection.prototype.constructor.apply(this, arguments);
        },

        url: function() {
            var base = _.result(this, 'urlRoot');
            if(base) {
                return base;
            } else if(this.parent) {
                base = _.result(this.parent, 'url');
                suffix = _.result(this, 'urlSuffix');
                if(base && suffix) {
                    return base.replace(/([^\/])$/, '$1/') + suffix.replace(/(\/?)(.*)/, '$2');
                }
            }

            throw new Error('Could not build url for the collection');
        },

        urlSuffix: function() {
            var self = this,
                parent = this.parent;
            return parent && _.find(_.keys(parent.embeddings), function(key) {
                return parent.get(key) === self;
            });
        },

        set: function() {
            this._deepChangePropagatedFor = [];
            return Backbone.Collection.prototype.set.apply(this, arguments);
        },

        // Sets the parent for an embedded collection
        // If the optional keyInParent parameter is omitted, is is automatically detected
        setParent: function(parent, keyInParent) {
            var self = this;
            this.keyInParent = keyInParent || _.find(_.keys(parent.embeddings), function(key) {
                return parent.get(key) == self;
            });
            if(!this.keyInParent) {
                throw new Error("A key for the embedding in the parent must be specified as it could not be detected automatically.");
            }

            this.parent = parent;
            if(this.parent.get(this.keyInParent) !== this) {
                this.parent.set(this.keyInParent, this);
            }
        },

        sync: function() {
            this._beforeSync();
            //options = wrapOptionsCallbacks(this._afterSetBeforeTrigger, options);
            return Backbone.Collection.prototype.sync.apply(this, arguments);
        },

        fetch: function(options) {
            options = wrapOptionsCallbacks(this._afterSetBeforeTrigger.bind(this), options);
            return Backbone.Collection.prototype.fetch.apply(this, [options]);
        },

        _beforeSync: function() {
            this.isSyncing = true;
        },

        _prepareModel: function(attrs, options) {
            // set isSynced flag on each item model
            // before the the "add" event is triggered
            var model = Backbone.Collection.prototype._prepareModel.apply(this, arguments);
            if(model && this.isSyncing) {
                model.isSynced = true;
            }
            return model;
        },

        _afterSetBeforeTrigger: function() {
            this.isSynced = true;
            delete this.isSyncing;
        },

        _representsToMany: true

    });

    _.extend(exports, Backbone);
    return Backbone;
}));
