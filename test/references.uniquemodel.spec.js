define(function(require) {
    "use strict";

    var Backbone = require("backbone-relations");
    require("backbone-uniquemodel"); // Attaches UniqueModel to Backbone global

    var flushModelCache = function(modelName) {
        var cache = Backbone.UniqueModel.getModelCache(modelName);
        for (var id in cache.instances) {
            delete cache.instances[id];
        }
    };

    describe("UniqueModel(Model)", function() {

        this.timeout(4000); // wait a max time of 4s for async requests

        var A = Backbone.UniqueModel(Backbone.Model.extend({
            url: function() { return FIXTURES_BASE + "a_" + this.id + ".json"; }
        }), "A");

        var ACollection = Backbone.Collection.extend({
            model: A,
            url: FIXTURES_BASE + "a_collection.json"
        });

        var B = Backbone.UniqueModel(Backbone.Model.extend({
            references: {
                oneA   : A,
                manyAs : ACollection,
                oneC   : function() { return C; },
                manyCs : function() { return CCollection; }
            },
            url: function() { return FIXTURES_BASE + "b_" + this.id + ".json"; }
        }), "B");

        var C = Backbone.UniqueModel(Backbone.Model.extend({
            references: {
                oneB    : B,
                children: function() { return CCollection; },
                parent  : function() { return C; }
            },
            url: function() { return FIXTURES_BASE + "c_" + this.id + ".json"; }
        }), "C");

        var CCollection = Backbone.Collection.extend({
            model: C
        });

        afterEach(function() {
            // flush uniquemodel model caches so that tests are kept isolated from each other
            flushModelCache("A");
            flushModelCache("B");
            flushModelCache("C");
        });


        describe('#fetch()', function() {

            it("should be ensured that referenced model instances are unique", function() {
                var server = sinon.fakeServer.create();

                var a = new A({id: 1});
                var b = new B({id: 1});

                b.fetch();

                server.requests[0].respond(200, { "Content-Type": "application/json" },
                    JSON.stringify({
                        oneAId: 1
                    })
                );

                expect(b.get("oneA")).to.equal(a);

                server.restore();
            });

            it("should automatically sync the unique referenced model instance", function() {
                var server = sinon.fakeServer.create();

                var a = new A({id: 1});
                var b = new B({id: 1});
                b.fetch();

                sinon.spy(a, "fetch");

                server.requests[0].respond(200, { "Content-Type": "application/json" },
                    JSON.stringify({
                        oneAId: 1
                    })
                );

                expect(a.fetch).to.have.been.calledOnce;

                server.restore();
            });

            it("should correctly handle circular to-one relations", function() {
                var server = sinon.fakeServer.create();

                var b = new B({id: 2});
                b.on("error", function(model, resp, opts) { done(new Error("fetch failed: " + resp.status)); });
                b.fetch();

                server.requests[0].respond(200, { "Content-Type": "application/json" },
                    JSON.stringify({
                        id: 2,
                        oneCId: 3
                    })
                );

                // c_3 is auto-fetched

                server.requests[1].respond(200, { "Content-Type": "application/json" },
                    JSON.stringify({
                        id: 3,
                        title: "c3",
                        oneBId: 2 // circular reference
                    })
                );

                expect(b.get("oneC"))
                    .to.be.an.instanceof(C);
                expect(b.get("oneC").get("title"))
                    .to.equal("c3");
                expect(b.get("oneC").get("oneB"))
                    .to.equal(b);

                server.restore();
            });

            it("should correctly handle circular to-many relations", function(done) {
                var b = new B({id: 2});
                b.on("error", function(model, resp, opts) { done(new Error("fetch failed: " + resp.status)); });
                b.fetch();
                b.once("deepsync", function() {
                    expect(b.get("oneC"))
                        .to.be.an.instanceof(C);
                    expect(b.get("oneC").get("title"))
                        .to.equal("c3");
                    expect(b.get("oneC").get("oneB"))
                        .to.equal(b);
                    done();
                });
            });

            it("should correctly handle self-referential relations", function(done) {
                var c = new C({id: 1});
                c.on("error", function(model, resp, opts) { done(new Error("fetch failed: " + resp.status)); });
                c.fetch();
                c.once("deepsync", function() {
                    expect(c.get("children"))
                        .to.be.an.instanceof(CCollection);
                    expect(c.get("children").models)
                        .to.have.length(2);
                    // c is a child of itself
                    expect(c.get("children").models[0])
                        .to.equal(c);
                    // c is also its own parent
                    expect(c.get("parent"))
                        .to.equal(c);
                    done();
                });
            });

            it("should not fetch referenced models that have been fetched before", function(done) {
                var a = new A({id:1});
                a.fetch();
                a.once("sync", function() {
                    sinon.spy(a, 'fetch');
                    var b = new B({id:1, oneAId: 1});
                    expect(a.fetch).to.have.not.been.called;
                    done();
                });
            });

            it("should not fetch referenced models that have been fetched before as part of a collection", function(done) {
                var aCollection = new ACollection();
                aCollection.fetch();
                aCollection.once("sync", function() {
                    var a = aCollection.get(1);
                    sinon.spy(a, 'fetch');
                    var b = new B({id:1, oneAId: 1});
                    expect(a.fetch).to.have.not.been.called;
                    done();
                });
            });

            it("should not fetch side-loaded referenced models that are also referenced from other referenced models", function(done) {
                var b = new B({id:3});
                var c1 = new C({id:1}),
                    c2 = new C({id:2});
                sinon.spy(b, 'fetch');
                sinon.spy(c1, 'fetch');
                b.url = FIXTURES_BASE + "b_3_sideloading.json";
                b.fetch();
                b.once("deepsync", function() {
                    expect(b.fetch).to.have.been.calledOnce;
                    expect(c1.fetch).to.not.have.been.called;
                    expect(b.isSyncing).to.be.undefined;
                    expect(c1.isSyncing).to.be.undefined;
                    done();
                });
            });

            it("should fetch every referenced models only once even it is referenced multiple times in deeply referenced models", function(done) {
                var b = new B({id:3});
                var c1 = new C({id:1}),
                    c2 = new C({id:2});
                sinon.spy(c2, 'fetch');
                b.url = FIXTURES_BASE + "b_3_sideloading.json";
                b.fetch();
                b.once("deepsync", function() {
                    expect(c2.fetch).to.have.been.calledOnce;
                    expect(c2.isSyncing).to.be.undefined;
                    done();
                });
            });

            it("should not fetch side-loaded referenced models that are referenced from other models in circular relations", function(done) {
                var b = new B({id:4});
                var c1 = new C({id:1}),
                    c2 = new C({id:2});
                sinon.spy(b, 'fetch');
                sinon.spy(c1, 'fetch');
                sinon.spy(c2, 'fetch');
                b.url = FIXTURES_BASE + "b_4_sideloading.json";
                b.fetch();
                b.once("deepsync", function() {
                    expect(b.fetch).to.have.been.calledOnce;
                    expect(c1.fetch).to.not.have.been.called;
                    expect(c2.fetch).to.have.been.calledOnce;
                    expect(b.isSyncing).to.be.undefined;
                    expect(c1.isSyncing).to.be.undefined;
                    expect(c2.isSyncing).to.be.undefined;
                    done();
                });
            });

        });

        describe('#save()', function() {

            it("should support creating referenced objects by inlining their JSON representation and preserve uniques", function() {
                var server = sinon.fakeServer.create();

                var b = new B({
                    title: "new_b",
                    oneA: {
                        title: "new_a"
                    }
                });

                var a = b.get("oneA");

                b.save(null, {
                    inlineJSON: "oneA"
                });

                server.requests[0].respond(200, { "Content-Type": "application/json" },
                    JSON.stringify({
                        id: 1,
                        title: "new_b",
                        oneA: {
                            id: 2,
                            title: "new_a"
                        }
                    })
                );

                expect(b.get("oneA")).to.equal(a);
                server.restore();
            });

        });





    });
});