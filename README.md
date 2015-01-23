## References vs. Embeddings

backbone-relations extends Backbone by two concepts that allow applications to represent relationships between models: references and embeddings. These concepts are inspired by the MongoDB data modeling in terms of embedded and referenced documents (http://docs.mongodb.org/manual/core/data-modeling-introduction/).



### References

A reference describes a relationship between two model classes (A and B) in terms of a unidirectional link or pointer from one instance of A to one or many instances of B. The reference is defined on the referencing object using the ID of the referenced object.

```
var User = Backbone.Model.extend({});

var LikeCollection = Backbone.Collection.extend({
	model: Like
});

var Comment = Backbone.Model.extend({
	references: {
		author: User,           // to-one reference
		likes: LikeCollection	// to-many reference
	}
});
```

References work especially well in conjunction with backbone.uniquemodel (https://github.com/disqus/backbone.uniquemodel). If you set up a reference to a model class tracked by backbone.uniquemodel, a referenced model instance will automatically be resolved to the right instance in the unique model cache.

```
var User = UniqueModel( Backbone.Model.extend({}), "User" );

var Comment = Backbone.Model.extend({
	references: {
		author: User
	}
});
var user = new User({ id: 1, name: "John Doe" });
var comment = new Comment({ authorId: 1 });
assert(comment.get("user") === user);  // the referenced author has been resolved to the unique user instance

```


### Embeddings

An embedded object lives in its parent.

- The URL for the API endpoint of the embedded object is built  based on the parent model's URL by appending the embedded object's "urlSuffix" property.

- Alternatively, the embedded object can be managed entirely through its parent, meaning that it does not have a dedicated URL endpoint but its JSON representation is inlined in the parent JSON.


```
var MetaData = Backbone.Model.extend({});

var CommentCollection = Backbone.Collection.extend({ 
	model: Comment
});

var Post = Backbone.Model.extend({
	embeddings: {
		meta: MetaData,				// to-one embedding
		comments: CommentCollection // to-many embedding
	}
})
```


#### Embedding Models

#### Embedding Collections





 




### Auto-fetching

This can be deactivated using the "autoFetchRelated"

- Upon assigning a reference, the referenced model is automatically fetched from the server if it has never been synced before.



### Side-loading

- Side-loading referenced models' data is supported by nesting the JSON representation of the referenced object like this:

```

```
