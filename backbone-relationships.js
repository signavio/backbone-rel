(function(root, factory) {
    if(typeof define === 'function' && define.amd) {
        // AMD

        define(['underscore', 'backbone', 'exports'], function(_, Backbone, exports) {
            // Export global even in AMD case in case this script is loaded with
            // others that may still expect a global Backbone.
            root.Backbone = factory(root, exports, _, Backbone);
        });

    } else if(typeof exports !== 'undefined') {
        // for Node.js or CommonJS

        var _ = require('underscore'),
            Backbone = require('backbone');

        factory(root, exports, _, Backbone);
    } else {
        // as a browser global

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

        // Property to control whether a related object shall be inlined in this model's JSON representation.
        // Useful when the related object shall be saved to the server together with its parent/referencing object.
        // If a relationship key is added as a string to this array, the result of #toJSON() will have
        // a property of that key, under which the related object's JSON representation is nested.
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

            this._updateIdRefFor = {};

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

            if(!this.isNew()) {
                this._autoFetchEmbeddings(true);
            }

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
                if(this.parent.isNew() && !this.parent.parent) {
                    throw new Error("Could not get the parent model's URL as it has not been saved yet.");
                }
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

            // Precalculate the idRefKeys for all references to improve performance of the lookups
            var refKeys = _.keys(this.references);
            var refAndIdRefKeys = {};
            for(var i=0; i<refKeys.length; i++) {
                refAndIdRefKeys[refKeys[i]] = refKeys[i];
                refAndIdRefKeys[refKeyToIdRefKey(this.references, refKeys[i])] = refKeys[i];
            }

            var findReferenceKey = function(key) {
                return refAndIdRefKeys[key];
            };

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
                this.trigger('deepchange_propagated', this, _.extend({ setOriginId: nestedOptions.setOriginId }, options));
            }

            // finally, fetch all related objects that need a fetch
            this._fetchRelatedObjects();

            return this;
        },

        _setEmbedding: function(key, value, options, changes) {

            var RelClass = resolveRelClass(this.embeddings[key]);
            var current = this.relatedObjects[key];

            if(value && value != current) {

                if(value._representsToMany || value._representsToOne) {
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

            if(value!==undefined && value!==null) {
                if(RelClass.prototype._representsToOne) {
                    // handling to-one relation
                    this._setToOneReference(key, RelClass, value, options);
                } else if(RelClass.prototype._representsToMany) {
                    // handling to-many relation
                    this._setToManyReference(key, RelClass, value, options);
                }
                this._ensureIdReference(idRef, key);
            } else {
                // set `undefined` or `null`
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

        _ensureIdReference: function(idRef, refKey) {
            var relatedObject = this.relatedObjects[refKey];

            if(relatedObject._representsToOne) {
                // if the relatedObject is new, i.e., it doesn't have an ID yet
                // we need to update the reference as soon as the referenced objects
                // got assigned an ID

                if(relatedObject.isNew()) {
                    if(this.attributes[idRef]) {
                        delete this.attributes[idRef];
                    }
                    relatedObject.once("change:" + (relatedObject.idAttribute||"id"), function() {
                        this.set(idRef, relatedObject.id);
                    }, this);
                } else {
                    this.attributes[idRef] = relatedObject.id;
                }

            } else {

                // if any one of the referenced objects is new,
                // we need to update the ID ref array as soon as that item
                // got assigned an ID
                var atLeastOneItemIsNew = false,
                    idAttr;
                this.attributes[idRef] = _.compact(relatedObject.map(function(m) {
                    if(m.isNew()) {
                        atLeastOneItemIsNew = true;
                        idAttr = m.idAttribute || "id";
                        return undefined;
                    } else {
                        return m.id;
                    }
                }));
                if(atLeastOneItemIsNew) {
                    relatedObject.once("change:" + idAttr, this._ensureIdReference.bind(this, idRef, refKey));
                }
            }
        },

        _setToOneReference: function(key, RelClass, value, options) {
            var relatedObject = this.relatedObjects[key];

            var id = value[RelClass.prototype.idAttribute||"id"] || value;

            // reset relatedObject if the ID reference changed
            if(relatedObject && relatedObject[relatedObject.idAttribute||"id"] && relatedObject.id != id) {
                relatedObject = undefined;
            }

            if(value._representsToOne) {
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
                    try {
                        url = _.result(relatedObject, "url");
                    } catch(e) {
                        if(autoFetch && console && _.isFunction(console.warn)) {
                            console.warn("Could not build url to auto-fetch referenced model for key '" + key +"'", e.stack);
                        }
                    }
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

            if(value._representsToMany) {
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
                        try {
                            url = _.result(item, "url");
                        } catch(e) {
                            if(autoFetch && console && _.isFunction(console.warn)) {
                                console.warn("Could not build url to auto-fetch referenced model for key '" + key + "'", e);
                            }
                        }
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

            if(current) {
                // stop propagating 'deepchange' of current related object
                this.stopListening(current, 'deepchange', this._propagateDeepChange);
                // stop listening to destroy and ID change events
                if(current._representsToOne) {
                    this.stopListening(current, 'destroy', this._relatedObjectDestroyHandler);
                    this.stopListening(current, 'change:' + (current.idAttribute || "id"), this._updateIdRefFor[key]);
                } else {
                    this.stopListening(current, 'add remove reset change:' + (current.idAttribute || "id"), this._updateIdRefFor[key]);
                }
            }

            // start propagating 'deepchange' of new related object
            if(this.relatedObjects[key]) {
                this.listenTo(this.relatedObjects[key], 'deepchange', this._propagateDeepChange);
                if(this.relatedObjects[key]._representsToOne) {
                    // listen to destroy to unset references
                    this.listenTo(this.relatedObjects[key], 'destroy', this._relatedObjectDestroyHandler);
                    // listen to changes of the ID to update ref
                    this._updateIdRefFor[key] = this._updateIdRefFor[key] || this._updateIdRef.bind(this, key);
                    this.listenTo(this.relatedObjects[key], 'change:' + (this.relatedObjects[key].idAttribute || "id"), this._updateIdRefFor[key]);
                } else {
                    // listen to changes in the of item IDs and collection manipulations to update ID ref array
                    this._updateIdRefFor[key] = this._updateIdRefFor[key] || this._updateIdRef.bind(this, key);
                    this.listenTo(this.relatedObjects[key], 'add remove reset change:' + (this.relatedObjects[key].idAttribute || "id"), this._updateIdRefFor[key]);
                }
            }
        },

        _updateIdRef: function(key) {
            if(this.references[key]) {
                var idRef = refKeyToIdRefKey(this.references, key);
                this._ensureIdReference(idRef, key);
                this.trigger("change:" + idRef, this, this.get(idRef), {});
                this.trigger("change", this, {});
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

            this.trigger("embedded", this, parent, keyInParent);
        },

        // Override #previous to add support for getting previous values of references and embeddings
        // in "change" events
        previous: function(attr) {
            var result = Backbone.Model.prototype.previous.apply(this, arguments);
            if(result) return result;

            if (attr == null || !this._previousRelatedObjects) return null;
            return this._previousRelatedObjects[attr];
        },

        // Override #toJSON to add support for inlining JSON representations of related objects
        // in the JSON of this model. The related objects to be inlined can be specified via the
        // `inlineJSON` property or option.
        toJSON: function(options) {
            options = options || {};
            var self = this;
            var json = Backbone.Model.prototype.toJSON.apply(this, arguments);

            var inlineJSON = _.uniq(_.compact(_.flatten(
                _.union([options.inlineJSON], [this.inlineJSON])
            )));

            _.each(inlineJSON, function(key) {
                var obj = self;
                var path = key.split("."),
                    nestedJson = json;
                while(obj && path.length > 0 && _.isFunction(obj.toJSON)) {
                    key = path.shift();
                    obj = obj.get(key);
                    if(obj && _.isFunction(obj.toJSON)) {
                        // nest JSON represention ob embedded object into the hierarchy
                        nestedJson[key] = obj.toJSON();
                        nestedJson = nestedJson[key];
                    } else if(obj===null) {
                        // if an embedded object was unset, i.e., set to null, we have to 
                        // notify the server by nesting a null value into the JSON hierarchy
                        nestedJson[key] = null;
                    }
                }
            });
            return json;
        },

        fetch: function(options) {
            var result = Backbone.Model.prototype.fetch.apply(this, arguments);
            this._autoFetchEmbeddings();
            return result;
        },

        /**
         * Fetches the related object for each key in the provided keys array
         * If no keys array is provided, it fetches the related objects for all
         * relations that have not been synced before
         */
        fetchRelated: function(keys) {
            if(!keys) {
                var embeddingKeys = _.filter(_.keys(this.embeddings), function(key) {
                    return !this.get(key) || (!this.get(key).isSyncing && !this.get(key).isSynced);
                }, this);
                var referencesKeys = _.filter(_.keys(this.references), function(key) {
                    return this.get(key) && (!this.get(key).isSyncing && !this.get(key).isSynced);
                }, this);

                keys = _.union(embeddingKeys, referencesKeys);
            }

            if(_.isString(keys)) {
                keys = [keys];
            }

            for(var i=0; i<keys.length; i++) {
                var key = keys[i];

                if(!this.embeddings[key] && !this.references[key]) {
                    throw new Error("Invalid relationship key '" + key + "'");
                }

                // init embeddings
                if(!this.get(key) && this.embeddings[key]) {
                    var RelClass = resolveRelClass(this.embeddings[key]);
                    this.set(key, new RelClass());
                }

                var relatedObject = this.get(key);
                if(relatedObject && !relatedObject.isSyncing && !_.contains(this._relatedObjectsToFetch, relatedObject)) {
                    this._relatedObjectsToFetch.push(relatedObject);
                }
            }
            this._fetchRelatedObjects();
        },

        _autoFetchEmbeddings: function(onlyUndefinedEmbeddings) {
            var embeddingsKeys = _.keys(this.embeddings);
            for(var i=0; i<embeddingsKeys.length; i++) {
                var key = embeddingsKeys[i];
                var autoFetch = this.autoFetchRelated === true ||
                        (_.isArray(this.autoFetchRelated) && _.contains(this.autoFetchRelated, key));
                if(autoFetch) {
                    if(!this.get(key)) {
                        var RelClass = resolveRelClass(this.embeddings[key]);
                        this.set(key, new RelClass());
                    } else if(onlyUndefinedEmbeddings) {
                        continue;
                    }
                    var relatedObject = this.get(key);
                    if(!relatedObject.isSyncing && !_.contains(this._relatedObjectsToFetch, relatedObject)) {
                        this._relatedObjectsToFetch.push(relatedObject);
                    }
                }
            }
            this._fetchRelatedObjects();
        },

        sync: function(method, obj, options) {
            this._beforeSync();
            options = wrapOptionsCallbacks(this._afterSyncBeforeSet.bind(this), options);
            if(this.parent && method === "create") method = "update"; // always PUT embedded models
            if(options.forceMethod) {
                method = options.forceMethod;
            }
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
            changedModelOrCollection.once('deepchange_propagated', function() {
                this.trigger('deepchange_propagated', changedModelOrCollection, opts);
            }, this);
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
                this.trigger('deepchange_propagated', this, _.extend({ setOriginId: originId }, options))
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
                if(this.parent.isNew() && !this.parent.parent) {
                    throw new Error("Could not get the parent model's URL as it has not been saved yet.");
                }
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

            this.trigger("embedded", this, parent, keyInParent);
        },

        sync: function() {
            this._beforeSync();
            //options = wrapOptionsCallbacks(this._afterSetBeforeTrigger, options);
            return Backbone.Collection.prototype.sync.apply(this, arguments);
        },

        fetch: function(options) {
            options = wrapOptionsCallbacks(this._afterSetBeforeTrigger.bind(this), options);

            // auto-fetch embeddings of items
            //this.once("sync", function() {
            //    this.each(function(item) {
            //        item._autoFetchEmbeddings();
            //    });
            //}, this);

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

            var triggerDeepSync = function() {
                this.trigger("deepsync", this);
            }.bind(this);

            var afterAllItemsDeepSync,
                itemsToSyncCount = 0,
                itemSyncedCb = function() {
                    afterAllItemsDeepSync();
                };

            this.each(function(item) {
                if(item.isSyncing) {
                    itemsToSyncCount++;
                    item.once("deepsync", itemSyncedCb);
                }
            }, this);

            if(itemsToSyncCount > 0) {
                afterAllItemsDeepSync = _.after(itemsToSyncCount, triggerDeepSync);
            } else {
                triggerDeepSync();
            }

        },

        _representsToMany: true

    });

    _.extend(exports, Backbone);
    return Backbone;
}));
