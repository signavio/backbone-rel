define(function(require) {
    "use strict";

    var _ = require("underscore"),
        Backbone = require("backbone-rel");

    var A = Backbone.Model.extend({
        embeddings: {
            embeddedModel: function() { return EmbeddedModel; },
            embeddedCollection: function() { return EmbeddedCollection; },
            embeddedCollectionOfA: function() { return EmbeddedCollectionOfA; }

        },
        autoFetchRelated: false,
        url: function() { return this.id ? this.id.toString() : "/"; }
    });

    var EmbeddedModel = Backbone.Model.extend({});
    var EmbeddedCollection = Backbone.Collection.extend({
        model: EmbeddedModel
    });

    var EmbeddedCollectionOfA = Backbone.Collection.extend({
        model: A
    });

    describe("Model", function() {

        this.timeout(4000); // wait a max time of 4s for async requests

        var a;

        beforeEach(function() {
            a = new A({
                id: 1,
                embeddedModel: {
                    title: "embedded_1"
                }
            });
        });

        afterEach(function() {
            a = undefined;
        });

        describe("#url()", function() {

            it("should use the parent object's URL and the embedding key to build a nested URL", function() {
                var parent = new A({ id: 1 });
                parent.url = "/parent";

                var embedded = new EmbeddedModel({ id: 1 });

                parent.set("embeddedModel", embedded);
                expect(embedded.url()).to.equal("/parent/embeddedModel");
            });

            it("should throw an error when the parent object is still new", function() {
                var parent = new A({ embeddedModel: {} });
                expect(parent.get("embeddedModel").url).to.throw(Error);
            });

        });

        describe("#destroy()", function() {

            it("should delete the embedded object in the parent model", function() {
                var aNew = new A({
                    embeddedModel: {
                        title: "embedded_1"
                    }
                });
                aNew.get("embeddedModel").destroy();
                expect(aNew.get("embeddedModel")).to.be.undefined;
            });

        });

        describe('#Events', function() {

            it("should trigger 'deepchange' on 'change' of one of the embedded objects", function() {
                var a = new A({ id: 1, embeddedModel: { title: "title" }});

                var spy = {
                    onDeepChange: function() {}
                };
                sinon.spy(spy, "onDeepChange");

                a.on("deepchange", spy.onDeepChange);
                a.get("embeddedModel").set("title", "title_changed");

                expect(spy.onDeepChange).to.be.calledOnce;
            });

            it("should trigger 'deepchange' on 'change' of an item when setting whole object structures", function() {
                var OuterEmbeddedModel = Backbone.Model.extend({
                    embeddings: {
                        embeddedModel: EmbeddedModel
                    }
                });
                var o = new OuterEmbeddedModel({
                    embeddedModel: {
                        id: 1,
                        title: "embedded_1"
                    }
                });

                var spy = {
                    onDeepChange: function() {}
                };
                sinon.spy(spy, "onDeepChange");

                o.on("deepchange", spy.onDeepChange);
                o.set({
                    embeddedModel: {
                        id: 1,
                        title: "embedded_1_changed"
                    }
                });

                expect(spy.onDeepChange).to.be.calledOnce;
            });


        });

        describe('#unset()', function() {

            it("should unset embedded objects", function() {
                var a = new A({
                    id: 1,
                    embeddedCollection: [
                        {
                            title: "embedded_1"
                        }
                    ]
                });
                expect(a.get("embeddedCollection")).to.be.an.instanceof(EmbeddedCollection);
                a.unset("embeddedCollection");
                expect(a.get("embeddedCollection")).to.be.undefined;
            });

        });

        describe('#toJSON()', function() {

            it("should nest embedded models' JSON structures if the embedding is declared in the `inlineJSON` property", function() {
                var AWithInlining = A.extend({
                    inlineJSON: [
                        "embeddedModel"
                    ]
                });

                var a = new A({
                    embeddedModel: {
                        title: "embedded_1"
                    }
                });

                var aWithInlining = new AWithInlining({
                    embeddedModel: {
                        title: "embedded_1"
                    }
                });

                var json = a.toJSON();
                var jsonWithInlining = aWithInlining.toJSON();
                expect(json).to.not.have.property("embeddedModel");

                expect(jsonWithInlining).to.have.property("embeddedModel")
                    .that.is.an("object")
                    .with.property("title", "embedded_1");
            });

            it("should nest embedded models' JSON structures if the embedding is declared in the `inlineJSON` option", function() {
                var a = new A({
                    embeddedModel: {
                        title: "embedded_1"
                    }
                });
                var json = a.toJSON({ inlineJSON: "embeddedModel" });
                expect(json).to.have.property("embeddedModel")
                    .that.is.an("object")
                    .with.property("title", "embedded_1");
            });

        });

        describe("#fetch", function() {

            it("should auto-fetch embeddings", function() {

                var e = new EmbeddedModel({ id: 1 });
                e.url = FIXTURES_BASE + "embedded_model.json";

                var AWithoutAutoFetch = A.extend({
                    autoFetchRelated: false
                });

                var a = new A({
                    id: 1,
                    embeddedModel: e
                });
                a.autoFetchRelated = ["embeddedModel"];

                sinon.spy(e, 'fetch');
                var server = sinon.fakeServer.create();

                a.fetch();

                expect(e.fetch).to.have.been.calledOnce;
                //a.once("sync", function() {
                //    expect(e.get("title")).to.equal("embedded_1");
                //    done();
                //});
            });

            //it("should not auto-fetch embeddings that are side-loaded", function(done) {
            //    var a = new A({
            //        id: 1,
            //        embeddedModel: {
            //            id: 1
            //        }
            //    });
            //    a.autoFetchRelated = ["embeddedModel"];
            //    a.url = FIXTURES_BASE + "a_1_sideloading.json";
            //    var e = a.get("embeddedModel");
            //    sinon.spy(e, 'fetch');
            //    a.fetch();
            //    a.once("deepsync", function() {
            //        expect(e.fetch).to.have.not.been.called;
            //        expect(e.get("title")).to.equal("embedded_1");
            //        done();
            //    });
            //});

        });

        describe("#save", function() {

            it("should send a PUT request for a new model with a parent", function() {
                var a = new A({ id: 1, embeddedModel: { title: "title" }});
                var e = a.get("embeddedModel");

                var server = sinon.fakeServer.create();
                e.save();

                expect(server.requests[0].method).to.equal('PUT');
            });

            it("should send a POST request for a new model in a collection", function() {
                var a = new A({ id: 1, embeddedCollection: [{ title: "title" }]});
                var e = a.get("embeddedCollection").first();

                var server = sinon.fakeServer.create();
                e.save();

                expect(server.requests[0].method).to.equal('POST');
            });

        });

    });

    describe("Collection", function() {

        var a;

        beforeEach(function() {
            a = new A({
                embeddedCollection: [
                    {
                        id: 1,
                        title: "embedded_1"
                    },
                    {
                        id: 2,
                        title: "embedded_2"
                    }
                ]
            });
        });

        describe("#url()", function() {

            it("should use the parent object's URL and the embedding key to build a nested URL", function() {
                var parent = new A({ id: 1 });
                parent.url = "/parent";

                var embedded = new EmbeddedCollection({ id: 1 });

                parent.set("embeddedCollection", embedded);
                expect(embedded.url()).to.equal("/parent/embeddedCollection");
            });

            it("should throw an error when the parent object is still new", function() {
                var parent = new A({ embeddedCollection: [] });
                expect(parent.get("embeddedCollection").url).to.throw(Error);
            });

        });

        describe("#set()", function() {

            it("should set embedded models passed as JSON objects", function() {
                var a = new A({
                    embeddedModel: {
                        title: "embedded_1"
                    }
                });
                expect(a.get("embeddedModel"))
                    .to.be.an.instanceof(EmbeddedModel);
                expect(a.get("embeddedModel").get("title"))
                    .to.equal("embedded_1");
            });

            it("should set embedded collections passed as JSON arrays", function() {
                var a = new A({
                    embeddedCollection: [
                        {
                            title: "embedded_1"
                        },
                        {
                            title: "embedded_2"
                        }
                    ]
                });
                expect(a.get("embeddedCollection")).to.be.an.instanceof(EmbeddedCollection);
                expect(a.get("embeddedCollection").models).to.have.length(2);
                expect(a.get("embeddedCollection").models[0]).to.be.an.instanceof(EmbeddedModel);
                expect(a.get("embeddedCollection").models[0].get("title")).to.equal("embedded_1");
                expect(a.get("embeddedCollection").models[1]).to.be.an.instanceof(EmbeddedModel);
                expect(a.get("embeddedCollection").models[1].get("title")).to.equal("embedded_2");
            });

            /*it("should merge attributes into existing models when setting a embedded collection", function() {
                var spy = { onAdd: function() {}, onRemove: function() {} };
                sinon.spy(spy, 'onAdd');
                sinon.spy(spy, 'onRemove');
                a.get("embeddedCollection").on("add", spy.onAdd);
                a.get("embeddedCollection").on("remove", spy.onRemove);
                var embedded_2 = a.get("embeddedCollection").get(2);

                a.set("embeddedCollection", [{id:2, title: "embedded_2_upd"}, {id:3, title: "embedded_3"}]);
                expect(a.get("embeddedCollection")).to.have.length(2);
                expect(spy.onAdd).to.be.calledOnce;
                expect(spy.onRemove).to.be.calledOnce;
                expect(embedded_2.get("title")).to.equal("embedded_2_upd");
            });*/

            //it("should trigger 'deepchange' and 'deepchange:[attribute]' on its parent when items are added, removed, or changed", function() {
            //    a.set("embeddedCollection", [{id: 1}, {id: 2}, {id:3}]);
            //    var spy = { onChange: function() {}, onChangeEmbedded: function() {} };
            //    sinon.spy(spy, "onChange");
            //    sinon.spy(spy, "onChangeEmbedded");
            //    a.on("change", spy.onChange);
            //    a.on("change:embeddedCollection", spy.onChangeEmbedded);
//
            //    a.set("embeddedCollection", [{id: 1}, {id: 2, title: "t2"}, {id:4}]);
            //    expect(spy.onChange).to.be.calledOnce;
            //    expect(spy.onChangeEmbedded).to.be.calledOnce;
            //});

        });

        describe("#fetch", function() {

            //it("should auto-fetch embeddings of all items", function(done) {
            //    A.prototype.autoFetchRelated = ["embeddedModel"];
//
            //    var a = new A({
            //        id: 1,
            //        embeddedCollectionOfA: [
            //            { id: 1, embeddedModel: {} },
            //            { id: 2, embeddedModel: {} }
            //        ]
            //    });
            //    var e1 = a.get("embeddedCollectionOfA").get(1).get("embeddedModel"),
            //        e2 = a.get("embeddedCollectionOfA").get(2).get("embeddedModel");
//
            //    sinon.spy(e1, 'fetch');
            //    sinon.spy(e2, 'fetch');
            //    a.get("embeddedCollectionOfA").fetch();
            //    a.get("embeddedCollectionOfA").once("sync", function() {
            //        _.defer(function() {
//
            //        });
            //        expect(e1.fetch).to.be.calledOnce;
            //        expect(e2.fetch).to.be.calledOnce;
            //        done();
            //    }, this);
//
//
            //    A.prototype.autoFetchRelated = false;
            //});

        });

    });

});
