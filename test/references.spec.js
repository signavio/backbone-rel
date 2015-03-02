define(function(require) {
    "use strict";

    var _ = require("underscore"),
        Backbone = require("backbone-relations");

    /**
     * Factory method for a callback for synchronizing sub-goals
     * After the returned callback has been called 'divideBy' times
     * the allDoneCb is called.
     */
    var doneDivision = function(divideBy, allDoneCb) {
        var done = 0;
        var oneDoneCb = function(err) {
            if(err) {
                allDoneCb(err);
            } else {
                done++;
                if(done==divideBy) allDoneCb();
                if(done>divideBy)
                    throw new Error("done callback was called too many times (" + divideBy+" calls expected, got " + done +" call)");
            }
        };
        return oneDoneCb;
    };



    var A = Backbone.Model.extend({
        references: {
            oneC: function() { return C; }
        },
        embeddings:{
            embeddedModel: function() { return EmbeddedModel; },
            embeddedCollection: function() { return EmbeddedCollection; }
        },
        autoFetchRelated: [ "oneC" ],
        url: function() { return FIXTURES_BASE + "a_" + this.id + ".json"; } // override for using fixtures
    });

    var ACollection = Backbone.Collection.extend({
        model: A,
        url: FIXTURES_BASE + "a_collection.json"
    });

    var B = Backbone.Model.extend({
        references: {
            oneA        : A,
            manyAs      : ACollection,
            oneC        : function() { return C; }
        },
        defaults: {
            manyAs: []
        },
        autoFetchRelated: [ "oneA", "manyAs", "oneC" ],
        url: function() { return FIXTURES_BASE + "b_" + this.id + ".json"; } // override for using fixtures
    });

    var C = Backbone.Model.extend({
        references: {
            oneB   : B
        },
        autoFetchRelated: [ "oneB" ],
        url: function() { return FIXTURES_BASE + "c_" + this.id + ".json"; } // override for using fixtures
    });

    var EmbeddedModel = Backbone.Model.extend({
        references: {
            oneA: A
        }
    });
    var EmbeddedCollection = Backbone.Collection.extend({
        model: EmbeddedModel
    });


    describe("Model", function() {

        this.timeout(4000); // wait a max time of 4s for async requests

        it("should be initializable", function() {
            expect(Backbone.Model).to.exist;
            expect(new Backbone.Model()).to.be.an.instanceof(Backbone.Model);
        });

        it("should be possible to define defaults for referenced objects", function() {
            var b = new B();
            expect(b.get("manyAs"))
                .to.be.an.instanceof(ACollection);
        });

        it("should correctly resolve the reference model class when a resolve function is supplied", function() {
            var a = new A({oneCId: 1});
            expect(a.get("oneC"))
                .to.be.an.instanceof(C);
        });

        it("should be possible to define custom attribute name patterns for ID references", function() {
            var MyModel = Backbone.Model.extend({
                references: {
                    oneA: A
                },
                referenceAttributeName: function(refKey) {
                    return "idFor_" + refKey;
                }
            });

            var m = new MyModel({ oneA: new A({ id: "a1" })});
            expect(m.get("idFor_oneA")).to.equal("a1");
            expect(m.get("oneAId")).to.not.exist;
            var json = m.toJSON();
            expect(json.idFor_oneA).to.equal("a1");
            expect(json.oneAId).to.not.exist;

        });

        it("should be possible to use the reference name as the attribute name for the ID reference", function() {
            var MyModel = Backbone.Model.extend({
                references: {
                    oneA: A
                },
                referenceAttributeName: function(refKey) {
                    return refKey;
                }
            });

            var m = new MyModel({ oneA: "a1" });
            expect(m.get("oneA")).to.be.an.instanceof(A);
            expect(m.get("oneA").id).to.equal("a1");

            m.set("oneA", new A({ id: "a2" }));
            var json = m.toJSON()
            expect(json.oneA).to.equal("a2");
        });

        describe("#constructor", function() {

            it("should auto-fetch embeddings", function() {
                var e = new EmbeddedModel({ id: 1 });
                e.url = FIXTURES_BASE + "embedded_model.json";
                sinon.spy(e, 'fetch');

                var AWithEmbeddedAutoFetch = A.extend({
                    autoFetchRelated: true
                });

                var server = sinon.fakeServer.create();

                var a = new AWithEmbeddedAutoFetch({
                    id: 1
                });

                expect(a.get("embeddedModel")).to.exist;
                expect(a.get("embeddedModel").isSyncing).to.be.true;

                server.restore();
            });

        });

        describe('#set()', function() {

            it("should be possible to set a referenced object directly", function() {
                var a = new A({id:1});
                var b1 = new B({id:1}),
                    b2 = new B({id:2, oneA: a});
                b1.set("oneA", a);
                expect(b1.get("oneA")).to.equal(a);
                expect(b2.get("oneA")).to.equal(a);
            });

            it("should be possible to set a referenced object by ID", function() {
                var b = new B({id:1});
                b.set("oneA", 2);
                expect(b.get("oneA"))
                    .to.be.an.instanceof(A);
                expect(b.get("oneA"))
                    .to.have.property("id", 2);
            });

            it("should be possible to set a collection of referenced objects", function() {
                var aCollection = new ACollection([
                    new A({id:1}), new A({id:2}), new A({id:3})
                ]);
                var b1 = new B({id:1}),
                    b2 = new B({id:2, manyAs: aCollection});
                b1.set("manyAs", aCollection);
                expect(b1.get("manyAs")).to.equal(aCollection);
                expect(b2.get("manyAs")).to.equal(aCollection);
            });

            it("should set the referenced object ID reference in the attributes", function() {
                var a = new A({id:1});
                var b = new B({id:1});
                b.set("oneA", a);
                b.set("manyAs", new ACollection([a]));

                expect(b.get("oneAId")).to.equal(1);
                expect(b.get("manyAIds")).to.have.length.of(1);
                expect(b.get("manyAIds")[0]).to.equal(1);
            });

            it("should trigger 'change:{referenceKey}' when the ID to the referenced object changed", function() {
                var a1 = new A({id:1});
                var b = new B({id:1, oneA: a1});

                var spy = {
                    onChange: function() {}
                };
                sinon.spy(spy, "onChange");
                b.on("change:oneA", spy.onChange);
                b.set("oneA", { id: 2 });
                expect(spy.onChange).to.have.been.calledOnce;
            });

            it("should update the ID reference when a new referenced object receives an ID", function() {
                var a1 = new A({title:"a_1"});
                var b = new B({id:1, oneA: a1});
                expect(b.get("oneAId")).to.be.undefined;
                a1.set("id", 1); // create a1 on the server, server assigns an ID
                expect(b.get("oneAId")).to.equal(1);
                expect(b.toJSON()).to.have.property("oneAId", 1);
            });

            it("should update the ID reference array when a new referenced item receives an ID", function() {
                var a1 = new A({title:"a_1"}),
                    a2 = new A({id: 2, title:"a_2"});
                var b = new B({id:1, manyAs: [a1, a2]});
                expect(b.get("manyAIds")).to.deep.equal([2]);
                a1.set("id", 1); // create a1 on the server, server assigns an ID
                expect(b.get("manyAIds")).to.deep.equal([1, 2]);
                expect(b.toJSON().manyAIds).to.deep.equal([1, 2]);
            });

            //it("should trigger 'change:{embeddingKey}' when the ID of the embedded object changed", function() {
            //    var e1 = new EmbeddedModel({id: 1});
            //    var a = new A({id:1, embeddedModel: e1});
//
            //    var spy = {
            //        onChange: function() {}
            //    };
            //    sinon.spy(spy, "onChange");
            //    a.on("change:embeddedModel", spy.onChange);
            //    a.set("embeddedModel", {id: 2});
            //    expect(spy.onChange).to.have.been.calledOnce;
            //});

            //it("should trigger 'change:relation' when setting an embedded object with no ID", function() {
            //    var e = new EmbeddedModel({title: "embedded_1"});
            //    var a = new A({id:1, embeddedModel: e});
//
            //    var spy = {
            //        onChange: function() {}
            //    };
            //    sinon.spy(spy, "onChange");
            //    a.on("change:embeddedModel", spy.onChange);
            //    a.set("embeddedModel", { title: "embedded_1_changed" });
            //    expect(spy.onChange).to.have.been.calledOnce;
            //});

            it("should fetch the new referenced object for to-one relations", function(done) {
                var b = new B({id: 1});
                b.fetch();
                b.once("sync", function() {
                    expect(b.get("oneA"))
                        .to.be.an.instanceof(A);
                    b.get("oneA").once("sync", function() {
                        expect(b.get("oneA").get("title")).to.equal("a1");
                        done();
                    });
                });
            });

            it("should fetch the new referenced objects for to-many relations", function(done) {
                var b = new B({id: 1});
                b.fetch();
                b.once("sync", function() {
                    expect(b.get("manyAs"))
                        .to.be.an.instanceof(ACollection);
                    expect(b.get("manyAs").models).to.have.length(3);

                    var oneDone = doneDivision(b.get("manyAs").models.length, done);
                    _.each(b.get("manyAs").models, function(a) {
                        a.once("sync", function() {
                            expect(a.get("title")).to.equal("a"+a.id);
                            oneDone();
                        });
                    });
                });
            });

            it("should merge side-loaded attribute data into existing referenced objects", function(done) {
                var a = new A({id:1});
                var b = new B({id: 1, manyAs: [a]});
                b.url = FIXTURES_BASE + "b_1_sideloading.json";
                b.on("error", function(model, resp, opts) { done(new Error("fetch failed: " + resp.status)); });
                b.fetch();
                b.once("deepsync", function() {
                    expect(b.get("manyAs").models).to.have.length(3);
                    expect(b.get("manyAs").models[0]).to.equal(a);
                    expect(a.get("title")).to.equal("a1_s");
                    done();
                });
            });

            it("should support side-loading of referenced objects", function(done) {
                var b = new B();
                b.url = FIXTURES_BASE + "b_1_sideloading.json";
                b.fetch();
                b.once("sync", function() {
                    expect(b.get("oneA"))
                        .to.be.an.instanceof(A);
                    expect(b.get("oneA").get("title")).to.equal("a1_s");

                    expect(b.get("manyAs"))
                        .to.be.an.instanceof(ACollection);
                    expect(b.get("manyAs").models).to.have.length(3);
                    _.each(b.get("manyAs").models, function(a) {
                        expect(a.get("title")).to.equal("a"+a.id+"_s");
                    });
                    done();
                });
            });

            it("should clear current attributes that are not present in the set attrs if the `clear` option is set", function() {
                var a1 = new A({
                    id: 1,
                    newAttr: "new_attr"
                });

                var idChanged = sinon.spy();
                var newAttrChanged = sinon.spy();
                var titleChanged = sinon.spy();
                a1.on("change:id", idChanged);
                a1.on("change:newAttr", newAttrChanged);
                a1.on("change:title", titleChanged);

                a1.set({ id: 1, title: "a1" }, { clear: true });

                expect(a1.get("newAttr")).to.not.exist;
                expect(a1.get("title")).to.equal("a1");

                expect(idChanged).to.have.not.been.called;
                expect(titleChanged).to.have.been.calledOnce;
                expect(newAttrChanged).to.have.been.calledOnce;
            });

            it("should clear current references that are not present in the set attrs if the `clear` option is set", function() {
                var a1 = new A({ id: 1, title: "a1" });
                var b1 = new B({ id: 1, oneA: a1, manyAIds: [1, 2, 3] });

                b1.set("oneAId", 2, { clear: true });
                expect(b1.get("oneA")).to.exist;
                expect(b1.get("manyAs").length).to.equal(0);
                expect(a1.get("title")).to.equal("a1");

                b1.set({ id: 1 }, { clear: true });

                expect(b1.get("oneA")).to.not.exist;
            });

            it("should clear current embeddings that are not present in the set attrs if the `clear` option is set", function() {
                var e1 = new EmbeddedModel({ id: 1, title: "e1" });
                var eC = new EmbeddedCollection([{id:2}, {id:3}]);

                var a1 = new A({ id: 1, embeddedModel: e1, embeddedCollection: eC });

                a1.set({ id: 1 }, { clear: true });

                expect(a1.get("embeddedModel")).to.not.exist;
                expect(e1.get("title")).to.equal("e1");
                expect(a1.get("embeddedCollection")).to.not.exist;
            });

            it("should restore its default value when clearing an attribute", function() {
                var ModelWithDefaults = Backbone.Model.extend({
                    references: {
                        oneA: A,
                        manyAs: ACollection
                    },
                    embeddings: {
                        embeddedModel: EmbeddedModel,
                        embeddedCollection: EmbeddedCollection
                    },
                    defaults: {
                        defAttr: "def",
                        oneA: new A({id: 1}),
                        manyAs: [],
                        embeddedModel: { id: 1 },
                        embeddedCollection: [ {id: 1} ]
                    }
                });

                var m = new ModelWithDefaults({
                    oneAId: 2,
                    manyAIds: [1, 2],
                    defAttr: "changed",
                    embeddedModel: null
                });

                m.set({ newAttr: "new" }, {clear: true});

                expect(m.get("defAttr")).to.equal("def");
                expect(m.get("oneA").id).to.equal(1);
                expect(m.get("manyAs").length).to.equal(0);
                expect(m.get("embeddedModel").id).to.equal(1);
                expect(m.get("embeddedCollection").length).to.equal(1);
            });

            it("should leave referenced objects untouched when clearing", function() {
                var a1 = new A({ id: 1, title: "a1" });
                var b1 = new B({ id: 1, oneA: a1 });

                b1.set({ id: 1, oneA: {} }, { clear: true });

                expect(b1.get("oneA").get("title")).to.not.exist;
                expect(a1.get("title")).to.equal("a1");
            });

            // This most probably is not desirable
            it("should leave embeddded objects untouched when clearing", function() {
               var e1 = new EmbeddedModel({ id: 1, title: "e1" });
               var eC = new EmbeddedCollection([{id:2}, {id:3}]);

               var a1 = new A({ id: 1, embeddedModel: e1, embeddedCollection: eC });

               a1.set({ id: 1, embeddedModel: {}, embeddedCollection: [] }, { clear: true });

               expect(a1.get("embeddedModel").get("title")).to.not.exist;
               expect(e1.get("title")).to.equal("e1");

               expect(a1.get("embeddedCollection").models).to.be.empty;
               expect(eC.length).to.equal(2);
            });

        });

        describe('#save()', function() {

            it("should support creating referenced objects by inlining their JSON representation when saving a model", function() {
                var server = sinon.fakeServer.create();

                var b = new B({
                    title: "new_b",
                    oneA: {
                        title: "new_a"
                    }
                });

                b.save(null, {
                    inlineJSON: "oneA"
                });

                server.requests[0].respond(200, { "Content-Type": "application/json" },
                    JSON.stringify({
                        id: 1,
                        title: "new_b",
                        oneA: {
                            id: 2,
                            title: "new_a",
                            description: "desc"
                        }
                    })
                );

                expect(b.get("oneAId")).to.equal(2);

                var a = b.get("oneA");
                expect(a.id).to.equal(2);
                expect(a.get("description")).to.equal("desc");

                server.restore();
            });

        });


        describe('#unset()', function() {

            it("should unset referenced objects", function() {
                var a = new A({id:1});
                var b = new B({id:1, oneA: a});
                expect(b.get("oneA")).to.equal(a);
                b.unset("oneA");
                expect(b.get("oneA")).to.be.undefined;
                expect(b.get("oneAId")).to.be.undefined;
            });

        });

        describe('#toJSON()', function() {

            it("should return a JSON hash with an ID reference to the referenced object", function() {
                var a = new A({id:1});
                var b = new B({id:1, oneA: a});
                var json = b.toJSON();
                expect(json).to.not.have.property("oneA");
                expect(json).to.have.property("oneAId", 1);
            });

            it("should return a JSON hash with an array of ID references to the referenced objects", function() {
                var aCollection = new ACollection([
                    new A({id:1}), new A({id:2}), new A({id:3})
                ]);
                var b = new B({id:1, manyAs: aCollection});
                var json = b.toJSON();
                expect(json).to.not.have.property("manyAs");
                expect(json).to.have.property("manyAIds")
                    .that.is.an("array")
                    .with.length.of(3);
                expect(json.manyAIds).to.include.members([1, 2, 3]);
            });

        });

        describe('#fetchRelated', function() {

            it("should fetch all related objects for the passed relation keys", function() {
                var eM = new EmbeddedModel({id:1}),
                    c = new C({id: 2});

                var AWithoutAutoFetch = A.extend({
                    autoFetchRelated: false
                });

                var a = new AWithoutAutoFetch({
                    id: 1,
                    oneC: c,
                    embeddedModel: eM
                });

                sinon.spy(c, "fetch");
                sinon.spy(eM, "fetch");

                var server = sinon.fakeServer.create();

                a.fetchRelated(["oneC", "embeddedModel", "embeddedCollection"]);

                expect(c.fetch).to.have.been.calledOnce;
                expect(eM.fetch).to.have.been.calledOnce;

                // embeddings will be inititalized, if they have not been set before
                expect(a.get("embeddedCollection")).to.exist;
                expect(a.get("embeddedCollection").isSyncing).to.be.true;

                server.restore();
            });

            it("should trigger 'deepsync' when all related objects have been synced", function(done) {
                var eM = new EmbeddedModel({id:1}),
                    eC = new EmbeddedCollection(),
                    c = new C({id: 2});

                var a = new A({
                    id: 1,
                    oneC: c
                });

                a.fetchRelated(["oneC"]);
                a.once("deepsync", function() {
                    done();
                });
            });

            it("should fetch all those related objects that have not been synced before, if no keys are given", function() {
                var eM = new EmbeddedModel({id:1}),
                    c = new C({id: 2});

                var AWithCollectionAutoFetch = A.extend({
                    autoFetchRelated: ["embeddedCollection"]
                });

                var server = sinon.fakeServer.create();

                var a = new AWithCollectionAutoFetch({
                    id: 1,
                    oneC: c,
                    embeddedModel: eM
                });

                var eC = a.get("embeddedCollection");
                expect(eC).to.exist;
                expect(eC.isSyncing).to.be.true;

                // respond to a_1
                server.requests[0].respond(200, { "Content-Type": "application/json" },
                    JSON.stringify({})
                );

                sinon.spy(c, "fetch");
                sinon.spy(eM, "fetch");
                sinon.spy(eC, "fetch");

                a.fetchRelated();

                expect(c.fetch).to.have.been.calledOnce;
                expect(eM.fetch).to.have.been.calledOnce;
                expect(eC.fetch).to.have.not.been.called;

                server.restore();

            });

            //it("should fetch embedded objects straight away, but referenced objects only after the model is finished syncing", function(done) {
            //
            //});

        });

        describe('#destroy', function() {

            it("should unset all references from other models to the the destroyed model", function(done) {
                var b = new B({ id: 1 });
                b.fetch();
                b.once("deepsync", function() {
                    var a = b.get("oneA");
                    a.destroy();
                    expect(b.get("oneA")).to.be.undefined;
                    expect(b.get("oneAId")).to.be.undefined;
                    done();
                });
            });

        });

        describe('#previous', function() {

            it("should return the previous related object, when called with a relationship key", function() {
                var c1 = new C({ id: 1 });
                var c2 = new C({ id: 2 });
                var e1 = new EmbeddedModel({ id: 1 });
                var e2 = new EmbeddedModel({ id: 2 });
                var a = new A({
                    oneC: c1,
                    embeddedModel: e1
                });
                a.on("change", function() {
                    expect(a.get("oneC")).to.equal(c2);
                    expect(a.previous("oneC")).to.equal(c1);

                    expect(a.get("embeddedModel")).to.equal(e2);
                    expect(a.previous("embeddedModel")).to.equal(e1);
                });
                a.set({
                    oneC: c2,
                    embeddedModel: e2
                });
            });

        });

        describe('Events', function() {

            it("should trigger change:referenceId when the ID ref changes", function(done) {
                var a1 = new A({id:1});
                var b = new B({
                    id: 5,
                    oneA: a1
                });
                b.once("change:oneAId", function() {
                    expect(b.get("oneAId")).to.equal(2);
                    done();
                });
                a1.set("id", 2);
            });


            it("should trigger change:referenceIds when one ID in the ref array changes", function(done) {
                var a1 = new A({id: 1}),
                    a2 = new A({id: 2});
                var b = new B({
                    id: 5,
                    manyAs: [a1, a2]
                });
                b.once("change:manyAIds", function() {
                    expect(b.get("manyAIds")).to.deep.equal([3,2]);
                    done();
                });
                a1.set("id", 3);
            });

            it("should trigger change:referenceIds when an item is add to the reference", function(done) {
                var a1 = new A({id: 1}),
                    a2 = new A({id: 2});
                var b = new B({
                    id: 5,
                    manyAs: [a1]
                });
                b.once("change:manyAIds", function() {
                    expect(b.get("manyAIds")).to.deep.equal([1,2]);
                    done();
                });
                b.get("manyAs").add(a2);
            });

            it("should trigger change:referenceIds when an item is removed from the reference", function(done) {
                var a1 = new A({id: 1}),
                    a2 = new A({id: 2});
                var b = new B({
                    id: 5,
                    manyAs: [a1, a2]
                });
                b.once("change:manyAIds", function() {
                    expect(b.get("manyAIds")).to.deep.equal([1]);
                    done();
                });
                b.get("manyAs").remove(2);
            });

            it("should trigger 'deepsync' when all referenced objects have been synced", function(done) {
                var b = new B({id: 1});
                b.fetch();
                b.once("deepsync", function() {
                    expect(b.get("oneA").get("title")).to.equal("a1");
                    _.each(b.get("manyAs").models, function(a) {
                        expect(a.get("title")).to.equal("a"+a.id);
                    });
                    done();
                });
            });

            it("should also trigger 'deepsync' in the case that all referenced objects are side-loaded", function(done) {
                var b = new B();
                b.url = FIXTURES_BASE + "b_1_sideloading.json";
                b.fetch();
                b.once("deepsync", function() {
                    done();
                });
            });

            it("should trigger 'deepsync' on 'sync' when there are no related objects to be fetched", function(done) {
                var c = new C({id: 2});
                c.autoFetchRelated = false;
                c.fetch();

                c.once("deepsync", function() {
                    expect(c.isSynced).to.be.true;
                    done();
                });
            });

            it("should trigger 'deepchange' on 'change' of one the referenced objects", function() {
                var a1 = new A({ id: 1});
                var b1 = new B({ id: 1, oneA: a1 });

                var spy = {
                    onDeepChangeB: function() {}
                };
                sinon.spy(spy, "onDeepChangeB");

                b1.on("deepchange", spy.onDeepChangeB);
                a1.set("title", "a1_changed");

                expect(spy.onDeepChangeB).to.be.calledOnce;
            });

            it("should trigger 'deepchange' events when referenced collections are changed", function() {
                var b1 = new B({ id: 1, manyAs: [{id:1}, {id:2}] });

                var spy = {
                    onDeepChange: function() {}
                };
                sinon.spy(spy, "onDeepChange");

                b1.on("deepchange", spy.onDeepChange);
                b1.get("manyAs").push(new A({id: 3}));

                expect(spy.onDeepChange).to.be.calledOnce;
            });

            it("should propagate 'deepchange' events from referenced models", function() {
                var a1 = new A({
                    id: 1,
                    oneC: new C({
                        id: 1,
                        oneB: new B({id: 1})
                    })
                });

                var spy = {
                    onDeepChange: function() {}
                };
                sinon.spy(spy, "onDeepChange");
                a1.on("deepchange", spy.onDeepChange);
                a1.get("oneC").get("oneB").set("title", "b1_changed");

                expect(spy.onDeepChange).to.be.calledOnce;
            });

            it("should propagate 'deepchange' events from referenced collections", function() {
                var a1 = new A({ id: 1});
                var b1 = new B({ id: 1, manyAs: [a1] });

                var spy = {
                    onDeepChange: function() {}
                };
                sinon.spy(spy, "onDeepChange");

                b1.on("deepchange", spy.onDeepChange);
                a1.set("title", "a1_changed");

                expect(spy.onDeepChange).to.be.calledOnce;
            });


            it("should consolidate 'deepchange' events when when those are propagated through multiple paths in the object graph", function() {
                var a1 = new A({ id: 1});
                var b1 = new B({ id: 1, oneA: a1, manyAs: [a1] });

                var spy = {
                    onDeepChange: function() {}
                };
                sinon.spy(spy, "onDeepChange");

                b1.on("deepchange", spy.onDeepChange);
                a1.set("title", "a1_changed");

                expect(spy.onDeepChange).to.be.calledOnce;
            });

            it("should handle 'deepchange' events that are propagated through circular paths in the object graph", function() {
                var b1 = new B({ id: 1 });
                var c1 = new C({ id: 1, oneB: b1});
                b1.set("oneC", c1);

                var spy = {
                    onDeepChangeB: function() {},
                    onDeepChangeC: function() {}
                };
                sinon.spy(spy, "onDeepChangeB");
                sinon.spy(spy, "onDeepChangeC");

                b1.on("deepchange", spy.onDeepChangeB);
                c1.on("deepchange", spy.onDeepChangeC);

                c1.set("title", "c1_changed");

                expect(spy.onDeepChangeB).to.be.calledOnce;
                expect(spy.onDeepChangeC).to.be.calledOnce;

            });

            it("should propagate the 'error' event when the automatic fetch of referenced objects fails", function() {
                var b = new B({});
                var server = sinon.fakeServer.create();
                b.set("oneAId", "invalid_id");

                b.on("error", function(model, resp, opts) {
                    expect(model).to.be.an.instanceof(A);
                    expect(resp.status).to.equal(404);
                });

                server.requests[0].respond(404, {}, "");
                server.restore();
            });

            it("should propagate the 'error' event when parsing of fetched data for referenced objects fails", function(done) {
                var b = new B({});
                b.set("oneAId", "badjson");
                b.on("error", function(model, resp, opts) {
                    expect(model).to.be.an.instanceof(A);
                    done();
                });
            });

        });


    });


    describe("Collection", function() {

        this.timeout(4000); // wait a max time of 4s for async requests

        describe("#sync()", function() {

            it("should set the isSynced flag on each item model that has been added during the sync", function(done) {
                var a5 = new A({id:5});
                var col = new ACollection([a5]);
                col.fetch();
                col.once("sync", function() {
                    expect(col.get(1)).to.have.property("isSynced", true);
                    expect(a5).to.not.have.property("isSynced");
                    done();
                });
            });

            it("should set the isSynced flag on each item model that has been added during the sync when resetting", function(done) {
                var col = new ACollection();
                col.fetch({reset: true});
                col.once("sync", function() {
                    expect(col.get(1)).to.have.property("isSynced", true);
                    done();
                });
            });

            it("should set the isSynced flag on each item model before the 'add' event is triggered", function(done) {
                var col = new ACollection();
                col.fetch();
                col.once("add", function(model) {
                    expect(model).to.have.property("isSynced", true);
                    done();
                });
            });

            it("should trigger 'deepsync' also when there are no related objects to be fetched", function(done) {
                var CNoAutoFetch = C.extend({ autoFetchRelated: false });
                var CCollection = Backbone.Collection.extend({
                    model: CNoAutoFetch,
                    url: FIXTURES_BASE + "a_collection.json"
                });
                var col = new CCollection();
                col.fetch();

                col.once("deepsync", function() {
                    expect(col.isSynced).to.be.true;
                    done();
                });
            });

        });

    });
});