define(function(require) {
    "use strict";

    var _ = require("underscore"),
        Backbone = require("backbone-rel"),
        React = require("react"),
        BackboneMixin = require("react-mixin"),
        TestUtils = React.addons.TestUtils;

    describe("BackboneMixin", function() {

        var A = Backbone.Model.extend({
            embeddings:{
                embeddedModel: function() { return EmbeddedModel; },
                embeddedCollection: function() { return EmbeddedCollection; }
            },
            url: function() { return FIXTURES_BASE + "a_" + this.id + ".json"; }, // override for using fixtures,
            autoFetchRelated: false
        });

        var EmbeddedModel = Backbone.Model.extend({
            references: {
                oneA: A
            }
        });
        var EmbeddedCollection = Backbone.Collection.extend({
            model: EmbeddedModel
        });

        var SimpleComponent = React.createClass({
            mixins: [ BackboneMixin ],
            render: function() {
                return React.createElement("h2", null, this.props.model.get("title"));
            }
        });

        var CompositeComponent = React.createClass({
            mixins: [ BackboneMixin ],
            render: function() {
                return React.createElement("div", null,
                    React.createElement("h1", null, this.props.model.get("title")),
                    React.createElement(SimpleComponent, { model : this.props.model.get("embeddedModel"), ref: "child" })
                );
            }
        });


        it("should update the component when the bound model triggers 'deepchange'", function() {
            var a = new A({ id: 1, title: "a1"});
            var c = TestUtils.renderIntoDocument(
                React.createElement(SimpleComponent, { model: a })
            );
            expect(c).to.have.textComponent("a1");

            a.set("title", "a1_changed");
            expect(c).to.have.textComponent("a1_changed");
        });

        it("should update each component in the component tree only once for each 'deepchange' event", function() {
            var a = new A({
                id: 1,
                title: "a1",
                embeddedModel: {
                    id: 1,
                    title: "e1"
                }
            });
            var comp = TestUtils.renderIntoDocument(
                React.createElement(CompositeComponent, { model: a })
            );
            var childComp = comp.refs.child;
            sinon.spy(comp, "render");
            sinon.spy(childComp, "render");

            a.set({
                title: "a1_changed",
                embeddedModel: {
                    title: "e1_changed"
                }
            });

            expect(comp.render).to.have.been.calledOnce;
            expect(childComp.render).to.have.been.calledOnce;
            expect(comp).to.have.textComponent("a1_changed");
            expect(childComp).to.have.textComponent("e1_changed");
        });

        it("should stop listening when the component unmounts", function() {
            var a = new A({ id: 1, title: "a1"});
            var c = TestUtils.renderIntoDocument(
                React.createElement(SimpleComponent, { model: a })
            );
            React.unmountComponentAtNode(c.getDOMNode().parentNode);

            var changeModel = function() {
                a.set("title", "a1_changed");
            };
            expect(changeModel).to.not.throw(Error);
        });

        it("should not update components in the tree that did not receive the 'deepchange' event", function() {
            var a = new A({
                id: 1,
                title: "a1",
                embeddedModel: {
                    id: 1,
                    title: "e1"
                }
            });
            var comp = TestUtils.renderIntoDocument(
                React.createElement(CompositeComponent, { model: a })
            );
            var childComp = comp.refs.child;
            sinon.spy(comp, "render");
            sinon.spy(childComp, "render");

            a.set({ title: "a1_changed" });

            expect(comp.render).to.have.been.calledOnce;
            expect(childComp.render).to.have.not.been.called;
        });

    });

});