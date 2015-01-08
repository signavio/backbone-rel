


## Embeddings

An embedded object lives in its parent.

- The URL for the API endpoint of the embedded object is built  based on the parent model's URL by appending the embedded object's "urlSuffix" property.

- Alternatively, the embedded object can be managed entirely through its parent, meaning that it does not have a dedicated URL endpoint but its JSON representation is inlined in the parent JSON.


### Embedding Models

### Embedding Collections





## References

- Upon assigning a reference, the referenced model is automatically fetched from the server if it has never been synced before. 




## Auto-fetching

This can be deactivated using the "autoFetchRelated"




## Side-loading

- Side-loading referenced models' data is supported by nesting the JSON representation of the referenced object like this:

```

```
