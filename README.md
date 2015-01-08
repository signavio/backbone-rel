## References vs. Embeddings

Backbone-relationships extends Backbone by two concepts that allow applications to represent relationships between models: references and embeddings. These concepts are inspired by the MongoDB data modeling in terms of embedded and referenced documents (http://docs.mongodb.org/manual/core/data-modeling-introduction/).



### References

A reference describes a relationship between two model classes (A and B) in terms of a unidirectional link or pointer from one instance of A to one or many instances of model class B. The reference is defined on the referencing object using the ID of the referenced object.



- Upon assigning a reference, the referenced model is automatically fetched from the server if it has never been synced before.



### Embeddings

An embedded object lives in its parent.

- The URL for the API endpoint of the embedded object is built  based on the parent model's URL by appending the embedded object's "urlSuffix" property.

- Alternatively, the embedded object can be managed entirely through its parent, meaning that it does not have a dedicated URL endpoint but its JSON representation is inlined in the parent JSON.


#### Embedding Models

#### Embedding Collections





 




### Auto-fetching

This can be deactivated using the "autoFetchRelated"




### Side-loading

- Side-loading referenced models' data is supported by nesting the JSON representation of the referenced object like this:

```

```
